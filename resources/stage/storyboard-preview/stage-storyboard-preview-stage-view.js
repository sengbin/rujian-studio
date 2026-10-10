// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-stage-view.js
// 说明：分镜动画预览的舞台区：状态行与错误提示、预览视图（舞台、镜头对照、调度俯视图）切换、画布尺寸适配与绘制、资产缩略图加载、画布无障碍文字。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 stage-storyboard-preview.js 拆出，通过 window.aiStoryboardPreviewStageView.create(ctx) 创建，并导出空状态文字 EMPTY_LOADING、EMPTY_UNAVAILABLE 供信息栏共用；依赖 stage-storyboard-preview-timeline.js、-renderer.js、-modes.js 与 aiUi 组件库，样式在 stage-storyboard-preview.css。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const EMPTY_LOADING = '正在读取分镜脚本…';
  const EMPTY_UNAVAILABLE = '分镜脚本生成完成后可以预览';
  const EMPTY_ERROR = '分镜脚本读取失败';
  /** 舞台在没有排版信息时使用的宽度（像素）。 */
  const FALLBACK_STAGE_WIDTH = 640;
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

  const timelineApi = window.aiStoryboardTimeline;
  const samplerApi = window.aiStoryboardSampler;
  const rendererApi = window.aiStoryboardRenderer;
  const modesApi = window.aiStoryboardModes;

  /**
   * 创建舞台区。
   * @param {{ state: object, player: object, retry: () => Promise<void> }} ctx
   *   state 为预览层的页面状态（读 view、timeline、display、shotIndex、loading、error、playable，读写 mode、canvasSize、context2d、canvasLabel）；
   *   player 提供当前播放时刻；retry 为错误行“重试”按钮的回调（重新读取分镜）。
   * @returns {{ statusRow: HTMLElement, errorRow: HTMLElement, modesRow: HTMLElement, frame: HTMLElement, fit: () => void, paint: () => void,
   *   renderStatus: () => void, syncImages: (view: object) => void, updateCanvasLabel: (time: number) => void }}
   *   statusRow、errorRow、modesRow、frame 为页面上自上而下的各元素（frame 是画布外框，尺寸变化时需要观察它）；
   *   fit 按画幅适配画布并重画；paint 重画当前时刻；renderStatus 刷新状态行与错误行；syncImages 同步实体缩略图；updateCanvasLabel 更新画布的无障碍文字。
   */
  function create(ctx) {
    const { state, player, retry } = ctx;
    const reducedMotion = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    /** 实体标识 → 资产缩略图的加载记录；readyImages 只含已加载完成的图，直接传给绘制。 */
    const imageEntries = new Map();
    const readyImages = new Map();

    // ---------- 元素 ----------
    const statusText = aiUi.h('span', { class: 'sbp-status__text', attrs: { role: 'status' } });
    const statusBadges = aiUi.h('span', { class: 'ui-wrap' });
    const errorRow = aiUi.h('div', { class: 'sbp-error', hidden: true });
    const canvas = aiUi.h('canvas', { class: 'sbp-canvas', attrs: { role: 'img', 'aria-label': '分镜动画舞台' } });
    const stageFrame = aiUi.h('div', { class: 'sbp-stage', attrs: { tabindex: '0', role: 'group', 'aria-label': '舞台，空格播放或暂停，方向键前进后退，Shift 加方向键切换镜头' } }, canvas);
    const statusRow = aiUi.h('div', { class: 'sbp-status' }, statusText, statusBadges);
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
      if (state.context2d === null) state.context2d = canvas.getContext('2d');
      return state.context2d;
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
        const panels = samplerApi.comparePanels(state.timeline, state.shotIndex).map((panel) => ({
          label: panel.label,
          frame: panel.time === null ? null : samplerApi.sampleFrame(state.timeline, panel.time, { reducedMotion: true })
        }));
        modesApi.drawCompare(ctx, panels, { width, height, display: state.display, images: readyImages });
      } else if (state.mode === 'top') {
        modesApi.drawTopView(ctx, samplerApi.buildTopView(state.timeline, state.shotIndex, time), { width, height });
      } else {
        const frame = samplerApi.sampleFrame(state.timeline, time, { reducedMotion });
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
        const frame = samplerApi.sampleFrame(state.timeline, time, { reducedMotion });
        if (frame && frame.captions.length > 0) {
          label += `；字幕：${frame.captions.map((caption) => (caption.speakerName ? `${caption.speakerName}：${caption.text}` : caption.text)).join('；')}`;
        }
      }
      if (label !== state.canvasLabel) {
        state.canvasLabel = label;
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
          aiUi.button({ text: '重试', compact: true, onClick: () => void retry() }).element
        );
      }
    }

    return { statusRow, errorRow, modesRow, frame: stageFrame, fit: fitCanvas, paint, renderStatus, syncImages, updateCanvasLabel };
  }

  window.aiStoryboardPreviewStageView = { create, EMPTY_LOADING, EMPTY_UNAVAILABLE };
})();
