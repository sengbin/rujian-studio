// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview.js
// 说明：分镜动画预览层（P10）：把某一集的分镜脚本播放成简化动画，提供舞台、播放控制、镜头时间线、镜头信息与质量检查，并随分镜保存自动刷新。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：通过 aiStoryboardPreview.open({ workId, episodeId, runId?, shotId? }) 打开，同一（作品、集）只有一个预览层；数据沿用 stage.load 请求（带 withImages 以取得实体的资产缩略图）与 stage.changed 事件（名称与 src/app/pages/stage-handlers.ts 一致）；依赖 stage-storyboard-preview-timeline/checks/art/renderer/modes/player/voice/voice-draft.js 与 stage.js（aiStage.open 用于“在分镜里编辑”）；没有音色的角色与旁白在声音列表里提供“生成音色”入口（对话框在 stage-storyboard-preview-voice-draft.js），生成的临时音色可直接用于配音试听，采用后绑定并重新读取分镜；样式在 stage-storyboard-preview.css；设计见 docs/storyboard-animation-design.md。
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
  const EMPTY_LOADING = '正在读取分镜脚本…';
  const EMPTY_UNAVAILABLE = '分镜脚本生成完成后可以预览';
  const EMPTY_ERROR = '分镜脚本读取失败';
  /** 阶段记录尚未产出完整镜头的状态。 */
  const UNPLAYABLE_DISPLAYS = ['running', 'failed', 'canceled'];
  /** 舞台在没有排版信息时使用的宽度（像素）。 */
  const FALLBACK_STAGE_WIDTH = 640;
  /** 时间线上分段宽度不小于这个像素才显示镜头序号。 */
  const SEGMENT_LABEL_MIN_WIDTH = 28;
  const FALLBACK_TIMELINE_WIDTH = 800;

  const DISPLAY_OPTIONS = [
    ['names', '名称'],
    ['actions', '动作'],
    ['trail', '轨迹与朝向'],
    ['grid', '站位网格'],
    ['captions', '字幕'],
    ['description', '画面描述'],
    ['camera', '景别与运镜'],
    ['frame', '取景框']
  ];
  /** 预览的三种视图：舞台、镜头对照（上一镜结尾、本镜开头、本镜结尾）、调度俯视图。 */
  const MODE_OPTIONS = [
    { value: 'stage', label: '舞台' },
    { value: 'compare', label: '镜头对照' },
    { value: 'top', label: '调度俯视图' }
  ];
  const MODE_HINTS = {
    stage: '',
    compare: '依次是上一镜结尾、本镜开头、本镜结尾，用来检查镜头之间的衔接。',
    top: '从上往下看站位：实心是此刻位置，空心是起点，灰色虚线连着上一镜的终点。'
  };
  /** 资产缩略图允许的图片类型：只接受常见位图。 */
  const IMAGE_MIME_PATTERN = /^image\/(png|jpeg|webp)$/;
  const RATE_OPTIONS = [0.5, 1, 1.5, 2].map((rate) => ({ value: String(rate), label: `${rate}×` }));
  const LANES = [
    ['dialogue', '对白'],
    ['narration', '旁白'],
    ['sfx', '音效'],
    ['music', '音乐']
  ];
  const SOUND_LABELS = { dialogue: '角色对白', narration: '旁白', sfx: '音效', music: '背景音乐' };
  const FIRST_FRAME_LABELS = { none: '不指定', prev_tail: '上一镜头尾帧', asset: '资产参考图', image: '指定图片' };
  const VOICE_COST_TIP = '试听和合成会调用声音模型，可能产生费用；台词、说话方式、音色绑定或模型变化后会重新合成，没有变化则直接用已合成的结果。';
  const VOICE_DRAFT_TIP = '按剧本里的音色描述让声音模型生成一段试听音色，满意后可以采用并绑定；会调用声音模型，可能产生费用。';
  const VOICE_ADOPT_TIP = '这是还没保存的临时音色，满意后采用，保存为声音资产并绑定。';
  const VOICE_REDO_TIP = '忽略已合成的结果，重新调用声音模型合成，新结果替换旧的；会产生费用，想换一种读法或对结果不满意时使用。';
  const VOICE_SETTINGS_HINT = '在“模型设置”里启用后，这里会自动出现。';

  const timelineApi = window.aiStoryboardTimeline;
  const checksApi = window.aiStoryboardChecks;
  const rendererApi = window.aiStoryboardRenderer;
  const modesApi = window.aiStoryboardModes;
  const playerApi = window.aiStoryboardPlayer;
  const voiceApi = window.aiStoryboardVoice;
  const voiceDraftApi = window.aiStoryboardVoiceDraft;

  /** 已打开的预览层：“作品:集” → { workId, handle, refresh, focus }。 */
  const openPreviews = new Map();

  /** 时间显示：分:秒.十分之一秒。 */
  function formatClock(seconds) {
    const tenths = Math.round(Math.max(0, seconds) * 10);
    const minutes = Math.floor(tenths / 600);
    const rest = (tenths % 600) / 10;
    return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`;
  }

  /** 秒数显示：最多一位小数，整数不带小数点。 */
  function formatSeconds(seconds) {
    return `${Number(seconds.toFixed(1))} 秒`;
  }

  /** 编译一个没有镜头的时间线，作为尚未加载时的占位。 */
  function emptyTimeline(aspectRatio) {
    return timelineApi.compile({ shots: [], groups: [], entities: [], aspectRatio: aspectRatio || null });
  }

  /** 创建预览层并登记。 */
  function createPreview(options, key) {
    const { workId, episodeId } = options;
    // 指定了版本时固定预览它；没指定时始终预览最新版本。
    const pinnedRunId = options.runId === undefined ? null : options.runId;
    let pendingShotId = options.shotId === undefined ? null : options.shotId;
    const reducedMotion = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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
      canvasSize: { width: 0, height: 0 }
    };
    let refreshTimer = 0;
    let handle = null;
    let context2d = null;
    let canvasLabel = '';
    /** 实体标识 → 资产缩略图的加载记录；readyImages 只含已加载完成的图，直接传给绘制。 */
    const imageEntries = new Map();
    const readyImages = new Map();
    /** 控件状态与镜头高亮上一次的取值，逐帧刷新时只在变化时才改 DOM。 */
    let controlsKey = '';
    let highlightedIndex = -2;

    // ---------- 元素 ----------
    const statusText = aiUi.h('span', { class: 'sbp-status__text', attrs: { role: 'status' } });
    const statusBadges = aiUi.h('span', { class: 'sbp-status__badges' });
    const errorRow = aiUi.h('div', { class: 'sbp-error', hidden: true });
    const canvas = aiUi.h('canvas', { class: 'sbp-canvas', attrs: { role: 'img', 'aria-label': '分镜动画舞台' } });
    const stageFrame = aiUi.h('div', { class: 'sbp-stage', attrs: { tabindex: '0', role: 'group', 'aria-label': '舞台，空格播放或暂停，方向键前进后退，Shift 加方向键切换镜头' } }, canvas);
    // 信息栏按页签分类：镜头、画面、调度、声音、检查；面板一次创建，切换时只显示、隐藏。
    const INFO_TABS = [
      { id: 'shot', label: '镜头' },
      { id: 'prompt', label: '画面' },
      { id: 'blocking', label: '调度' },
      { id: 'sounds', label: '声音' },
      { id: 'checks', label: '检查' }
    ];
    let infoTab = 'shot';
    const infoPanels = {};
    const infoTabButtons = {};
    const infoCounts = {};
    for (const tab of INFO_TABS) {
      const tabId = aiUi.uid('sbp-tab');
      const panelId = aiUi.uid('sbp-panel');
      infoCounts[tab.id] = aiUi.h('span', { class: 'ui-tab__count sbp-tab__count' });
      infoTabButtons[tab.id] = aiUi.h('button', { class: 'ui-tab sbp-tab', attrs: { type: 'button', role: 'tab', id: tabId, 'aria-controls': panelId } }, tab.label, infoCounts[tab.id]);
      infoPanels[tab.id] = aiUi.h('div', { class: 'sbp-panel', attrs: { role: 'tabpanel', id: panelId, 'aria-labelledby': tabId } });
    }
    const checkInfo = infoPanels.checks;
    checkInfo.classList.add('sbp-info__checks');
    const infoBody = aiUi.h('div', { class: 'sbp-info__body' }, INFO_TABS.map((tab) => infoPanels[tab.id]));
    const infoTabs = aiUi.h('div', { class: 'ui-tabs sbp-tabs', attrs: { role: 'tablist', 'aria-label': '镜头信息类别' } }, INFO_TABS.map((tab) => infoTabButtons[tab.id]));
    const infoPanel = aiUi.h('aside', { class: 'sbp-info', attrs: { 'aria-label': '镜头信息与检查' } }, infoTabs, infoBody);
    /** 选中信息页签：只显示它的面板，只有选中的页签在键盘 Tab 顺序里。 */
    function selectInfoTab(id) {
      infoTab = id;
      for (const tab of INFO_TABS) {
        const isActive = tab.id === id;
        infoTabButtons[tab.id].setAttribute('aria-selected', String(isActive));
        infoTabButtons[tab.id].tabIndex = isActive ? 0 : -1;
        infoPanels[tab.id].hidden = !isActive;
      }
      infoBody.scrollTop = 0;
    }
    INFO_TABS.forEach((tab, index) => {
      infoTabButtons[tab.id].addEventListener('click', () => selectInfoTab(tab.id));
      infoTabButtons[tab.id].addEventListener('keydown', (event) => {
        let target;
        if (event.key === 'ArrowLeft') target = INFO_TABS[(index - 1 + INFO_TABS.length) % INFO_TABS.length];
        else if (event.key === 'ArrowRight') target = INFO_TABS[(index + 1) % INFO_TABS.length];
        else if (event.key === 'Home') target = INFO_TABS[0];
        else if (event.key === 'End') target = INFO_TABS[INFO_TABS.length - 1];
        else return;
        event.preventDefault();
        selectInfoTab(target.id);
        infoTabButtons[target.id].focus();
      });
    });
    selectInfoTab(infoTab);
    const timeLabel = aiUi.h('span', { class: 'sbp-time', text: `${formatClock(0)} / ${formatClock(0)}` });
    const groupRow = aiUi.h('div', { class: 'sbp-tl-row sbp-tl-row--groups' });
    const segmentRow = aiUi.h('div', { class: 'sbp-tl-row sbp-tl-row--shots' });
    const laneRows = aiUi.h('div', { class: 'sbp-tl-lanes' });
    const laneLabels = aiUi.h('div', { class: 'sbp-tl-labels' });
    const playhead = aiUi.h('div', { class: 'sbp-playhead', attrs: { 'aria-hidden': 'true' } });
    const tracks = aiUi.h(
      'div',
      { class: 'sbp-tl-tracks', attrs: { role: 'slider', tabindex: '0', 'aria-label': '播放进度', 'aria-valuemin': '0', 'aria-valuemax': '0', 'aria-valuenow': '0' } },
      groupRow,
      segmentRow,
      laneRows,
      playhead
    );
    const timelineElement = aiUi.h('div', { class: 'sbp-timeline' }, laneLabels, tracks);

    // ---------- 播放器 ----------
    const player = playerApi.create({ timeline: state.timeline, onChange: onPlayerChange });

    // ---------- 控制行 ----------
    const playButton = aiUi.button({ text: '播放', icon: 'player-play', iconOnly: true, ariaLabel: '播放', onClick: () => player.toggle() });
    const prevButton = aiUi.button({ text: '上一镜', icon: 'player-skip-back', iconOnly: true, onClick: () => player.prevShot() });
    const nextButton = aiUi.button({ text: '下一镜', icon: 'player-skip-forward', iconOnly: true, onClick: () => player.nextShot() });
    const stopButton = aiUi.button({ text: '回到开头', icon: 'player-stop', iconOnly: true, onClick: () => player.stop() });
    const loopButton = aiUi.button({ text: '循环当前镜头', icon: 'repeat', iconOnly: true, onClick: () => player.setLoopShot(!player.getState().loopShot) });
    loopButton.element.setAttribute('aria-pressed', 'false');
    const rateSelect = aiUi.select({ options: RATE_OPTIONS, value: '1', allowEmpty: false, ariaLabel: '倍速', onChange: (value) => player.setRate(Number(value)) });
    const displayControls = DISPLAY_OPTIONS.map(([name, label]) =>
      aiUi.checkbox({
        label,
        checked: state.display[name],
        onChange: (checked) => {
          state.display[name] = checked;
          paint();
        }
      })
    );
    const transportButtons = [playButton, prevButton, nextButton, stopButton, loopButton];
    const modeHint = aiUi.h('span', { class: 'sbp-modes__hint' });
    const modeGroup = aiUi.radioGroup({
      options: MODE_OPTIONS,
      value: state.mode,
      direction: 'horizontal',
      ariaLabel: '预览视图',
      onChange: (value) => {
        state.mode = value;
        modeHint.textContent = MODE_HINTS[value] || '';
        fitCanvas();
      }
    });
    const modesRow = aiUi.h('div', { class: 'sbp-modes' }, modeGroup.element, modeHint);

    // ---------- 台词配音 ----------
    const voiceSync = voiceApi.createSync(undefined, (error) => setVoiceMessage(`配音播放失败：${(error && (error.message || error.name)) || '浏览器拒绝了播放'}。`, true));
    /** 试听或合成后显示的提示（结果、失败原因），直到换模型、重新读取分镜或有新的提示；拖动进度条、切换镜头不清除。 */
    let voiceMessage = null;
    /** 正在合成的进度文字，只在合成期间有值，单独一行显示。 */
    let voiceProgress = null;
    let voiceBusy = false;
    /** 正在读取已保存配音；读取期间又有变化时记下，读完再读一次。 */
    let voiceRestoring = false;
    let voiceRestoreAgain = false;
    /** 上一次重建镜头信息时的所选模型，模型变化才重建。 */
    let voiceModelKey = null;
    /** 上一次重建模型下拉时的模型列表与所选，没变化就不重建（下拉打开时不被打断）。 */
    let voiceSelectKey = null;
    /** 宿主报告的临时音色状态：旁白的音色来源（作品音色、临时音色、没有），以及有临时音色的角色。 */
    let voiceSpeakers = { narrator: 'none', draftEntityIds: [] };
    /** 预览层已关闭：之后到达的应答不再刷新界面。 */
    let disposed = false;
    const voiceSlot = aiUi.h('span', { class: 'sbp-voice__model' });
    const voiceHint = aiUi.h('span', { class: 'status-warning sbp-voice__hint', attrs: { role: 'status' }, hidden: true });
    const voiceStatus = aiUi.h('span', { class: 'sbp-voice__status', attrs: { role: 'status' } });
    const voiceSummary = aiUi.h('span', { class: 'sbp-voice__summary' });
    const voiceProgressText = aiUi.h('span', { class: 'sbp-voice__progress', attrs: { role: 'status' } });
    const voiceInfo = aiUi.h('div', { class: 'sbp-voice__info' }, voiceSummary, voiceProgressText, voiceStatus);
    const voiceSyncBox = aiUi.checkbox({
      label: '播放时配音',
      checked: false,
      disabled: true,
      onChange: (checked) => {
        voiceSync.setEnabled(checked);
        voiceSync.unlock();
      }
    });
    const voiceBatchButton = aiUi.button({ text: '合成本镜头配音', icon: 'microphone', compact: true, disabled: true, onClick: () => void synthesizeShot() });
    voiceBatchButton.element.title = VOICE_COST_TIP;
    const voiceAllButton = aiUi.button({ text: '合成整集配音', icon: 'microphone', compact: true, disabled: true, onClick: () => void synthesizeEpisode() });
    voiceAllButton.element.title = VOICE_COST_TIP;
    const voiceRedoShotButton = aiUi.button({ text: '重新合成本镜头', icon: 'refresh', compact: true, disabled: true, onClick: () => void resynthesize(shotVoiceSounds(), '本镜头') });
    voiceRedoShotButton.element.title = VOICE_REDO_TIP;
    const voiceRedoAllButton = aiUi.button({ text: '重新合成整集', icon: 'refresh', compact: true, disabled: true, onClick: () => void resynthesize(episodeVoiceSounds(), '整集') });
    voiceRedoAllButton.element.title = VOICE_REDO_TIP;
    const voiceRow = aiUi.h(
      'div',
      { class: 'sbp-voice', attrs: { role: 'group', 'aria-label': '台词配音' } },
      aiUi.h('span', { class: 'sbp-voice__label', text: '台词配音', attrs: { title: VOICE_COST_TIP } }),
      voiceSlot,
      voiceHint,
      voiceSyncBox.element,
      voiceBatchButton.element,
      voiceAllButton.element,
      voiceRedoShotButton.element,
      voiceRedoAllButton.element,
      voiceInfo
    );
    const controlsRow = aiUi.h(
      'div',
      { class: 'sbp-controls' },
      aiUi.h('div', { class: 'sbp-controls__transport' }, transportButtons.map((button) => button.element)),
      timeLabel,
      aiUi.h('div', { class: 'sbp-controls__rate' }, rateSelect.element),
      aiUi.h('div', { class: 'sbp-controls__display', attrs: { role: 'group', 'aria-label': '显示选项' } }, displayControls.map((control) => control.element))
    );

    const root = aiUi.h(
      'div',
      { class: 'sbp', attrs: { 'aria-label': '分镜动画预览' } },
      aiUi.h('div', { class: 'sbp-status' }, statusText, statusBadges),
      errorRow,
      modesRow,
      voiceRow,
      aiUi.h('div', { class: 'sbp-main' }, stageFrame, infoPanel),
      controlsRow,
      timelineElement,
      aiUi.h('p', { class: 'sbp-note', text: NOTE_TEXT })
    );
    // 浏览器只允许在用户操作的当下启动新的音频，所以每次点击或按键都让配音同步器解锁它的音频元素（开启配音后只做一次）。
    for (const name of ['mousedown', 'pointerup', 'keydown', 'touchend']) root.addEventListener(name, () => voiceSync.unlock(), true);

    // ---------- 舞台尺寸与绘制 ----------
    /** 按画幅在舞台区域内等比缩放画布，并按设备像素比设置画布分辨率；镜头对照三幅画面并排，比例相应加宽。 */
    function fitCanvas() {
      const aspect = state.timeline.aspect.ratio;
      const ratio = state.mode === 'compare' ? (aspect * 3) / (1 - 2 * modesApi.COMPARE_GAP) : aspect;
      const availableWidth = stageFrame.clientWidth || FALLBACK_STAGE_WIDTH;
      const availableHeight = stageFrame.clientHeight || availableWidth / ratio;
      let width = availableWidth;
      let height = width / ratio;
      if (height > availableHeight) {
        height = availableHeight;
        width = height * ratio;
      }
      width = Math.max(1, Math.floor(width));
      height = Math.max(1, Math.floor(height));
      state.canvasSize = { width, height };
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = getContext();
      if (ctx) ctx.setTransform(scale, 0, 0, scale, 0, 0);
      paint();
    }

    function getContext() {
      if (context2d === null) context2d = canvas.getContext('2d');
      return context2d;
    }

    /** 没有可播放内容时舞台上的提示文字。 */
    function emptyMessage() {
      if (state.loading) return EMPTY_LOADING;
      if (state.error && state.view === null) return EMPTY_ERROR;
      return EMPTY_UNAVAILABLE;
    }

    /** 绘制当前时刻的画面：舞台、镜头对照或调度俯视图。 */
    function paint() {
      const ctx = getContext();
      const { width, height } = state.canvasSize;
      if (!ctx || width === 0) return;
      const time = player.getState().time;
      if (state.timeline.shots.length === 0) {
        rendererApi.drawEmpty(ctx, width, height, emptyMessage());
        return;
      }
      if (state.mode === 'compare') {
        const panels = timelineApi.comparePanels(state.timeline, state.shotIndex).map((panel) => ({
          label: panel.label,
          frame: panel.time === null ? null : timelineApi.sampleFrame(state.timeline, panel.time, { reducedMotion: true })
        }));
        modesApi.drawCompare(ctx, panels, { width, height, display: state.display, images: readyImages });
      } else if (state.mode === 'top') {
        modesApi.drawTopView(ctx, timelineApi.buildTopView(state.timeline, state.shotIndex, time), { width, height });
      } else {
        const frame = timelineApi.sampleFrame(state.timeline, time, { reducedMotion });
        rendererApi.draw(ctx, frame, { width, height, display: state.display, time, reducedMotion, images: readyImages });
      }
    }

    /** 同步实体的资产缩略图：新的或有变化的重新加载，加载完成后重画；不再存在的移除。 */
    function syncImages(view) {
      const wanted = new Set();
      for (const entity of view.entities || []) {
        const image = entity.image;
        if (!image || !IMAGE_MIME_PATTERN.test(image.mime)) continue;
        wanted.add(entity.id);
        const key = `${image.mime}:${image.data.length}:${image.data.slice(-24)}`;
        const cached = imageEntries.get(entity.id);
        if (cached && cached.key === key) continue;
        readyImages.delete(entity.id);
        const element = new window.Image();
        const entry = { key, element };
        element.onload = () => {
          if (imageEntries.get(entity.id) !== entry) return;
          const imageWidth = element.naturalWidth || element.width;
          const imageHeight = element.naturalHeight || element.height;
          if (imageWidth > 0 && imageHeight > 0) readyImages.set(entity.id, { element, width: imageWidth, height: imageHeight });
          paint();
        };
        imageEntries.set(entity.id, entry);
        element.src = `data:${image.mime};base64,${image.data}`;
      }
      for (const id of [...imageEntries.keys()]) {
        if (wanted.has(id)) continue;
        imageEntries.delete(id);
        readyImages.delete(id);
      }
    }

    /** 画布的无障碍文字：当前镜头摘要，加上此刻的字幕。 */
    function updateCanvasLabel(time) {
      const shot = state.timeline.shots[state.shotIndex];
      let label = '分镜动画舞台';
      if (shot) {
        label = timelineApi.summarizeShot(shot);
        const frame = timelineApi.sampleFrame(state.timeline, time, { reducedMotion });
        if (frame && frame.captions.length > 0) {
          label += `；字幕：${frame.captions.map((caption) => (caption.speakerName ? `${caption.speakerName}：${caption.text}` : caption.text)).join('；')}`;
        }
      }
      if (label !== canvasLabel) {
        canvasLabel = label;
        canvas.setAttribute('aria-label', label);
      }
    }

    // ---------- 状态行 ----------
    function renderStatus() {
      statusBadges.textContent = '';
      const { view, timeline } = state;
      const shot = timeline.shots[state.shotIndex];
      if (shot) {
        const parts = [`第 ${shot.seq} / ${timeline.shots.length} 镜`, shot.sceneLabel || shot.scene.name, shot.shotSize, shot.cameraMovement].filter(Boolean);
        statusText.textContent = parts.join(' · ');
      } else {
        statusText.textContent = state.playable || state.loading ? '' : EMPTY_UNAVAILABLE;
      }
      if (view && view.versions && view.versions[0] && view.versions[0].id !== view.run.id) {
        const version = view.versions.find((item) => item.id === view.run.id);
        statusBadges.append(aiUi.h('span', { class: 'sbp-badge sbp-badge--history', text: `历史版本${version ? ` v${version.version}` : ''}` }));
      }
      if (state.playable && timeline.aspect.assumed) {
        statusBadges.append(aiUi.h('span', { class: 'sbp-badge', text: '画幅未记录，按 16:9 显示' }));
      }
      errorRow.textContent = '';
      errorRow.hidden = state.error === '';
      if (state.error !== '') {
        errorRow.append(
          aiUi.h('span', { class: 'status-error', text: state.error, attrs: { role: 'alert' } }),
          aiUi.button({ text: '重试', compact: true, onClick: () => void load(true) }).element
        );
      }
    }

    // ---------- 时间线 ----------
    /** 时间线总宽度对应的像素（没有排版信息时用缺省值）。 */
    function timelineWidth() {
      return tracks.clientWidth || FALLBACK_TIMELINE_WIDTH;
    }

    function percent(seconds) {
      const total = state.timeline.totalSeconds;
      return total > 0 ? (seconds / total) * 100 : 0;
    }

    function placeBar(element, start, end) {
      element.style.left = `${percent(start)}%`;
      element.style.width = `${percent(end - start)}%`;
    }

    /** 有警告级检查项的镜头标识集合。 */
    function warningShotIds() {
      return new Set(state.checks.filter((entry) => entry.level === checksApi.LEVEL_WARNING).map((entry) => entry.shotId));
    }

    /** 重建时间线：镜头分段、镜头组标记与声音泳道。 */
    function renderTimeline() {
      groupRow.textContent = '';
      segmentRow.textContent = '';
      laneRows.textContent = '';
      laneLabels.textContent = '';
      highlightedIndex = -2;
      const { timeline } = state;
      const total = timeline.totalSeconds;
      tracks.setAttribute('aria-valuemax', String(total));
      timelineElement.classList.toggle('sbp-timeline--empty', timeline.shots.length === 0);
      if (timeline.shots.length === 0) return;

      const warned = warningShotIds();
      const width = timelineWidth();
      const groupFirst = new Set(timeline.groups.map((group) => group.firstIndex));
      for (const group of timeline.groups) {
        if (group.seq === null) continue;
        const mark = aiUi.h('span', { class: 'sbp-group-mark', text: `组 ${group.seq}` });
        placeBar(mark, group.start, group.end);
        groupRow.append(mark);
      }
      for (const shot of timeline.shots) {
        const wide = (shot.duration / total) * width >= SEGMENT_LABEL_MIN_WIDTH;
        const classes = ['sbp-seg', shot.groupSeq !== null && shot.groupSeq % 2 === 0 ? 'sbp-seg--even' : 'sbp-seg--odd'];
        if (groupFirst.has(shot.index)) classes.push('sbp-seg--group-start');
        if (warned.has(shot.id)) classes.push('sbp-seg--warn');
        const segment = aiUi.h('span', {
          class: classes.join(' '),
          text: wide ? String(shot.seq) : '',
          attrs: { title: `第 ${shot.seq} 镜 · ${shot.sceneLabel || shot.scene.name} · ${formatSeconds(shot.duration)}${warned.has(shot.id) ? ' · 有警告' : ''}`, 'data-index': shot.index }
        });
        placeBar(segment, shot.start, shot.end);
        segmentRow.append(segment);
      }
      for (const [kind, label] of LANES) {
        const sounds = timeline.shots.flatMap((shot) => shot.sounds.filter((sound) => sound.kind === kind).map((sound) => ({ shot, sound })));
        if (sounds.length === 0) continue;
        laneLabels.append(aiUi.h('span', { class: 'sbp-tl-label', text: label }));
        const lane = aiUi.h('div', { class: 'sbp-tl-row sbp-tl-row--lane' });
        for (const { shot, sound } of sounds) {
          const bar = aiUi.h('span', { class: `sbp-sound sbp-sound--${kind}`, attrs: { title: `${label}：${sound.text}` } });
          placeBar(bar, shot.start + sound.start, shot.start + Math.max(sound.end, sound.start + 0.05));
          lane.append(bar);
        }
        laneRows.append(lane);
      }
      updatePlayhead(player.getState());
    }

    /** 播放头位置、当前镜头高亮与滑块无障碍值。 */
    function updatePlayhead(playerState) {
      playhead.style.left = `${percent(playerState.time)}%`;
      if (highlightedIndex !== state.shotIndex) {
        highlightedIndex = state.shotIndex;
        for (const segment of segmentRow.children) {
          segment.classList.toggle('sbp-seg--current', Number(segment.getAttribute('data-index')) === state.shotIndex);
        }
      }
      tracks.setAttribute('aria-valuenow', String(Number(playerState.time.toFixed(1))));
      const shot = state.timeline.shots[state.shotIndex];
      tracks.setAttribute('aria-valuetext', shot ? `第 ${shot.seq} 镜，${formatSeconds(playerState.time)}，共 ${formatSeconds(playerState.total)}` : '没有可播放的镜头');
    }

    /** 按指针位置跳转到对应时间。 */
    function seekFromPointer(event) {
      const rect = tracks.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      player.seek(ratio * state.timeline.totalSeconds);
    }

    let dragging = false;
    let resumeAfterDrag = false;
    tracks.addEventListener('pointerdown', (event) => {
      if (state.timeline.shots.length === 0) return;
      dragging = true;
      resumeAfterDrag = player.getState().playing;
      if (resumeAfterDrag) player.pause();
      if (tracks.setPointerCapture && event.pointerId !== undefined) tracks.setPointerCapture(event.pointerId);
      seekFromPointer(event);
      tracks.focus();
    });
    tracks.addEventListener('pointermove', (event) => {
      if (dragging) seekFromPointer(event);
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      const current = player.getState();
      if (resumeAfterDrag && current.time < current.total) player.play();
    };
    tracks.addEventListener('pointerup', endDrag);
    tracks.addEventListener('pointercancel', endDrag);

    // ---------- 信息栏 ----------
    function section(title, ...children) {
      return aiUi.h('section', { class: 'sbp-section' }, aiUi.h('h3', { class: 'sbp-section__title', text: title }), ...children);
    }

    function factRow(label, value) {
      return aiUi.h('div', { class: 'sbp-fact' }, aiUi.h('dt', { text: label }), aiUi.h('dd', { text: value || '—' }));
    }

    /** 调度列表的一行：颜色点、名称与位置描述。 */
    function actorItem(actor, isFramedOut) {
      const dot = aiUi.h('span', { class: 'sbp-dot', attrs: { 'aria-hidden': 'true' } });
      dot.style.background = actor.color;
      const text = timelineApi.describeActor(actor) + (actor.action ? `；${actor.action}` : '') + (isFramedOut ? '（不在取景范围内，画面里看不到）' : '');
      return aiUi.h('li', { class: 'sbp-list__item' }, dot, aiUi.h('span', { text }));
    }

    /** 声音列表的一行：类型、说话人、内容与时间，附“估算”“超出镜头”标记。 */
    function soundItem(sound) {
      const kindLabel = (state.view.soundKinds || []).find((item) => item.kind === sound.kind);
      const label = kindLabel ? kindLabel.label : SOUND_LABELS[sound.kind] || sound.kind;
      const head = sound.speakerName ? `${label} · ${sound.speakerName}` : label;
      const notes = [sound.estimated ? '时间为估算' : '', sound.clipped ? '超出镜头时长' : ''].filter(Boolean).join('，');
      const isVoice = sound.kind === 'dialogue' || sound.kind === 'narration';
      const deliveryText = isVoice ? (sound.delivery ? `说话方式：${sound.delivery}` : '没有写说话方式（语气、语速、音量），配音按默认语气合成') : sound.delivery || '';
      return aiUi.h(
        'li',
        { class: 'sbp-list__item sbp-list__item--sound' },
        aiUi.h('span', { class: 'sbp-sound-head', text: head }),
        aiUi.h('span', { class: 'sbp-sound-text', text: sound.text }),
        deliveryText === '' ? null : aiUi.h('span', { class: 'sbp-sound-delivery', text: deliveryText }),
        aiUi.h('span', { class: 'sbp-sound-time', text: `${sound.start.toFixed(1)}–${sound.end.toFixed(1)} 秒${notes ? `（${notes}）` : ''}` }),
        voiceControl(sound)
      );
    }

    // ---------- 台词配音 ----------
    /** 请求宿主时带的作品、集与分镜版本（即当前显示的版本，声音标识只在该版本内有效）。 */
    function voiceContext() {
      return { workId, episodeId, runId: state.view ? state.view.run.id : undefined };
    }

    /** 实体本集是否已绑定音色参考。 */
    function entityHasVoice(entityId) {
      const entity = state.view && (state.view.entities || []).find((item) => item.id === entityId);
      return Boolean(entity && entity.hasVoice);
    }

    /** 说话人是否已有音色：角色看本集的绑定与临时音色，旁白（null）看作品的旁白音色与临时音色。 */
    function speakerReady(entityId) {
      if (entityId === null) return voiceSpeakers.narrator !== 'none';
      return entityHasVoice(entityId) || voiceSpeakers.draftEntityIds.includes(entityId);
    }

    /** 说话人用的是还没保存的临时音色。 */
    function usesDraftVoice(entityId) {
      return entityId === null ? voiceSpeakers.narrator === 'draft' : !entityHasVoice(entityId) && voiceSpeakers.draftEntityIds.includes(entityId);
    }

    /** 当前镜头里可以试听的对白与旁白。 */
    function shotVoiceSounds() {
      const shot = state.timeline.shots[state.shotIndex];
      return shot ? shot.sounds.filter((sound) => voiceApi.canPreview(sound, speakerReady)) : [];
    }

    function setVoiceMessage(text, isError) {
      voiceMessage = { text, isError: Boolean(isError) };
      renderVoice();
    }

    function setVoiceProgress(text) {
      voiceProgress = text;
      renderVoice();
    }

    /**
     * 声音行里的配音控件：没有音色的说话人给“生成音色”入口；有音色的带试听按钮（没有可用的声音模型时不显示，配音行已提示去配置）；用临时音色的标明并提供“采用”，作品的旁白音色提供“更换”。
     */
    function voiceControl(sound) {
      const isNarration = sound.kind === 'narration';
      if ((!isNarration && (sound.kind !== 'dialogue' || sound.speakerEntityId === null)) || String(sound.text || '').trim() === '') return null;
      const speakerId = isNarration ? null : sound.speakerEntityId;
      const speakerName = isNarration ? '旁白' : sound.speakerName || '角色';
      if (!speakerReady(speakerId)) {
        const create = aiUi.button({ text: '生成音色', icon: 'microphone', compact: true, ariaLabel: `为${speakerName}生成音色`, onClick: () => openVoiceDraft(sound, speakerId, speakerName) });
        create.element.title = VOICE_DRAFT_TIP;
        return aiUi.h('span', { class: 'sbp-sound-voice sbp-sound-voice--none' }, aiUi.h('span', { text: `${speakerName}还没有音色` }), create.element);
      }
      const parts = [];
      if (voiceApi.getState().selected !== null) {
        const preview = aiUi.audioPreview({ iconOnly: true, ariaLabel: `试听${speakerName}的台词`, load: () => loadVoice(sound) });
        preview.button.element.title = VOICE_COST_TIP;
        parts.push(preview.element);
        const stateTag = aiUi.h('span', { class: 'sbp-sound-voice__state' });
        voiceStateTags.set(sound.id, { element: stateTag, sound });
        applyVoiceState(stateTag, sound);
        parts.push(stateTag);
      }
      if (usesDraftVoice(speakerId)) {
        const adopt = aiUi.button({ text: '采用…', compact: true, ariaLabel: `采用${speakerName}的临时音色`, onClick: () => openVoiceDraft(sound, speakerId, speakerName) });
        adopt.element.title = VOICE_ADOPT_TIP;
        parts.push(aiUi.h('span', { class: 'sbp-sound-voice__tag', text: '临时音色' }), adopt.element);
      } else if (speakerId === null) {
        const change = aiUi.button({ text: '更换音色', compact: true, ariaLabel: '更换旁白音色', onClick: () => openVoiceDraft(sound, speakerId, speakerName) });
        change.element.title = VOICE_DRAFT_TIP;
        parts.push(change.element);
      }
      return parts.length === 0 ? null : aiUi.h('span', { class: 'sbp-sound-voice' }, ...parts);
    }

    /** 打开“生成音色”对话框：试听台词取这一条声音的台词。 */
    function openVoiceDraft(sound, speakerId, speakerName) {
      void voiceDraftApi.open({
        workId,
        episodeId,
        entityId: speakerId,
        speakerName,
        sampleText: sound.text,
        delivery: sound.delivery || '',
        onChanged: (kind, result) => void onVoiceDraftChanged(kind, result)
      });
    }

    /** 读取宿主里各说话人的临时音色与旁白音色状态，并重建依赖它的界面。 */
    async function refreshSpeakers() {
      try {
        const speakers = await voiceApi.loadSpeakers(workId);
        voiceSpeakers = { narrator: speakers.narrator || 'none', draftEntityIds: speakers.draftEntityIds || [] };
      } catch {
        voiceSpeakers = { narrator: 'none', draftEntityIds: [] };
      }
      if (disposed) return;
      renderShotInfo();
      renderVoice();
      void restoreVoices();
    }

    /** 生成了新的试听音色或采用了音色：采用后重新读取分镜（角色的音色绑定变了），再刷新临时音色状态并说明结果。 */
    async function onVoiceDraftChanged(kind, result) {
      if (kind === 'adopted') await load(false);
      await refreshSpeakers();
      if (disposed) return;
      if (kind === 'adopted') {
        const others = result.otherEpisodesBound > 0 ? `，并同时用于其他 ${result.otherEpisodesBound} 集` : '';
        setVoiceMessage(`已保存为声音资产“${result.assetName}”并绑定${others}。`, false);
      } else {
        setVoiceMessage('试听音色已更新，重新合成本镜头配音即可用它试听；满意后点“采用…”。', false);
      }
    }

    /** 试听一条对白：请求宿主合成（内容没变时宿主直接用缓存），失败时在配音行说明原因。 */
    async function loadVoice(sound) {
      try {
        const clip = await voiceApi.load(voiceContext(), sound);
        const base = clip.cached ? '没有重新调用模型，用的是已合成的结果。' : '已调用模型合成。';
        setVoiceMessage(clip.note ? `${base}${clip.note}` : base, false);
        return { mime: clip.mime, data: clip.data };
      } catch (error) {
        setVoiceMessage((error && error.message) || '试听失败。', true);
        return undefined;
      }
    }

    /** 声音标识 → 对白行里的“已合成/需要合成”标记，合成、读取结果后原地更新，不重建对白行（正在试听的不被打断）。 */
    const voiceStateTags = new Map();

    /** 按是否已有可用的合成结果设置标记：没有结果说明还没合成，或台词、说话方式改过。 */
    function applyVoiceState(element, sound) {
      const modelId = voiceApi.getState().selectedId;
      const isReady = modelId !== null && voiceApi.readyClip(modelId, sound) !== null;
      element.textContent = isReady ? '已合成' : '需要合成';
      element.title = isReady ? '' : '还没有合成，或台词、说话方式改过。点“合成本镜头配音”“合成整集配音”或这条的“试听”才会合成（会调用模型）。';
      element.classList.toggle('sbp-sound-voice__state--pending', !isReady);
    }

    function updateVoiceStates() {
      for (const { element, sound } of voiceStateTags.values()) applyVoiceState(element, sound);
    }

    /**
     * 打开预览、重新读取分镜、换模型后，把宿主本地已保存的配音读回来（只读缓存，不调用模型，不产生费用）。
     * 台词、说话方式改过的读不到，显示“需要合成”，由用户点合成或重新合成。
     */
    async function restoreVoices() {
      if (disposed) return;
      if (voiceRestoring) {
        voiceRestoreAgain = true;
        return;
      }
      const modelId = voiceApi.getState().selectedId;
      if (modelId === null || !state.view) return;
      const missing = episodeVoiceSounds().filter((sound) => voiceApi.readyClip(modelId, sound) === null);
      if (missing.length === 0) return;
      voiceRestoring = true;
      try {
        if ((await voiceApi.restore(voiceContext(), missing)) > 0 && !disposed) renderVoice();
      } finally {
        voiceRestoring = false;
        if (voiceRestoreAgain) {
          voiceRestoreAgain = false;
          void restoreVoices();
        }
      }
    }

    /** 合成一批对白，之后“播放时配音”即可听到；scope 是提示里的范围名称，regenerate 为 true 时绕过缓存全部重新合成。 */
    async function synthesizeSounds(sounds, scope, regenerate) {
      if (sounds.length === 0 || voiceBusy) return;
      voiceBusy = true;
      setVoiceProgress(`正在合成配音 0/${sounds.length}…`);
      const result = await voiceApi.loadAll(voiceContext(), sounds, (done, total) => setVoiceProgress(`正在合成配音 ${done}/${total}…`), regenerate);
      voiceBusy = false;
      voiceProgress = null;
      if (result.failed > 0) setVoiceMessage(`已合成 ${result.done} 条，${result.failed} 条失败：${result.error}`, true);
      else setVoiceMessage(`${scope} ${result.done} 条配音已${regenerate ? '重新' : ''}合成，勾选“播放时配音”后播放即可听到。`, false);
    }

    /** 合成当前镜头里全部可试听的对白。 */
    function synthesizeShot() {
      return synthesizeSounds(shotVoiceSounds(), '本镜头');
    }

    /** 整集里全部可试听的对白与旁白。 */
    function episodeVoiceSounds() {
      return state.timeline.shots.flatMap((shot) => shot.sounds.filter((sound) => voiceApi.canPreview(sound, speakerReady)));
    }

    /** 合成整集的配音：条数多、会产生费用，先确认；已合成且没有变化的不会再调用模型。 */
    async function synthesizeEpisode() {
      const sounds = episodeVoiceSounds();
      if (sounds.length === 0 || voiceBusy) return;
      const pending = sounds.length - voiceApi.countReady(sounds);
      const confirmed = await aiUi.confirm({
        title: '合成整集配音',
        message: pending === 0 ? `整集 ${sounds.length} 条配音都已合成，没有变化的不会再调用模型。继续吗？` : `整集共 ${sounds.length} 条配音，其中 ${pending} 条还没合成，将逐条调用声音模型，可能产生费用。继续吗？`,
        confirmText: '合成'
      });
      if (confirmed) await synthesizeSounds(sounds, '整集');
    }

    /** 重新合成：不管有没有变化都重新调用模型，结果替换已合成的；会产生费用，先确认。 */
    async function resynthesize(sounds, scope) {
      if (sounds.length === 0 || voiceBusy) return;
      const confirmed = await aiUi.confirm({
        title: `重新合成${scope}配音`,
        message: `将忽略已合成的结果，逐条重新调用声音模型合成${scope}的 ${sounds.length} 条配音，新结果会替换旧的，可能产生费用。继续吗？`,
        confirmText: '重新合成'
      });
      if (confirmed) await synthesizeSounds(sounds, scope, true);
    }

    /** 重建配音行：声音模型下拉（没有可用模型时提示去“模型设置”配置）、同步播放开关、合成按钮与状态文字。 */
    function renderVoice() {
      const voice = voiceApi.getState();
      const selectKey = `${voice.models.map((model) => model.id).join(',')}|${voice.selectedId}`;
      if (selectKey !== voiceSelectKey) {
        voiceSelectKey = selectKey;
        voiceSlot.textContent = '';
        if (voice.models.length > 0) {
          const modelSelect = aiUi.select({
            options: voice.models.map((model) => ({ value: String(model.id), label: model.label })),
            value: String(voice.selectedId),
            allowEmpty: false,
            ariaLabel: '声音模型',
            onChange: (value) => voiceApi.select(Number(value))
          });
          modelSelect.element.title = '配音使用的声音模型，列表是“模型设置”里已启用并配置了访问密钥的语音模型';
          voiceSlot.append(modelSelect.element);
        }
      }
      const unavailable = voice.loaded && voice.selected === null;
      voiceHint.hidden = !unavailable;
      voiceHint.textContent = unavailable ? `${voice.error || voice.hint} ${VOICE_SETTINGS_HINT}` : '';
      voiceSyncBox.setDisabled(voice.selected === null);
      if (voice.selected === null) {
        voiceSyncBox.setValue(false);
        voiceSync.setEnabled(false);
      }
      const sounds = shotVoiceSounds();
      voiceBatchButton.setDisabled(voice.selected === null || sounds.length === 0 || voiceBusy);
      const episodeSounds = voice.selected === null ? [] : episodeVoiceSounds();
      voiceAllButton.setDisabled(episodeSounds.length === 0 || voiceBusy);
      voiceRedoShotButton.setDisabled(voice.selected === null || sounds.length === 0 || voiceBusy);
      voiceRedoAllButton.setDisabled(episodeSounds.length === 0 || voiceBusy);
      let summary = '';
      if (voice.selected !== null && episodeSounds.length > 0) {
        const readyAll = voiceApi.countReady(episodeSounds);
        const missing = episodeSounds.length - readyAll;
        const hint = missing > 0 ? `，${missing} 条需要合成（还没合成，或台词、说话方式改过）` : '';
        summary = `本镜头 ${sounds.length} 条对白可配音，已合成 ${voiceApi.countReady(sounds)} 条；整集已合成 ${readyAll}/${episodeSounds.length} 条${hint}。`;
      }
      voiceSummary.textContent = summary;
      voiceProgressText.textContent = voiceProgress === null ? '' : voiceProgress;
      voiceStatus.textContent = voiceMessage === null ? '' : voiceMessage.text;
      voiceStatus.classList.toggle('status-error', voiceMessage !== null && voiceMessage.isError);
      updateVoiceStates();
    }

    /** 声音模型状态变化（读取完成、模型在设置里被启用或关闭、换了所选模型）：刷新配音行，模型变化时连同对白行的试听按钮一起重建。 */
    function onVoiceChange(voice) {
      const key = voice.selectedId === null ? '' : String(voice.selectedId);
      const modelChanged = key !== voiceModelKey;
      voiceModelKey = key;
      if (modelChanged) voiceMessage = null;
      renderVoice();
      if (modelChanged) {
        renderShotInfo();
        void restoreVoices();
      }
    }
    const unsubscribeVoice = voiceApi.subscribe(onVoiceChange);

    /** 页签上的数量标记；0 或没有时不显示。 */
    function setTabCount(id, count) {
      infoCounts[id].textContent = count > 0 ? String(count) : '';
    }

    /** 重建当前镜头的信息：基本信息、画面描述、调度、声音，分别放进各自的页签。 */
    function renderShotInfo() {
      voiceStateTags.clear();
      for (const id of ['shot', 'prompt', 'blocking', 'sounds']) {
        infoPanels[id].textContent = '';
        setTabCount(id, 0);
      }
      const shot = state.timeline.shots[state.shotIndex];
      if (!shot) {
        infoPanels.shot.append(aiUi.h('p', { class: 'sbp-empty', text: state.loading ? EMPTY_LOADING : EMPTY_UNAVAILABLE }));
        return;
      }
      const cameraText = shot.cameraMovement ? (shot.camera.supported ? shot.cameraMovement : `${shot.cameraMovement}（预览未模拟）`) : '';
      infoPanels.shot.append(
        section(
          `第 ${shot.seq} 镜`,
          aiUi.h(
            'dl',
            { class: 'sbp-facts' },
            factRow('场次', shot.sceneLabel || shot.scene.name),
            factRow('景别', shot.shotSize),
            factRow('机位', shot.cameraAngle),
            factRow('运镜', cameraText),
            factRow('转场', shot.transition),
            factRow('时长', formatSeconds(shot.duration)),
            factRow('所属组', shot.groupSeq === null ? '' : `第 ${shot.groupSeq} 组`),
            factRow('首帧', FIRST_FRAME_LABELS[shot.firstFrameMode] || '')
          )
        )
      );
      infoPanels.prompt.append(aiUi.h('p', { class: 'sbp-prompt', text: shot.prompt || '—' }));
      const framedOut = timelineApi.framedOut(state.timeline, state.shotIndex);
      const actorItems = shot.actors.map((actor) => actorItem(actor, framedOut.has(actor.entityId)));
      for (const entity of shot.unplaced) {
        actorItems.push(aiUi.h('li', { class: 'sbp-list__item' }, aiUi.h('span', { text: `${entity.name}：未绘制（没有站位）` })));
      }
      infoPanels.blocking.append(actorItems.length > 0 ? aiUi.h('ul', { class: 'sbp-list' }, actorItems) : aiUi.h('p', { class: 'sbp-empty', text: '没有出场的角色、道具或特效。' }));
      infoPanels.sounds.append(shot.sounds.length > 0 ? aiUi.h('ul', { class: 'sbp-list' }, shot.sounds.map(soundItem)) : aiUi.h('p', { class: 'sbp-empty', text: '没有声音条目。' }));
      setTabCount('blocking', actorItems.length);
      setTabCount('sounds', shot.sounds.length);
    }

    /** 打开分镜编辑区并定位到镜头。 */
    function editShot(shotId) {
      window.aiStage.open(workId, STAGE, episodeId, shotId);
    }

    /** 重建检查列表：汇总与各检查项（点击跳转，右侧按钮在分镜里编辑）。 */
    function renderChecks() {
      checkInfo.textContent = '';
      setTabCount('checks', state.checks.length);
      infoTabButtons.checks.classList.toggle('ui-tab--warning', state.checks.some((entry) => entry.level === checksApi.LEVEL_WARNING));
      if (state.timeline.shots.length === 0) return;
      const { warnings, infos } = checksApi.summarize(state.checks);
      const summary = state.checks.length === 0 ? '没有发现问题' : `警告 ${warnings} 项，提示 ${infos} 项`;
      const items = state.checks.map((entry) => {
        const iconName = entry.level === checksApi.LEVEL_WARNING ? 'alert-triangle' : 'info-circle';
        const main = aiUi.h(
          'button',
          { class: 'sbp-check__main', attrs: { type: 'button', title: '跳转到该镜头' }, on: { click: () => player.seekToShot(entry.shotIndex) } },
          aiUi.icon(iconName, 'sbp-check__icon'),
          aiUi.h('span', { text: entry.text })
        );
        const edit = aiUi.button({ text: '在分镜里编辑', icon: 'pencil', iconOnly: true, compact: true, onClick: () => editShot(entry.shotId) });
        return aiUi.h('li', { class: `sbp-check sbp-check--${entry.level}`, attrs: { 'data-index': entry.shotIndex } }, main, edit.element);
      });
      checkInfo.append(section(`检查（${summary}）`, items.length > 0 ? aiUi.h('ul', { class: 'sbp-checks' }, items) : null));
      markCurrentChecks();
    }

    /** 当前镜头的检查项加高亮。 */
    function markCurrentChecks() {
      for (const item of checkInfo.querySelectorAll('.sbp-check')) {
        item.classList.toggle('sbp-check--current', Number(item.getAttribute('data-index')) === state.shotIndex);
      }
    }

    // ---------- 播放状态 ----------
    function updateControls(playerState) {
      timeLabel.textContent = `${formatClock(playerState.time)} / ${formatClock(playerState.total)}`;
      const key = `${playerState.playing}|${playerState.loopShot}|${state.playable}|${state.timeline.shots.length}`;
      if (key === controlsKey) return;
      controlsKey = key;
      playButton.setIcon(playerState.playing ? 'player-pause' : 'player-play');
      playButton.setAriaLabel(playerState.playing ? '暂停' : '播放');
      loopButton.element.setAttribute('aria-pressed', String(playerState.loopShot));
      loopButton.element.classList.toggle('sbp-pressed', playerState.loopShot);
      const disabled = !state.playable || state.timeline.shots.length === 0;
      for (const button of transportButtons) button.setDisabled(disabled);
      rateSelect.setDisabled(disabled);
    }

    /** 播放器时间或状态变化：刷新控件、播放头，镜头变了就刷新镜头信息，然后重画。 */
    function onPlayerChange(playerState) {
      const index = timelineApi.locate(state.timeline, playerState.time);
      const shotChanged = index !== state.shotIndex;
      state.shotIndex = index;
      updateControls(playerState);
      updatePlayhead(playerState);
      if (shotChanged) {
        renderStatus();
        renderShotInfo();
        markCurrentChecks();
        renderVoice();
      }
      voiceSync.update({ timeline: state.timeline, shotIndex: index, time: playerState.time, playing: playerState.playing, rate: playerState.rate });
      if (shotChanged || !playerState.playing) updateCanvasLabel(playerState.time);
      paint();
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
      voiceMessage = null;
      syncImages(view);
      state.playable = view.shots.length > 0 && !UNPLAYABLE_DISPLAYS.includes(view.run.display);
      const source = state.playable ? view : { ...view, shots: [], groups: [] };
      state.timeline = timelineApi.compile(source);
      state.checks = checksApi.check(state.timeline);

      let time = timelineApi.restore(state.timeline, saved);
      if (time === null && state.timeline.shots.length > 0) {
        const fallback = state.timeline.shots[Math.min(Math.max(oldIndex, 0), state.timeline.shots.length - 1)];
        time = fallback.start;
      }
      if (pendingShotId !== null) {
        const target = state.timeline.shots.find((shot) => shot.id === pendingShotId);
        if (target) {
          time = target.start;
          pendingShotId = null;
        }
      }
      handle.setTitle(`${view.work.name} › 分镜动画 › 第 ${view.episode.seq} 集`);
      player.setTimeline(state.timeline, time === null ? 0 : time);
    }

    async function load(showLoading) {
      if (showLoading) {
        state.loading = true;
        state.error = '';
        renderAll();
      }
      try {
        const payload = { workId, stage: STAGE, episodeId, withImages: true, ...(pinnedRunId === null ? {} : { id: pinnedRunId }) };
        applyView(await window.hostBridge.request(REQUEST_LOAD, payload));
        state.error = '';
      } catch (error) {
        state.error = (error && error.message) || GENERIC_ERROR_TEXT;
      }
      state.loading = false;
      renderAll();
      void restoreVoices();
    }

    function renderAll() {
      state.shotIndex = timelineApi.locate(state.timeline, player.getState().time);
      controlsKey = '';
      renderStatus();
      renderTimeline();
      renderShotInfo();
      renderChecks();
      renderVoice();
      updateControls(player.getState());
      updatePlayhead(player.getState());
      fitCanvas();
      updateCanvasLabel(player.getState().time);
    }

    /** 合并连续的变化事件后重新加载，保持播放状态。 */
    function scheduleRefresh() {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void load(false), REFRESH_DELAY_MS);
    }

    /** 定位到某个镜头：已加载时立即跳转，否则等加载完成后定位。 */
    function focus(shotId) {
      const target = state.timeline.shots.find((shot) => shot.id === shotId);
      if (target) player.seek(target.start);
      else pendingShotId = shotId;
    }

    // ---------- 键盘 ----------
    root.addEventListener('keydown', (event) => {
      // 控件自己处理空格、方向键与回车。
      if (event.target.closest('button, select, input, textarea, [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="listbox"], [role="option"]')) return;
      if (state.timeline.shots.length === 0) return;
      let handled = true;
      if (event.key === ' ') player.toggle();
      else if (event.key === 'ArrowLeft') (event.shiftKey ? player.prevShot : () => player.step(-1))();
      else if (event.key === 'ArrowRight') (event.shiftKey ? player.nextShot : () => player.step(1))();
      else if (event.key === 'Home') player.seek(0);
      else if (event.key === 'End') player.seek(state.timeline.totalSeconds);
      else handled = false;
      if (handled) event.preventDefault();
    });

    // ---------- 尺寸变化 ----------
    let observer = null;
    if (window.ResizeObserver) {
      observer = new window.ResizeObserver(() => {
        fitCanvas();
        renderTimeline();
      });
      observer.observe(stageFrame);
      observer.observe(tracks);
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
      disposed = true;
      window.clearTimeout(refreshTimer);
      if (observer) observer.disconnect();
      unsubscribeVoice();
      voiceSync.stop();
      player.destroy();
      openPreviews.delete(key);
    });
    renderAll();
    void load(false);
    void refreshSpeakers();
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
