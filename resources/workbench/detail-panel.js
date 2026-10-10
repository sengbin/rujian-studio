// ------------------------------------------------------------------------
// 名称：detail-panel.js
// 说明：工作台中栏的镜头组详情：头部是固定标题与“编辑镜头”；内容依次是组标题与摘要（含出场实体概览）、镜头列表（可拆分与合并镜头组）、生成状态（最新一次任务、历史记录、结果操作）。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 workbench.js 拆出；对外是 window.aiWorkbenchDetail.create(host)，返回 render(group, index)；必须先于 workbench.js、晚于 job-display.js 加载；依赖 shared/page-format.js（pageFormat）。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const { ACTIVE_STATUSES, STATUS_CLASSES, resultCount, describeResult, renderFailure, elapsedElement, describeJobParams, groupStatus } = window.aiWorkbenchJobs;
  const { formatRelativeTime, formatDateTime } = window.pageFormat;

  /** 出场实体概览一句话：各类型的数量与未绑定的数量，放在组摘要里；具体的实体和绑定在右栏“绑定素材”步骤里。 */
  function describeEntities(group) {
    if (group.entities.length === 0) return '无出场实体';
    const unbound = group.entities.filter((entity) => !entity.bound).length;
    const counts = new Map();
    for (const entity of group.entities) counts.set(entity.kindLabel, (counts.get(entity.kindLabel) || 0) + 1);
    const typeText = [...counts].map(([label, count]) => `${label} ${count}`).join(' · ');
    return `${typeText}，${unbound > 0 ? `其中 ${unbound} 项未绑定` : '已全部绑定'}`;
  }

  /** 详情里的一个区块：标题行（右侧可放操作）加内容。 */
  function renderSection(label, title, actions, ...content) {
    return aiUi.h(
      'section',
      { class: 'wb-section', attrs: { 'aria-label': label } },
      aiUi.h('div', { class: 'wb-section__head' }, aiUi.h('h3', { class: 'ui-subheading wb-section__title', text: title }), aiUi.h('div', { class: 'ui-wrap wb-section__actions' }, actions)),
      content
    );
  }

  /**
   * 展开“提交的提示词”“历史记录”等折叠内容时，让镜头列表保持当前高度，多出来的内容靠整个详情区滚动；全部收起后列表恢复自然撑高。
   * 点击摘要时（内容展开之前）记下列表高度并锁定，所有折叠内容收起后解除。
   */
  function keepShotListHeight(body) {
    const list = body.querySelector('.wb-shot-list');
    if (!list) return;
    body.addEventListener(
      'click',
      (event) => {
        if (!event.target.closest('summary') || list.style.flex !== '') return;
        list.style.flex = `0 0 ${list.getBoundingClientRect().height}px`;
      },
      true
    );
    body.addEventListener(
      'toggle',
      () => {
        if (body.querySelector('details[open]')) return;
        list.style.flex = '';
      },
      true
    );
  }

  /**
   * 创建镜头组详情面板；只创建一个实例。
   * @param {{
   *   getView: () => { groups: object[] },
   *   getResolved: () => object|null,
   *   groupResolved: (group: object) => object|null,
   *   groupModelMaxSeconds: (group: object) => number|null,
   *   exceedsModel: (group: object) => boolean,
   *   isSubmitting: (groupId: number) => boolean,
   *   editGroupShots: (group: object) => void,
   *   splitBefore: (shot: object) => Promise<void>,
   *   mergeIntoPrevious: (group: object) => Promise<void>,
   *   cancelJob: (job: object) => Promise<void>,
   *   openVersions: (group: object) => void,
   *   openResult: (result: object) => Promise<void>,
   *   exportResult: (result: object) => Promise<void>,
   *   revealResult: (result: object) => Promise<void>
   * }} host 宿主页面提供的状态与操作：groupResolved 与 groupModelMaxSeconds 是镜头组的生效参数与所用模型的单次最长时长，isSubmitting 判断镜头组是否正在提交。
   * @returns {{ render: (group: object, index: number) => HTMLElement }}
   */
  function create(host) {
    /** 一次任务的状态：状态文字、生成参数、时间、失败原因或结果信息、提醒与提交的提示词；showAdopted 为 true（这一组有多个版本）时标出采用的那个。 */
    function renderJob(job, group, showAdopted) {
      const hasElapsed = Boolean(job.submittedAt);
      const parts = [
        aiUi.h(
          'div',
          { class: 'wb-job__head' },
          aiUi.h('span', { class: STATUS_CLASSES[job.status] || 'description', text: job.statusLabel }),
          aiUi.h('span', { class: 'description', text: `第 ${job.attempt} 次 · ${formatRelativeTime(job.finishedAt || job.createdAt)}` })
        ),
        aiUi.h('div', { class: 'description wb-job__params', text: describeJobParams(job) }),
        aiUi.h('div', { class: 'description' }, `提交于 ${formatDateTime(job.createdAt)}`, hasElapsed ? ' · 耗时 ' : null, hasElapsed ? elapsedElement(job) : null)
      ];
      if (job.waitNote) parts.push(aiUi.h('div', { class: 'status-warning', text: job.waitNote }));
      if (job.failure) parts.push(renderFailure(job.failure));
      if (job.result) {
        parts.push(
          aiUi.h(
            'div',
            { class: 'wb-result' },
            aiUi.h('span', { class: 'description', text: `结果：${describeResult(job.result)}` }),
            showAdopted && job.result.isSelected ? aiUi.chip({ text: '已采用' }) : null,
            aiUi.button({ text: '播放', compact: true, variant: 'primary', ariaLabel: `播放第 ${group.seq} 组第 ${job.attempt} 次的视频`, onClick: () => void host.openResult(job.result) }).element,
            aiUi.button({ text: '导出…', compact: true, ariaLabel: '导出视频到指定位置', onClick: () => void host.exportResult(job.result) }).element,
            aiUi.button({ text: '在文件夹中显示', compact: true, onClick: () => void host.revealResult(job.result) }).element
          )
        );
      }
      parts.push(
        aiUi.h('details', { class: 'wb-history' }, aiUi.h('summary', { text: '提交的提示词' }), aiUi.h('div', { class: 'wb-prompt', text: job.prompt }))
      );
      return aiUi.h('div', { class: 'wb-job' }, parts);
    }

    /** 镜头组的生成状态：最新一次任务，更早的任务折叠在“历史”里。 */
    function renderGroupStatus(group) {
      if (group.jobs.length === 0) return aiUi.h('span', { class: 'description', text: '尚未生成' });
      const [latest, ...older] = group.jobs;
      const showAdopted = resultCount(group) > 1;
      return aiUi.h(
        'div',
        {},
        group.staleNote ? aiUi.h('div', { class: 'status-warning wb-stale', text: group.staleNote }) : null,
        renderJob(latest, group, showAdopted),
        older.length > 0
          ? aiUi.h(
              'details',
              { class: 'wb-history' },
              aiUi.h('summary', { text: `历史记录（${older.length} 次）` }),
              older.map((job) => renderJob(job, group, showAdopted))
            )
          : null
      );
    }

    /** 镜头列表：每个镜头一行（序号、景别与画面描述加场次、时长）；没有生成记录的组可在某个镜头前拆开，也可并入上一组。 */
    function renderShotList(group, index) {
      const view = host.getView();
      const canEdit = group.jobs.length === 0 && !host.isSubmitting(group.id);
      const previous = view.groups[index - 1];
      const canMerge = canEdit && Boolean(previous) && previous.jobs.length === 0;
      const rows = group.shots.map((shot, shotIndex) =>
        aiUi.h(
          'li',
          { class: 'wb-shot' },
          aiUi.h('span', { class: 'wb-shot__seq', text: `镜头 ${shot.seq}` }),
          aiUi.h(
            'div',
            { class: 'wb-shot__body' },
            aiUi.h('p', { class: 'wb-shot__prompt', text: [shot.shotSize, shot.prompt].filter(Boolean).join(' · ') }),
            shot.sceneLabel ? aiUi.h('span', { class: 'wb-shot__scene', text: shot.sceneLabel }) : null
          ),
          aiUi.h(
            'div',
            { class: 'wb-shot__side' },
            aiUi.h('span', { class: 'wb-shot__duration', text: `${shot.durationSeconds} 秒` }),
            shotIndex > 0 && canEdit
              ? aiUi.button({ text: '从这里拆开', compact: true, ariaLabel: `在镜头 ${shot.seq} 之前拆开这一组`, onClick: () => void host.splitBefore(shot) }).element
              : null
          )
        )
      );
      const merge = canMerge ? aiUi.button({ text: '并入上一组', ariaLabel: `把第 ${group.seq} 组并入上一组`, onClick: () => void host.mergeIntoPrevious(group) }) : null;
      if (merge) merge.element.classList.add('wb-shots__more');
      return aiUi.h('div', { class: 'wb-shot-list' }, aiUi.h('ol', { class: 'wb-shots', attrs: { 'aria-label': '镜头' } }, rows), merge && merge.element);
    }

    /** 生成状态区块：任务进行中时有“取消”；有多个结果时有“结果版本”；下面是最新任务与历史。提交统一在右栏“检查并提交”步骤里做。 */
    function renderStatusSection(group) {
      const active = group.jobs.find((job) => ACTIVE_STATUSES.includes(job.status));
      const buttons = [];
      if (active) {
        buttons.push(aiUi.button({ text: '取消', compact: true, variant: 'danger', ariaLabel: `取消第 ${group.seq} 组的任务`, onClick: () => void host.cancelJob(active) }));
      }
      if (resultCount(group) > 1) {
        buttons.push(aiUi.button({ text: `结果版本（${resultCount(group)}）`, compact: true, ariaLabel: `查看第 ${group.seq} 组的结果版本`, onClick: () => host.openVersions(group) }));
      }
      return renderSection('生成状态', '生成状态', buttons.map((button) => button.element), renderGroupStatus(group));
    }

    /** 中栏：选中镜头组的详情。头部是固定标题与“编辑镜头”；内容依次是组标题与摘要（含出场实体概览）、镜头列表、生成状态。 */
    function render(group, index) {
      const status = groupStatus(group);
      const groupValues = host.groupResolved(group) || host.getResolved();
      const aspectRatio = groupValues ? groupValues.values.aspectRatio : '';
      const summary = [`${group.shots.length} 个镜头`, `总时长 ${group.totalSeconds} 秒`, aspectRatio, describeEntities(group)].filter(Boolean).join(' · ');
      const max = host.groupModelMaxSeconds(group);
      const body = aiUi.h(
        'div',
        { class: 'wb-panel__body wb-detail__body' },
        aiUi.h(
          'div',
          { class: 'wb-detail-head' },
          aiUi.h('div', {}, aiUi.h('h3', { class: 'wb-detail-title', text: `第 ${group.seq} 组` }), aiUi.h('p', { class: 'wb-detail-summary', text: summary })),
          aiUi.h('span', { class: `wb-detail-status ${status.className}`, text: status.text })
        ),
        host.exceedsModel(group) ? aiUi.h('p', { class: 'status-warning', text: `超过所选模型单次最长 ${max} 秒，请拆分这一组或换一个模型。` }) : null,
        renderShotList(group, index),
        renderStatusSection(group)
      );
      keepShotListHeight(body);
      return aiUi.h(
        'section',
        { class: 'wb-panel wb-detail', attrs: { 'aria-label': `第 ${group.seq} 组详情` } },
        aiUi.h(
          'div',
          { class: 'wb-panel__header' },
          aiUi.h('div', {}, aiUi.h('h2', { class: 'ui-title wb-panel__title', text: '镜头组详情' }), aiUi.h('p', { class: 'wb-panel__subtitle', text: '分镜内容与出场实体集中查看' })),
          aiUi.button({ text: '编辑镜头', ariaLabel: `编辑第 ${group.seq} 组的镜头`, onClick: () => host.editGroupShots(group) }).element
        ),
        body
      );
    }

    return { render };
  }

  window.aiWorkbenchDetail = { create };
})();
