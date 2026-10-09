// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-modes.js
// 说明：分镜动画的两种对照视图的绘制：镜头对照（上一镜结尾、本镜开头、本镜结尾并排）与调度俯视图（5×3 站位网格上的走位轨迹、朝向和上一镜终点）。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：只接收画布上下文与 stage-storyboard-preview-timeline.js 产出的数据，不读取视图、不依赖页面；颜色固定，不随主题变化；通过 window.aiStoryboardModes 暴露，依赖 stage-storyboard-preview-renderer.js。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const renderer = window.aiStoryboardRenderer;
  const timelineApi = window.aiStoryboardTimeline;

  /** 镜头对照：相邻画面之间的间距占总宽度的比例。 */
  const COMPARE_GAP = 0.012;
  const COMPARE_LABEL_FONT = 0.045;
  const COMPARE_EMPTY_TEXT = '没有上一镜';
  const NO_OVERLAY = { fadeToBlack: 0, flashWhite: 0, dissolve: null };

  /** 俯视图：横向范围（含画面外两列）、舞台区上下边与行位置的内缩。 */
  const X_MIN = -0.2;
  const X_MAX = 1.2;
  const PAD_X = 0.05;
  const TOP = 0.13;
  const BOTTOM = 0.86;
  const ROW_INSET = 0.1;
  const MARKER_RADIUS = 0.032;
  const COLUMN_LABELS = { off_left: '左外', left: '左', center: '中', right: '右', off_right: '右外' };
  const ROW_LABELS = [[0, '背景'], [0.5, '中景'], [1, '前景']];
  const FACING_VECTORS = { left: [-1, 0], right: [1, 0], camera: [0, 1], away: [0, -1] };

  const COLOR_BACKGROUND = '#14171D';
  const COLOR_VISIBLE = '#232A35';
  const COLOR_LINE = 'rgba(255, 255, 255, 0.22)';
  const COLOR_TEXT = '#FFFFFF';
  const COLOR_MUTED = '#9AA0AA';

  /**
   * 镜头对照：把几个画面并排画在一张画布上，每个画面左上角带标题；没有画面的位置画提示文字。
   * @param {CanvasRenderingContext2D} ctx 画布上下文。
   * @param {Array<{ label: string, frame: object|null }>} panels 各画面的标题与采样帧（null 表示没有）。
   * @param {{ width: number, height: number, display?: object, images?: Map<number, object> }} options 画布总尺寸与显示选项。
   */
  function drawCompare(ctx, panels, options) {
    const { width, height } = options;
    const gap = width * COMPARE_GAP;
    const panelWidth = (width - gap * (panels.length - 1)) / panels.length;
    ctx.save();
    ctx.fillStyle = COLOR_BACKGROUND;
    ctx.fillRect(0, 0, width, height);
    panels.forEach((panel, index) => {
      ctx.save();
      ctx.translate(index * (panelWidth + gap), 0);
      ctx.beginPath();
      ctx.rect(0, 0, panelWidth, height);
      ctx.clip();
      if (panel.frame) {
        renderer.draw(ctx, { ...panel.frame, overlay: NO_OVERLAY }, { width: panelWidth, height, display: options.display, images: options.images, time: 0, reducedMotion: true, hud: false });
      } else {
        renderer.drawEmpty(ctx, panelWidth, height, COMPARE_EMPTY_TEXT);
      }
      const margin = height * 0.02;
      renderer.drawPill(ctx, panel.label, margin, margin, Math.max(renderer.MIN_NAME_FONT, height * COMPARE_LABEL_FONT), COLOR_TEXT, 1);
      ctx.restore();
    });
    ctx.restore();
  }

  /** 实体在俯视图上的标记：角色画圆，道具画方块，特效画菱形；hollow 为 true 时只画轮廓。 */
  function drawMarker(ctx, kind, x, y, radius, color, hollow) {
    ctx.beginPath();
    if (kind === 'prop') {
      ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
    } else if (kind === 'effect') {
      ctx.moveTo(x, y - radius * 1.2);
      ctx.lineTo(x + radius * 1.2, y);
      ctx.lineTo(x, y + radius * 1.2);
      ctx.lineTo(x - radius * 1.2, y);
      ctx.closePath();
    } else {
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
    if (hollow) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = COLOR_TEXT;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  /** 从 (fromX, fromY) 到 (toX, toY) 的虚线，可选在终点画箭头。 */
  function drawLink(ctx, fromX, fromY, toX, toY, color, arrow, size) {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const tipX = arrow ? toX - Math.cos(angle) * size * 0.3 : toX;
    const tipY = arrow ? toY - Math.sin(angle) * size * 0.3 : toY;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.setLineDash([]);
    if (arrow) {
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - Math.cos(angle - 0.45) * size, toY - Math.sin(angle - 0.45) * size);
      ctx.lineTo(toX - Math.cos(angle + 0.45) * size, toY - Math.sin(angle + 0.45) * size);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 调度俯视图：从上往下看舞台，画出站位网格、画面范围与摄影机，以及本镜头每个实体的起点、终点、轨迹、此刻位置、朝向和上一镜终点。
   * @param {CanvasRenderingContext2D} ctx 画布上下文。
   * @param {object|null} view aiStoryboardTimeline.buildTopView 的结果；null 时画空状态。
   * @param {{ width: number, height: number, emptyText?: string }} options 画布尺寸。
   */
  function drawTopView(ctx, view, options) {
    const { width, height } = options;
    if (view === null) {
      renderer.drawEmpty(ctx, width, height, options.emptyText || '');
      return;
    }
    const padX = width * PAD_X;
    const top = height * TOP;
    const bottom = height * BOTTOM;
    const mapX = (x) => padX + ((x - X_MIN) / (X_MAX - X_MIN)) * (width - padX * 2);
    const mapY = (row) => top + (bottom - top) * (ROW_INSET + (1 - ROW_INSET * 2) * row);
    const radius = height * MARKER_RADIUS;
    const labelFont = Math.max(renderer.MIN_ACTION_FONT, height * 0.03);

    ctx.save();
    ctx.fillStyle = COLOR_BACKGROUND;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = COLOR_VISIBLE;
    ctx.fillRect(mapX(0), top, mapX(1) - mapX(0), bottom - top);
    ctx.strokeStyle = COLOR_LINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(mapX(X_MIN), top, mapX(X_MAX) - mapX(X_MIN), bottom - top);

    // 站位网格与标注。
    renderer.setFont(ctx, labelFont, false);
    ctx.fillStyle = COLOR_MUTED;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'center';
    ctx.setLineDash([5, 6]);
    for (const name of timelineApi.X_ORDER) {
      const x = mapX(timelineApi.X_FRACTION[name]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.fillText(COLUMN_LABELS[name], x, top - height * 0.01);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const [row, label] of ROW_LABELS) {
      const y = mapY(row);
      ctx.beginPath();
      ctx.moveTo(mapX(X_MIN), y);
      ctx.lineTo(mapX(X_MAX), y);
      ctx.stroke();
      ctx.fillText(label, mapX(X_MIN) + 4, y - labelFont * 0.8);
    }
    ctx.setLineDash([]);

    // 摄影机与取景范围。
    const cameraX = mapX(0.5);
    const cameraY = bottom + height * 0.06;
    ctx.strokeStyle = COLOR_LINE;
    ctx.beginPath();
    ctx.moveTo(cameraX, cameraY);
    ctx.lineTo(mapX(0), top);
    ctx.moveTo(cameraX, cameraY);
    ctx.lineTo(mapX(1), top);
    ctx.stroke();
    ctx.fillStyle = COLOR_MUTED;
    ctx.beginPath();
    ctx.moveTo(cameraX, cameraY - radius * 0.7);
    ctx.lineTo(cameraX - radius * 0.8, cameraY + radius * 0.5);
    ctx.lineTo(cameraX + radius * 0.8, cameraY + radius * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('摄影机', cameraX + radius, cameraY);

    // 实体：先画上一镜终点与轨迹，再画此刻位置。
    const arrowSize = height * 0.02;
    for (const actor of view.actors) {
      const from = { x: mapX(actor.from.x), y: mapY(actor.from.row) };
      const to = { x: mapX(actor.to.x), y: mapY(actor.to.row) };
      if (actor.ghost) {
        const ghost = { x: mapX(actor.ghost.x), y: mapY(actor.ghost.row) };
        drawLink(ctx, ghost.x, ghost.y, from.x, from.y, COLOR_MUTED, true, arrowSize);
        ctx.save();
        ctx.setLineDash([3, 3]);
        drawMarker(ctx, actor.kind, ghost.x, ghost.y, radius * 0.85, COLOR_MUTED, true);
        ctx.restore();
        renderer.setFont(ctx, labelFont * 0.9, false);
        ctx.fillStyle = COLOR_MUTED;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('上一镜终点', ghost.x, ghost.y + radius);
      }
      if (actor.isMoving) {
        drawLink(ctx, from.x, from.y, to.x, to.y, actor.color, true, arrowSize);
        drawMarker(ctx, actor.kind, from.x, from.y, radius * 0.7, actor.color, true);
      }
    }
    for (const actor of view.actors) {
      const x = mapX(actor.current.x);
      const y = mapY(actor.current.row);
      drawMarker(ctx, actor.kind, x, y, radius, actor.color, false);
      const vector = actor.kind === 'character' ? FACING_VECTORS[actor.facing] : undefined;
      if (vector) {
        ctx.fillStyle = COLOR_TEXT;
        ctx.beginPath();
        ctx.moveTo(x + vector[0] * radius * 1.7, y + vector[1] * radius * 1.7);
        ctx.lineTo(x + vector[0] * radius * 1.1 - vector[1] * radius * 0.45, y + vector[1] * radius * 1.1 + vector[0] * radius * 0.45);
        ctx.lineTo(x + vector[0] * radius * 1.1 + vector[1] * radius * 0.45, y + vector[1] * radius * 1.1 - vector[0] * radius * 0.45);
        ctx.closePath();
        ctx.fill();
      }
      renderer.setFont(ctx, labelFont, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      renderer.outlineText(ctx, `${renderer.truncate(actor.name, 8)}${actor.isPlaced || actor.kind !== 'character' ? '' : '（未设站位）'}`, x, y + radius * 1.3, COLOR_TEXT);
    }

    // 标题；图例由页面上方的说明文字给出。
    renderer.setFont(ctx, Math.max(renderer.MIN_NAME_FONT, height * 0.04), true);
    ctx.fillStyle = COLOR_TEXT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`第 ${view.seq} 镜 · 调度俯视图 · ${view.sceneName}`, padX, height * 0.025);
    ctx.restore();
  }

  window.aiStoryboardModes = { COMPARE_GAP, drawCompare, drawTopView };
})();
