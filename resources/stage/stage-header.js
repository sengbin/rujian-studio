// ------------------------------------------------------------------------
// 名称：stage-header.js
// 说明：阶段产出层的头部与进度区：作品信息、版本下拉、状态文字、操作按钮，以及生成进度、失败与取消提示、上游变更提示与阶段汇总。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 stage.js 拆出，通过 window.aiStageHeader.create(ctx) 创建，返回的两个渲染函数接收当前视图作为参数；按钮的行为由 ctx 注入（来自 stage-actions.js）；依赖 shared/page-format.js（pageFormat）与 aiUi 组件库，必须在 stage.js 之前加载。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const SOURCE_LABELS = { text: '文字灵感', image: '灵感图片', novel: '小说原文', original: '原创文稿' };
  /** 不显示阶段汇总的状态：产出尚未完整生成。 */
  const SUMMARY_HIDDEN_DISPLAYS = ['running', 'failed', 'canceled'];
  const STALE_TEXT = '上游产出已修改，本产出可能已过期。不会自动重新生成，请检查后决定是否重新生成。';

  const { formatRelativeTime, stageStatusLabel, stageStatusClass } = window.pageFormat;

  /**
   * 创建头部与进度区。
   * @param {{ provider: object, isWorkspace: boolean, content: object, titleSuffix: () => string, setTitle: (title: string) => void,
   *   approve: () => void, cancelGeneration: () => void, retryGeneration: () => void, regenerate: () => void,
   *   showRawOutput: () => void, switchVersion: (runId: number) => void }} ctx
   *   provider 为阶段登记的内容，content 为它创建的内容区（提供汇总）；isWorkspace 为工作区布局；
   *   titleSuffix 给出标题里附加的文字，setTitle 设置弹出页面的标题；其余为各操作按钮的行为。
   * @returns {{ headerElement: HTMLElement, progressElement: HTMLElement, renderHeader: (view: object|null) => void, renderProgress: (view: object|null) => void }}
   *   headerElement、progressElement 为两个区域的容器；renderHeader、renderProgress 按视图重绘（视图为 null 时只清空）。
   */
  function create(ctx) {
    const { provider, isWorkspace, content, titleSuffix, setTitle, approve, cancelGeneration, retryGeneration, regenerate, showRawOutput, switchVersion } = ctx;
    const headerElement = aiUi.h('header', { class: 'stage-header' });
    const progressElement = aiUi.h('div', { class: 'stage-progress-area' });

    /** 状态文字：颜色之外始终带文字。 */
    function renderStatus(view) {
      const { run } = view;
      const progress = run.progress && run.display === 'running' ? `（${run.progress.step}）` : '';
      return aiUi.h('span', { class: stageStatusClass(run.display), text: `${stageStatusLabel(run.display)}${progress}` });
    }

    /** 阶段自己的汇总；生成中、失败与已取消时没有可汇总的完整产出，不显示。 */
    function createSummary(view) {
      if (SUMMARY_HIDDEN_DISPLAYS.includes(view.run.display)) return null;
      return content.renderSummary(view);
    }

    /** 顶部：作品信息、版本、状态与操作按钮；作品名显示在弹出页面的标题行。工作区布局把汇总一并放在信息区。 */
    function renderHeader(view) {
      headerElement.textContent = '';
      if (!view) return;
      const { work, run, actions, versions } = view;
      setTitle(`${work.name} › ${provider.label}${titleSuffix()}`);

      const versionSelect = aiUi.select({
        options: versions.map((item) => ({
          value: String(item.id),
          label: `v${item.version} · ${stageStatusLabel(item.display)}${item.isCurrent ? '（当前）' : ''}`
        })),
        value: String(run.id),
        allowEmpty: false,
        ariaLabel: '版本',
        onChange: (value) => void switchVersion(Number(value))
      });

      const buttons = [
        aiUi.button({ text: '确认采用', variant: 'primary', disabled: !actions.canApprove, onClick: () => void approve() }),
        actions.canCancel ? aiUi.button({ text: '取消生成', variant: 'danger', onClick: () => void cancelGeneration() }) : null,
        actions.canRetry ? aiUi.button({ text: '重试', onClick: () => void retryGeneration() }) : null,
        ...(provider.headerActions ? provider.headerActions(view) : []),
        provider.canRegenerate && !provider.canRegenerate(view)
          ? null
          : aiUi.button({ text: '重新生成', disabled: actions.canCancel, onClick: () => void regenerate() }),
        run.hasRawOutput ? aiUi.button({ text: '查看原始输出', onClick: () => void showRawOutput() }) : null
      ].filter(Boolean);

      const details = [
        `${work.kindLabel || ''}`,
        SOURCE_LABELS[work.sourceType] || '',
        run.modelInfo ? `模型：${run.modelInfo}` : '',
        `开始于 ${formatRelativeTime(run.createdAt)}`
      ].filter(Boolean);

      headerElement.append(
        isWorkspace
          ? aiUi.h(
              'div',
              { class: 'stage-header__info' },
              aiUi.h('div', { class: 'stage-meta' }, details.map((text) => aiUi.h('span', { text }))),
              createSummary(view)
            )
          : aiUi.h('p', { class: 'description', text: details.join(' · ') }),
        aiUi.h(
          'div',
          { class: 'stage-bar' },
          aiUi.h('div', { class: 'stage-bar__version' }, versionSelect.element),
          // 工作区布局的版本下拉里已带状态文字。
          isWorkspace ? null : renderStatus(view),
          aiUi.h('div', { class: 'stage-bar__buttons' }, buttons.map((button) => button.element))
        )
      );
    }

    /** 状态提示与进度条：生成中显示进度；失败、已取消显示原因；生成结束后显示上游变更提示与阶段自己的汇总。 */
    function renderProgress(view) {
      progressElement.textContent = '';
      if (!view) return;
      const { run } = view;
      if (run.display === 'running') {
        const total = run.progress ? Math.max(run.progress.total, 1) : 1;
        const done = run.progress ? run.progress.done : 0;
        const text = run.progress ? `${run.progress.step}（${run.progress.done} / ${run.progress.total}）` : '准备中…';
        progressElement.append(
          aiUi.h('progress', { class: 'stage-progress', attrs: { max: String(total), value: String(done), 'aria-label': '生成进度' } }),
          aiUi.h('p', { class: 'description', text })
        );
        return;
      }
      if (run.display === 'failed') {
        progressElement.append(
          aiUi.h('p', { class: 'status-error', text: `生成失败：${run.errorMessage || '未知原因'}。${provider.keptNote}，可点“重试”继续。` })
        );
      } else if (run.display === 'canceled') {
        progressElement.append(aiUi.h('p', { class: 'description', text: `已取消生成，${provider.keptNote}，可点“重试”继续。` }));
      }
      if (view.stale) progressElement.append(aiUi.h('p', { class: 'status-warning', text: STALE_TEXT }));
      // 工作区布局的汇总已在头部显示。
      if (!isWorkspace) {
        const summary = createSummary(view);
        if (summary) progressElement.append(summary);
      }
    }

    return { headerElement, progressElement, renderHeader, renderProgress };
  }

  window.aiStageHeader = { create };
})();
