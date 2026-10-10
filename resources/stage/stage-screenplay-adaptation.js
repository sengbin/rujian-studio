// ------------------------------------------------------------------------
// 名称：stage-screenplay-adaptation.js
// 说明：剧本阶段的“改编取舍清单”面板：创意内容明显超出目标时长时，列出可取舍的支线、人物合并与场次，勾选后顶部实时显示预计总时长，确认后才生成剧本正文。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 stage-screenplay.js 拆出；请求名称与 src/app/pages/stage-handlers.ts 一致；对外是 window.aiScreenplayAdaptation.create(context)，返回 render(view)；同一版本内以本地勾选为准，换版本或确认后按宿主的状态重置；必须晚于 stage-editor-common.js、先于 stage-screenplay.js 加载。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_SAVE_ADAPTATION = 'stage.saveAdaptation';
  const REQUEST_CONFIRM_ADAPTATION = 'stage.confirmAdaptation';
  const ADAPTATION_KIND_LABELS = { subplot: '支线', character_merge: '人物合并', scene_skip: '场次跳过', other: '其他' };
  const SECOND_PRECISION = 10;
  const TOLERANCE_EPSILON = 1e-9;

  const { readonlyReason } = window.aiStageEditor;

  /** 按勾选在本地重算预计总量，公式与宿主一致：节省字数相加，按语速换算成秒；不向宿主发请求。 */
  function estimateAdaptation(adaptation, selected) {
    const saved = adaptation.options.filter((option) => selected.has(option.id)).reduce((sum, option) => sum + option.estimatedWordsSaved, 0);
    const words = Math.max(0, adaptation.baselineWords - saved);
    const seconds = Math.round((words / adaptation.wordsPerSecond) * SECOND_PRECISION) / SECOND_PRECISION;
    const within = Math.abs(seconds - adaptation.targetSeconds) <= adaptation.targetSeconds * adaptation.toleranceRatio + TOLERANCE_EPSILON;
    return { words, seconds, within };
  }

  /**
   * 创建改编取舍清单面板。
   * @param context 外壳提供的 { runAction, reload }。
   * @returns {{ render: (view: object) => HTMLElement }}
   */
  function create(context) {
    /** 改编清单的本地勾选：{ key: '版本:是否已确认', selected: Set<取舍项标识> }。 */
    let adaptationState = { key: '', selected: new Set() };

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
    function render(view) {
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

    return { render };
  }

  window.aiScreenplayAdaptation = { create };
})();
