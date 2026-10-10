// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview.js
// 说明：分镜动画预览层（P10）：把某一集的分镜脚本播放成简化动画；本文件只保留页面状态、各界面单元的装配与生命周期（打开、关闭、读取、刷新、加载序号）。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：通过 aiStoryboardPreview.open({ workId, episodeId, runId?, shotId? }) 打开，同一（作品、集）只有一个预览层；数据沿用 stage.load 请求（带 withImages 以取得实体的资产缩略图）与 stage.changed 事件（名称与 src/app/pages/stage-handlers.ts 一致）；界面拆成 stage-storyboard-preview-stage-view.js（舞台区）、-controls.js（播放控制）、-timeline-view.js（时间线）、-info-panel.js（信息栏）、-voice-panel.js（台词配音面板），各自以“工厂函数 + 注入上下文（页面状态 state、播放器、回调）”创建，页面状态由本文件持有；其余依赖 stage-storyboard-preview-rules/timeline/timeline-sample/checks/draw/art*/props-*/creatures/bestiary/renderer/modes/player/voice/voice-draft.js、shared/page-format.js（阶段状态）、组件库与 stage.js（aiStage.open 用于“在分镜里编辑”）；没有音色的角色与旁白在声音列表里提供“生成音色”入口（对话框在 stage-storyboard-preview-voice-draft.js），生成的临时音色可直接用于配音试听，采用后绑定并重新读取分镜；样式在 stage-storyboard-preview.css；设计见 private-docs/rujian-studio/开发文档-vscode/storyboard-animation-design.md。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_LOAD = 'stage.load';
  const EVENT_CHANGED = 'stage.changed';
  const STAGE = 'storyboard_script';
  const REFRESH_DELAY_MS = 150;
  const PAGE_WIDTH = 1120;
  const PAGE_HEIGHT = 760;
  const PAGE_MIN_WIDTH = 640;
  const PAGE_MIN_HEIGHT = 480;
  const NOTE_TEXT = '预览用矢量图形（有资产图时用缩略图）示意站位、走位、景别、台词和时长，不代表最终画面。';
  const GENERIC_ERROR_TEXT = '分镜脚本读取失败。';

  const timelineApi = window.aiStoryboardTimeline;
  const checksApi = window.aiStoryboardChecks;
  const rendererApi = window.aiStoryboardRenderer;
  const playerApi = window.aiStoryboardPlayer;
  const stageViewApi = window.aiStoryboardPreviewStageView;
  const controlsApi = window.aiStoryboardPreviewControls;
  const timelineViewApi = window.aiStoryboardPreviewTimelineView;
  const infoPanelApi = window.aiStoryboardPreviewInfoPanel;
  const voicePanelApi = window.aiStoryboardPreviewVoicePanel;
  const { isStageUnfinished } = window.pageFormat;

  /** 已打开的预览层：“作品:集” → { workId, handle, refresh, focus }。 */
  const openPreviews = new Map();

  /** 编译一个没有镜头的时间线，作为尚未加载时的占位。 */
  function emptyTimeline(aspectRatio) {
    return timelineApi.compile({ shots: [], groups: [], entities: [], aspectRatio: aspectRatio || null });
  }

  /** 创建预览层并登记。 */
  function createPreview(options, key) {
    const { workId, episodeId } = options;
    // 指定了版本时固定预览它；没指定时始终预览最新版本。
    const pinnedRunId = options.runId === undefined ? null : options.runId;

    /** 预览层的全部状态：数据与显示、加载与界面刷新的运行时状态，以及台词配音的状态（voice）。 */
    const state = {
      view: null,
      timeline: emptyTimeline(null),
      checks: [],
      loading: true,
      error: '',
      playable: false,
      display: { ...rendererApi.DEFAULT_DISPLAY },
      mode: 'stage',
      shotIndex: -1,
      canvasSize: { width: 0, height: 0 },
      /** 打开时指定的镜头标识：数据读取后选中它，只用一次。 */
      pendingShotId: options.shotId === undefined ? null : options.shotId,
      /** 加载请求的序号，只采纳最后一次请求的响应；预览层关闭（disposed）后到达的应答不再刷新界面。 */
      loadSerial: 0,
      disposed: false,
      /** 合并连续的数据变化后再刷新的定时器。 */
      refreshTimer: 0,
      context2d: null,
      canvasLabel: '',
      /** 控件状态与镜头高亮上一次的取值，逐帧刷新时只在变化时才改 DOM。 */
      controlsKey: '',
      highlightedIndex: -2,
      /** 拖动时间线进度条：是否正在拖动，以及开始拖动时是否在播放（松手后接着播）。 */
      dragging: false,
      resumeAfterDrag: false,
      voice: {
        /** 试听或合成后显示的提示（结果、失败原因），直到换模型、重新读取分镜或有新的提示；拖动进度条、切换镜头不清除。 */
        message: null,
        /** 正在合成的进度文字，只在合成期间有值，单独一行显示。 */
        progress: null,
        busy: false,
        /** 正在读取已保存配音；读取期间又有变化时记下，读完再读一次。 */
        restoring: false,
        restoreAgain: false,
        /** 上一次重建镜头信息时的所选模型，模型变化才重建。 */
        modelKey: null,
        /** 上一次重建模型下拉时的模型列表与所选，没变化就不重建（下拉打开时不被打断）。 */
        selectKey: null,
        /** 宿主报告的临时音色状态：旁白的音色来源（作品音色、临时音色、没有），以及有临时音色的角色。 */
        speakers: { narrator: 'none', draftEntityIds: [] }
      }
    };

    // 弹出页面的句柄与尺寸观察器保留为闭包变量：它们是界面资源而不是页面数据，handle 要等 aiUi.openPage 返回才有，observer 只在支持 ResizeObserver 时才有，关闭时都要释放。
    let handle = null;
    let observer = null;

    // ---------- 播放器与界面单元 ----------
    // 播放器先于各界面单元创建，单元都要读取播放状态；onPlayerChange 要等单元建好后才会被调用。
    const player = playerApi.create({ timeline: state.timeline, onChange: onPlayerChange });
    const voicePanel = voicePanelApi.create({ state, workId, episodeId, renderShotInfo: () => infoPanel.renderShot(), reload: () => load(false) });
    const stageView = stageViewApi.create({ state, player, retry: () => load(true) });
    const timelineView = timelineViewApi.create({ state, player });
    const infoPanel = infoPanelApi.create({
      state,
      player,
      voiceControl: voicePanel.control,
      clearVoiceStates: voicePanel.clearStateTags,
      editShot: (shotId) => window.aiStage.open(workId, STAGE, episodeId, shotId)
    });
    const controls = controlsApi.create({ state, player, paint: stageView.paint });

    const root = aiUi.h(
      'div',
      { class: 'sbp', attrs: { 'aria-label': '分镜动画预览' } },
      stageView.statusRow,
      stageView.errorRow,
      stageView.modesRow,
      voicePanel.element,
      aiUi.h('div', { class: 'sbp-main' }, stageView.frame, infoPanel.element),
      controls.element,
      timelineView.element,
      aiUi.h('p', { class: 'sbp-note', text: NOTE_TEXT })
    );
    voicePanel.bindUnlock(root);
    controls.bindKeyboard(root);
    voicePanel.start();

    // ---------- 播放状态 ----------
    /** 播放器时间或状态变化：刷新控件、播放头，镜头变了就刷新镜头信息，然后重画。 */
    function onPlayerChange(playerState) {
      const index = timelineApi.locate(state.timeline, playerState.time);
      const shotChanged = index !== state.shotIndex;
      state.shotIndex = index;
      controls.update(playerState);
      timelineView.updatePlayhead(playerState);
      if (shotChanged) {
        stageView.renderStatus();
        infoPanel.renderShot();
        infoPanel.markCurrentChecks();
        voicePanel.render();
      }
      voicePanel.update({ timeline: state.timeline, shotIndex: index, time: playerState.time, playing: playerState.playing, rate: playerState.rate });
      if (shotChanged || !playerState.playing) stageView.updateCanvasLabel(playerState.time);
      stageView.paint();
    }

    // ---------- 数据 ----------
    /** 接收新视图：重建时间线与检查，按镜头标识恢复播放位置（镜头被删除时落到最近的镜头）。 */
    function applyView(view) {
      const previous = state.timeline;
      const playerState = player.getState();
      const saved = timelineApi.position(previous, playerState.time);
      const oldIndex = timelineApi.locate(previous, playerState.time);
      state.view = view;
      // 分镜刷新后声音条目可能已变化，上一次的提示不再适用（合成进行中的进度另外显示，不受影响）。
      state.voice.message = null;
      stageView.syncImages(view);
      state.playable = view.shots.length > 0 && !isStageUnfinished(view.run.display);
      const source = state.playable ? view : { ...view, shots: [], groups: [] };
      state.timeline = timelineApi.compile(source);
      state.checks = checksApi.check(state.timeline);

      let time = timelineApi.restore(state.timeline, saved);
      if (time === null && state.timeline.shots.length > 0) {
        const fallback = state.timeline.shots[Math.min(Math.max(oldIndex, 0), state.timeline.shots.length - 1)];
        time = fallback.start;
      }
      if (state.pendingShotId !== null) {
        const target = state.timeline.shots.find((shot) => shot.id === state.pendingShotId);
        if (target) {
          time = target.start;
          state.pendingShotId = null;
        }
      }
      handle.setTitle(`${view.work.name} › 分镜动画 › 第 ${view.episode.seq} 集`);
      player.setTimeline(state.timeline, time === null ? 0 : time);
    }

    /**
     * 读取本集的分镜脚本并刷新预览（时间线、检查、缩略图、播放位置）；读取失败时保留旧数据并显示原因。
     * @param {boolean} showLoading 为 true 时先清空错误并显示“正在读取”（首次打开、重试），后台刷新传 false，不打断播放。
     * @returns {Promise<void>}
     */
    async function load(showLoading) {
      // 只采纳最后一次请求的响应：变化事件、重试、采用音色后的重载会并发，乱序返回时旧数据不能覆盖新数据。
      state.loadSerial += 1;
      const serial = state.loadSerial;
      if (showLoading) {
        state.loading = true;
        state.error = '';
        renderAll();
      }
      let failure = '';
      let payloadView = null;
      try {
        const payload = { workId, stage: STAGE, episodeId, withImages: true, ...(pinnedRunId === null ? {} : { id: pinnedRunId }) };
        payloadView = await window.hostBridge.request(REQUEST_LOAD, payload);
      } catch (error) {
        failure = (error && error.message) || GENERIC_ERROR_TEXT;
      }
      if (state.disposed || serial !== state.loadSerial) return;
      if (payloadView !== null) applyView(payloadView);
      state.error = failure;
      state.loading = false;
      renderAll();
      void voicePanel.restoreVoices();
    }

    /** 重建全部界面：状态行、时间线、信息栏、检查列表、配音行、控件与舞台。 */
    function renderAll() {
      state.shotIndex = timelineApi.locate(state.timeline, player.getState().time);
      state.controlsKey = '';
      stageView.renderStatus();
      timelineView.render();
      infoPanel.renderShot();
      infoPanel.renderChecks();
      voicePanel.render();
      controls.update(player.getState());
      timelineView.updatePlayhead(player.getState());
      stageView.fit();
      stageView.updateCanvasLabel(player.getState().time);
    }

    /** 合并连续的变化事件后重新加载，保持播放状态。 */
    function scheduleRefresh() {
      window.clearTimeout(state.refreshTimer);
      state.refreshTimer = window.setTimeout(() => void load(false), REFRESH_DELAY_MS);
    }

    /** 定位到某个镜头：已加载时立即跳转，否则等加载完成后定位。 */
    function focus(shotId) {
      const target = state.timeline.shots.find((shot) => shot.id === shotId);
      if (target) player.seek(target.start);
      else state.pendingShotId = shotId;
    }

    // ---------- 尺寸变化 ----------
    if (window.ResizeObserver) {
      observer = new window.ResizeObserver(() => {
        stageView.fit();
        timelineView.render();
      });
      observer.observe(stageView.frame);
      observer.observe(timelineView.tracks);
    }

    handle = aiUi.openPage({
      title: '分镜动画',
      content: root,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      minWidth: PAGE_MIN_WIDTH,
      minHeight: PAGE_MIN_HEIGHT,
      modal: false,
      buttons: [{ id: 'close', text: '关闭', isCancel: true }]
    });
    openPreviews.set(key, { workId, handle, refresh: scheduleRefresh, focus });
    void handle.closed.then(() => {
      state.disposed = true;
      window.clearTimeout(state.refreshTimer);
      if (observer) observer.disconnect();
      voicePanel.dispose();
      player.destroy();
      openPreviews.delete(key);
    });
    renderAll();
    void load(false);
    void voicePanel.refreshSpeakers();
    return handle;
  }

  /**
   * 打开某一集的分镜动画预览；已经打开时聚焦已有的。
   * @param {{ workId: number, episodeId: number, runId?: number|null, shotId?: number|null }} options
   *   runId 为要预览的版本，缺省时预览最新版本；shotId 为打开后定位的镜头标识，缺省从第 1 镜开始。
   * @returns 弹出页面的句柄。
   */
  function open(options) {
    const key = `${options.workId}:${options.episodeId}`;
    const existing = openPreviews.get(key);
    if (existing) {
      existing.handle.element.focus();
      if (options.shotId !== undefined && options.shotId !== null) existing.focus(options.shotId);
      return existing.handle;
    }
    return createPreview(options, key);
  }

  /** 关闭作品已不存在的预览层（作品被删除，或随所属项目一起删除）。 */
  function closeMissing(existingWorkIds) {
    for (const entry of openPreviews.values()) {
      if (!existingWorkIds.includes(entry.workId)) entry.handle.close('api');
    }
  }

  // 该作品的分镜保存、重新生成等变化都会触发事件，打开的预览层一并刷新。
  window.hostBridge.onEvent(EVENT_CHANGED, (payload) => {
    for (const entry of openPreviews.values()) {
      if (payload && entry.workId === payload.workId) entry.refresh();
    }
  });

  window.aiStage.onCloseMissing(closeMissing);
  window.aiStoryboardPreview = { open, closeMissing };
})();
