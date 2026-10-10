// ------------------------------------------------------------------------
// 名称：stage-screenplay.js
// 说明：剧本阶段的产出内容：左侧列表（剧本包正文、集、实体）、右侧编辑区、集与实体的新增和删除、集的上移下移、重新抽取、重新标注，原创文稿的集还有结构标注编辑，以及生成结束后的汇总。本文件只保存选中状态并装配各部分，列表、编辑器与改编清单在下面列出的子脚本里。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：向 stage.js 的外壳登记；请求名称与 src/app/pages/stage-handlers.ts、表单名称与 src/app/forms/screenplay-form.ts 一致；集与实体的 ref 由宿主给出，页面只原样回传；只读原因、保存按钮状态、已确认版本被编辑时的确认、偏差文案与汇总列表写法来自 stage-editing.js（aiStageEditor），左侧列表来自 stage-screenplay-list.js（aiScreenplayList），三种条目的编辑器来自 stage-screenplay-editors.js（aiScreenplayEditors），改编取舍清单来自 stage-screenplay-adaptation.js（aiScreenplayAdaptation），这些脚本都必须先于本文件加载。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_ADD_EPISODE = 'stage.addEpisode';
  const REQUEST_DELETE_EPISODE = 'stage.deleteEpisode';
  const REQUEST_MOVE_EPISODE = 'stage.moveEpisode';
  const REQUEST_ADD_ENTITY = 'stage.addEntity';
  const REQUEST_DELETE_ENTITY = 'stage.deleteEntity';
  const REQUEST_REEXTRACT = 'stage.reextract';
  const REQUEST_REANNOTATE = 'stage.reannotate';
  const FORM_START = 'screenplay.start';
  const SAVE_TEXT = '保存';
  const ALIAS_SEPARATORS = /[,，、\n]/;

  const { SAVE_STATE_DIRTY, SAVE_STATE_SAVED, DELETE_REOPEN_NOTE, readonlyReason, createSaveButton, confirmReopening, describeReference, limitedList } = window.aiStageEditor;
  const { ADD_TEXT, TYPE_TEXT, TYPE_EPISODE, TYPE_ENTITY, NEW_REF, findItem } = window.aiScreenplayList;
  const { buildTextEditor, buildEpisodeEditor, buildEntityEditor } = window.aiScreenplayEditors;

  /** “参考目标 / 实测值 / 偏差”的文字，如“参考 30 秒，实测 32.5 秒，偏差 +8%”。 */
  function referenceText(reference) {
    return describeReference(`${reference.targetSeconds} 秒`, `${reference.actualSeconds} 秒`, reference.deviationRatio);
  }

  /**
   * 创建剧本阶段的内容。
   * @param context 外壳提供的 { runAction, showMessage, reload, getView, confirmDiscard }。
   */
  function create(context) {
    /** 当前选中的条目：{ type, ref, kind?, draft? }；ref 仅集和实体有，为 NEW_REF 表示正在新增（实体带 kind）。 */
    let selection = { type: TYPE_TEXT, ref: null };
    /** 编辑器当前对应的“版本:条目”，用来判断切换后是否需要重建。 */
    let editorKey = '';
    let editorDirty = false;
    let editorControls = null;
    let bodyContainer = null;
    const adaptationPanel = aiScreenplayAdaptation.create(context);

    /** 生成结束后的汇总：集数、实体数，以及编辑的影响范围；有节拍表时说明超出时长容差的集。 */
    function renderSummary(view) {
      if (!view.screenplay) return null;
      const counts = `共 ${view.episodes.length} 集、${view.entities.length} 个实体。`;
      const note = view.merged
        ? '集和实体已合并到作品，编辑将直接修改作品的集和实体。'
        : '确认采用前，集和实体只是抽取结果，不影响作品已有的数据；确认采用时才会合并。';
      const adopted = view.adaptation ? view.adaptation.options.filter((option) => option.selected).length : 0;
      const adaptationNote = view.adaptation && adopted > 0 ? `已按确认的 ${adopted} 项改编取舍生成。` : '';
      const outOfRange = view.episodes.filter((episode) => episode.reference && !episode.reference.withinTolerance);
      if (outOfRange.length > 0) {
        const { listed } = limitedList(outOfRange, (episode) => `第 ${episode.seq} 集（${referenceText(episode.reference)}）`, '集');
        return aiUi.h('p', {
          class: 'status-error',
          text: `${counts}${adaptationNote}有 ${outOfRange.length} 集超出目标时长的容差，已自动重写 ${view.maxCalibrationRounds} 轮仍未达标（已达上限）：${listed}。可直接编辑调整后再确认采用。${note}`
        });
      }
      return aiUi.h('p', { class: 'description', text: `${counts}${adaptationNote}${note}` });
    }

    /** 选择条目；有未保存的修改时先确认。 */
    async function select(next) {
      if (next.type === selection.type && next.ref === selection.ref) return;
      if (!(await context.confirmDiscard())) return;
      editorDirty = false;
      selection = next;
      renderBody(context.getView(), bodyContainer);
    }

    /** 保存当前条目（新增中的条目则添加）；保存中再次触发（双击、快捷键）直接忽略，避免重复添加。 */
    let isSaving = false;
    async function save() {
      if (isSaving) return;
      isSaving = true;
      try {
        await performSave();
      } finally {
        isSaving = false;
      }
    }

    /** 保存当前条目（新增中的条目则添加）；已确认的版本被编辑时先提示会回到待确认。 */
    async function performSave() {
      const view = context.getView();
      const isNew = selection.ref === NEW_REF;
      const verb = isNew ? '添加' : '保存';
      if (!(await confirmReopening(view, { title: isNew ? '添加' : '保存修改', action: verb, confirmText: verb }))) return;
      const { built } = editorControls;
      const payload = { id: view.run.id, ...built.collect() };
      if (isNew) {
        if (selection.type === TYPE_ENTITY) payload.kind = selection.kind;
      } else if (selection.type !== TYPE_TEXT) {
        payload.ref = selection.ref;
      }
      const addRequest = selection.type === TYPE_EPISODE ? REQUEST_ADD_EPISODE : REQUEST_ADD_ENTITY;
      const result = await context.runAction(isNew ? addRequest : built.request, payload);
      if (result) {
        editorDirty = false;
        // 新增成功后选中刚加入的条目。
        if (isNew) selection = { type: selection.type, ref: result.ref };
        await context.reload();
        // 重新加载后编辑区可能被重建（如已确认的版本保存后回到待确认），按钮状态要在重建后再设置。
        if (editorControls) editorControls.setSaveState(SAVE_STATE_SAVED);
        context.showMessage(isNew ? '已添加。' : built.note ? `已保存。${built.note}` : '已保存。', false);
      }
    }

    /** 删除当前的集或实体；先确认，并说明影响范围。 */
    async function remove() {
      const view = context.getView();
      const item = findItem(view, selection);
      const isEpisode = selection.type === TYPE_EPISODE;
      const lines = isEpisode
        ? [`删除第 ${item.seq} 集“${item.title}”后，后面的集序号会前移。`]
        : [`删除实体“${item.name}”。`];
      if (isEpisode && view.merged && (view.downstreamEpisodes || []).includes(item.seq)) lines.push('这一集的分镜脚本也会一并删除。');
      if (!isEpisode && view.merged) lines.push('已被镜头、声音或资产绑定引用的实体不能删除，可改为停用。');
      if (view.actions.editNeedsConfirm) lines.push(DELETE_REOPEN_NOTE);
      const confirmed = await aiUi.confirm({
        title: isEpisode ? '删除集' : '删除实体',
        message: lines,
        confirmText: '删除',
        variant: 'danger'
      });
      if (!confirmed) return;
      if (await context.runAction(isEpisode ? REQUEST_DELETE_EPISODE : REQUEST_DELETE_ENTITY, { id: view.run.id, ref: selection.ref })) {
        editorDirty = false;
        selection = { type: TYPE_TEXT, ref: null };
        await context.reload();
        context.showMessage('已删除。', false);
      }
    }

    /** 把当前的集与前一集（up）或后一集（down）互换位置；有未保存的修改时先确认放弃，已确认的版本先提示会回到待确认。 */
    async function moveEpisode(direction) {
      const view = context.getView();
      if (!(await context.confirmDiscard())) return;
      if (!(await confirmReopening(view, { title: '调整集的顺序', action: '调整顺序', confirmText: '调整' }))) return;
      const result = await context.runAction(REQUEST_MOVE_EPISODE, { id: view.run.id, ref: selection.ref, direction });
      if (result) {
        editorDirty = false;
        // 未合并时定位值是抽取结果中的位置，要跟着集走。
        selection = { type: TYPE_EPISODE, ref: result.ref };
        await context.reload();
        context.showMessage('已调整顺序。', false);
      }
    }

    /** 用当前正文重新抽取集和实体。 */
    async function reextract() {
      if (!(await context.confirmDiscard())) return;
      const confirmed = await aiUi.confirm({
        title: '重新抽取',
        message: '将用当前剧本包正文重新抽取集和实体，覆盖现有的抽取结果（包括你对集和实体所做的修改）。',
        confirmText: '重新抽取'
      });
      if (!confirmed) return;
      editorDirty = false;
      if (await context.runAction(REQUEST_REEXTRACT, { id: context.getView().run.id })) await context.reload();
    }

    /** 重新标注：保留现有的集和实体，重做所有集的结构标注（包括对标注所做的修改）。 */
    async function reannotate() {
      if (!(await context.confirmDiscard())) return;
      const confirmed = await aiUi.confirm({
        title: '重新标注',
        message: '将保留现有的集和实体，重新为所有集生成结构标注，覆盖现有的标注（包括你对标注所做的修改）。',
        confirmText: '重新标注'
      });
      if (!confirmed) return;
      editorDirty = false;
      if (await context.runAction(REQUEST_REANNOTATE, { id: context.getView().run.id })) await context.reload();
    }

    /** 右侧编辑区：切换条目时重建；同一条目有未保存的修改时保留输入。 */
    function renderEditor(view) {
      const item = findItem(view, selection);
      const canEdit = view.actions.canEdit;
      const key = `${view.run.id}:${selection.type}:${selection.ref}:${selection.kind || ''}:${view.merged}:${canEdit}:${view.actions.editNeedsConfirm}`;
      if (editorControls && editorKey === key) {
        if (!editorDirty) editorControls.built.refresh(item);
        return editorControls.element;
      }

      editorKey = key;
      editorDirty = false;
      const isNew = selection.ref === NEW_REF;
      // 新增的条目始终可点“添加”，已有条目只在有修改时可点“保存”。
      const { button: saveButton, setSaveState } = createSaveButton({ text: isNew ? ADD_TEXT : SAVE_TEXT, alwaysEnabled: isNew, onClick: () => void save() });
      const markDirty = () => {
        editorDirty = true;
        setSaveState(SAVE_STATE_DIRTY);
      };
      /** 新增实体时切换类型：保留已填的名称、别名和摘要，重建编辑区。 */
      const changeKind = (nextKind) => {
        const values = editorControls.built.collect();
        const wasDirty = editorDirty;
        const aliases = values.aliases.split(ALIAS_SEPARATORS).map((alias) => alias.trim()).filter(Boolean);
        selection = { type: TYPE_ENTITY, ref: NEW_REF, kind: nextKind, draft: { name: values.name, aliases, description: values.description } };
        renderBody(context.getView(), bodyContainer);
        editorDirty = wasDirty;
      };

      const built =
        selection.type === TYPE_EPISODE
          ? buildEpisodeEditor(view, item, canEdit, markDirty)
          : selection.type === TYPE_ENTITY
            ? buildEntityEditor(view, item, canEdit, markDirty, isNew ? changeKind : null)
            : buildTextEditor(view, canEdit, markDirty);
      const reason = readonlyReason(view);
      // 单个短视频只有 1 集，不能删除。
      const canRemove = canEdit && !isNew && selection.type !== TYPE_TEXT && !(selection.type === TYPE_EPISODE && !view.work.multiEpisode);
      // 只有多集的已有集可以调整顺序。
      const canMove = canEdit && !isNew && selection.type === TYPE_EPISODE && view.work.multiEpisode;
      const episodeIndex = view.episodes.findIndex((episode) => episode.ref === selection.ref);
      const actions = [
        canEdit ? saveButton.element : null,
        canMove ? aiUi.button({ text: '上移', disabled: episodeIndex === 0, onClick: () => void moveEpisode('up') }).element : null,
        canMove ? aiUi.button({ text: '下移', disabled: episodeIndex === view.episodes.length - 1, onClick: () => void moveEpisode('down') }).element : null,
        canEdit && selection.type === TYPE_TEXT && view.actions.canReextract
          ? aiUi.button({ text: '重新抽取', onClick: () => void reextract() }).element
          : null,
        canEdit && selection.type === TYPE_TEXT && view.actions.canReannotate
          ? aiUi.button({ text: '重新标注', onClick: () => void reannotate() }).element
          : null,
        canRemove ? aiUi.button({ kind: 'delete', text: '删除', onClick: () => void remove() }).element : null
      ].filter(Boolean);

      const element = aiUi.h(
        'section',
        { class: 'stage-editor stage-editor--fields' },
        built.fields,
        reason ? aiUi.h('p', { class: 'description', text: reason }) : null,
        actions.length > 0 ? aiUi.h('div', { class: 'stage-editor__actions' }, actions) : null
      );
      editorControls = { key, element, built, setSaveState };
      return element;
    }

    /** 主体：左侧列表与右侧编辑区；选中的条目不存在时回到剧本包正文；还没有正文时显示改编取舍清单（如有）。 */
    function renderBody(view, container) {
      bodyContainer = container;
      container.textContent = '';
      if (!view.screenplay) {
        editorControls = null;
        editorKey = '';
        const placeholder = view.adaptation
          ? adaptationPanel.render(view)
          : aiUi.h('p', { class: 'description', text: '剧本包正文生成后会显示在这里。' });
        container.append(aiScreenplayList.render(view, selection, select), aiUi.h('div', { class: 'stage-detail' }, placeholder));
        return;
      }
      if (selection.type !== TYPE_TEXT && (!findItem(view, selection) || (selection.ref === NEW_REF && !view.actions.canEdit))) {
        selection = { type: TYPE_TEXT, ref: null };
        editorDirty = false;
      }
      container.append(aiScreenplayList.render(view, selection, select), aiUi.h('div', { class: 'stage-detail' }, renderEditor(view)));
    }

    return {
      render: renderBody,
      renderSummary,
      isDirty: () => editorDirty,
      discard: () => {
        editorDirty = false;
      }
    };
  }

  window.aiStage.registerStage({
    stage: 'screenplay',
    label: '剧本',
    regenerateForm: FORM_START,
    keptNote: '已完成的步骤已保留',
    discardMessage: '当前内容有未保存的修改，放弃这些修改？',
    approveNote: (view) => {
      const base = view.merged
        ? '确认后它将继续作为后续分镜脚本的依据。'
        : '确认后将把抽取的集和实体合并到作品：集按序号更新，实体按类型与名称合并并保留已有绑定，不再出现的实体会被停用；它也将作为后续分镜脚本的依据。';
      const blocked = view.blockedEpisodes || [];
      const removed = view.removedEpisodes || [];
      const downstream = (view.downstreamEpisodes || []).filter((seq) => !blocked.includes(seq));
      const notes = [base];
      if (downstream.length > 0) {
        notes.push(`第 ${downstream.join('、')} 集已有分镜脚本，确认后它们会显示“上游已变更”，不会自动更新。`);
      }
      if (removed.length > 0) {
        notes.push(`原有的第 ${removed.join('、')} 集在新版本中已不存在（不再属于剧本），确认后将被移除。`);
      }
      if (blocked.length > 0) {
        notes.push(
          `原有的第 ${blocked.join('、')} 集在新版本中已不存在（不再属于剧本），但已有分镜脚本、资产绑定或生成参数，不能直接移除，确认会被拒绝；请先在新版本中保留这些集。`
        );
      }
      return notes.join('');
    },
    confirmRegenerate: (view) =>
      view.merged || view.versions.some((item) => item.isCurrent)
        ? aiUi.confirm({
            title: '重新生成剧本',
            message: '重新生成不会立即改动已有的集和实体，确认采用新版本时才合并；已有绑定与参数保留。',
            confirmText: '继续'
          })
        : Promise.resolve(true),
    create
  });
})();
