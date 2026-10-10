// ------------------------------------------------------------------------
// 名称：workbench.js
// 说明：生成工作台页脚本：顶部选择项目、作品与分集并显示当前生成配置；下面三栏——左栏镜头组列表（状态、镜头数与时长、重新分组），中栏选中镜头组的详情（镜头、出场实体概览、生成状态与结果），右栏三步流程（绑定素材、配置参数、检查并提交）；底部可折叠的队列列出全部任务，失败时显示平台返回的具体原因。页面不出现整页滚动条，各区域在内部滚动。支持重新分组、拆分与合并镜头组、取消、编辑镜头后再次生成、打开结果视频、在结果版本之间切换采用和对比。本文件只保存页面状态并装配各区域，各区域的绘制在下面列出的子脚本里。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：请求与事件名称与 src/app/pages/workbench-handlers.ts 一致；“编辑镜头”“确认分镜脚本”复用 stage/stage.js 的产出层（aiStage）；右栏步骤页签由 workbench/step-tabs.js（aiStepTabs）提供，其中“绑定素材”面板由 workbench/bindings.js（aiBindings）提供，“配置参数”面板与生效参数的合并由 workbench/profile.js（aiProfile）提供，“检查并提交”面板由 workbench/submit-panel.js（aiSubmit）提供，“结果版本”弹出页由 workbench/versions.js（aiVersions）提供（打开时另行请求该组全部历史成功版本），“上一组尾帧作首帧”的尾帧截取由 workbench/tail-frames.js（aiTailFrames）提供；任务与镜头组状态的展示规则、耗时刷新由 workbench/job-display.js（aiWorkbenchJobs）提供，顶部上下文栏与集选择值由 workbench/context-bar.js（aiWorkbenchContext）提供，左栏镜头组列表由 workbench/groups-panel.js（aiWorkbenchGroups）提供，中栏镜头组详情由 workbench/detail-panel.js（aiWorkbenchDetail）提供，底部队列与结果由 workbench/queue-panel.js（aiWorkbenchQueue）提供，取消任务、结果视频操作与采用结果版本由 workbench/job-actions.js（aiWorkbenchActions）提供，这些脚本都必须先于本文件加载（job-display.js 在其余几个之前）；依赖 shared/page-format.js（pageFormat）。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_CATALOG = 'workbench.catalog';
  const REQUEST_EPISODE = 'workbench.episode';
  const REQUEST_PROFILE = 'workbench.profile';
  const REQUEST_SAVE_PROFILE = 'workbench.saveProfile';
  const REQUEST_SAVE_GROUP_PROFILE = 'workbench.saveGroupProfile';
  const REQUEST_SUBMIT = 'workbench.submit';
  const REQUEST_PREVIEW = 'workbench.preview';
  const REQUEST_REGROUP = 'workbench.regroup';
  const REQUEST_SPLIT_GROUP = 'workbench.splitGroup';
  const REQUEST_MERGE_GROUP = 'workbench.mergeGroup';
  const EVENT_CHANGED = 'workbench.changed';
  const EVENT_MODELS_CHANGED = 'models.changed';
  const STAGE_STORYBOARD = 'storyboard_script';

  const REFRESH_DELAY_MS = 150;
  /** 进行中任务耗时文字的刷新间隔。 */
  const ELAPSED_TICK_MS = 1000;
  /** 重绘前后需要保持滚动位置的区域：镜头组列表、详情、镜头列表、各步骤面板、队列。 */
  const SCROLL_SELECTORS = ['.wb-groups__list', '.wb-detail__body', '.wb-shots', '.wb-steps__panel', '.wb-queue__body'];

  const { errorText, createActionRunner } = window.pageFormat;
  const { ACTIVE_STATUSES, hasActiveJob, groupStatus, tickElapsed } = window.aiWorkbenchJobs;
  const { parseEpisodeKey, selectableWorks, episodeKeyOf } = window.aiWorkbenchContext;

  const root = document.getElementById('app');
  /** 工作台清单：可选的作品、集与可用的视频模型；尚未加载成功时为 null。 */
  let catalog = null;
  /** 当前选择的集，值为“作品标识:集标识”；没有可选的集时为空串。 */
  let episodeKey = '';
  /** 当前集的生成参数视图（作品默认、本集覆盖、生效值）；尚未加载成功时为 null。 */
  let profile = null;
  /** 按清单与参数视图算出的生效参数（见 profile.js）；没有参数视图时为 null。 */
  let resolved = null;
  /** 当前集的工作台视图；尚未加载成功时为 null。 */
  let view = null;
  let loadError = '';
  let isLoading = true;
  let refreshTimer = 0;
  /** 当前集加载请求的序号，只采纳最后一次请求的响应。 */
  let episodeLoadSerial = 0;
  /** 正在提交的镜头组标识，避免重复点击。 */
  const submitting = new Set();
  let contentElement = null;
  /** 当前选中的镜头组标识；没有选中或已不存在时按第一组显示。 */
  let selectedGroupId = null;
  /** 右栏的步骤页签，以及其中三个步骤的面板（创建后一直保留）。 */
  let stepTabs = null;
  let bindingsPanel = null;
  let profilePanel = null;
  let submitPanel = null;

  /** 操作结果提示区（可多行）。 */
  const message = aiUi.message();
  const runAction = createActionRunner(message);

  /** 已选择的集不在清单里时（如被删除），改选第一个。 */
  function normalizeEpisodeKey() {
    if (!catalog) return;
    const keys = selectableWorks(catalog).flatMap((work) => work.episodes.map((episode) => episodeKeyOf(work, episode)));
    if (!keys.includes(episodeKey)) episodeKey = keys[0] || '';
  }

  /** 切换到另一集：先清空当前集的数据，再重新读取。 */
  function selectEpisode(key) {
    if (key === episodeKey) return;
    episodeKey = key;
    view = null;
    profile = null;
    updateResolved();
    isLoading = true;
    contextBar.render();
    render();
    void loadEpisode(false);
  }

  /** 步骤页签的副文字与状态：绑定步骤看所选镜头组未绑定的实体数，参数步骤看生效参数是否可用，提交步骤看待提交的镜头组数。 */
  function updateStepTabs() {
    if (!view || view.groups.length === 0) {
      for (const id of ['bindings', 'profile', 'submit']) stepTabs.setStatus(id, { note: '' });
      return;
    }
    const selected = view.groups[selectedGroupIndex()];
    stepTabs.setContext(`第 ${selected.seq} 组`);
    bindingsPanel.setEntities(selected.entities.map((entity) => entity.id));
    const unbound = selected.entities.filter((entity) => !entity.bound).length;
    stepTabs.setStatus('bindings', unbound > 0 ? { note: `${unbound} 项未绑定` } : { note: '全部已绑定', state: 'done' });

    if (!resolved || !resolved.model) {
      stepTabs.setStatus('profile', { note: '无可用模型' });
    } else if (Object.keys(resolved.issues).length > 0) {
      stepTabs.setStatus('profile', { note: '需调整' });
    } else {
      const { aspectRatio, resolution } = resolved.values;
      stepTabs.setStatus('profile', { note: [aspectRatio, resolution].filter(Boolean).join(' · ') || resolved.model.displayName, state: 'done' });
    }

    const pending = view.groups.filter(isPendingGroup).length;
    if (view.blockReason) stepTabs.setStatus('submit', { note: '分镜脚本未确认' });
    else if (pending > 0) stepTabs.setStatus('submit', { note: `${pending} 组待提交` });
    else stepTabs.setStatus('submit', { note: '没有待提交', state: 'done' });
  }

  function selectedModel() {
    return resolved ? resolved.model : undefined;
  }

  /** 生成参数是否可用于提交：选了可用模型，且各参数都在该模型支持的范围内。 */
  function paramsReady() {
    return Boolean(resolved && resolved.model) && Object.keys(resolved.issues).length === 0;
  }

  /** 按清单与参数视图重新算出生效参数。 */
  function updateResolved() {
    resolved = catalog && profile ? aiProfile.resolve(catalog, profile) : null;
  }

  /** 参数面板里“本镜头组”对应的镜头组及其覆盖；没有选中时为 null。 */
  function profileGroup() {
    if (!view || view.groups.length === 0) return null;
    const group = view.groups[selectedGroupIndex()];
    return { id: group.id, seq: group.seq, overrides: group.overrides, totalSeconds: group.totalSeconds };
  }

  /** 一个镜头组的生效参数：本组覆盖优先于本集的生效值；还没有参数视图时为 null。 */
  function groupResolved(group) {
    return catalog && profile ? aiProfile.resolveForGroup(catalog, profile, group) : null;
  }

  /** 保存某一级的参数修改，成功后用返回的视图刷新工具栏、提交按钮和参数页；镜头组级的覆盖保存后重新读取本集视图。 */
  async function saveProfile(scope, changes) {
    const { workId, episodeId } = parseEpisodeKey(episodeKey);
    if (scope === 'group') {
      const target = profileGroup();
      if (!target) return { ok: false, message: '请先选择一个镜头组。' };
      try {
        await window.hostBridge.request(REQUEST_SAVE_GROUP_PROFILE, { workId, episodeId, groupId: target.id, changes });
      } catch (error) {
        return { ok: false, message: errorText(error) };
      }
      await loadEpisode(false);
      return { ok: true };
    }
    try {
      profile = await window.hostBridge.request(REQUEST_SAVE_PROFILE, { scope, workId, episodeId, changes });
    } catch (error) {
      return { ok: false, message: errorText(error) };
    }
    updateResolved();
    contextBar.render();
    render();
    profilePanel.refresh();
    return { ok: true };
  }

  /** 弹出分镜脚本产出层，用来编辑镜头或确认采用。 */
  function openStoryboard() {
    const { workId, episodeId } = parseEpisodeKey(episodeKey);
    aiStage.open(workId, STAGE_STORYBOARD, episodeId);
  }

  /** 弹出分镜脚本产出层并定位到一个镜头组的第一个镜头。 */
  function editGroupShots(group) {
    const { workId, episodeId } = parseEpisodeKey(episodeKey);
    aiStage.open(workId, STAGE_STORYBOARD, episodeId, group.shots.length > 0 ? group.shots[0].id : null);
  }

  /** 所选模型单次最长时长；没有上限信息时为 null。 */
  function modelMaxSeconds() {
    const model = selectedModel();
    return model ? model.maxGroupSeconds : null;
  }

  /** 这一组使用的模型单次最长时长（含本组覆盖的模型）；没有上限信息时为 null。 */
  function groupModelMaxSeconds(group) {
    const resolvedGroup = groupResolved(group);
    return resolvedGroup && resolvedGroup.model ? resolvedGroup.model.maxGroupSeconds : modelMaxSeconds();
  }

  /** 这一组是否超过它所用模型的单次最长时长。 */
  function exceedsModel(group) {
    const max = groupModelMaxSeconds(group);
    return max !== null && group.totalSeconds > max;
  }

  /** 这一组的生效参数是否可用于提交：有可用模型且各参数都在模型支持的范围内。 */
  function groupParamsReady(group) {
    const resolvedGroup = groupResolved(group);
    return Boolean(resolvedGroup && resolvedGroup.model) && Object.keys(resolvedGroup.issues).length === 0;
  }

  /** 提交与预览共用的请求内容：作品、集、镜头组与生效的生成参数。 */
  function submitPayload(groupIds) {
    const { workId, episodeId } = parseEpisodeKey(episodeKey);
    return {
      workId,
      episodeId,
      groupIds,
      params: {
        modelId: Number(resolved.values.modelId),
        aspectRatio: resolved.values.aspectRatio,
        resolution: resolved.values.resolution,
        audioMode: resolved.values.audioMode,
        audioElements: resolved.values.audioElements,
        seed: resolved.values.seed,
        negativeList: resolved.values.negativeList,
        promptExtend: resolved.values.promptExtend
      }
    };
  }

  /** 提交镜头组；返回提交结果（已提交的组与被拒绝的原因），请求失败时返回 undefined。 */
  async function submit(groups) {
    if (!view || groups.length === 0) return undefined;
    groups.forEach((group) => submitting.add(group.id));
    render();
    const result = await runAction(REQUEST_SUBMIT, submitPayload(groups.map((group) => group.id)));
    groups.forEach((group) => submitting.delete(group.id));
    // 提交结果、被拒绝的原因和提醒由宿主以系统通知提示，页面只刷新状态。
    await loadEpisode(false);
    return result;
  }

  /** 从“检查并提交”步骤提交所选的镜头组；至少有一组已入队时展开队列并定位到第一个已提交的组，返回 true。 */
  async function submitSelected(groupIds) {
    const result = await submit(view.groups.filter((group) => groupIds.includes(group.id)));
    if (result && result.submitted.length > 0) {
      queuePanel.open();
      selectedGroupId = result.submitted[0].groupId;
      render();
      return true;
    }
    return false;
  }

  /** 还没有结果、没有进行中任务，且没有超过所选模型单次最长时长的镜头组。 */
  function isPendingGroup(group) {
    return !submitting.has(group.id) && !exceedsModel(group) && !group.jobs.some((job) => ACTIVE_STATUSES.includes(job.status) || job.status === 'succeeded');
  }

  /** 在某个镜头之前拆开所在的组。 */
  async function splitBefore(shot) {
    const { workId, episodeId } = parseEpisodeKey(episodeKey);
    if (await runAction(REQUEST_SPLIT_GROUP, { workId, episodeId, shotId: shot.id })) await loadEpisode(false);
  }

  /** 把一个组并入上一组。 */
  async function mergeIntoPrevious(group) {
    const { workId, episodeId } = parseEpisodeKey(episodeKey);
    if (await runAction(REQUEST_MERGE_GROUP, { workId, episodeId, groupId: group.id })) await loadEpisode(false);
  }

  /** 按填写的单组最长时长重新分组；已有生成记录时先确认会被清除。 */
  async function regroup(secondsText) {
    const seconds = /^\d+$/.test(secondsText.trim()) ? Number(secondsText.trim()) : Number.NaN;
    if (!Number.isInteger(seconds)) {
      message.show('单组最长时长必须是整数（秒）。', true);
      return;
    }
    if (view.groups.some((group) => group.jobs.length > 0)) {
      const confirmed = await aiUi.confirm({
        title: '重新分组',
        message: '重新分组会丢弃本集现有的镜头组，并清除各组已有的生成记录和失败原因（已保存的视频文件不会删除）。确认继续？',
        confirmText: '重新分组',
        cancelText: '取消',
        variant: 'danger'
      });
      if (!confirmed) return;
    }
    const { workId, episodeId } = parseEpisodeKey(episodeKey);
    if (await runAction(REQUEST_REGROUP, { workId, episodeId, maxSeconds: seconds })) await loadEpisode(false);
  }

  /** 当前选中的镜头组及其序号；没有选中（或已不存在）时取第一组。 */
  function selectedGroupIndex() {
    const index = view ? view.groups.findIndex((group) => group.id === selectedGroupId) : -1;
    return index >= 0 ? index : 0;
  }

  /** 选中一个镜头组并刷新页面。 */
  function selectGroup(group) {
    selectedGroupId = group.id;
    render();
  }

  /** 内容区上方的提示：没有可用模型、生成参数需要调整、分镜脚本未确认。 */
  function renderNotices() {
    const notices = [];
    if (catalog.models.length === 0) {
      notices.push(aiUi.h('p', { class: 'status-warning wb-notice', text: '没有可用的视频模型。请在“模型设置”中启用服务商、填写访问密钥并启用视频模型。' }));
    }
    if (resolved && Object.keys(resolved.issues).length > 0) {
      notices.push(aiUi.h('p', { class: 'status-warning wb-notice', text: `生成参数需要调整：${Object.values(resolved.issues).join('')}请在右侧“配置参数”步骤中修改。` }));
    }
    if (view && view.blockReason) {
      notices.push(
        aiUi.h(
          'div',
          { class: 'wb-notice' },
          aiUi.h('span', { class: 'status-warning', text: view.blockReason }),
          aiUi.button({ text: '查看分镜脚本', compact: true, onClick: openStoryboard }).element
        )
      );
    }
    return notices;
  }

  /** 记下各滚动区域的位置；重绘会重建这些元素，位置会丢失。 */
  function captureScroll() {
    return SCROLL_SELECTORS.map((selector) => [...contentElement.querySelectorAll(selector)].map((element) => element.scrollTop));
  }

  /** 恢复滚动位置；切换到另一个镜头组时详情回到顶部。 */
  function restoreScroll(saved, resetDetail) {
    SCROLL_SELECTORS.forEach((selector, selectorIndex) => {
      if (resetDetail && (selector === '.wb-detail__body' || selector === '.wb-shots')) return;
      contentElement.querySelectorAll(selector).forEach((element, index) => {
        element.scrollTop = saved[selectorIndex][index] || 0;
      });
    });
  }

  /** 按当前状态刷新内容区。 */
  function render() {
    const scroll = captureScroll();
    const previousGroupId = selectedGroupId;
    contentElement.textContent = '';
    if (isLoading) {
      contentElement.append(aiUi.state({ text: '加载中…' }));
      return;
    }
    if (loadError) {
      contentElement.append(aiUi.state({ text: loadError, button: aiUi.button({ text: '重试', onClick: () => void loadAll(true) }) }));
      return;
    }
    if (catalog.works.length === 0) {
      contentElement.append(aiUi.state({ text: '还没有分镜脚本。请先在“分镜”列表中为作品生成分镜脚本并确认采用。' }));
      return;
    }
    contentElement.append(...renderNotices());
    if (!view) return;
    if (view.groups.length === 0) {
      contentElement.append(aiUi.state({ text: '这一集没有镜头。' }));
      return;
    }
    const index = selectedGroupIndex();
    const group = view.groups[index];
    selectedGroupId = group.id;
    contentElement.append(aiUi.h('div', { class: 'wb-workspace' }, groupsPanel.render(group.id), detailPanel.render(group, index), stepTabs.element), queuePanel.render());
    restoreScroll(scroll, previousGroupId !== group.id);
    updateStepTabs();
    profilePanel.refresh();
    submitPanel.refresh();
  }

  /** 加载当前集的视图。 */
  async function loadEpisode(showLoading) {
    if (!catalog || episodeKey === '') {
      episodeLoadSerial += 1;
      view = null;
      profile = null;
      updateResolved();
      isLoading = false;
      contextBar.render();
      render();
      bindingsPanel.setEpisode(null);
      profilePanel.refresh();
      return;
    }
    if (showLoading) {
      isLoading = true;
      render();
    }
    loadError = '';
    // 只采纳最后一次请求的响应：快速切换集时旧集的响应不能覆盖新集的视图与参数。
    episodeLoadSerial += 1;
    const serial = episodeLoadSerial;
    let loaded = null;
    try {
      const target = parseEpisodeKey(episodeKey);
      loaded = await Promise.all([window.hostBridge.request(REQUEST_EPISODE, target), window.hostBridge.request(REQUEST_PROFILE, target)]);
    } catch (error) {
      if (serial === episodeLoadSerial) loadError = errorText(error);
    }
    if (serial !== episodeLoadSerial) return;
    if (loaded !== null) {
      [view, profile] = loaded;
      updateResolved();
    }
    isLoading = false;
    contextBar.render();
    render();
    bindingsPanel.setEpisode(episodeKey === '' ? null : parseEpisodeKey(episodeKey).episodeId);
    profilePanel.refresh();
    submitPanel.refresh();
    aiVersions.refresh();
  }

  /** 加载清单与当前集；showLoading 为 false 时保留现有内容（后台刷新）。 */
  async function loadAll(showLoading) {
    if (showLoading) {
      isLoading = true;
      render();
    }
    loadError = '';
    try {
      catalog = await window.hostBridge.request(REQUEST_CATALOG);
      normalizeEpisodeKey();
      contextBar.render();
      // 作品被删除后，它的分镜脚本产出层没有意义，自动关闭。
      aiStage.closeMissing(catalog.works.map((work) => work.id));
    } catch (error) {
      loadError = errorText(error);
      isLoading = false;
      render();
      return;
    }
    await loadEpisode(false);
  }

  /** 数据变化后稍作合并再刷新，任务状态频繁变化时避免反复重绘。 */
  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(async () => {
      await Promise.all([loadAll(false), bindingsPanel.refresh()]);
      void aiTailFrames.sync();
    }, REFRESH_DELAY_MS);
  }

  /** 顶部上下文栏、镜头组列表、详情与队列、任务操作：各自的绘制在子脚本里，这里注入页面状态与操作。 */
  const contextBar = aiWorkbenchContext.create({
    getCatalog: () => catalog,
    getEpisodeKey: () => episodeKey,
    getResolved: () => resolved,
    selectEpisode
  });
  const jobActions = aiWorkbenchActions.create({
    getView: () => view,
    getEpisodeTarget: () => parseEpisodeKey(episodeKey),
    runAction,
    message,
    reload: () => loadEpisode(false)
  });
  const groupsPanel = aiWorkbenchGroups.create({ getView: () => view, modelMaxSeconds, selectGroup, regroup });
  const detailPanel = aiWorkbenchDetail.create({
    getView: () => view,
    getResolved: () => resolved,
    groupResolved,
    groupModelMaxSeconds,
    exceedsModel,
    isSubmitting: (groupId) => submitting.has(groupId),
    editGroupShots,
    splitBefore,
    mergeIntoPrevious,
    cancelJob: jobActions.cancelJob,
    openVersions: jobActions.openVersions,
    openResult: jobActions.openResult,
    exportResult: jobActions.exportResult,
    revealResult: jobActions.revealResult
  });
  const queuePanel = aiWorkbenchQueue.create({
    getView: () => view,
    selectGroup,
    cancelJob: jobActions.cancelJob,
    canRetry: (group) => view.canGenerate && paramsReady() && groupParamsReady(group) && !submitting.has(group.id) && !exceedsModel(group),
    retry: (group) => submit([group]),
    openResult: jobActions.openResult,
    render
  });

  /** 渲染页面骨架：顶部上下文栏、操作结果、内容区；创建右栏三个步骤的面板。 */
  function renderPage() {
    contentElement = aiUi.h('div', { class: 'wb-content' });
    root.append(contextBar.element, message.element, contentElement);
    // 三个步骤的面板创建一次，之后只在步骤之间切换显示。
    bindingsPanel = aiBindings.create();
    profilePanel = aiProfile.create({ getState: () => ({ catalog, profile, group: profileGroup() }), save: saveProfile });
    submitPanel = aiSubmit.create({
      getState: () => ({ view, resolved, episodeKey, busyGroupIds: submitting }),
      isVisible: () => Boolean(stepTabs) && stepTabs.getActive() === 'submit' && stepTabs.element.isConnected,
      groupStatus,
      isSelectable: (group) => !hasActiveJob(group) && !submitting.has(group.id),
      isPending: isPendingGroup,
      openPrevious: () => stepTabs.showPrevious(),
      preview: (groupIds) => window.hostBridge.request(REQUEST_PREVIEW, submitPayload(groupIds)),
      submit: submitSelected
    });
    stepTabs = aiStepTabs.create({
      ariaLabel: '生成步骤',
      initial: 'bindings',
      tabs: [
        { id: 'bindings', label: '绑定素材', icon: 'link', build: () => bindingsPanel },
        { id: 'profile', label: '配置参数', icon: 'adjustments', build: () => profilePanel },
        { id: 'submit', label: '检查并提交', icon: 'list-check', build: () => submitPanel }
      ]
    });
  }

  renderPage();
  window.hostBridge.onEvent(EVENT_CHANGED, scheduleRefresh);
  // 在“模型设置”里改了模型或密钥后，可用模型实时更新。
  window.hostBridge.onEvent(EVENT_MODELS_CHANGED, scheduleRefresh);
  window.setInterval(tickElapsed, ELAPSED_TICK_MS);
  void loadAll(true).then(() => aiTailFrames.sync());
})();
