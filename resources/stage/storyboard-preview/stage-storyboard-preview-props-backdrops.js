// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-props-backdrops.js
// 说明：分镜动画的室内场景背景扩展：厨房、卫生间、卧室、医院、教室、商店。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：依赖 stage-storyboard-preview-draw.js 与 stage-storyboard-preview-art.js，通过 art.registerBackdrops 登记（场景类型与归类关键词见 stage-storyboard-preview-rules.js 的 SCENE_SETTING_RULES）；颜色固定，不随主题变化。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const { TAU, circle, roundedRect, WOOD, METAL, DARK_METAL, drawRoom } = window.aiStoryboardDraw;
  const { drawWindow, registerBackdrops } = window.aiStoryboardArt;
  /** 室内背景墙面顶部与踢脚线相对墙色的明暗系数。 */
  const ROOM_WALL_TOP = 0.88;
  const ROOM_BASEBOARD = 0.72;


  /** 墙上的瓷砖格线。 */
  function tiles(ctx, width, horizon, color, size) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -width; x <= width * 2; x += size) {
      ctx.moveTo(x, -horizon);
      ctx.lineTo(x, horizon);
    }
    for (let y = 0; y <= horizon; y += size) {
      ctx.moveTo(-width, y);
      ctx.lineTo(width * 2, y);
    }
    ctx.stroke();
  }

  function fillRect(ctx, x, y, w, h, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }

  const BACKDROPS = {
    kitchen(ctx, scene, width, height) {
      const horizon = drawRoom(ctx, width, height, 'rgb(239, 231, 214)', 'rgb(185, 161, 132)', ROOM_WALL_TOP, ROOM_BASEBOARD);
      tiles(ctx, width, horizon, 'rgba(120, 100, 70, 0.18)', height * 0.07);
      for (const [left, span] of [[0.04, 0.2], [0.26, 0.2]]) {
        fillRect(ctx, width * left, height * 0.05, width * span, height * 0.17, 'rgb(199, 154, 99)');
        fillRect(ctx, width * (left + span / 2) - 1, height * 0.05, 2, height * 0.17, 'rgb(142, 106, 62)');
        fillRect(ctx, width * (left + span / 2) - width * 0.012, height * 0.16, width * 0.006, height * 0.03, 'rgb(232, 210, 138)');
      }
      const counterTop = horizon - height * 0.17;
      fillRect(ctx, width * 0.04, counterTop, width * 0.46, height * 0.17, 'rgb(199, 154, 99)');
      fillRect(ctx, width * 0.04, counterTop - height * 0.018, width * 0.46, height * 0.018, 'rgb(231, 226, 216)');
      fillRect(ctx, width * 0.1, counterTop - height * 0.012, width * 0.1, height * 0.012, 'rgb(159, 178, 196)');
      fillRect(ctx, width * 0.15 - 1, counterTop - height * 0.06, 2, height * 0.05, 'rgb(184, 190, 198)');
      for (const left of [0.22, 0.34]) fillRect(ctx, width * left, counterTop, 1, height * 0.17, 'rgb(142, 106, 62)');
      const stoveX = width * 0.6;
      fillRect(ctx, stoveX, counterTop, width * 0.2, height * 0.17, 'rgb(207, 212, 218)');
      fillRect(ctx, stoveX, counterTop - height * 0.012, width * 0.2, height * 0.012, 'rgb(138, 146, 155)');
      fillRect(ctx, stoveX + width * 0.03, counterTop + height * 0.05, width * 0.14, height * 0.1, DARK_METAL);
      for (const dx of [0.05, 0.15]) circle(ctx, stoveX + width * dx, counterTop - height * 0.018, height * 0.012, 'rgb(247, 107, 21)');
      ctx.fillStyle = 'rgb(201, 206, 212)';
      ctx.beginPath();
      ctx.moveTo(stoveX - width * 0.01, height * 0.2);
      ctx.lineTo(stoveX + width * 0.21, height * 0.2);
      ctx.lineTo(stoveX + width * 0.15, height * 0.1);
      ctx.lineTo(stoveX + width * 0.05, height * 0.1);
      ctx.closePath();
      ctx.fill();
      fillRect(ctx, stoveX + width * 0.09, 0, width * 0.02, height * 0.1, 'rgb(184, 190, 198)');
    },
    bathroom(ctx, scene, width, height) {
      const horizon = drawRoom(ctx, width, height, 'rgb(220, 234, 240)', 'rgb(199, 211, 217)', ROOM_WALL_TOP, ROOM_BASEBOARD);
      tiles(ctx, width, horizon, 'rgba(90, 120, 140, 0.2)', height * 0.07);
      ctx.fillStyle = 'rgb(184, 212, 228)';
      ctx.beginPath();
      ctx.ellipse(width * 0.22, height * 0.2, width * 0.06, height * 0.14, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgb(136, 149, 160)';
      ctx.lineWidth = Math.max(2, height * 0.008);
      ctx.stroke();
      fillRect(ctx, width * 0.14, horizon - height * 0.2, width * 0.16, height * 0.015, 'rgb(244, 246, 248)');
      fillRect(ctx, width * 0.16, horizon - height * 0.185, width * 0.12, height * 0.185, 'rgb(227, 232, 236)');
      fillRect(ctx, width * 0.22 - 1, horizon - height * 0.27, 2, height * 0.07, METAL);
      const tubX = width * 0.56;
      ctx.fillStyle = 'rgb(244, 246, 248)';
      roundedRect(ctx, tubX, horizon - height * 0.1, width * 0.34, height * 0.16, height * 0.04);
      ctx.fill();
      fillRect(ctx, tubX + width * 0.02, horizon - height * 0.06, width * 0.3, height * 0.05, 'rgb(191, 221, 240)');
      fillRect(ctx, tubX + width * 0.31, height * 0.06, width * 0.006, horizon - height * 0.16, METAL);
      fillRect(ctx, tubX + width * 0.26, height * 0.06, width * 0.05, height * 0.012, METAL);
    },
    bedroom(ctx, scene, width, height) {
      const horizon = drawRoom(ctx, width, height, 'rgb(220, 203, 184)', 'rgb(156, 123, 91)', ROOM_WALL_TOP, ROOM_BASEBOARD);
      drawWindow(ctx, scene, width * 0.1, height * 0.1, width * 0.18, height * 0.26);
      fillRect(ctx, width * 0.07, height * 0.08, width * 0.05, height * 0.3, 'rgb(185, 106, 106)');
      fillRect(ctx, width * 0.26, height * 0.08, width * 0.05, height * 0.3, 'rgb(185, 106, 106)');
      fillRect(ctx, width * 0.5, horizon - height * 0.24, width * 0.4, height * 0.24, 'rgb(122, 90, 60)');
      fillRect(ctx, width * 0.52, horizon - height * 0.1, width * 0.36, height * 0.1, 'rgb(231, 226, 216)');
      fillRect(ctx, width * 0.52, horizon - height * 0.06, width * 0.36, height * 0.06, 'rgb(127, 164, 207)');
      ctx.fillStyle = 'rgb(255, 255, 255)';
      roundedRect(ctx, width * 0.53, horizon - height * 0.13, width * 0.1, height * 0.04, height * 0.02);
      ctx.fill();
      fillRect(ctx, width * 0.4 - 1, horizon - height * 0.13, 2, height * 0.13, 'rgb(107, 74, 58)');
      ctx.save();
      ctx.globalAlpha *= 0.28;
      circle(ctx, width * 0.4, horizon - height * 0.15, height * 0.07, 'rgb(255, 233, 168)');
      ctx.restore();
      circle(ctx, width * 0.4, horizon - height * 0.15, height * 0.02, 'rgb(255, 243, 176)');
    },
    hospital(ctx, scene, width, height) {
      const horizon = drawRoom(ctx, width, height, 'rgb(232, 240, 238)', 'rgb(201, 217, 210)', ROOM_WALL_TOP, ROOM_BASEBOARD);
      fillRect(ctx, -width, horizon - height * 0.22, width * 3, height * 0.03, 'rgb(143, 196, 176)');
      fillRect(ctx, width * 0.1, height * 0.1, width * 0.08, height * 0.14, 'rgb(255, 255, 255)');
      fillRect(ctx, width * 0.13, height * 0.11, width * 0.02, height * 0.12, 'rgb(214, 64, 58)');
      fillRect(ctx, width * 0.11, height * 0.15, width * 0.06, height * 0.04, 'rgb(214, 64, 58)');
      fillRect(ctx, width * 0.55, horizon - height * 0.26, width * 0.3, height * 0.12, 'rgb(143, 196, 176)');
      fillRect(ctx, width * 0.55, horizon - height * 0.14, width * 0.3, height * 0.14, 'rgb(244, 246, 248)');
      fillRect(ctx, width * 0.55, horizon - height * 0.08, width * 0.3, height * 0.02, 'rgb(191, 221, 240)');
      fillRect(ctx, width * 0.4, horizon - height * 0.3, 2, height * 0.3, METAL);
      circle(ctx, width * 0.4, horizon - height * 0.3, height * 0.02, 'rgb(191, 221, 240)');
      drawWindow(ctx, scene, width * 0.3, height * 0.1, width * 0.14, height * 0.2);
    },
    classroom(ctx, scene, width, height) {
      const horizon = drawRoom(ctx, width, height, 'rgb(228, 220, 192)', 'rgb(184, 148, 107)', ROOM_WALL_TOP, ROOM_BASEBOARD);
      fillRect(ctx, width * 0.2, height * 0.08, width * 0.46, height * 0.22, WOOD);
      fillRect(ctx, width * 0.21, height * 0.09, width * 0.44, height * 0.2, 'rgb(47, 74, 58)');
      ctx.strokeStyle = 'rgb(244, 241, 232)';
      ctx.lineWidth = Math.max(1, height * 0.004);
      ctx.beginPath();
      for (const [dx, dy, length] of [[0.24, 0.14, 0.2], [0.24, 0.19, 0.28], [0.24, 0.24, 0.14]]) {
        ctx.moveTo(width * dx, height * dy);
        ctx.lineTo(width * (dx + length), height * dy);
      }
      ctx.stroke();
      drawWindow(ctx, scene, width * 0.74, height * 0.1, width * 0.16, height * 0.22);
      for (const [dx, dy] of [[0.1, 0.1], [0.4, 0.1], [0.7, 0.1], [0.2, 0.2], [0.55, 0.2]]) {
        fillRect(ctx, width * dx, horizon + height * dy, width * 0.14, height * 0.02, 'rgb(201, 160, 107)');
        fillRect(ctx, width * dx + width * 0.01, horizon + height * dy + height * 0.02, width * 0.006, height * 0.07, 'rgb(139, 107, 74)');
        fillRect(ctx, width * (dx + 0.12), horizon + height * dy + height * 0.02, width * 0.006, height * 0.07, 'rgb(139, 107, 74)');
      }
    },
    shop(ctx, scene, width, height) {
      const horizon = drawRoom(ctx, width, height, 'rgb(216, 181, 138)', 'rgb(122, 90, 60)', ROOM_WALL_TOP, ROOM_BASEBOARD);
      const goods = ['rgb(192, 80, 77)', 'rgb(79, 129, 189)', 'rgb(232, 184, 74)', 'rgb(106, 168, 79)', 'rgb(192, 132, 252)'];
      for (const row of [0.08, 0.2]) {
        fillRect(ctx, width * 0.04, height * (row + 0.1), width * 0.56, height * 0.012, WOOD);
        for (let index = 0; index < 12; index += 1) fillRect(ctx, width * (0.05 + index * 0.045), height * (row + 0.04), width * 0.03, height * 0.06, goods[(index + Math.round(row * 10)) % goods.length]);
      }
      fillRect(ctx, width * 0.62, horizon - height * 0.16, width * 0.32, height * 0.16, 'rgb(107, 74, 58)');
      fillRect(ctx, width * 0.62, horizon - height * 0.18, width * 0.32, height * 0.02, 'rgb(201, 160, 107)');
      for (const dx of [0.2, 0.5, 0.78]) {
        fillRect(ctx, width * dx, 0, 1, height * 0.04, 'rgb(85, 85, 85)');
        ctx.save();
        ctx.globalAlpha *= 0.25;
        circle(ctx, width * dx, height * 0.06, height * 0.05, 'rgb(255, 233, 168)');
        ctx.restore();
        circle(ctx, width * dx, height * 0.05, height * 0.015, 'rgb(255, 243, 176)');
      }
    }
  };
  registerBackdrops(BACKDROPS);
})();
