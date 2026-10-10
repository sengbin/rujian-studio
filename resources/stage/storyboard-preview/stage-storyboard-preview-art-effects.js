// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-art-effects.js
// 说明：分镜动画的特效图形表：火焰、烟、雨、雪、光芒、闪电、法阵、爱心、音符、风、泡泡、落叶、黑雾、冲击波与火花，并提供按名称画特效和登记扩展特效的函数。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：依赖 stage-storyboard-preview-draw.js，通过 window.aiStoryboardArtEffects 暴露，由 stage-storyboard-preview-art.js 汇总；扩展特效由 stage-storyboard-preview-props-effects.js 经 registerEffects 登记到同一张表；图形名称与归类关键词见 stage-storyboard-preview-rules.js 的 EFFECT_RULES；颜色基本固定，认不出的名称画成火花（取实体的识别色）。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const { TAU, circle, star } = window.aiStoryboardDraw;
  /** 减少动态效果时特效停在的瞬间（循环时间，秒）。 */
  const STILL_CYCLE = 0.25;
  /** 兜底的特效图形名称。 */
  const FALLBACK_EFFECT = 'spark';

  /** 火焰：外焰与内焰，随时间摇曳。 */
  function drawFlame(ctx, x, y, radius, flicker, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x, y - radius * (1.7 + flicker));
    ctx.quadraticCurveTo(x + radius * 0.95, y - radius * 0.6, x, y);
    ctx.quadraticCurveTo(x - radius * 0.95, y - radius * 0.6, x, y - radius * (1.7 + flicker));
    ctx.fill();
  }

  /**
   * 特效图形注册表：glyph → 绘制函数 (ctx, x, y, r, color, cycle, reducedMotion, { angle })。
   * x、y 为脚下位置，r 为特效半径，cycle 为循环时间（秒），angle 是特效前进方向（弧度，0 朝右）；
   * 函数里 ctx.globalAlpha 只在进入时的透明度基础上叠乘，drawEffect 画完会恢复。
   */
  const EFFECTS = {
    fire(ctx, x, y, r, color, cycle) {
      drawFlame(ctx, x, y, r, 0.08 * Math.sin(cycle * 12), 'rgb(247, 107, 21)');
      drawFlame(ctx, x, y, r * 0.55, 0.1 * Math.sin(cycle * 15 + 1), 'rgb(255, 214, 10)');
    },
    smoke(ctx, x, y, r, color, cycle) {
      for (let index = 0; index < 3; index += 1) {
        const rise = ((cycle * 0.3 + index / 3) % 1) * r * 0.4;
        circle(ctx, x + (index - 1) * r * 0.25, y - r * (0.4 + 0.5 * index) - rise, r * (0.45 + 0.15 * index), 'rgba(200, 205, 212, 0.55)');
      }
    },
    rain(ctx, x, y, r, color, cycle) {
      ctx.strokeStyle = 'rgb(156, 200, 234)';
      ctx.lineWidth = Math.max(1, r * 0.06);
      for (let index = -2; index <= 2; index += 1) {
        const drop = ((cycle * 1.5 + index * 0.37) % 1) * r * 0.5;
        ctx.beginPath();
        ctx.moveTo(x + index * r * 0.5, y - r * 1.8 + drop);
        ctx.lineTo(x + index * r * 0.5 - r * 0.2, y - r * 1.2 + drop);
        ctx.stroke();
      }
    },
    snow(ctx, x, y, r, color, cycle) {
      for (let index = -3; index <= 3; index += 1) {
        const fall = ((cycle * 0.4 + index * 0.21 + 1) % 1) * r * 1.4;
        circle(ctx, x + index * r * 0.3, y - r * 1.8 + fall, Math.max(1.5, r * 0.07), 'rgb(255, 255, 255)');
      }
    },
    light(ctx, x, y, r) {
      const base = ctx.globalAlpha;
      const cy = y - r;
      ctx.globalAlpha = base * 0.3;
      circle(ctx, x, cy, r, 'rgb(255, 243, 176)');
      ctx.globalAlpha = base;
      star(ctx, x, cy, r, r * 0.32, 8, 'rgb(255, 243, 176)');
    },
    lightning(ctx, x, y, r) {
      const base = ctx.globalAlpha;
      ctx.strokeStyle = 'rgb(255, 243, 176)';
      ctx.lineWidth = Math.max(2, r * 0.14);
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.moveTo(x + r * 0.3, y - r * 2.1);
      ctx.lineTo(x - r * 0.25, y - r * 1.2);
      ctx.lineTo(x + r * 0.25, y - r * 1.15);
      ctx.lineTo(x - r * 0.3, y - r * 0.1);
      ctx.stroke();
      ctx.globalAlpha = base * 0.25;
      circle(ctx, x, y - r * 1.1, r * 0.9, 'rgb(156, 200, 255)');
    },
    magic(ctx, x, y, r, color, cycle) {
      const base = ctx.globalAlpha;
      const cy = y - r;
      ctx.strokeStyle = 'rgb(167, 139, 250)';
      ctx.lineWidth = Math.max(1.5, r * 0.08);
      const turn = cycle * 0.8;
      ctx.beginPath();
      ctx.ellipse(x, cy, r * 1.3, r * 0.55, 0, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      for (let index = 0; index <= 5; index += 1) {
        const angle = turn + (index * 2 * TAU) / 5;
        const px = x + Math.cos(angle) * r * 1.15;
        const py = cy + Math.sin(angle) * r * 0.48;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.globalAlpha = base * 0.25;
      ctx.beginPath();
      ctx.ellipse(x, cy, r * 1.3, r * 0.55, 0, 0, TAU);
      ctx.fillStyle = 'rgb(167, 139, 250)';
      ctx.fill();
    },
    heart(ctx, x, y, r, color, cycle, reducedMotion) {
      const cy = y - r;
      const beat = reducedMotion ? 1 : 1 + 0.12 * Math.sin(cycle * TAU * 1.5);
      const size = r * 0.9 * beat;
      ctx.fillStyle = 'rgb(240, 69, 122)';
      ctx.beginPath();
      ctx.moveTo(x, cy + size * 0.9);
      ctx.bezierCurveTo(x - size * 1.5, cy - size * 0.1, x - size * 0.7, cy - size * 1.2, x, cy - size * 0.35);
      ctx.bezierCurveTo(x + size * 0.7, cy - size * 1.2, x + size * 1.5, cy - size * 0.1, x, cy + size * 0.9);
      ctx.fill();
    },
    notes(ctx, x, y, r, color, cycle) {
      ctx.strokeStyle = 'rgb(255, 255, 255)';
      ctx.fillStyle = 'rgb(255, 255, 255)';
      ctx.lineWidth = Math.max(1.5, r * 0.07);
      for (let index = 0; index < 2; index += 1) {
        const rise = ((cycle * 0.35 + index * 0.5) % 1) * r * 0.8;
        const nx = x + (index - 0.5) * r * 1.1;
        const ny = y - r * 0.6 - rise - index * r * 0.5;
        ctx.beginPath();
        ctx.ellipse(nx, ny, r * 0.22, r * 0.16, -0.4, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(nx + r * 0.2, ny);
        ctx.lineTo(nx + r * 0.2, ny - r * 0.9);
        ctx.lineTo(nx + r * 0.55, ny - r * 0.7);
        ctx.stroke();
      }
    },
    wind(ctx, x, y, r, color, cycle) {
      const cy = y - r;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = Math.max(1.5, r * 0.07);
      ctx.lineCap = 'round';
      for (let index = -1; index <= 1; index += 1) {
        const shift = ((cycle * 0.5 + index * 0.3) % 1) * r * 0.6;
        const py = cy + index * r * 0.5;
        ctx.beginPath();
        ctx.moveTo(x - r * 1.4 + shift, py);
        ctx.bezierCurveTo(x - r * 0.4 + shift, py - r * 0.35, x + r * 0.4 + shift, py + r * 0.35, x + r * 1.2 + shift, py - r * 0.1);
        ctx.stroke();
      }
    },
    bubbles(ctx, x, y, r, color, cycle) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = Math.max(1, r * 0.05);
      for (let index = 0; index < 4; index += 1) {
        const rise = ((cycle * 0.3 + index / 4) % 1) * r * 1.6;
        const radius = r * (0.22 + 0.12 * (index % 3));
        ctx.beginPath();
        ctx.arc(x + (index - 1.5) * r * 0.4, y - r * 0.4 - rise, radius, 0, TAU);
        ctx.stroke();
        circle(ctx, x + (index - 1.5) * r * 0.4 - radius * 0.3, y - r * 0.4 - rise - radius * 0.3, radius * 0.2, 'rgba(255, 255, 255, 0.8)');
      }
    },
    leaves(ctx, x, y, r, color, cycle) {
      for (let index = 0; index < 4; index += 1) {
        const fall = ((cycle * 0.3 + index / 4) % 1) * r * 1.8;
        ctx.fillStyle = index % 2 === 0 ? 'rgb(229, 143, 42)' : 'rgb(111, 168, 63)';
        ctx.beginPath();
        ctx.ellipse(x + Math.sin(cycle * 2 + index) * r * 0.4 + (index - 1.5) * r * 0.35, y - r * 1.9 + fall, r * 0.22, r * 0.11, cycle * 2 + index, 0, TAU);
        ctx.fill();
      }
    },
    dark(ctx, x, y, r, color, cycle) {
      const base = ctx.globalAlpha;
      const cy = y - r;
      ctx.globalAlpha = base * 0.7;
      for (const [dx, dy, scale] of [[-0.5, 0.2, 0.7], [0.5, 0, 0.8], [0, -0.5, 0.9], [0.1, 0.4, 0.6]]) {
        circle(ctx, x + dx * r + Math.sin(cycle * 1.5 + dy) * r * 0.1, cy + dy * r, r * scale, 'rgba(40, 25, 60, 0.7)');
      }
    },
    shockwave(ctx, x, y, r, color, cycle) {
      const base = ctx.globalAlpha;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      for (let index = 0; index < 2; index += 1) {
        const grow = (cycle * 0.6 + index * 0.5) % 1;
        ctx.lineWidth = Math.max(1, r * 0.1 * (1 - grow));
        ctx.globalAlpha = base * (1 - grow);
        ctx.beginPath();
        ctx.ellipse(x, y - r * 0.2, r * (0.4 + 1.4 * grow), r * (0.15 + 0.5 * grow), 0, 0, TAU);
        ctx.stroke();
      }
    },
    spark(ctx, x, y, r, color, cycle, reducedMotion) {
      const radius = r * (reducedMotion ? 1 : 1 + 0.1 * Math.sin(cycle * TAU));
      star(ctx, x, y - r, radius, radius * 0.32, 4, color);
    }
  };

  /**
   * 画一个特效：按图形名称取表里的绘制函数，认不出的名称画成火花；画完恢复进入时的透明度。
   * @param {number} r 特效半径（像素）。
   * @param {number} time 特效的循环时间（秒）；reducedMotion 为 true 时停在固定的瞬间。
   * @param {{ angle?: number }} [options] angle 是特效前进方向（弧度，0 朝右）。
   */
  function drawEffect(ctx, glyph, x, y, r, color, time, reducedMotion, options) {
    const base = ctx.globalAlpha;
    const cycle = reducedMotion ? STILL_CYCLE : time;
    (EFFECTS[glyph] || EFFECTS[FALLBACK_EFFECT])(ctx, x, y, r, color, cycle, Boolean(reducedMotion), options || {});
    ctx.globalAlpha = base;
  }

  /** 登记扩展的特效图形（与内置图形同一张表）；绘制函数的参数见 EFFECTS。 */
  function registerEffects(painters) {
    Object.assign(EFFECTS, painters);
  }

  window.aiStoryboardArtEffects = { drawEffect, registerEffects };
})();
