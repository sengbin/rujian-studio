// ------------------------------------------------------------------------
// 名称：queue-panel.js
// 说明：工作台底部的“队列与结果”区：标题行是摘要（生成中、失败、已完成的组数）和展开、收起按钮，展开后列出每个任务（最新的在前，最多显示一定数量），在表格内部滚动；每行可取消、重试（最新的失败或已取消任务）和查看结果。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 workbench.js 拆出；对外是 window.aiWorkbenchQueue.create(host)，返回 render 与 open；必须先于 workbench.js、晚于 job-display.js 加载；队列是否展开由本面板保存。
// ------------------------------------------------------------------------

'use strict';

(function () {
  /** 底部队列最多显示的任务数。 */
  const QUEUE_MAX_ROWS = 100;

  const { ACTIVE_STATUSES, STATUS_CLASSES, STATUS_ICONS, resultCount, elapsedElement } = window.aiWorkbenchJobs;

  /**
   * 创建队列与结果面板；只创建一个实例。
   * @param {{
   *   getView: () => { groups: object[] },
   *   selectGroup: (group: object) => void,
   *   cancelJob: (job: object) => Promise<void>,
   *   canRetry: (group: object) => boolean,
   *   retry: (group: object) => Promise<unknown>,
   *   openResult: (result: object) => Promise<void>,
   *   render: () => void
   * }} host 宿主页面提供的状态与操作：canRetry 判断这一组此刻能否重新生成，retry 重新提交这一组，render 在展开状态变化后重绘页面。
   * @returns {{ render: () => HTMLElement, open: () => void }}
   */
  function create(host) {
    /** 底部队列是否展开。 */
    let isOpen = true;

    /** 队列里的全部任务，最新的在前，最多显示一定数量。 */
    function queueRows() {
      return host
        .getView()
        .groups.flatMap((group) => group.jobs.map((job, order) => ({ job, group, isLatest: order === 0 })))
        .sort((left, right) => Date.parse(right.job.createdAt) - Date.parse(left.job.createdAt) || right.job.id - left.job.id)
        .slice(0, QUEUE_MAX_ROWS);
    }

    /** 队列摘要：进行中的任务数、最新任务失败的组数、已有结果的组数。 */
    function queueSummary() {
      const { groups } = host.getView();
      const active = groups.reduce((sum, group) => sum + group.jobs.filter((job) => ACTIVE_STATUSES.includes(job.status)).length, 0);
      const failed = groups.filter((group) => group.jobs[0] && group.jobs[0].status === 'failed').length;
      const done = groups.filter((group) => resultCount(group) > 0).length;
      return `生成中 ${active} · 失败 ${failed} · 已完成 ${done}（共 ${groups.length} 组）`;
    }

    /** 底部队列与结果：标题行是摘要和展开、收起按钮，展开后列出每个任务（最新的在前），在表格内部滚动。 */
    function render() {
      const panelId = 'wb-queue-panel';
      const toggle = aiUi.button({
        text: isOpen ? '收起队列' : '展开队列',
        compact: true,
        onClick: () => {
          isOpen = !isOpen;
          host.render();
        }
      });
      toggle.element.setAttribute('aria-expanded', String(isOpen));
      toggle.element.setAttribute('aria-controls', panelId);
      const rows = queueRows();
      const columns = [
        {
          title: '镜头组',
          nowrap: true,
          render: ({ group }) => aiUi.button({ text: `第 ${group.seq} 组`, compact: true, ariaLabel: `定位到第 ${group.seq} 组`, onClick: () => host.selectGroup(group) }).element
        },
        { title: '模型', render: ({ job }) => job.modelName },
        {
          title: '状态',
          minWidth: 160,
          render: ({ job }) =>
            aiUi.h(
              'div',
              {},
              aiUi.h('span', { class: STATUS_CLASSES[job.status] || 'description', text: `${STATUS_ICONS[job.status] || ''} ${job.statusLabel}`.trim() }),
              job.failure ? aiUi.h('div', { class: 'description wb-queue__failure', text: job.failure.label, attrs: { title: job.failure.message } }) : null,
              job.waitNote ? aiUi.h('div', { class: 'status-warning', text: job.waitNote }) : null
            )
        },
        { title: '耗时', nowrap: true, muted: true, render: ({ job }) => elapsedElement(job) },
        { title: '尝试', type: 'number', render: ({ job }) => job.attempt },
        {
          title: '操作',
          type: 'actions',
          render: ({ job, group, isLatest }) => {
            const buttons = [];
            if (ACTIVE_STATUSES.includes(job.status)) {
              buttons.push(aiUi.button({ text: '取消', compact: true, variant: 'danger', ariaLabel: `取消第 ${group.seq} 组的任务`, onClick: () => void host.cancelJob(job) }));
            }
            if (isLatest && (job.status === 'failed' || job.status === 'canceled')) {
              buttons.push(aiUi.button({ text: '重试', compact: true, disabled: !host.canRetry(group), ariaLabel: `重新生成第 ${group.seq} 组`, onClick: () => void host.retry(group) }));
            }
            if (job.result) {
              buttons.push(aiUi.button({ text: '查看结果', compact: true, ariaLabel: `播放第 ${group.seq} 组第 ${job.attempt} 次的视频`, onClick: () => void host.openResult(job.result) }));
            }
            return buttons.map((button) => button.element);
          }
        }
      ];
      return aiUi.h(
        'section',
        { class: `wb-queue${isOpen ? ' wb-queue--open' : ''}`, attrs: { 'aria-label': '队列与结果' } },
        aiUi.h(
          'div',
          { class: 'wb-queue__header' },
          aiUi.h('div', { class: 'wb-queue__title' }, aiUi.h('h2', { class: 'ui-title wb-panel__title', text: '队列与结果' }), aiUi.h('span', { class: 'description', text: queueSummary() })),
          toggle.element
        ),
        aiUi.h(
          'div',
          { class: 'wb-queue__body', hidden: !isOpen, attrs: { id: panelId } },
          rows.length === 0 ? aiUi.h('p', { class: 'description wb-queue__empty', text: '还没有提交过生成任务。' }) : aiUi.table({ columns, rows, ariaLabel: '生成任务', compact: true, flush: true }).element
        )
      );
    }

    return {
      render,
      /** 展开队列（下次重绘生效）。 */
      open() {
        isOpen = true;
      }
    };
  }

  window.aiWorkbenchQueue = { create };
})();
