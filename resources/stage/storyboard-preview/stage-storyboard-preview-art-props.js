// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-art-props.js
// 说明：分镜动画的道具图形表：每种图形登记绘制函数、高度和“会说话时脸的位置”，并提供画道具（带影子）与画资产缩略图方块的函数。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：依赖 stage-storyboard-preview-draw.js，通过 window.aiStoryboardArtProps 暴露，由 stage-storyboard-preview-art.js 汇总；扩展的图形由 stage-storyboard-preview-props-*.js 经 registerProps 登记；图形名称与归类关键词见 stage-storyboard-preview-rules.js 的 OBJECT_RULES；道具以脚下中点为锚点，单位 u 为“画面高度的 1% × 纵深缩放”，每种图形约 12u 宽。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const { TAU, SHADOW, shade, circle, ellipse, roundedRect, polygon, drawCover } = window.aiStoryboardDraw;

  /** 道具图形注册表：glyph → { paint(ctx, x, y, u, color) 以脚下中点 (x, y) 为锚点作图, height 图形高度（单位 u）, face 会说话时脸的圆心离地高度 cy 与半径 r }。 */
  const PROPS = {
    table: {
      height: 7,
      face: { cy: 3, r: 2.2 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = shade(color, 0.7);
        ctx.fillRect(x - 7 * u, y - 5.2 * u, 1.6 * u, 5.2 * u);
        ctx.fillRect(x + 5.4 * u, y - 5.2 * u, 1.6 * u, 5.2 * u);
        ctx.fillStyle = color;
        roundedRect(ctx, x - 8.5 * u, y - 7 * u, 17 * u, 2 * u, 0.6 * u);
        ctx.fill();
      }
    },
    chair: {
      height: 12,
      face: { cy: 8.6, r: 2.2 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = shade(color, 0.7);
        ctx.fillRect(x - 3.8 * u, y - 4.2 * u, 1.2 * u, 4.2 * u);
        ctx.fillRect(x + 2.6 * u, y - 4.2 * u, 1.2 * u, 4.2 * u);
        ctx.fillRect(x - 4 * u, y - 12 * u, 1.4 * u, 8 * u);
        ctx.fillStyle = color;
        ctx.fillRect(x - 4.4 * u, y - 5.6 * u, 8.8 * u, 1.6 * u);
      }
    },
    door: {
      height: 19,
      face: { cy: 11, r: 3.4 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x - 5 * u, y - 19 * u, 10 * u, 19 * u);
        ctx.strokeStyle = shade(color, 0.7);
        ctx.lineWidth = 0.6 * u;
        ctx.strokeRect(x - 3.6 * u, y - 17.4 * u, 7.2 * u, 7 * u);
        ctx.strokeRect(x - 3.6 * u, y - 8.8 * u, 7.2 * u, 7 * u);
        circle(ctx, x + 3 * u, y - 9.5 * u, 0.7 * u, 'rgb(232, 210, 138)');
      }
    },
    window: {
      height: 14.6,
      face: { cy: 8, r: 3.4 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x - 6.6 * u, y - 14.6 * u, 13.2 * u, 13.2 * u);
        ctx.fillStyle = 'rgb(156, 200, 234)';
        ctx.fillRect(x - 5.6 * u, y - 13.6 * u, 11.2 * u, 11.2 * u);
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.8 * u;
        ctx.beginPath();
        ctx.moveTo(x, y - 13.6 * u);
        ctx.lineTo(x, y - 2.4 * u);
        ctx.moveTo(x - 5.6 * u, y - 8 * u);
        ctx.lineTo(x + 5.6 * u, y - 8 * u);
        ctx.stroke();
      }
    },
    light: {
      height: 15.4,
      face: { cy: 13.8, r: 1.7 },
      paint(ctx, x, y, u, color) {
        const base = ctx.globalAlpha;
        ctx.globalAlpha = base * 0.25;
        circle(ctx, x, y - 13 * u, 7 * u, 'rgb(255, 233, 168)');
        ctx.globalAlpha = base;
        ctx.fillStyle = shade(color, 0.6);
        ctx.fillRect(x - 0.5 * u, y - 12 * u, 1 * u, 12 * u);
        ctx.fillRect(x - 2.4 * u, y - 0.8 * u, 4.8 * u, 0.8 * u);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x - 2.4 * u, y - 12 * u);
        ctx.lineTo(x + 2.4 * u, y - 12 * u);
        ctx.lineTo(x + 1.4 * u, y - 15.4 * u);
        ctx.lineTo(x - 1.4 * u, y - 15.4 * u);
        ctx.closePath();
        ctx.fill();
        circle(ctx, x, y - 12.4 * u, 1 * u, 'rgb(255, 243, 176)');
      }
    },
    weapon: {
      height: 17,
      face: { cy: 11, r: 1.5 },
      paint(ctx, x, y, u, color) {
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgb(201, 209, 219)';
        ctx.lineWidth = 1.4 * u;
        ctx.beginPath();
        ctx.moveTo(x - 2.4 * u, y - 5 * u);
        ctx.lineTo(x + 3.4 * u, y - 17 * u);
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2 * u;
        ctx.beginPath();
        ctx.moveTo(x - 4.4 * u, y - 5.6 * u);
        ctx.lineTo(x - 0.6 * u, y - 3.6 * u);
        ctx.moveTo(x - 2.4 * u, y - 5 * u);
        ctx.lineTo(x - 3.6 * u, y - 1.4 * u);
        ctx.stroke();
      }
    },
    book: {
      height: 3.4,
      face: { cy: 1.7, r: 1.5 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x - 5 * u, y - 3.4 * u, 10 * u, 3.4 * u);
        ctx.fillStyle = 'rgb(244, 239, 224)';
        ctx.fillRect(x - 4.6 * u, y - 2.6 * u, 9.2 * u, 1.6 * u);
      }
    },
    box: {
      height: 8,
      face: { cy: 4.2, r: 3.1 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x - 5.4 * u, y - 8 * u, 10.8 * u, 8 * u);
        ctx.fillStyle = shade(color, 0.75);
        ctx.fillRect(x - 5.4 * u, y - 8 * u, 10.8 * u, 2.4 * u);
        ctx.fillStyle = 'rgb(232, 210, 138)';
        ctx.fillRect(x - 0.8 * u, y - 6 * u, 1.6 * u, 2 * u);
      }
    },
    bed: {
      height: 10,
      face: { cy: 3.6, r: 2.3 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = shade(color, 0.7);
        ctx.fillRect(x - 9 * u, y - 10 * u, 1.4 * u, 10 * u);
        ctx.fillRect(x - 9 * u, y - 4 * u, 18 * u, 4 * u);
        ctx.fillStyle = 'rgb(231, 226, 216)';
        ctx.fillRect(x - 7.6 * u, y - 7 * u, 16.6 * u, 3 * u);
        ctx.fillStyle = 'rgb(255, 255, 255)';
        roundedRect(ctx, x - 7.4 * u, y - 9 * u, 5 * u, 2.2 * u, 1 * u);
        ctx.fill();
      }
    },
    vehicle: {
      height: 11,
      face: { cy: 5.2, r: 3.4 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = color;
        roundedRect(ctx, x - 9 * u, y - 7 * u, 18 * u, 4.6 * u, 1.2 * u);
        ctx.fill();
        ctx.fillStyle = shade(color, 1.3);
        roundedRect(ctx, x - 5 * u, y - 11 * u, 10 * u, 4.4 * u, 1.4 * u);
        ctx.fill();
        circle(ctx, x - 5.6 * u, y - 2.2 * u, 2.2 * u, 'rgb(31, 34, 41)');
        circle(ctx, x + 5.6 * u, y - 2.2 * u, 2.2 * u, 'rgb(31, 34, 41)');
      }
    },
    plant: {
      height: 12,
      face: { cy: 8, r: 3.2 },
      paint(ctx, x, y, u) {
        for (const [dx, dy, r] of [[0, 9, 3.2], [-3, 7, 2.4], [3, 7, 2.4]]) circle(ctx, x + dx * u, y - dy * u, r * u, 'rgb(63, 155, 90)');
        ctx.fillStyle = 'rgb(160, 98, 62)';
        ctx.fillRect(x - 2.6 * u, y - 4.2 * u, 5.2 * u, 4.2 * u);
      }
    },
    flower: {
      height: 15,
      face: { cy: 11.8, r: 2.8 },
      paint(ctx, x, y, u, color) {
        ctx.strokeStyle = 'rgb(63, 155, 90)';
        ctx.lineWidth = 1 * u;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - 9 * u);
        ctx.stroke();
        ctx.fillStyle = 'rgb(63, 155, 90)';
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(x + side * 2.2 * u, y - 3.6 * u, 2.2 * u, 1 * u, side * -0.5, 0, TAU);
          ctx.fill();
        }
        for (let index = 0; index < 6; index += 1) circle(ctx, x + Math.cos((index * TAU) / 6) * 3.8 * u, y - 11.8 * u + Math.sin((index * TAU) / 6) * 3.8 * u, 2.1 * u, color);
        circle(ctx, x, y - 11.8 * u, 3 * u, 'rgb(245, 217, 10)');
      }
    },
    grass: {
      height: 10.5,
      face: { cy: 4.4, r: 2.2 },
      paint(ctx, x, y, u) {
        for (const [dx, height, half, tip] of [[-3.2, 8, 1.8, -1.4], [0, 10.5, 2.4, 0.6], [3.2, 7.5, 1.8, 1.4]]) {
          ctx.fillStyle = height > 10 ? 'rgb(88, 174, 69)' : 'rgb(76, 154, 62)';
          ctx.beginPath();
          ctx.moveTo(x + (dx - half) * u, y);
          ctx.quadraticCurveTo(x + (dx - half * 0.2) * u, y - height * 0.6 * u, x + (dx + tip) * u, y - height * u);
          ctx.quadraticCurveTo(x + (dx + half * 0.6) * u, y - height * 0.5 * u, x + (dx + half) * u, y);
          ctx.closePath();
          ctx.fill();
        }
      }
    },
    tree: {
      height: 20,
      face: { cy: 12.6, r: 4.4 },
      paint(ctx, x, y, u) {
        ctx.fillStyle = 'rgb(122, 90, 60)';
        ctx.fillRect(x - 1.6 * u, y - 9 * u, 3.2 * u, 9 * u);
        for (const [dx, dy, r] of [[-4, 11, 4.4], [4, 11, 4.4], [0, 14.2, 5.8]]) circle(ctx, x + dx * u, y - dy * u, r * u, 'rgb(60, 138, 88)');
        circle(ctx, x - 1.6 * u, y - 15.4 * u, 2 * u, 'rgb(88, 174, 117)');
      }
    },
    stone: {
      height: 8.6,
      face: { cy: 4.2, r: 3.4 },
      paint(ctx, x, y, u) {
        ctx.fillStyle = 'rgb(140, 144, 151)';
        ctx.beginPath();
        ctx.ellipse(x, y - 4 * u, 7 * u, 4.6 * u, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.beginPath();
        ctx.ellipse(x - 2.2 * u, y - 6 * u, 3 * u, 1.6 * u, -0.4, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 0.5 * u;
        ctx.beginPath();
        ctx.moveTo(x + 3.4 * u, y - 7.6 * u);
        ctx.lineTo(x + 2.4 * u, y - 5.4 * u);
        ctx.lineTo(x + 3.2 * u, y - 4 * u);
        ctx.stroke();
      }
    },
    mushroom: {
      height: 10,
      face: { cy: 4.6, r: 2.4 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = 'rgb(242, 232, 213)';
        roundedRect(ctx, x - 2.2 * u, y - 5.6 * u, 4.4 * u, 5.6 * u, 1.4 * u);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(x, y - 5.4 * u, 6 * u, 4.6 * u, 0, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        for (const [dx, dy] of [[-2.6, 7.6], [1.2, 8.8], [3.2, 6.6]]) circle(ctx, x + dx * u, y - dy * u, 0.9 * u, 'rgba(255, 255, 255, 0.85)');
      }
    },
    cactus: {
      height: 12.4,
      face: { cy: 6.8, r: 2 },
      paint(ctx, x, y, u) {
        ctx.fillStyle = 'rgb(76, 154, 94)';
        roundedRect(ctx, x - 2.4 * u, y - 12.4 * u, 4.8 * u, 12.4 * u, 2.4 * u);
        ctx.fill();
        for (const side of [-1, 1]) {
          roundedRect(ctx, x + side * 3.6 * u - 1.1 * u, y - 9.6 * u, 2.2 * u, 4.6 * u, 1.1 * u);
          ctx.fill();
          ctx.fillRect(x + side * 2.2 * u - 1.2 * u, y - 5.8 * u, 2.4 * u, 1.6 * u);
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 0.3 * u;
        for (const dy of [3, 6, 9]) {
          ctx.beginPath();
          ctx.moveTo(x - 0.8 * u, y - dy * u);
          ctx.lineTo(x - 1.6 * u, y - (dy + 0.6) * u);
          ctx.moveTo(x + 0.8 * u, y - dy * u);
          ctx.lineTo(x + 1.6 * u, y - (dy + 0.6) * u);
          ctx.stroke();
        }
      }
    },
    screen: {
      height: 9,
      face: { cy: 5.6, r: 2.8 },
      paint(ctx, x, y, u) {
        ctx.fillStyle = 'rgb(42, 46, 54)';
        roundedRect(ctx, x - 6 * u, y - 9 * u, 12 * u, 7.6 * u, 0.8 * u);
        ctx.fill();
        ctx.fillStyle = 'rgb(123, 196, 245)';
        ctx.fillRect(x - 5.2 * u, y - 8.2 * u, 10.4 * u, 6 * u);
        ctx.fillStyle = 'rgb(42, 46, 54)';
        ctx.fillRect(x - 0.8 * u, y - 1.6 * u, 1.6 * u, 1.2 * u);
        ctx.fillRect(x - 3 * u, y - 0.8 * u, 6 * u, 0.8 * u);
      }
    },
    clock: {
      height: 11.6,
      face: { cy: 6.2, r: 3.2 },
      paint(ctx, x, y, u, color) {
        circle(ctx, x, y - 6.2 * u, 5.4 * u, color);
        circle(ctx, x, y - 6.2 * u, 4.4 * u, 'rgb(244, 239, 224)');
        ctx.strokeStyle = 'rgb(42, 46, 54)';
        ctx.lineWidth = 0.6 * u;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y - 6.2 * u);
        ctx.lineTo(x, y - 9.4 * u);
        ctx.moveTo(x, y - 6.2 * u);
        ctx.lineTo(x + 2.2 * u, y - 5.2 * u);
        ctx.stroke();
        ctx.fillStyle = shade(color, 0.6);
        ctx.fillRect(x - 3.4 * u, y - 0.8 * u, 1.2 * u, 0.8 * u);
        ctx.fillRect(x + 2.2 * u, y - 0.8 * u, 1.2 * u, 0.8 * u);
      }
    },
    mirror: {
      height: 16.4,
      face: { cy: 9.2, r: 3 },
      paint(ctx, x, y, u, color) {
        ctx.strokeStyle = shade(color, 0.7);
        ctx.lineWidth = 0.9 * u;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - 2.4 * u, y - 2.4 * u);
        ctx.lineTo(x - 3.4 * u, y);
        ctx.moveTo(x + 2.4 * u, y - 2.4 * u);
        ctx.lineTo(x + 3.4 * u, y);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(x, y - 9.2 * u, 4.8 * u, 7.2 * u, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgb(191, 227, 242)';
        ctx.beginPath();
        ctx.ellipse(x, y - 9.2 * u, 3.8 * u, 6.2 * u, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.ellipse(x - 1.4 * u, y - 11.4 * u, 0.9 * u, 2.4 * u, 0.4, 0, TAU);
        ctx.fill();
      }
    },
    key: {
      height: 11.6,
      face: { cy: 9, r: 1.8 },
      paint(ctx, x, y, u, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2 * u;
        ctx.beginPath();
        ctx.arc(x, y - 9 * u, 2.6 * u, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillRect(x - 0.6 * u, y - 6.4 * u, 1.2 * u, 6.2 * u);
        ctx.fillRect(x, y - 2.4 * u, 2.4 * u, 1 * u);
        ctx.fillRect(x, y - 4.2 * u, 1.8 * u, 1 * u);
      }
    },
    umbrella: {
      height: 14.2,
      face: { cy: 9.6, r: 3 },
      paint(ctx, x, y, u, color) {
        ctx.strokeStyle = 'rgb(74, 79, 89)';
        ctx.lineWidth = 0.8 * u;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y - 9 * u);
        ctx.lineTo(x, y - 1 * u);
        ctx.arc(x - 1.2 * u, y - 1 * u, 1.2 * u, 0, Math.PI);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(x, y - 9 * u, 8 * u, 5.2 * u, 0, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 0.4 * u;
        for (const dx of [-3.4, 0, 3.4]) {
          ctx.beginPath();
          ctx.moveTo(x, y - 14.2 * u);
          ctx.lineTo(x + dx * u, y - 9 * u);
          ctx.stroke();
        }
      }
    },
    ball: {
      height: 10,
      face: { cy: 5, r: 3 },
      paint(ctx, x, y, u, color) {
        circle(ctx, x, y - 5 * u, 5 * u, color);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 0.6 * u;
        ctx.beginPath();
        ctx.arc(x, y - 5 * u, 3.6 * u, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
        circle(ctx, x - 1.8 * u, y - 7 * u, 1.1 * u, 'rgba(255, 255, 255, 0.5)');
      }
    },
    flag: {
      height: 16,
      face: { cy: 13.4, r: 2 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = 'rgb(122, 90, 60)';
        ctx.fillRect(x - 3.4 * u, y - 16 * u, 0.8 * u, 16 * u);
        polygon(ctx, [[x - 2.6 * u, y - 16 * u], [x + 6 * u, y - 14.2 * u], [x - 2.6 * u, y - 10.6 * u]], color);
        circle(ctx, x - 3 * u, y - 16.4 * u, 0.7 * u, 'rgb(240, 200, 74)');
      }
    },
    tent: {
      height: 11,
      face: { cy: 4.4, r: 2.6 },
      paint(ctx, x, y, u, color) {
        polygon(ctx, [[x - 8 * u, y], [x, y - 11 * u], [x + 8 * u, y]], color);
        polygon(ctx, [[x - 2.2 * u, y], [x, y - 5.4 * u], [x + 2.2 * u, y]], shade(color, 0.5));
        ctx.strokeStyle = shade(color, 0.7);
        ctx.lineWidth = 0.5 * u;
        ctx.beginPath();
        ctx.moveTo(x, y - 11 * u);
        ctx.lineTo(x, y - 5.4 * u);
        ctx.stroke();
      }
    },
    barrel: {
      height: 8,
      face: { cy: 4.2, r: 3 },
      paint(ctx, x, y, u) {
        ctx.fillStyle = 'rgb(156, 107, 63)';
        roundedRect(ctx, x - 4.4 * u, y - 8 * u, 8.8 * u, 8 * u, 2 * u);
        ctx.fill();
        ctx.fillStyle = 'rgb(90, 74, 58)';
        ctx.fillRect(x - 4.4 * u, y - 6.4 * u, 8.8 * u, 0.8 * u);
        ctx.fillRect(x - 4.4 * u, y - 2.4 * u, 8.8 * u, 0.8 * u);
      }
    },
    sign: {
      height: 14,
      face: { cy: 11, r: 2.6 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = 'rgb(122, 90, 60)';
        ctx.fillRect(x - 0.7 * u, y - 8.4 * u, 1.4 * u, 8.4 * u);
        ctx.fillStyle = color;
        roundedRect(ctx, x - 5 * u, y - 14 * u, 10 * u, 6.2 * u, 0.8 * u);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 0.5 * u;
        ctx.beginPath();
        ctx.moveTo(x - 3.4 * u, y - 12 * u);
        ctx.lineTo(x + 3.4 * u, y - 12 * u);
        ctx.moveTo(x - 3.4 * u, y - 10 * u);
        ctx.lineTo(x + 1.6 * u, y - 10 * u);
        ctx.stroke();
      }
    },
    gem: {
      height: 9,
      face: { cy: 5.6, r: 2.4 },
      paint(ctx, x, y, u, color) {
        polygon(ctx, [[x, y - 0.6 * u], [x - 4.4 * u, y - 5.6 * u], [x - 2.4 * u, y - 9 * u], [x + 2.4 * u, y - 9 * u], [x + 4.4 * u, y - 5.6 * u]], color);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 0.4 * u;
        ctx.beginPath();
        ctx.moveTo(x - 4.4 * u, y - 5.6 * u);
        ctx.lineTo(x + 4.4 * u, y - 5.6 * u);
        ctx.moveTo(x - 2.4 * u, y - 9 * u);
        ctx.lineTo(x - 1.2 * u, y - 5.6 * u);
        ctx.lineTo(x, y - 0.6 * u);
        ctx.moveTo(x + 2.4 * u, y - 9 * u);
        ctx.lineTo(x + 1.2 * u, y - 5.6 * u);
        ctx.lineTo(x, y - 0.6 * u);
        ctx.stroke();
      }
    },
    instrument: {
      height: 18,
      face: { cy: 4, r: 2.5 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = 'rgb(74, 58, 42)';
        ctx.fillRect(x - 0.7 * u, y - 18 * u, 1.4 * u, 10 * u);
        circle(ctx, x, y - 4 * u, 4 * u, color);
        circle(ctx, x, y - 9 * u, 3 * u, color);
        circle(ctx, x, y - 5 * u, 1.2 * u, 'rgb(42, 46, 54)');
      }
    },
    pot: {
      height: 10,
      face: { cy: 4.4, r: 3 },
      paint(ctx, x, y, u) {
        ctx.fillStyle = 'rgb(74, 79, 89)';
        ctx.beginPath();
        ctx.ellipse(x, y - 5 * u, 6 * u, 5 * u, 0, 0, Math.PI);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x, y - 5 * u, 6.2 * u, 1.4 * u, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgb(124, 130, 141)';
        ctx.beginPath();
        ctx.ellipse(x, y - 5 * u, 5 * u, 0.9 * u, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgb(74, 79, 89)';
        ctx.fillRect(x - 4 * u, y - 0.8 * u, 1.2 * u, 1.2 * u);
        ctx.fillRect(x + 2.8 * u, y - 0.8 * u, 1.2 * u, 1.2 * u);
      }
    },
    crown: {
      height: 8.4,
      face: { cy: 4.6, r: 2.2 },
      paint(ctx, x, y, u) {
        polygon(ctx, [[x - 5 * u, y - 2 * u], [x - 5 * u, y - 7.6 * u], [x - 2.5 * u, y - 4.6 * u], [x, y - 8.4 * u], [x + 2.5 * u, y - 4.6 * u], [x + 5 * u, y - 7.6 * u], [x + 5 * u, y - 2 * u]], 'rgb(240, 200, 74)');
        ctx.fillStyle = 'rgb(199, 154, 30)';
        ctx.fillRect(x - 5 * u, y - 2.8 * u, 10 * u, 0.9 * u);
        for (const [dx, color] of [[-3, 'rgb(229, 72, 77)'], [0, 'rgb(62, 99, 221)'], [3, 'rgb(48, 164, 108)']]) circle(ctx, x + dx * u, y - 4.2 * u, 0.7 * u, color);
      }
    },
    fence: {
      height: 8.8,
      face: { cy: 5, r: 2 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = shade(color, 1.1);
        ctx.fillRect(x - 7 * u, y - 6.4 * u, 14 * u, 1 * u);
        ctx.fillRect(x - 7 * u, y - 3 * u, 14 * u, 1 * u);
        for (let index = 0; index < 4; index += 1) {
          const px = x - 7 * u + index * 4.2 * u;
          polygon(ctx, [[px, y], [px, y - 7.4 * u], [px + 0.9 * u, y - 8.8 * u], [px + 1.8 * u, y - 7.4 * u], [px + 1.8 * u, y]], shade(color, 0.9));
        }
      }
    },
    stairs: {
      height: 9.6,
      face: { cy: 6, r: 2.2 },
      paint(ctx, x, y, u, color) {
        for (let index = 0; index < 4; index += 1) {
          ctx.fillStyle = shade(color, 0.8 + index * 0.1);
          ctx.fillRect(x - 6 * u + index * 3 * u, y - (index + 1) * 2.4 * u, 12 * u - index * 3 * u, (index + 1) * 2.4 * u);
        }
      }
    },
    tower: {
      height: 21,
      face: { cy: 8, r: 2.2 },
      paint(ctx, x, y, u, color) {
        polygon(ctx, [[x - 3.4 * u, y], [x + 3.4 * u, y], [x + 2.4 * u, y - 14 * u], [x - 2.4 * u, y - 14 * u]], 'rgb(244, 239, 224)');
        polygon(ctx, [[x - 2.9 * u, y - 4 * u], [x + 2.9 * u, y - 4 * u], [x + 2.6 * u, y - 7 * u], [x - 2.6 * u, y - 7 * u]], color);
        polygon(ctx, [[x - 2.2 * u, y - 10.4 * u], [x + 2.2 * u, y - 10.4 * u], [x + 2.4 * u, y - 14 * u], [x - 2.4 * u, y - 14 * u]], color);
        ctx.fillStyle = 'rgb(255, 233, 168)';
        ctx.fillRect(x - 2.6 * u, y - 17 * u, 5.2 * u, 3 * u);
        polygon(ctx, [[x - 3.4 * u, y - 17 * u], [x, y - 21 * u], [x + 3.4 * u, y - 17 * u]], shade(color, 0.6));
      }
    },
    house: {
      height: 13.4,
      face: { cy: 3.8, r: 2.6 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x - 6 * u, y - 7 * u, 12 * u, 7 * u);
        polygon(ctx, [[x - 7.4 * u, y - 7 * u], [x, y - 13.4 * u], [x + 7.4 * u, y - 7 * u]], 'rgb(181, 80, 60)');
        ctx.fillStyle = shade(color, 0.5);
        ctx.fillRect(x - 1.2 * u, y - 4.4 * u, 2.4 * u, 4.4 * u);
        ctx.fillStyle = 'rgb(191, 227, 242)';
        ctx.fillRect(x + 2.6 * u, y - 5.4 * u, 2.2 * u, 2.2 * u);
        ctx.fillRect(x - 4.8 * u, y - 5.4 * u, 2.2 * u, 2.2 * u);
      }
    },
    castle: {
      height: 17.6,
      face: { cy: 5, r: 3 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x - 7 * u, y - 9 * u, 14 * u, 9 * u);
        for (const side of [-1, 1]) {
          ctx.fillRect(x + side * 6.4 * u - 2 * u, y - 14 * u, 4 * u, 14 * u);
          polygon(ctx, [[x + side * 6.4 * u - 2.6 * u, y - 14 * u], [x + side * 6.4 * u, y - 17.6 * u], [x + side * 6.4 * u + 2.6 * u, y - 14 * u]], 'rgb(181, 80, 60)');
        }
        ctx.fillStyle = shade(color, 0.5);
        ctx.beginPath();
        ctx.arc(x, y - 3.4 * u, 2 * u, Math.PI, 0);
        ctx.lineTo(x + 2 * u, y);
        ctx.lineTo(x - 2 * u, y);
        ctx.closePath();
        ctx.fill();
        for (const dx of [-3.4, -1, 1.4, 3.8]) ctx.fillRect(x + dx * u - 0.5 * u, y - 10.4 * u, 1 * u, 1.4 * u);
      }
    },
    bag: {
      height: 10,
      face: { cy: 5, r: 3 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = color;
        roundedRect(ctx, x - 4.5 * u, y - 10 * u, 9 * u, 10 * u, 2.6 * u);
        ctx.fill();
        ctx.fillStyle = shade(color, 0.75);
        roundedRect(ctx, x - 3 * u, y - 5.4 * u, 6 * u, 3.6 * u, 0.9 * u);
        ctx.fill();
        ctx.strokeStyle = shade(color, 0.6);
        ctx.lineWidth = 0.8 * u;
        ctx.beginPath();
        ctx.arc(x, y - 10 * u, 2.2 * u, Math.PI, 0);
        ctx.stroke();
      }
    },
    cup: {
      height: 4.4,
      face: { cy: 2.2, r: 1.8 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x - 2.4 * u, y - 4.4 * u, 4.8 * u, 4.4 * u);
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.8 * u;
        ctx.beginPath();
        ctx.arc(x + 2.8 * u, y - 2.4 * u, 1.4 * u, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
      }
    },
    phone: {
      height: 6,
      face: { cy: 3, r: 1.7 },
      paint(ctx, x, y, u) {
        ctx.fillStyle = 'rgb(42, 46, 54)';
        roundedRect(ctx, x - 2.4 * u, y - 6 * u, 4.8 * u, 6 * u, 0.8 * u);
        ctx.fill();
        ctx.fillStyle = 'rgb(123, 196, 245)';
        ctx.fillRect(x - 1.8 * u, y - 5.4 * u, 3.6 * u, 4.2 * u);
      }
    },
    generic: {
      height: 6.5,
      face: { cy: 3.3, r: 2.7 },
      paint(ctx, x, y, u, color) {
        ctx.fillStyle = color;
        roundedRect(ctx, x - 5 * u, y - 6.5 * u, 10 * u, 6.5 * u, 1.2 * u);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 0.4 * u;
        ctx.stroke();
      }
    }
  };

  /** 会说话时脸的默认位置：按图形高度估算，圆心在中部偏上，半径随高度增大但不超过 3.4u。 */
  function defaultFace(height) {
    return { cy: Math.round(height * 0.55 * 10) / 10, r: Math.round(Math.min(3.4, Math.max(1.3, height * 0.24)) * 10) / 10 };
  }

  /**
   * 登记扩展的道具图形（由 stage-storyboard-preview-props-*.js 调用）。
   * @param {Record<string, { paint: Function, height: number, face?: { cy: number, r: number } }>} defs 图形名称 → 绘制函数、高度（单位 u）与脸的位置；缺脸的位置时按高度估算。
   */
  function registerProps(defs) {
    for (const [glyph, def] of Object.entries(defs)) PROPS[glyph] = { ...def, face: def.face || defaultFace(def.height) };
  }

  /** 画一个道具：影子（noShadow 时不画）加对应的图形，认不出的图形名用通用图形。 */
  function drawProp(ctx, glyph, x, y, u, color, noShadow) {
    if (!noShadow) ellipse(ctx, x, y, 7 * u, 1.3 * u, SHADOW);
    (PROPS[glyph] || PROPS.generic).paint(ctx, x, y, u, color);
  }

  /** 道具的资产缩略图：圆角方块里按填满方式画图，加描边。 */
  function drawImageTile(ctx, image, x, y, u) {
    const size = 12 * u;
    ellipse(ctx, x, y, 7 * u, 1.3 * u, SHADOW);
    ctx.save();
    roundedRect(ctx, x - size / 2, y - size, size, size, 1.6 * u);
    ctx.clip();
    drawCover(ctx, image, x - size / 2, y - size, size, size);
    ctx.restore();
    ctx.strokeStyle = 'rgb(255, 255, 255)';
    ctx.lineWidth = 0.6 * u;
    roundedRect(ctx, x - size / 2, y - size, size, size, 1.6 * u);
    ctx.stroke();
  }

  window.aiStoryboardArtProps = { PROPS, registerProps, drawProp, drawImageTile };
})();
