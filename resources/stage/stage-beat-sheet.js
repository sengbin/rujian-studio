// ------------------------------------------------------------------------
// 名称：stage-beat-sheet.js
// 说明：节拍表阶段的产出内容：左侧节拍列表（带参考时长与字数）、右侧节拍的剧情内容编辑、按节拍保存，以及顶部的目标时长汇总。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：向 stage.js 的外壳登记；请求名称与 src/app/pages/stage-handlers.ts、重新生成表单名称与 src/app/forms/beat-sheet-form.ts 一致；参考时长与字数只是参考基准，不是硬性限制，界面不做超标提示。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_SAVE_BEAT = 'stage.saveBeat';
  const FORM_REGENERATE = 'beatSheet.start';
  const SAVE_TEXT = '保存本拍';
  const SAVED_TEXT = '已保存';
  const SAVE_STATE_DIRTY = 'dirty';
  const SAVE_STATE_SAVED = 'saved';
  // 剧情内容按内容增高，最多长到这个行数再滚动。
  const BODY_MAX_ROWS = 12;

  /** 参考时长与字数的文字，如“约 4.5 秒 / 18 字”。 */
  function budgetText(beat) {
    return `约 ${beat.estimatedSeconds} 秒 / ${beat.estimatedWords} 字`;
  }

  /**
   * 创建节拍表阶段的内容。
   * @param context 外壳提供的 { runAction, showMessage, reload, getView, confirmDiscard }。
   */
  function create(context) {
    let selectedSeq = null;
    /** 编辑器当前对应的“版本:节拍”，用来判断切换后是否需要重建。 */
    let editorKey = '';
    let editorDirty = false;
    let editorControls = null;
    let bodyContainer = null;

    /** 生成结束后的汇总：模板、目标时长与换算字数、参考集数。 */
    function renderSummary(view) {
      const { params, beats, templateLabel } = view;
      if (!params || beats.length === 0) return null;
      const words = beats.reduce((sum, beat) => sum + beat.estimatedWords, 0);
      const episodes = view.work.multiEpisode ? `，参考集数 ${params.episodeCount} 集` : '';
      return aiUi.h('p', {
        class: 'description',
        text: `${templateLabel}：目标时长 ${params.targetDurationSeconds} 秒，按 ${params.wordsPerSecond} 字/秒约 ${words} 字，共 ${beats.length} 个节拍${episodes}。参考时长与字数只是基准，不是硬性限制。`
      });
    }

    /** 选择节拍；有未保存的修改时先确认。 */
    async function selectBeat(seq) {
      if (seq === selectedSeq) return;
      if (!(await context.confirmDiscard())) return;
      editorDirty = false;
      selectedSeq = seq;
      renderBody(context.getView(), bodyContainer);
    }

    /** 保存当前节拍；保存中再次触发（双击、快捷键）直接忽略，避免重复提交。 */
    let isSaving = false;
    async function saveBeat() {
      if (isSaving) return;
      isSaving = true;
      try {
        await performSaveBeat();
      } finally {
        isSaving = false;
      }
    }

    /** 保存当前节拍；已确认的版本被编辑时先提示会回到待确认。 */
    async function performSaveBeat() {
      const view = context.getView();
      if (view.actions.editNeedsConfirm) {
        const confirmed = await aiUi.confirm({
          title: '保存修改',
          message: '该版本已确认采用。保存后将回到待确认，需要重新确认。',
          confirmText: '保存',
          cancelText: '取消'
        });
        if (!confirmed) return;
      }
      const result = await context.runAction(REQUEST_SAVE_BEAT, {
        id: view.run.id,
        seq: selectedSeq,
        synopsis: editorControls.synopsis.getValue()
      });
      if (result) {
        editorDirty = false;
        await context.reload();
        // 重新加载后编辑区可能被重建，按钮状态要在重建后再设置。
        if (editorControls) editorControls.setSaveState(SAVE_STATE_SAVED);
        context.showMessage('已保存。', false);
      }
    }

    /** 节拍列表：名称与参考预算；当前节拍高亮。 */
    function renderBeatList(view) {
      const { beats } = view;
      const items = beats.map((beat) => {
        const isSelected = beat.seq === selectedSeq;
        return aiUi.listItem(
          { selected: isSelected, className: 'stage-item', onClick: () => void selectBeat(beat.seq) },
          aiUi.h('span', { class: 'stage-item__title', text: `${beat.seq}. ${beat.label}` }),
          aiUi.h('span', { class: 'stage-item__meta', text: budgetText(beat) })
        );
      });
      return aiUi.list(
        { tag: 'aside', className: 'stage-list' },
        aiUi.h('p', { class: 'description', text: `共 ${beats.length} 个节拍` }),
        beats.length === 0 ? aiUi.h('p', { class: 'description', text: '节拍表生成后会显示在这里。' }) : null,
        items
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

    /** 节拍编辑区：切换节拍时重建；同一节拍有未保存的修改时保留输入。 */
    function renderEditor(view, beat) {
      const key = `${view.run.id}:${beat.seq}:${view.actions.canEdit}:${view.actions.editNeedsConfirm}`;
      if (editorControls && editorKey === key) {
        if (!editorDirty) editorControls.synopsis.setValue(beat.synopsis);
        return editorControls.element;
      }

      editorKey = key;
      editorDirty = false;
      const markDirty = () => {
        editorDirty = true;
        setSaveState(SAVE_STATE_DIRTY);
      };
      const canEdit = view.actions.canEdit;
      const synopsis = aiUi.textArea({ value: beat.synopsis, ariaLabel: '剧情内容', maxRows: BODY_MAX_ROWS, disabled: !canEdit, onChange: markDirty });
      const reason = readonlyReason(view);
      const saveButton = aiUi.button({ text: SAVE_TEXT, variant: 'primary', disabled: true, onClick: () => void saveBeat() });
      /** 保存按钮只在有修改时可点，保存后显示“已保存”，再次修改后恢复。 */
      const setSaveState = (state) => {
        saveButton.setText(state === SAVE_STATE_SAVED ? SAVED_TEXT : SAVE_TEXT);
        saveButton.setDisabled(state !== SAVE_STATE_DIRTY);
      };

      const refs = beat.sourceRefs.length === 0 ? '' : `依据原文第 ${beat.sourceRefs.join('、')} 段`;
      const element = aiUi.h(
        'section',
        { class: 'stage-editor' },
        aiUi.h('p', { class: 'description', text: `戏剧目的：${beat.purpose}${refs ? `；${refs}` : ''}` }),
        aiUi.h('div', { class: 'stage-editor__content' }, synopsis.element),
        reason ? aiUi.h('p', { class: 'description', text: reason }) : null,
        canEdit ? aiUi.h('div', { class: 'stage-editor__actions' }, saveButton.element) : null
      );
      editorControls = { key, element, synopsis, setSaveState };
      return element;
    }

    /** 主体：节拍列表与编辑区。 */
    function renderBody(view, container) {
      bodyContainer = container;
      container.textContent = '';
      const { beats } = view;
      if (beats.length === 0) {
        editorControls = null;
        editorKey = '';
        container.append(renderBeatList(view));
        return;
      }
      if (!beats.some((beat) => beat.seq === selectedSeq)) selectedSeq = beats[0].seq;
      const beat = beats.find((item) => item.seq === selectedSeq);
      container.append(
        renderBeatList(view),
        aiUi.h(
          'div',
          { class: 'stage-detail' },
          aiUi.h('p', { class: 'description', text: `${beat.label}（${budgetText(beat)}，占 ${Math.round(beat.targetRatio * 100)}%）` }),
          renderEditor(view, beat)
        )
      );
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
    stage: 'beat_sheet',
    label: '节拍表',
    regenerateForm: FORM_REGENERATE,
    keptNote: '素材整理的进度已保留',
    discardMessage: '当前节拍有未保存的修改，放弃这些修改？',
    approveNote: () => '确认后它将作为创意（参考节拍表模式）、剧本与分镜阶段的时长参考基准。',
    create
  });
})();
