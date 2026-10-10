// ------------------------------------------------------------------------
// 名称：stage.js
// 说明：阶段产出层的外壳脚本：在所属页面内以弹出页面显示生成进度，提供版本、确认采用、取消、重试、重新生成、查看原始输出；各阶段自己的内容区由登记的“阶段内容”负责。本文件只保留页面状态、数据加载与各部分的装配。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：通过 aiStage.open(workId, stage, episodeId?, focus?) 打开（focus 为打开后要定位的对象，由阶段内容解释：分镜脚本为镜头标识），同一作品的同一阶段（分镜脚本还要同一集）只有一个产出层；阶段内容由 stage-beat-sheet.js、stage-creative.js、stage-screenplay.js、stage-storyboard.js 通过 aiStage.registerStage 登记；阶段登记 layout: 'workspace' 时使用工作区布局（头部带汇总、主体占满弹出页面高度并在内部滚动），样式见 stage.css；头部与进度区在 stage-header.js（aiStageHeader），确认采用、取消、重试、重新生成、查看原始输出与版本切换在 stage-actions.js（aiStageActions），二者以“工厂函数 + 注入上下文”创建，须先于本文件加载；请求载荷都带 workId 与 stage（分镜脚本还带 episodeId），事件名称与 src/app/pages/stage-handlers.ts 一致；依赖 form/form-runtime.js（aiForm）与 shared/page-format.js（pageFormat）。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_LOAD = 'stage.load';
  const EVENT_CHANGED = 'stage.changed';

  const REFRESH_DELAY_MS = 150;
  const PAGE_WIDTH = 960;
  const PAGE_HEIGHT = 640;
  const PAGE_MIN_WIDTH = 420;
  const PAGE_MIN_HEIGHT = 360;
  /** 阶段登记的布局名称：工作区布局让主体占满弹出页面高度，头部同时显示阶段汇总。 */
  const LAYOUT_WORKSPACE = 'workspace';

  const { requestAction, createFormOpener } = window.pageFormat;
  const actionsApi = window.aiStageActions;
  const headerApi = window.aiStageHeader;

  /**
   * 各阶段登记的“阶段内容”：
   * { stage, label, regenerateForm, keptNote, discardMessage, approveNote(view), layout?, pageSize?, modal?（默认 true；false 为非模态）, canRegenerate?(view), confirmRegenerate?(view), titleSuffix?(view), headerActions?(view), create(context) }，
   * headerActions 返回要追加到头部按钮区的按钮对象（aiUi.button 的返回值），位于“重新生成”之前；
   * create 接收 { call, runAction, showMessage, reload, getView, confirmDiscard }，返回 { render(view, container), renderSummary(view), isDirty(), discard(), focus?(target) }（focus 定位到打开时指定的对象，视图尚未加载时由内容自己记下，加载后再定位）。
   */
  const providers = new Map();
  /** 已打开的产出层：“阶段:作品标识” → { workId, handle, refresh }。 */
  const openViews = new Map();
  /** 作品已不存在时需要一并关闭自己层的订阅者（如分镜动画预览），参数与 closeMissing 相同。 */
  const missingClosers = [];

  /** 登记一个阶段的内容。 */
  function registerStage(provider) {
    providers.set(provider.stage, provider);
  }

  /** 产出层的键；分镜脚本按集区分。 */
  function viewKey(workId, stage, episodeId) {
    return episodeId ? `${stage}:${workId}:${episodeId}` : `${stage}:${workId}`;
  }

  /**
   * 为一个作品的一个阶段创建产出层：弹出页面、加载数据并随宿主事件刷新。
   * @param {number} workId 作品标识。
   * @param {string} stage 阶段，如 creative、screenplay、storyboard_script。
   * @param {number|null} episodeId 集标识，仅分镜脚本阶段使用。
   * @param {number|null} focus 打开后要定位的对象；为 null 时不定位。
   * @returns 弹出页面的句柄。
   */
  function createStageView(workId, stage, episodeId, focus) {
    const provider = providers.get(stage);
    if (!provider) throw new Error(`没有登记阶段：${stage}`);
    const isWorkspace = provider.layout === LAYOUT_WORKSPACE;
    const pageSize = provider.pageSize || { width: PAGE_WIDTH, height: PAGE_HEIGHT };

    /** 当前显示的视图；尚未加载成功时为 null。 */
    let view = null;
    /** 用户在版本下拉中固定查看的版本；为 null 时始终显示最新版本。 */
    let pinnedRunId = null;
    let latestRunId = null;
    let loadError = '';
    let isLoading = true;
    let refreshTimer = 0;
    let handle = null;

    const forms = createFormOpener({ open: (options) => aiForm.open(options) });
    const message = aiUi.message();
    const bodyElement = aiUi.h('div', { class: 'stage-body' });

    /** 发起带作品标识与阶段（分镜脚本还带集标识）的请求。 */
    function call(name, payload) {
      return window.hostBridge.request(name, { ...payload, workId, stage, ...(episodeId ? { episodeId } : {}) });
    }

    /** 阶段在标题里附加的文字，如分镜脚本的“ › 第 1 集”。 */
    function titleSuffix() {
      return provider.titleSuffix && view ? provider.titleSuffix(view) : '';
    }

    /** 在操作结果区显示文字；空串表示清除。 */
    function showMessage(text, isError) {
      message.show(text, isError);
    }

    /** 发起请求，失败时在操作结果区显示原因；成功返回响应数据，失败返回 undefined。 */
    function runAction(name, payload) {
      showMessage('', false);
      return requestAction(() => call(name, payload), (text) => showMessage(text, true));
    }

    /** 加载请求的序号，只采纳最后一次请求的响应：保存、切换版本、事件刷新会并发，旧响应不能覆盖新状态。 */
    let loadSerial = 0;

    /** 加载视图；showLoading 为 false 时保留现有内容（后台刷新）。 */
    async function loadView(showLoading) {
      loadSerial += 1;
      const serial = loadSerial;
      if (showLoading) {
        isLoading = true;
        render();
      }
      loadError = '';
      try {
        const next = await call(REQUEST_LOAD, pinnedRunId === null ? {} : { id: pinnedRunId });
        if (serial !== loadSerial) return undefined;
        // 出现了新的最新版本（如重新生成）：不再固定旧版本，直接显示新版本。
        const newLatestId = next.versions[0].id;
        if (latestRunId !== null && newLatestId !== latestRunId && pinnedRunId !== null) {
          pinnedRunId = null;
          latestRunId = newLatestId;
          return loadView(false);
        }
        latestRunId = newLatestId;
        // 版本或状态变了，之前的结果提示（如“已确认采用。”）已经过期。
        if (view && (next.run.id !== view.run.id || next.run.display !== view.run.display)) showMessage('', false);
        view = next;
      } catch (error) {
        if (serial !== loadSerial) return undefined;
        const text = (error && error.message) || `${provider.label}产出加载失败。`;
        // 后台刷新失败时保留已有内容，只提示；没有可显示的内容（或用户主动重试）时才整页报错。
        if (view && !showLoading) showMessage(text, true);
        else loadError = text;
      }
      isLoading = false;
      render();
      return undefined;
    }

    /** 数据变化后稍作合并再刷新，生成进度频繁推送时避免反复重绘。 */
    function scheduleRefresh() {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void loadView(false), REFRESH_DELAY_MS);
    }

    const content = provider.create({
      call,
      runAction,
      showMessage,
      reload: () => loadView(false),
      getView: () => view,
      confirmDiscard: () => confirmDiscardEdits()
    });

    /** 有未保存的修改时询问是否放弃；没有修改直接返回 true。 */
    async function confirmDiscardEdits() {
      if (!content.isDirty()) return true;
      return aiUi.confirm({
        title: '放弃修改',
        message: provider.discardMessage,
        confirmText: '放弃修改',
        cancelText: '继续编辑',
        variant: 'danger'
      });
    }

    // 头部与进度区、各项操作由 stage-header.js、stage-actions.js 提供；它们依赖阶段内容与上面的状态访问器，所以放在 content 之后创建。
    const actions = actionsApi.create({
      provider,
      episodeId,
      forms,
      content,
      getView: () => view,
      getLatestRunId: () => latestRunId,
      setPinnedRunId: (runId) => {
        pinnedRunId = runId;
      },
      runAction,
      showMessage,
      titleSuffix,
      reload: () => loadView(false),
      confirmDiscardEdits,
      renderHeader: () => header.renderHeader(view)
    });
    const header = headerApi.create({
      provider,
      isWorkspace,
      content,
      titleSuffix,
      setTitle: (title) => {
        if (handle) handle.setTitle(title);
      },
      ...actions
    });
    const root = aiUi.h('div', { class: isWorkspace ? 'stage-view stage-view--workspace' : 'stage-view' }, header.headerElement, message.element, header.progressElement, bodyElement);

    /** 主体：加载中与错误由外壳显示，其余交给阶段内容。 */
    function renderBody() {
      bodyElement.textContent = '';
      if (isLoading) {
        bodyElement.append(aiUi.h('p', { class: 'description', text: '加载中…' }));
        return;
      }
      if (loadError) {
        bodyElement.append(
          aiUi.h('p', { class: 'description', text: loadError }),
          aiUi.button({ text: '重试', onClick: () => void loadView(true) }).element
        );
        return;
      }
      if (view) content.render(view, bodyElement);
    }

    function render() {
      header.renderHeader(view);
      header.renderProgress(view);
      renderBody();
    }

    handle = aiUi.openPage({
      title: provider.label,
      content: root,
      width: pageSize.width,
      height: pageSize.height,
      minWidth: PAGE_MIN_WIDTH,
      minHeight: PAGE_MIN_HEIGHT,
      modal: provider.modal !== false,
      beforeClose: () => confirmDiscardEdits()
    });
    const key = viewKey(workId, stage, episodeId);
    openViews.set(key, {
      workId,
      handle,
      refresh: scheduleRefresh,
      focus: (target) => {
        if (content.focus) content.focus(target);
      }
    });
    if (focus !== null && content.focus) content.focus(focus);
    void handle.closed.then(() => {
      window.clearTimeout(refreshTimer);
      openViews.delete(key);
    });
    void loadView(true);
    return handle;
  }

  /**
   * 打开作品某个阶段的产出层；已经打开时聚焦已有的。
   * @param {number} workId 作品标识。
   * @param {string} stage 阶段，缺省为创意。
   * @param {number|null} episodeId 集标识，分镜脚本阶段必填。
   * @param {number|null} focus 打开后要定位的对象（分镜脚本阶段为镜头标识）；已经打开时同样重新定位。
   * @returns 弹出页面的句柄。
   */
  function open(workId, stage = 'creative', episodeId = null, focus = null) {
    const existing = openViews.get(viewKey(workId, stage, episodeId));
    if (existing) {
      existing.handle.element.focus();
      if (focus !== null) existing.focus(focus);
      return existing.handle;
    }
    return createStageView(workId, stage, episodeId, focus);
  }

  /** 关闭作品已不存在的产出层（作品被删除，或随所属项目一起删除），并通知订阅者。 */
  function closeMissing(existingWorkIds) {
    for (const entry of openViews.values()) {
      if (!existingWorkIds.includes(entry.workId)) entry.handle.close('api');
    }
    for (const close of missingClosers) close(existingWorkIds);
  }

  /** 订阅“作品已不存在”：closeMissing 被调用时一并调用 listener(existingWorkIds)。 */
  function onCloseMissing(listener) {
    missingClosers.push(listener);
  }

  // 一个作品任一阶段变化，都可能影响它的其他阶段（如上游变更提示），所以该作品的产出层一并刷新。
  window.hostBridge.onEvent(EVENT_CHANGED, (payload) => {
    for (const entry of openViews.values()) {
      if (payload && entry.workId === payload.workId) entry.refresh();
    }
  });

  window.aiStage = { open, closeMissing, onCloseMissing, registerStage };
})();
