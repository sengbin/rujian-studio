// ------------------------------------------------------------------------
// 名称：job-display.js
// 说明：工作台里生成任务与镜头组状态的展示规则：状态文字与样式、结果与参数的说明文字、失败原因、任务耗时（进行中的任务由定时器每秒刷新）。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 workbench.js 拆出，只有纯展示逻辑、不持有页面状态；对外是 window.aiWorkbenchJobs；必须先于 detail-panel.js、groups-panel.js、queue-panel.js、job-actions.js 与 workbench.js 加载；describeJobParams 与 describeJobFields 在调用时使用 aiProfile.describeElements；依赖 shared/page-format.js（pageFormat）。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const ACTIVE_STATUSES = ['waiting', 'queued', 'running'];
  const STATUS_CLASSES = {
    waiting: 'status-warning',
    queued: 'status-warning',
    running: 'status-warning',
    succeeded: 'status-success',
    failed: 'status-error',
    canceled: 'description'
  };
  const AUDIO_MODE_LABELS = { native: '模型原生生成', none: '无声' };
  /** 状态前的图标，让状态不只靠颜色区分。 */
  const STATUS_ICONS = { waiting: '…', queued: '…', running: '●', succeeded: '✓', failed: '✕', canceled: '–' };
  const MS_PER_SECOND = 1000;
  const SECONDS_PER_MINUTE = 60;

  const { formatBytes } = window.pageFormat;

  /** 这一组是否有进行中的任务。 */
  function hasActiveJob(group) {
    return group.jobs.some((job) => ACTIVE_STATUSES.includes(job.status));
  }

  /** 这一组有结果视频的任务数。 */
  function resultCount(group) {
    return group.jobs.filter((job) => job.result).length;
  }

  /** 结果视频的信息一行：时长、大小、是否有声。 */
  function describeResult(result) {
    const { durationSeconds, sizeBytes, hasAudio } = result;
    return [durationSeconds === null ? '' : `${durationSeconds} 秒`, formatBytes(sizeBytes), hasAudio ? '有声' : '无声'].filter(Boolean).join(' · ');
  }

  /** 失败原因：分类名称、平台返回的原文、错误码和处理建议。 */
  function renderFailure(failure) {
    return aiUi.h(
      'div',
      { class: 'wb-failure' },
      aiUi.h('div', { class: 'status-error wb-failure__label', text: `失败：${failure.label}` }),
      aiUi.h('div', { class: 'wb-failure__message', text: failure.message }),
      failure.code ? aiUi.h('div', { class: 'description', text: `错误码：${failure.code}` }) : null,
      aiUi.h('div', { class: 'description', text: failure.hint })
    );
  }

  function formatSeconds(seconds) {
    return seconds < SECONDS_PER_MINUTE ? `${seconds} 秒` : `${Math.floor(seconds / SECONDS_PER_MINUTE)} 分 ${seconds % SECONDS_PER_MINUTE} 秒`;
  }

  /** 耗时文字：从提交到结束（进行中到现在）；还没提交给平台时为空。 */
  function formatElapsed(job) {
    if (!job.submittedAt) return '';
    const end = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
    return formatSeconds(Math.max(0, Math.round((end - Date.parse(job.submittedAt)) / MS_PER_SECOND)));
  }

  /** 耗时元素：进行中的任务带上提交时间，由定时器每秒刷新文字。 */
  function elapsedElement(job) {
    const isRunning = Boolean(job.submittedAt) && !job.finishedAt;
    return aiUi.h('span', { text: formatElapsed(job), attrs: { 'data-elapsed-since': isRunning ? job.submittedAt : null } });
  }

  /** 刷新页面上所有进行中任务的耗时文字。 */
  function tickElapsed() {
    document.querySelectorAll('[data-elapsed-since]').forEach((element) => {
      const start = Date.parse(element.getAttribute('data-elapsed-since'));
      if (!Number.isNaN(start)) element.textContent = formatSeconds(Math.max(0, Math.round((Date.now() - start) / MS_PER_SECOND)));
    });
  }

  /** 任务的首帧来源说明：上一组尾帧、指定图片或无。 */
  function firstFrameLabel(job) {
    if (job.usesPreviousTail) return '上一组尾帧';
    return job.usesFirstFrameImage ? '指定图片' : '无';
  }

  /** 任务提交时的生成参数一行：模型、画幅、分辨率、时长、镜头数、声音、种子。 */
  function describeJobParams(job) {
    const { params } = job;
    return [
      job.modelName,
      params.aspectRatio,
      params.resolution,
      params.durationSeconds === null ? '' : `${params.durationSeconds} 秒`,
      `${job.shotCount} 个镜头`,
      firstFrameLabel(job) === '无' ? '' : `首帧：${firstFrameLabel(job)}`,
      AUDIO_MODE_LABELS[params.audioMode] || '',
      params.audioMode === 'native' && params.audioElements ? aiProfile.describeElements(params.audioElements) : '',
      params.seed === null ? '' : `种子 ${params.seed}`
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** 任务的对比条目：提交时的参数、结果信息和提示词，两个任务的条目顺序一致。 */
  function describeJobFields(job) {
    const { params } = job;
    const orNone = (value) => (value === null || value === undefined || value === '' ? '（未指定）' : String(value));
    return [
      { label: '模型', value: orNone(job.modelName) },
      { label: '画幅', value: orNone(params.aspectRatio) },
      { label: '分辨率', value: orNone(params.resolution) },
      { label: '整组时长', value: params.durationSeconds === null ? '（未指定）' : `${params.durationSeconds} 秒` },
      { label: '镜头数', value: String(job.shotCount) },
      { label: '首帧', value: firstFrameLabel(job) },
      { label: '声音', value: AUDIO_MODE_LABELS[params.audioMode] || orNone(params.audioMode) },
      { label: '声音内容', value: params.audioElements ? aiProfile.describeElements(params.audioElements) : '（未指定）' },
      { label: '种子', value: orNone(params.seed) },
      { label: '结果', value: describeResult(job.result) },
      { label: '提示词格式', value: `第 ${job.promptFormat} 版` },
      { label: '提示词', value: job.prompt, long: true }
    ];
  }

  /** 镜头组状态：最新一次任务的状态；还没有任务时，有未绑定资产的实体为“待绑定”，否则为“可生成”。图标让状态不只靠颜色区分。 */
  function groupStatus(group) {
    const [latest] = group.jobs;
    if (latest) {
      return { text: `${STATUS_ICONS[latest.status] || ''} ${latest.statusLabel}`.trim(), className: STATUS_CLASSES[latest.status] || 'description' };
    }
    if (group.entities.some((entity) => !entity.bound)) return { text: '! 待绑定', className: 'status-warning' };
    return { text: '○ 可生成', className: 'description' };
  }

  window.aiWorkbenchJobs = {
    ACTIVE_STATUSES,
    STATUS_CLASSES,
    STATUS_ICONS,
    hasActiveJob,
    resultCount,
    describeResult,
    renderFailure,
    elapsedElement,
    tickElapsed,
    describeJobParams,
    describeJobFields,
    groupStatus
  };
})();
