// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-props-effects.js
// 说明：分镜动画的扩展特效图形：爆炸、烟花、发射（子弹、箭）、枪口火光、光束、激光、阴影、水花与挥砍。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：依赖 stage-storyboard-preview-draw.js 与 stage-storyboard-preview-art.js，通过 art.registerEffects 登记到特效图形表（图形名称与归类关键词见 stage-storyboard-preview-rules.js 的 EFFECT_RULES）；绘制函数的参数见 stage-storyboard-preview-art-effects.js 的 EFFECTS；颜色基本固定。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const { TAU, circle, linear, star, rotated } = window.aiStoryboardDraw;
  const { registerEffects } = window.aiStoryboardArt;


  /** 特效循环中的进度（0 到 1）：减少动态效果时停在一个好看的瞬间。 */
  function loop(cycle, period, reduced, still) {
    return reduced ? still : (cycle % period) / period;
  }

  const EFFECTS = {
    explosion(ctx, x, y, r, color, cycle, reduced) {
      const t = loop(cycle, 1.4, reduced, 0.4);
      const grow = Math.min(1, t / 0.45);
      const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      const cy = y - r;
      ctx.save();
      ctx.globalAlpha *= Math.max(0, fade);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = Math.max(1, r * 0.08 * (1 - grow * 0.5));
      ctx.beginPath();
      ctx.ellipse(x, y - r * 0.2, r * (0.6 + 1.8 * grow), r * (0.2 + 0.6 * grow), 0, 0, TAU);
      ctx.stroke();
      for (let index = 0; index < 4; index += 1) {
        circle(ctx, x + (index - 1.5) * r * 0.55 * (0.4 + grow), cy - r * (0.5 + grow * 0.9) - (index % 2) * r * 0.3, r * 0.5 * grow + 1, 'rgba(70, 70, 75, 0.55)');
      }
      const flare = r * (0.5 + 1.1 * grow);
      const core = r * (0.35 + 0.75 * grow);
      star(ctx, x, cy, flare, flare * 0.6, 12, 'rgb(247, 107, 21)');
      star(ctx, x, cy, core, core * 0.6, 9, 'rgb(255, 176, 32)');
      circle(ctx, x, cy, r * (0.2 + 0.4 * grow), 'rgb(255, 243, 176)');
      ctx.strokeStyle = 'rgb(255, 214, 10)';
      ctx.lineWidth = Math.max(1.5, r * 0.06);
      ctx.lineCap = 'round';
      for (let index = 0; index < 10; index += 1) {
        const angle = (index * TAU) / 10 + 0.3;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * r * (0.9 + grow), cy + Math.sin(angle) * r * (0.9 + grow));
        ctx.lineTo(x + Math.cos(angle) * r * (1.3 + 1.6 * grow), cy + Math.sin(angle) * r * (1.3 + 1.6 * grow));
        ctx.stroke();
      }
      ctx.restore();
    },
    fireworks(ctx, x, y, r, color, cycle, reduced) {
      const colors = ['rgb(255, 92, 122)', 'rgb(255, 214, 10)', 'rgb(111, 211, 255)', 'rgb(155, 229, 100)', 'rgb(192, 132, 252)'];
      ctx.save();
      const base = ctx.globalAlpha;
      ctx.lineCap = 'round';
      for (let burst = 0; burst < 2; burst += 1) {
        const t = loop(cycle + burst * 0.8, 1.6, reduced, 0.55);
        const bx = x + (burst - 0.5) * r * 2.2;
        const by = y - r * (1.8 + burst * 0.5);
        if (t < 0.25) {
          ctx.strokeStyle = 'rgb(255, 233, 168)';
          ctx.lineWidth = Math.max(1.5, r * 0.07);
          ctx.beginPath();
          ctx.moveTo(bx, y);
          ctx.lineTo(bx, y + (by - y) * (t / 0.25));
          ctx.stroke();
          continue;
        }
        const grow = Math.min(1, (t - 0.25) / 0.45);
        ctx.globalAlpha = base * Math.max(0, 1 - Math.max(0, (t - 0.6) / 0.4));
        ctx.lineWidth = Math.max(1.5, r * 0.06);
        for (let ray = 0; ray < 14; ray += 1) {
          const angle = (ray * TAU) / 14;
          ctx.strokeStyle = colors[(ray + burst) % colors.length];
          ctx.beginPath();
          ctx.moveTo(bx + Math.cos(angle) * r * 0.4 * grow, by + Math.sin(angle) * r * 0.4 * grow);
          ctx.lineTo(bx + Math.cos(angle) * r * (0.6 + 0.9 * grow), by + Math.sin(angle) * r * (0.6 + 0.9 * grow) + r * 0.25 * grow * grow);
          ctx.stroke();
          circle(ctx, bx + Math.cos(angle) * r * (0.75 + 0.9 * grow), by + Math.sin(angle) * r * (0.75 + 0.9 * grow) + r * 0.25 * grow * grow, Math.max(1.5, r * 0.05), colors[(ray + burst) % colors.length]);
        }
        ctx.globalAlpha = base;
      }
      ctx.restore();
    },
    projectile(ctx, x, y, r, color, cycle, reduced, options) {
      const angle = options.angle || 0;
      rotated(ctx, x, y - r, angle, () => {
        ctx.lineCap = 'round';
        for (const [offset, alpha] of [[-0.5, 0.25], [0, 0.35], [0.5, 0.25]]) {
          ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
          ctx.lineWidth = Math.max(1, r * 0.06);
          ctx.beginPath();
          ctx.moveTo(-r * 2.6, r * offset * 0.5);
          ctx.lineTo(-r * 1.1, r * offset * 0.25);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgb(201, 160, 107)';
        ctx.lineWidth = Math.max(2, r * 0.13);
        ctx.beginPath();
        ctx.moveTo(-r * 1.1, 0);
        ctx.lineTo(r * 0.9, 0);
        ctx.stroke();
        ctx.fillStyle = 'rgb(201, 209, 219)';
        ctx.beginPath();
        ctx.moveTo(r * 0.9, -r * 0.2);
        ctx.lineTo(r * 1.5, 0);
        ctx.lineTo(r * 0.9, r * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgb(229, 72, 77)';
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(-r * 1.1, 0);
          ctx.lineTo(-r * 1.4, side * r * 0.3);
          ctx.lineTo(-r * 0.8, side * r * 0.3);
          ctx.closePath();
          ctx.fill();
        }
      });
    },
    muzzle(ctx, x, y, r, color, cycle, reduced, options) {
      const flicker = reduced ? 1 : 0.85 + 0.15 * Math.sin(cycle * 40);
      rotated(ctx, x, y - r, options.angle || 0, () => {
        ctx.fillStyle = 'rgb(247, 107, 21)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(r * 0.5, -r * 0.55 * flicker);
        ctx.lineTo(r * 0.9, -r * 0.1);
        ctx.lineTo(r * 2 * flicker, 0);
        ctx.lineTo(r * 0.9, r * 0.1);
        ctx.lineTo(r * 0.5, r * 0.55 * flicker);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgb(255, 226, 74)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(r * 0.4, -r * 0.25);
        ctx.lineTo(r * 1.3 * flicker, 0);
        ctx.lineTo(r * 0.4, r * 0.25);
        ctx.closePath();
        ctx.fill();
        circle(ctx, r * 0.1, 0, r * 0.2, 'rgb(255, 255, 255)');
        for (let index = 0; index < 3; index += 1) circle(ctx, r * (1.4 + index * 0.45), -r * 0.18 * (index + 1), r * (0.16 + 0.07 * index), 'rgba(200, 205, 212, 0.5)');
      });
    },
    beam(ctx, x, y, r, color, cycle, reduced) {
      const top = y - r * 3.4;
      ctx.save();
      ctx.fillStyle = linear(ctx, 0, top, 0, y, [[0, 'rgba(255, 243, 176, 0.6)'], [1, 'rgba(255, 243, 176, 0.1)']]);
      ctx.beginPath();
      ctx.moveTo(x - r * 0.2, top);
      ctx.lineTo(x + r * 0.2, top);
      ctx.lineTo(x + r * 1.1, y);
      ctx.lineTo(x - r * 1.1, y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha *= 0.5 + (reduced ? 0 : 0.08 * Math.sin(cycle * 5));
      ctx.fillStyle = 'rgb(255, 243, 176)';
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.1, r * 0.3, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      circle(ctx, x, top, r * 0.22, 'rgb(255, 255, 255)');
    },
    laser(ctx, x, y, r, color, cycle, reduced, options) {
      const pulse = reduced ? 1 : 0.8 + 0.2 * Math.sin(cycle * 30);
      rotated(ctx, x, y - r, options.angle || 0, () => {
        ctx.lineCap = 'round';
        for (const [width, stroke] of [[0.34, 'rgba(255, 60, 60, 0.25)'], [0.16, 'rgba(255, 90, 90, 0.6)'], [0.07, 'rgb(255, 255, 255)']]) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = Math.max(1, r * width * pulse);
          ctx.beginPath();
          ctx.moveTo(-r * 0.2, 0);
          ctx.lineTo(r * 2.6, 0);
          ctx.stroke();
        }
        circle(ctx, r * 2.6, 0, r * 0.18 * pulse, 'rgb(255, 255, 255)');
      });
    },
    shadow(ctx, x, y, r) {
      for (let index = 0; index < 4; index += 1) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
        ctx.beginPath();
        ctx.ellipse(x, y - r * 0.1, r * (1.7 - index * 0.33), r * (0.5 - index * 0.1), 0, 0, TAU);
        ctx.fill();
      }
    },
    splash(ctx, x, y, r, color, cycle, reduced) {
      ctx.fillStyle = 'rgba(123, 196, 245, 0.55)';
      ctx.beginPath();
      ctx.ellipse(x, y - r * 0.1, r * 1.1, r * 0.28, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.beginPath();
      ctx.ellipse(x, y - r * 0.1, r * 0.8, r * 0.2, 0, 0, TAU);
      ctx.stroke();
      for (let index = -3; index <= 3; index += 1) {
        const t = reduced ? 0.45 : (cycle * 0.9 + (index + 3) * 0.09) % 1;
        const px = x + index * r * 0.28 * (0.4 + t);
        const py = y - r * (2.4 * t - 2.2 * t * t) - r * 0.2;
        circle(ctx, px, py, Math.max(1.5, r * 0.09), 'rgba(160, 215, 250, 0.9)');
      }
    },
    slash(ctx, x, y, r, color, cycle, reduced, options) {
      const t = loop(cycle, 0.9, reduced, 0.5);
      const spread = 0.35 + 0.65 * Math.min(1, t / 0.6);
      ctx.save();
      ctx.globalAlpha *= Math.max(0, t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
      rotated(ctx, x, y - r, options.angle === undefined ? -0.5 : options.angle, () => {
        ctx.fillStyle = 'rgb(234, 246, 255)';
        ctx.beginPath();
        ctx.moveTo(-r * 1.5 * spread, r * 0.9);
        ctx.quadraticCurveTo(0, -r * 1.5, r * 1.5 * spread, r * 0.9);
        ctx.quadraticCurveTo(0, -r * 0.55, -r * 1.5 * spread, r * 0.9);
        ctx.fill();
        ctx.strokeStyle = 'rgba(160, 215, 250, 0.8)';
        ctx.lineWidth = Math.max(1, r * 0.05);
        ctx.beginPath();
        ctx.moveTo(-r * 1.9 * spread, r * 1.1);
        ctx.quadraticCurveTo(0, -r * 1.9, r * 1.9 * spread, r * 1.1);
        ctx.stroke();
      });
      ctx.restore();
    }
  };
  registerEffects(EFFECTS);
})();
