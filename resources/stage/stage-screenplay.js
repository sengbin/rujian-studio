// ------------------------------------------------------------------------
// 名称：stage-screenplay.js
// 说明：剧本阶段的产出内容：左侧列表（剧本包正文、集、实体）、右侧编辑区、集与实体的新增和删除、集的上移下移、重新抽取、重新标注，原创文稿的集还有结构标注编辑，以及生成结束后的汇总。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：向 stage.js 的外壳登记；请求名称与 src/app/pages/stage-handlers.ts、表单名称与 src/app/forms/screenplay-form.ts 一致；集与实体的 ref 由宿主给出，页面只原样回传。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_SAVE_TEXT = 'stage.saveScreenplayText';
  const REQUEST_SAVE_EPISODE = 'stage.saveEpisode';
  const REQUEST_SAVE_ENTITY = 'stage.saveEntity';
  const REQUEST_ADD_EPISODE = 'stage.addEpisode';
  const REQUEST_DELETE_EPISODE = 'stage.deleteEpisode';
  const REQUEST_MOVE_EPISODE = 'stage.moveEpisode';
  const REQUEST_ADD_ENTITY = 'stage.addEntity';
  const REQUEST_DELETE_ENTITY = 'stage.deleteEntity';
  const REQUEST_REEXTRACT = 'stage.reextract';
  const REQUEST_REANNOTATE = 'stage.reannotate';
  const REQUEST_SAVE_ADAPTATION = 'stage.saveAdaptation';
  const REQUEST_CONFIRM_ADAPTATION = 'stage.confirmAdaptation';
  const FORM_START = 'screenplay.start';
  const SAVE_TEXT = '保存';
  const ADD_TEXT = '添加';
  const SAVED_TEXT = '已保存';
  const SAVE_STATE_DIRTY = 'dirty';
  const SAVE_STATE_SAVED = 'saved';
  // 正文按内容增高，最多长到这个行数再滚动（与阶段页的编辑区高度相当）。
  const BODY_MAX_ROWS = 20;
  const TYPE_TEXT = 'text';
  const TYPE_EPISODE = 'episode';
  const TYPE_ENTITY = 'entity';
  // 尚未保存的新条目用这个定位值。
  const NEW_REF = 'new';
  const ALIAS_SEPARATORS = /[,，、\n]/;
  const SEGMENT_KINDS = [
    { value: 'narration', label: '旁白' },
    { value: 'dialogue', label: '对白' },
    { value: 'thought', label: '心声' }
  ];
  const KIND_NARRATION = 'narration';
  const UNKNOWN_SPEAKER_LABEL = '（未知）';
  const FIDELITY_VERBATIM = 'verbatim';
  const ADAPTATION_KIND_LABELS = { subplot: '支线', character_merge: '人物合并', scene_skip: '场次跳过', other: '其他' };
  const SECOND_PRECISION = 10;
  const TOLERANCE_EPSILON = 1e-9;

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
    /** 改编清单的本地勾选：{ key: '版本:是否已确认', selected: Set<取舍项标识> }。 */
    let adaptationState = { key: '', selected: new Set() };

    /** 在最新视图中找到选中的集或实体；新增中的条目返回空白内容；找不到返回 undefined。 */
    function findItem(view, current) {
      if (current.ref === NEW_REF) {
        if (current.type === TYPE_EPISODE) return { title: '', synopsis: '', screenplayText: '', targetDurationSeconds: null };
        const draft = current.draft || {};
        return { kind: current.kind, name: draft.name || '', aliases: draft.aliases || [], description: draft.description || '', attributes: {}, isActive: true };
      }
      if (current.type === TYPE_EPISODE) return view.episodes.find((episode) => episode.ref === current.ref);
      if (current.type === TYPE_ENTITY) return view.entities.find((entity) => entity.ref === current.ref);
      return view.screenplay || undefined;
    }

    /** 实体类型的界面名称。 */
    function kindLabel(view, kind) {
      const item = view.entityKinds.find((candidate) => candidate.kind === kind);
      return item ? item.label : kind;
    }

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
        const listed = outOfRange.slice(0, 5).map((episode) => `第 ${episode.seq} 集（${referenceText(episode.reference)}）`).join('、');
        return aiUi.h('p', {
          class: 'status-error',
          text: `${counts}${adaptationNote}有 ${outOfRange.length} 集超出目标时长的容差，已自动重写 ${view.maxCalibrationRounds} 轮仍未达标（已达上限）：${listed}。可直接编辑调整后再确认采用。${note}`
        });
      }
      return aiUi.h('p', { class: 'description', text: `${counts}${adaptationNote}${note}` });
    }

    /** “参考目标 / 实测值 / 偏差”的文字，如“参考 30 秒，实测 32.5 秒，偏差 +8%”。 */
    function referenceText(reference) {
      const percent = Math.round(reference.deviationRatio * 100);
      return `参考 ${reference.targetSeconds} 秒，实测 ${reference.actualSeconds} 秒，偏差 ${percent > 0 ? '+' : ''}${percent}%`;
    }

    /** 集在左侧列表里的补充文字：有参考目标时显示“实测 / 参考 秒”，否则显示目标时长。 */
    function episodeMeta(episode) {
      if (episode.reference) return `${episode.reference.actualSeconds} / ${episode.reference.targetSeconds} 秒`;
      return episode.targetDurationSeconds ? `${episode.targetDurationSeconds} 秒` : '';
    }

    /** 选择条目；有未保存的修改时先确认。 */
    async function select(next) {
      if (next.type === selection.type && next.ref === selection.ref) return;
      if (!(await context.confirmDiscard())) return;
      editorDirty = false;
      selection = next;
      renderBody(context.getView(), bodyContainer);
    }

    /** 左侧列表中的一个按钮；warn 为 true 时补充文字标红（超出参考容差）。 */
    function renderItem(next, title, meta, warn) {
      const isSelected = next.type === selection.type && next.ref === selection.ref;
      return aiUi.listItem(
        { selected: isSelected, className: 'stage-item', onClick: () => void select(next) },
        aiUi.h('span', { class: 'stage-item__title', text: title }),
        meta ? aiUi.h('span', { class: warn ? 'stage-item__meta status-error' : 'stage-item__meta', text: meta }) : null
      );
    }

    /** 左侧列表的分组标题；可编辑时右侧带“添加”按钮。 */
    function renderHeading(text, onAdd) {
      return aiUi.h(
        'div',
        { class: 'stage-list__head' },
        aiUi.h('p', { class: 'ui-heading stage-list__heading', text }),
        onAdd ? aiUi.button({ kind: 'add', text: ADD_TEXT, compact: true, onClick: onAdd }).element : null
      );
    }

    /** 左侧列表：剧本包正文、集、实体。 */
    function renderList(view) {
      const hasStructure = view.episodes.length > 0 || view.entities.length > 0;
      const canEdit = view.actions.canEdit;
      const isNew = (type) => selection.type === type && selection.ref === NEW_REF;
      // 单个短视频只有 1 集，不能增删集。
      const canAddEpisode = canEdit && view.work.multiEpisode;
      return aiUi.list(
        { tag: 'aside', className: 'stage-list' },
        renderItem({ type: TYPE_TEXT, ref: null }, '剧本包正文', view.screenplay ? `${view.screenplay.fullText.length} 字` : ''),
        hasStructure ? null : aiUi.h('p', { class: 'description', text: '集和实体抽取完成后会显示在这里。' }),
        hasStructure
          ? renderHeading(`集（${view.episodes.length}）`, canAddEpisode ? () => void select({ type: TYPE_EPISODE, ref: NEW_REF }) : null)
          : null,
        view.episodes.map((episode) =>
          renderItem(
            { type: TYPE_EPISODE, ref: episode.ref },
            `${episode.seq}. ${episode.title}`,
            episodeMeta(episode),
            Boolean(episode.reference) && !episode.reference.withinTolerance
          )
        ),
        isNew(TYPE_EPISODE) ? renderItem({ type: TYPE_EPISODE, ref: NEW_REF }, '新增集', '未保存') : null,
        hasStructure
          ? renderHeading(
              `实体（${view.entities.length}）`,
              canEdit ? () => void select({ type: TYPE_ENTITY, ref: NEW_REF, kind: view.entityKinds[0].kind }) : null
            )
          : null,
        view.entities.map((entity) =>
          renderItem({ type: TYPE_ENTITY, ref: entity.ref }, `[${kindLabel(view, entity.kind)}] ${entity.name}`, entity.isActive ? '' : '已停用')
        ),
        isNew(TYPE_ENTITY) ? renderItem({ type: TYPE_ENTITY, ref: NEW_REF }, '新增实体', '未保存') : null
      );
    }

    /** 不能编辑时的原因。 */
    function readonlyReason(view) {
      const { run, actions } = view;
      if (actions.canEdit) return '';
      if (run.display === 'running') return '生成中，暂不能编辑。';
      if (run.display === 'failed' || run.display === 'canceled') return '生成尚未成功，暂不能编辑。';
      return '历史版本只读；如需修改，请切换到最新版本。';
    }

    /** 带标签的字段。 */
    function field(label, control, description) {
      return aiUi.field({ label, description, control }).element;
    }

    /** 剧本包正文编辑：标题与梗概只读显示，正文可改。 */
    function buildTextEditor(view, canEdit, markDirty) {
      const fullText = aiUi.textArea({ value: view.screenplay.fullText, ariaLabel: '剧本包正文', maxRows: BODY_MAX_ROWS, disabled: !canEdit, onChange: markDirty });
      return {
        fields: [
          aiUi.h('p', { class: 'description', text: `标题：${view.screenplay.title}` }),
          aiUi.h('p', { class: 'description', text: `梗概：${view.screenplay.overview}` }),
          aiUi.h('div', { class: 'stage-editor__content' }, fullText.element)
        ],
        collect: () => ({ fullText: fullText.getValue() }),
        refresh: (latest) => fullText.setValue(latest.fullText),
        request: REQUEST_SAVE_TEXT,
        note: '正文保存后，已抽取的集和实体不会自动更新，需要时点“重新抽取”。'
      };
    }

    /**
     * 结构标注（原创文稿）：每个片段一行，可修改类型和说话人，片段文字只读；不是原稿保真的剧本不显示。
     * @returns { element, collect, refresh }，collect 返回附加到集保存请求的字段，没有标注时为空对象。
     */
    function buildSegmentsEditor(view, episode, canEdit, markDirty) {
      if (view.fidelity !== FIDELITY_VERBATIM) return null;
      const characters = view.entities.filter((entity) => entity.kind === 'character' && entity.isActive).map((entity) => entity.name);
      const note = aiUi.h('p', { class: 'description' });
      const list = aiUi.h('div', { class: 'stage-segments' });
      let rows = [];

      /** 一个片段的行：类型、说话人（旁白时隐藏）、片段文字与待核对提示。 */
      function buildRow(segment) {
        const names = segment.speaker && !characters.includes(segment.speaker) ? [...characters, segment.speaker] : characters;
        const speaker = aiUi.select({
          options: [{ value: '', label: UNKNOWN_SPEAKER_LABEL }, ...names.map((name) => ({ value: name, label: name }))],
          value: segment.speaker || '',
          allowEmpty: false,
          ariaLabel: '说话人',
          disabled: !canEdit,
          onChange: markDirty
        });
        const speakerSlot = aiUi.h('div', { class: 'stage-segment__speaker', hidden: segment.kind === KIND_NARRATION }, speaker.element);
        const kind = aiUi.select({
          options: SEGMENT_KINDS,
          value: segment.kind,
          allowEmpty: false,
          ariaLabel: '片段类型',
          disabled: !canEdit,
          onChange: () => {
            speakerSlot.hidden = kind.getValue() === KIND_NARRATION;
            markDirty();
          }
        });
        const element = aiUi.h(
          'div',
          { class: segment.uncertain ? 'stage-segment is-uncertain' : 'stage-segment' },
          aiUi.h('div', { class: 'stage-segment__kind' }, kind.element),
          speakerSlot,
          aiUi.h('p', { class: 'stage-segment__text', text: segment.text.trim() }),
          segment.uncertain ? aiUi.h('span', { class: 'status-warning stage-segment__flag', text: '待核对' }) : null
        );
        return { element, kind, speaker };
      }

      /** 用最新的标注重建列表。 */
      function refresh(latest) {
        const segments = latest.segments || [];
        list.textContent = '';
        rows = segments.map(buildRow);
        list.append(...rows.map((row) => row.element));
        const uncertain = segments.filter((segment) => segment.uncertain).length;
        note.textContent =
          segments.length === 0
            ? '本集还没有结构标注。标注在抽取集和实体后自动生成；修改本集正文并保存会清除标注。'
            : `结构标注：共 ${segments.length} 个片段${uncertain > 0 ? `，其中 ${uncertain} 个待核对` : ''}。只能修改类型和说话人，片段文字不会改变；修改上面的本集正文并保存会清除标注。`;
      }

      refresh(episode);
      return {
        element: aiUi.h('div', { class: 'stage-editor__content' }, note, list),
        collect: () => (rows.length === 0 ? {} : { segments: rows.map((row) => ({ kind: row.kind.getValue(), speaker: row.speaker.getValue() })) }),
        refresh
      };
    }

    /** 集编辑：标题、梗概、目标时长、本集剧本正文，原创文稿还有结构标注。 */
    function buildEpisodeEditor(view, episode, canEdit, markDirty) {
      const title = aiUi.textInput({ value: episode.title, disabled: !canEdit, onChange: markDirty });
      const synopsis = aiUi.textArea({ value: episode.synopsis, maxRows: 4, disabled: !canEdit, onChange: markDirty });
      const duration = aiUi.textInput({
        value: episode.targetDurationSeconds === null ? '' : String(episode.targetDurationSeconds),
        disabled: !canEdit,
        onChange: markDirty
      });
      const text = aiUi.textArea({ value: episode.screenplayText, maxRows: BODY_MAX_ROWS, disabled: !canEdit, onChange: markDirty });
      const segments = buildSegmentsEditor(view, episode, canEdit, markDirty);
      return {
        fields: [
          field('集标题', title),
          field('本集梗概', synopsis),
          field('本集目标时长（秒）', duration, '可选，正整数。分镜阶段用作本集镜头总时长上限，留空不限制；已有节拍表时以节拍表为准'),
          aiUi.h('div', { class: 'stage-editor__content' }, field('本集剧本正文', text)),
          segments ? segments.element : null
        ],
        collect: () => ({
          title: title.getValue(),
          synopsis: synopsis.getValue(),
          targetDurationSeconds: duration.getValue(),
          screenplayText: text.getValue(),
          ...(segments ? segments.collect() : {})
        }),
        refresh: (latest) => {
          title.setValue(latest.title);
          synopsis.setValue(latest.synopsis);
          duration.setValue(latest.targetDurationSeconds === null ? '' : String(latest.targetDurationSeconds));
          text.setValue(latest.screenplayText);
          if (segments) segments.refresh(latest);
        },
        request: REQUEST_SAVE_EPISODE,
        note: ''
      };
    }

    /** 实体编辑：名称、别名、摘要、按类型区分的设定、是否启用；新增时可选类型，切换类型由 onKindChange 重建编辑区。 */
    function buildEntityEditor(view, entity, canEdit, markDirty, onKindChange) {
      const kind = view.entityKinds.find((candidate) => candidate.kind === entity.kind);
      const kindControl = onKindChange
        ? aiUi.select({
            options: view.entityKinds.map((item) => ({ value: item.kind, label: item.label })),
            value: entity.kind,
            allowEmpty: false,
            ariaLabel: '实体类型',
            onChange: () => onKindChange(kindControl.getValue())
          })
        : null;
      const name = aiUi.textInput({ value: entity.name, disabled: !canEdit, onChange: markDirty });
      const aliases = aiUi.textInput({ value: entity.aliases.join('，'), disabled: !canEdit, onChange: markDirty });
      const description = aiUi.textArea({ value: entity.description, minRows: 1, maxRows: 3, disabled: !canEdit, onChange: markDirty });
      const active = aiUi.switchControl({ label: '启用', checked: entity.isActive, disabled: !canEdit, onChange: markDirty });
      const attributes = new Map(
        kind.attributes.map((attribute) => [
          attribute.key,
          // 表演与动作按情绪分条，内容长，多给几行。
          aiUi.textArea({ value: entity.attributes[attribute.key] || '', minRows: 1, maxRows: attribute.key === 'performance' ? 8 : 3, disabled: !canEdit, onChange: markDirty })
        ])
      );
      return {
        fields: [
          kindControl ? field('类型', kindControl, '切换类型会重置下面的设定字段') : aiUi.h('p', { class: 'description', text: `类型：${kind.label}（不能修改）` }),
          field('名称', name, '同类型内不能重复；改名不影响已有绑定和镜头引用'),
          field('别名', aliases, '多个别名用逗号分隔'),
          field('设定摘要', description),
          ...kind.attributes.map((attribute) => field(attribute.label, attributes.get(attribute.key))),
          active.element
        ],
        collect: () => ({
          name: name.getValue(),
          aliases: aliases.getValue(),
          description: description.getValue(),
          attributes: Object.fromEntries([...attributes].map(([key, control]) => [key, control.getValue()])),
          isActive: active.getValue()
        }),
        refresh: (latest) => {
          name.setValue(latest.name);
          aliases.setValue(latest.aliases.join('，'));
          description.setValue(latest.description);
          active.setValue(latest.isActive);
          for (const [key, control] of attributes) control.setValue(latest.attributes[key] || '');
        },
        request: REQUEST_SAVE_ENTITY,
        note: ''
      };
    }

    /** 保存当前条目（新增中的条目则添加）；已确认的版本被编辑时先提示会回到待确认。 */
    async function save() {
      const view = context.getView();
      const isNew = selection.ref === NEW_REF;
      if (view.actions.editNeedsConfirm) {
        const confirmed = await aiUi.confirm({
          title: isNew ? '添加' : '保存修改',
          message: `该版本已确认采用。${isNew ? '添加' : '保存'}后将回到待确认，需要重新确认。`,
          confirmText: isNew ? '添加' : '保存',
          cancelText: '取消'
        });
        if (!confirmed) return;
      }
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
      if (view.actions.editNeedsConfirm) lines.push('该版本已确认采用，删除后将回到待确认。');
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
      if (view.actions.editNeedsConfirm) {
        const confirmed = await aiUi.confirm({
          title: '调整集的顺序',
          message: '该版本已确认采用。调整顺序后将回到待确认，需要重新确认。',
          confirmText: '调整',
          cancelText: '取消'
        });
        if (!confirmed) return;
      }
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
      const saveButton = aiUi.button({ text: isNew ? ADD_TEXT : SAVE_TEXT, variant: 'primary', disabled: !isNew, onClick: () => void save() });
      /** 保存按钮只在有修改时可点，保存后显示“已保存”，再次修改后恢复；新增的条目始终可点“添加”。 */
      const setSaveState = (state) => {
        saveButton.setText(state === SAVE_STATE_SAVED ? SAVED_TEXT : isNew ? ADD_TEXT : SAVE_TEXT);
        saveButton.setDisabled(!isNew && state !== SAVE_STATE_DIRTY);
      };
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

    /** 按勾选在本地重算预计总量，公式与宿主一致：节省字数相加，按语速换算成秒；不向宿主发请求。 */
    function estimateAdaptation(adaptation, selected) {
      const saved = adaptation.options.filter((option) => selected.has(option.id)).reduce((sum, option) => sum + option.estimatedWordsSaved, 0);
      const words = Math.max(0, adaptation.baselineWords - saved);
      const seconds = Math.round((words / adaptation.wordsPerSecond) * SECOND_PRECISION) / SECOND_PRECISION;
      const within = Math.abs(seconds - adaptation.targetSeconds) <= adaptation.targetSeconds * adaptation.toleranceRatio + TOLERANCE_EPSILON;
      return { words, seconds, within };
    }

    /** 保存当前勾选（不改变确认状态），刷新后勾选不丢失。 */
    function saveAdaptationSelection(view) {
      return context.runAction(REQUEST_SAVE_ADAPTATION, { id: view.run.id, selected: [...adaptationState.selected] });
    }

    /** 确认取舍：之后在后台按取舍继续生成剧本正文。 */
    async function confirmAdaptation(view) {
      const confirmed = await aiUi.confirm({
        title: '确认改编取舍',
        message: `将按勾选的 ${adaptationState.selected.size} 项取舍生成剧本正文，确认后不能再修改取舍。`,
        confirmText: '确认并生成'
      });
      if (!confirmed) return;
      if (await context.runAction(REQUEST_CONFIRM_ADAPTATION, { id: view.run.id, selected: [...adaptationState.selected] })) {
        await context.reload();
      }
    }

    /**
     * 结构性改编清单：内容明显超出目标时长时，列出可取舍的支线、人物合并与场次，勾选后顶部实时显示预计总时长，确认后才生成剧本正文。
     * 同一版本内以本地勾选为准，换版本或确认后按宿主的状态重置。
     */
    function renderAdaptation(view) {
      const { adaptation, actions, run } = view;
      const key = `${run.id}:${adaptation.confirmed}`;
      if (adaptationState.key !== key) {
        adaptationState = { key, selected: new Set(adaptation.options.filter((option) => option.selected).map((option) => option.id)) };
      }
      const editable = actions.canConfirmAdaptation;
      const status = aiUi.h('p', { attrs: { role: 'status' } });
      const refreshStatus = () => {
        const estimate = estimateAdaptation(adaptation, adaptationState.selected);
        const tolerance = Math.round(adaptation.toleranceRatio * 100);
        status.className = estimate.within ? 'status-success' : 'status-warning';
        status.textContent =
          `当前预计总时长 ${estimate.seconds} 秒 / 目标时长 ${adaptation.targetSeconds} 秒（容差 ±${tolerance}%，改编前预计 ${adaptation.baselineSeconds} 秒）。` +
          (estimate.within
            ? '已进入容差范围。'
            : estimate.seconds > adaptation.targetSeconds
              ? '仍超出目标，正文生成后还会再做轻量校准。'
              : '已低于目标时长，取舍偏多，可取消部分勾选。');
      };
      refreshStatus();

      const rows = adaptation.options.map((option) => {
        const box = aiUi.checkbox({
          label: `${ADAPTATION_KIND_LABELS[option.kind] || option.kind}：${option.label}`,
          checked: adaptationState.selected.has(option.id),
          disabled: !editable,
          onChange: (checked) => {
            if (checked) adaptationState.selected.add(option.id);
            else adaptationState.selected.delete(option.id);
            refreshStatus();
            void saveAdaptationSelection(view);
          }
        });
        const refs = option.affectedRefs.length > 0 ? `；涉及：${option.affectedRefs.join('、')}` : '';
        return aiUi.h(
          'div',
          { class: 'stage-adaptation__item' },
          box.element,
          aiUi.h('p', { class: 'description', text: `${option.reason.replace(/[。.；;\s]+$/, '')}；预计节省约 ${option.estimatedWordsSaved} 字 / ${option.estimatedSecondsSaved} 秒${refs}。` })
        );
      });

      const hint = editable
        ? '已确认的创意内容明显超出目标时长。请勾选要取舍的内容（默认按模型建议勾选），确认后才会生成剧本正文。勾选只在本地重算预计时长，不会调用模型。'
        : adaptation.confirmed
          ? '改编取舍已确认，正在按取舍生成剧本正文。'
          : readonlyReason(view);
      return aiUi.h(
        'section',
        { class: 'stage-editor stage-adaptation' },
        aiUi.h('p', { class: 'description', text: hint }),
        status,
        rows,
        editable ? aiUi.h('div', { class: 'stage-editor__actions' }, aiUi.button({ text: '确认取舍并生成正文', variant: 'primary', onClick: () => void confirmAdaptation(view) }).element) : null
      );
    }

    /** 主体：左侧列表与右侧编辑区；选中的条目不存在时回到剧本包正文；还没有正文时显示改编取舍清单（如有）。 */
    function renderBody(view, container) {
      bodyContainer = container;
      container.textContent = '';
      if (!view.screenplay) {
        editorControls = null;
        editorKey = '';
        const placeholder = view.adaptation
          ? renderAdaptation(view)
          : aiUi.h('p', { class: 'description', text: '剧本包正文生成后会显示在这里。' });
        container.append(renderList(view), aiUi.h('div', { class: 'stage-detail' }, placeholder));
        return;
      }
      if (selection.type !== TYPE_TEXT && (!findItem(view, selection) || (selection.ref === NEW_REF && !view.actions.canEdit))) {
        selection = { type: TYPE_TEXT, ref: null };
        editorDirty = false;
      }
      container.append(renderList(view), aiUi.h('div', { class: 'stage-detail' }, renderEditor(view)));
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
