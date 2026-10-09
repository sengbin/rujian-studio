// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-props.js
// 说明：分镜动画的道具、特效与场景背景扩展：家具与家电（柜、架、沙发、冰箱、空调、洗衣机等）、厨具与餐具（灶台、油烟机、水槽、锅、碗盘、刀叉等）、卫浴（马桶、浴缸、淋浴）、常见物品（炸弹、弓箭、盾、工具、食物等），发射、爆炸、烟花、光束、阴影、水花、挥砍等特效，以及厨房、卫生间、卧室、医院、教室、商店的背景。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：依赖 stage-storyboard-preview-art.js，通过它的 registerProps、registerEffects、registerBackdrops 登记，图形名称与归类关键词见 stage-storyboard-preview-timeline.js 的 PROP_RULES、THING_RULES、EFFECT_RULES、SCENE_SETTING_RULES；只用画布路径与填充，颜色固定或取实体的识别色；道具以脚下中点为锚点，单位 u 为“画面高度的 1% × 纵深缩放”。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const art = window.aiStoryboardArt;
  const { shade, circle, roundedRect, linear, TAU } = art;
  const WOOD = '#8B6B4A';
  const METAL = '#B8BEC6';
  const DARK_METAL = '#2A2E36';
  const GOLD = '#E8B84A';

  /** 以脚下中点 (x, y) 为原点、向上为正的作图工具：位置与尺寸都以 u 为单位。 */
  function pen(ctx, x, y, u) {
    // 进入时的透明度：alpha() 在它的基础上叠乘，调用方的叠化、淡出不会被覆盖。
    const base = ctx.globalAlpha;
    return {
      rect(left, bottom, width, height, fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(x + left * u, y - (bottom + height) * u, width * u, height * u);
      },
      rrect(left, bottom, width, height, radius, fill) {
        ctx.fillStyle = fill;
        roundedRect(ctx, x + left * u, y - (bottom + height) * u, width * u, height * u, radius * u);
        ctx.fill();
      },
      oval(cx, cy, rx, ry, fill, rotation) {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.ellipse(x + cx * u, y - cy * u, rx * u, ry * u, rotation || 0, 0, TAU);
        ctx.fill();
      },
      circ(cx, cy, radius, fill) {
        circle(ctx, x + cx * u, y - cy * u, radius * u, fill);
      },
      poly(points, fill) {
        ctx.fillStyle = fill;
        ctx.beginPath();
        points.forEach(([px, py], index) => (index === 0 ? ctx.moveTo(x + px * u, y - py * u) : ctx.lineTo(x + px * u, y - py * u)));
        ctx.closePath();
        ctx.fill();
      },
      line(x0, y0, x1, y1, color, width) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width * u;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + x0 * u, y - y0 * u);
        ctx.lineTo(x + x1 * u, y - y1 * u);
        ctx.stroke();
      },
      arc(cx, cy, radius, from, to, color, width) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width * u;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(x + cx * u, y - cy * u, radius * u, from, to);
        ctx.stroke();
      },
      alpha(value) {
        ctx.globalAlpha = base * value;
      }
    };
  }

  /** 绕 (cx, cy) 旋转 angle 弧度后执行绘制。 */
  function rotated(ctx, cx, cy, angle, draw) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    draw();
    ctx.restore();
  }

  /** 多角星：points 个尖角，innerRatio 为内径占外径的比例。 */
  function star(ctx, cx, cy, radius, points, innerRatio, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let index = 0; index < points * 2; index += 1) {
      const angle = (Math.PI * index) / points - Math.PI / 2;
      const length = index % 2 === 0 ? radius : radius * innerRatio;
      if (index === 0) ctx.moveTo(cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
      else ctx.lineTo(cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
    }
    ctx.closePath();
    ctx.fill();
  }

  // ---------- 道具 ----------

  const PAINTERS = {
    cabinet(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.rect(-6, 0.8, 12, 15.2, shade(color, 0.85));
      g.rect(-5.4, 1.4, 5.2, 14, color);
      g.rect(0.2, 1.4, 5.2, 14, color);
      g.rect(-6.5, 15.8, 13, 1, shade(color, 0.65));
      g.rect(-5.6, 0, 1, 0.8, shade(color, 0.5));
      g.rect(4.6, 0, 1, 0.8, shade(color, 0.5));
      g.circ(-1, 8, 0.5, '#E8D28A');
      g.circ(1.4, 8, 0.5, '#E8D28A');
    },
    shelf(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.rect(-6, 0, 1, 18, shade(color, 0.7));
      g.rect(5, 0, 1, 18, shade(color, 0.7));
      for (const bottom of [0, 6, 12, 17]) g.rect(-6, bottom, 12, 1, shade(color, 0.85));
      const tones = ['#C0504D', '#4F81BD', '#E8B84A', '#6AA84F'];
      for (const row of [1, 7, 13]) for (let index = 0; index < 5; index += 1) g.rect(-5 + index * 2, row, 1.6, 4 + (index % 2), tones[(index + row) % 4]);
    },
    sofa(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.rrect(-9, 2, 18, 7, 1.6, shade(color, 0.8));
      g.rrect(-9, 0.8, 18, 4.4, 1, color);
      g.rrect(-10.4, 1.2, 3, 6.4, 1.2, shade(color, 0.9));
      g.rrect(7.4, 1.2, 3, 6.4, 1.2, shade(color, 0.9));
      g.rrect(-6.6, 4.6, 6, 2.4, 0.8, shade(color, 1.15));
      g.rrect(0.6, 4.6, 6, 2.4, 0.8, shade(color, 1.15));
      g.rect(-9, 0, 1, 0.8, '#4A3A2A');
      g.rect(8, 0, 1, 0.8, '#4A3A2A');
    },
    bench(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.rect(-7, 0, 1.2, 5, shade(color, 0.7));
      g.rect(5.8, 0, 1.2, 5, shade(color, 0.7));
      g.rect(-7, 5, 1, 5, shade(color, 0.7));
      g.rect(6, 5, 1, 5, shade(color, 0.7));
      g.rrect(-8, 5, 16, 1.4, 0.5, color);
      g.rect(-7.6, 7.4, 15.2, 1.1, color);
      g.rect(-7.6, 9.2, 15.2, 1.1, color);
    },
    curtain(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.rect(-9, 17.4, 18, 0.7, WOOD);
      g.poly([[-8, 17.4], [-0.6, 17.4], [-1.8, 0], [-8, 0]], color);
      g.poly([[0.6, 17.4], [8, 17.4], [8, 0], [1.8, 0]], color);
      for (const dx of [-6, -4, -2.4, 2.8, 4.8, 6.6]) g.line(dx, 17, dx * 0.9, 0.4, shade(color, 0.75), 0.4);
    },
    carpet(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.oval(0, 0.9, 10, 1.7, color);
      g.oval(0, 0.9, 7.4, 1.1, shade(color, 1.25));
      g.oval(0, 0.9, 4, 0.55, shade(color, 0.8));
    },
    chandelier(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.line(0, 26, 0, 18, '#555555', 0.5);
      g.alpha(0.25);
      g.circ(0, 14, 8, '#FFE9A8');
      g.alpha(1);
      for (const [dx, dy] of [[-5.4, 14], [0, 13], [5.4, 14]]) {
        g.line(0, 18, dx, dy + 1.4, GOLD, 0.6);
        g.circ(dx, dy, 1.3, '#FFF3B0');
      }
      g.oval(0, 18, 2.2, 1, shade(color, 0.7));
    },
    candle(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rect(-1.4, 0.8, 2.8, 6, '#F5EBD0');
      g.rect(-2.6, 0, 5.2, 0.8, '#B58B4A');
      g.rect(-0.15, 6.8, 0.3, 0.9, '#333333');
      g.alpha(0.3);
      g.circ(0, 8.8, 3, '#FFE9A8');
      g.alpha(1);
      g.oval(0, 8.9, 0.95, 1.5, '#FFC83D');
      g.oval(0, 8.6, 0.45, 0.8, '#FFF3B0');
    },
    fireplace(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rect(-7, 0, 14, 14, '#8E5A44');
      for (const row of [3, 6.4, 9.8]) g.rect(-7, row, 14, 0.3, '#6B3F2E');
      g.rect(-8, 14, 16, 1.6, '#6B4A3A');
      g.rect(-4, 0, 8, 7.4, '#2A1A16');
      g.oval(0, 7.4, 4, 1.6, '#2A1A16');
      g.poly([[-2.6, 0.4], [-1.6, 4.4], [-0.4, 2], [0.6, 5.4], [1.6, 2.2], [2.8, 0.4]], '#F76B15');
      g.poly([[-1.2, 0.4], [-0.4, 2.8], [0.4, 1.4], [1.2, 0.4]], '#FFD60A');
    },
    pillar(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rect(-2.4, 2, 4.8, 15, '#D9D4C7');
      for (const dx of [-1.2, 0, 1.2]) g.line(dx, 2.2, dx, 16.8, '#BFB8A8', 0.3);
      g.rect(-3.5, 0, 7, 2, '#BFB8A8');
      g.rect(-3.5, 17, 7, 2, '#BFB8A8');
    },
    blackboard(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rect(-7.5, 0, 1, 6, WOOD);
      g.rect(6.5, 0, 1, 6, WOOD);
      g.rect(-8.4, 5, 16.8, 10.8, WOOD);
      g.rect(-7.6, 5.8, 15.2, 9.2, '#2F4A3A');
      g.rect(-8.4, 4.4, 16.8, 0.8, '#6B4A3A');
      g.line(-5.6, 12.6, -1.2, 12.6, '#F4F1E8', 0.4);
      g.line(-5.6, 10.4, 3.6, 10.4, '#F4F1E8', 0.4);
      g.line(-5.6, 8.2, 0.6, 8.2, '#F4F1E8', 0.4);
      g.circ(4.6, 12, 1.2, 'rgba(244, 241, 232, 0.6)');
    },
    well(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rect(-5, 0, 10, 6, '#8A8F98');
      for (const row of [2, 4]) g.rect(-5, row, 10, 0.3, '#6B7078');
      g.rect(-5, 6, 1, 8, WOOD);
      g.rect(4, 6, 1, 8, WOOD);
      g.poly([[-7, 14], [0, 18.6], [7, 14]], '#A0522D');
      g.line(0, 14, 0, 9.6, '#6B4A3A', 0.4);
      g.rect(-1.2, 7.6, 2.4, 2, '#6B4A3A');
    },
    bridge(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.rect(-9, 0, 3, 3.4, '#8A7F70');
      g.rect(6, 0, 3, 3.4, '#8A7F70');
      g.rect(-9.4, 3.4, 18.8, 1.6, '#9B8F7E');
      g.rect(-9.4, 5.8, 18.8, 0.6, color);
      for (const dx of [-9, -4.5, 0, 4.5, 8.6]) g.rect(dx, 5, 0.8, 2.4, shade(color, 0.8));
    },
    fridge(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rrect(-5, 0.6, 10, 18.4, 1.2, '#E9EEF2');
      g.rect(-5, 12.4, 10, 0.4, '#B8C2CC');
      g.rect(3, 13.6, 0.8, 3.4, '#8895A0');
      g.rect(3, 8, 0.8, 3, '#8895A0');
      g.rect(-3.8, 0, 1.2, 0.6, '#555555');
      g.rect(2.6, 0, 1.2, 0.6, '#555555');
      g.rect(-3, 15, 1.6, 1.2, '#E5484D');
    },
    aircon(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rrect(-4.6, 0, 9.2, 19, 1.2, '#F2F5F8');
      for (let row = 0; row < 4; row += 1) g.rect(-3.6, 11 + row * 1.2, 7.2, 0.4, '#C7CED6');
      g.rect(-1.6, 16.4, 3.2, 1.2, DARK_METAL);
      g.circ(1, 17, 0.25, '#7CF0A0');
      for (let row = 0; row < 3; row += 1) g.rect(-3.4, 2 + row * 1.6, 6.8, 0.4, '#C7CED6');
    },
    washer(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rrect(-5.4, 0, 10.8, 12.4, 0.8, '#EDF1F4');
      g.rect(-5.4, 10.2, 10.8, 2.2, '#D4DBE2');
      g.circ(-3.6, 11.3, 0.6, '#8895A0');
      g.rect(1.4, 10.9, 3, 0.8, '#7BC4F5');
      g.circ(0, 5, 3.6, '#B0BAC4');
      g.circ(0, 5, 2.9, '#6FA8DC');
      g.circ(-0.9, 5.9, 0.8, 'rgba(255, 255, 255, 0.5)');
    },
    microwave(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rrect(-6.4, 0, 12.8, 7.4, 0.8, '#D9DEE3');
      g.rect(-5.4, 1, 7.8, 5.4, DARK_METAL);
      g.rect(-4.8, 1.6, 6.6, 4.2, '#4A505A');
      g.rect(3.2, 1, 2.4, 5.4, '#B0BAC4');
      g.circ(4.4, 5, 0.5, '#FFD60A');
      g.circ(4.4, 3.4, 0.5, '#FFFFFF');
      g.circ(4.4, 2, 0.5, '#FFFFFF');
    },
    fan(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.oval(0, 0.6, 3.6, 0.7, '#555555');
      g.rect(-0.4, 0.6, 0.8, 9.6, '#666666');
      g.alpha(0.3);
      g.circ(0, 14, 4.6, '#CFE3F5');
      g.alpha(1);
      g.arc(0, 14, 4.6, 0, TAU, '#8895A0', 0.4);
      for (let index = 0; index < 3; index += 1) {
        const angle = (index * TAU) / 3 + 0.5;
        g.oval(Math.cos(angle) * 2.2, 14 + Math.sin(angle) * 2.2, 2.3, 0.9, '#9CC8EA', -angle);
      }
      g.circ(0, 14, 0.8, '#555555');
    },
    kettle(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.oval(0, 3.2, 3.8, 3.2, color);
      g.rect(-1.5, 6.2, 3, 0.8, shade(color, 0.7));
      g.circ(0, 7.4, 0.6, shade(color, 0.6));
      g.poly([[3, 2.6], [5.8, 5.4], [5, 6], [2.6, 4]], color);
      g.arc(-3.6, 3.6, 2.2, Math.PI * 0.6, Math.PI * 1.6, shade(color, 0.6), 0.7);
    },
    speaker(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rrect(-3.6, 0, 7.2, 10, 0.8, '#2B2F36');
      g.circ(0, 3.2, 2.3, '#4A505A');
      g.circ(0, 3.2, 1, '#2B2F36');
      g.circ(0, 7.6, 1.4, '#4A505A');
      g.circ(0, 7.6, 0.5, '#2B2F36');
    },
    camera(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rrect(-4.4, 1, 8.8, 5.4, 0.8, '#2B2F36');
      g.rect(-3.2, 6.4, 3, 1, '#2B2F36');
      g.circ(0, 3.8, 2.4, '#4A505A');
      g.circ(0, 3.8, 1.4, '#7BC4F5');
      g.circ(-0.5, 4.3, 0.4, 'rgba(255, 255, 255, 0.7)');
      g.circ(3.2, 5.2, 0.5, '#E5484D');
      g.rect(-1.4, 0, 2.8, 1, '#555555');
    },
    socket(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rrect(-2.4, 0, 4.8, 4.8, 0.6, '#F4F1E8');
      g.rect(-1.2, 2, 0.5, 1.2, '#444444');
      g.rect(0.7, 2, 0.5, 1.2, '#444444');
      g.circ(0, 1, 0.3, '#444444');
    },
    stove(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rect(-7, 0, 14, 8, '#C9CED4');
      g.rect(-7.4, 8, 14.8, 0.9, '#8A929B');
      for (const dx of [-3.4, 3.4]) {
        g.oval(dx, 9.2, 2.3, 0.5, DARK_METAL);
        g.poly([[dx - 1, 9.4], [dx - 0.4, 10.8], [dx, 9.8], [dx + 0.4, 10.8], [dx + 1, 9.4]], '#F76B15');
      }
      for (const dx of [-4.6, -2.2, 2.2, 4.6]) g.circ(dx, 6.6, 0.55, '#444444');
      g.rect(-5.6, 0.8, 11.2, 4.4, DARK_METAL);
      g.rect(-4.8, 1.4, 9.6, 3.2, '#4A505A');
      g.rect(-4, 5.2, 8, 0.5, METAL);
    },
    hood(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rect(-1.6, 21, 3.2, 4.6, METAL);
      g.poly([[-6, 15], [6, 15], [2.4, 21], [-2.4, 21]], '#C9CED4');
      g.rect(-6.4, 14.1, 12.8, 0.9, '#8A929B');
      g.circ(-3.2, 14, 0.5, '#FFF3B0');
      g.circ(3.2, 14, 0.5, '#FFF3B0');
      g.rect(-2, 16.4, 4, 0.4, '#8A929B');
      g.rect(-2, 18, 4, 0.4, '#8A929B');
    },
    sink(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.rect(-7, 0, 14, 8, shade(color, 0.9));
      g.rect(-0.1, 0.8, 0.2, 6.4, shade(color, 0.6));
      g.rect(-7.6, 8, 15.2, 1, '#D8D8D8');
      g.rect(-4, 8.8, 8, 0.5, '#9FB2C4');
      g.line(-2.4, 9, -2.4, 12, METAL, 0.7);
      g.line(-2.4, 12, -0.4, 12, METAL, 0.7);
      g.circ(-0.4, 11, 0.35, '#7BC4F5');
    },
    faucet(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rect(-0.7, 0, 1.4, 6, METAL);
      g.line(0, 6, 0, 8.4, METAL, 1.2);
      g.line(0, 8.4, 3.4, 8.4, METAL, 1.2);
      g.line(3.4, 8.4, 3.4, 7, METAL, 1.2);
      g.rect(-2.4, 5.4, 1.6, 0.9, '#E5484D');
      g.oval(3.4, 5.4, 0.5, 0.8, '#7BC4F5');
      g.oval(3.4, 3.2, 0.4, 0.6, '#7BC4F5');
    },
    pan(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.oval(0, 1.6, 5, 1.4, '#3A3F47');
      g.oval(0, 2, 4.2, 1, '#23262C');
      g.line(5, 2, 11, 3.2, '#6B4A3A', 1.3);
    },
    knife(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.poly([[-6, 1.4], [3, 1.4], [3, 7.4], [-6, 6]], '#C9D1DB');
      g.rect(-6, 1.4, 9, 0.5, '#8A929B');
      g.rrect(3, 2.8, 4.4, 2.4, 1, '#6B4A3A');
      g.circ(-4.6, 5, 0.5, '#8A929B');
    },
    board(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rrect(-6, 0, 12, 2, 0.8, '#C9A06B');
      g.rect(-6, 1.4, 12, 0.5, '#B38A56');
      g.poly([[-3, 2], [2.4, 2.4], [-3, 3.6]], '#F28C28');
      g.poly([[-3, 2.8], [-4.6, 3.8], [-3.6, 2.2]], '#6AA84F');
    },
    bowl(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y - 3.4 * u, 4.8 * u, 3.2 * u, 0, 0, Math.PI);
      ctx.fill();
      g.oval(0, 3.4, 4.8, 1, shade(color, 1.25));
      g.oval(0, 3.4, 3.8, 0.6, '#D9A55B');
      g.rect(-1.8, 0, 3.6, 0.7, shade(color, 0.7));
    },
    plate(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.oval(0, 1, 6, 1.2, '#F4F1E8');
      g.oval(0, 1.1, 4, 0.7, '#E3DED0');
      g.oval(0, 1.6, 2, 0.6, color);
    },
    cutlery(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.oval(-3, 8, 1.2, 1.8, '#C9D1DB');
      g.rect(-3.2, 0, 0.5, 6.6, '#C9D1DB');
      g.rect(-0.2, 0, 0.5, 6.4, '#C9D1DB');
      for (const dx of [-0.9, 0.5, 1.9]) g.rect(dx - 0.2, 6.4, 0.4, 2.6, '#C9D1DB');
      g.rect(-0.9, 6.4, 2.8, 0.5, '#C9D1DB');
      g.poly([[3.4, 0], [4.2, 0], [4.2, 9], [3.4, 9], [3, 5]], '#C9D1DB');
    },
    toilet(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rrect(-4, 6, 6, 5.6, 0.8, '#F4F6F8');
      g.circ(-1, 11.8, 0.5, '#8895A0');
      g.rect(-1.6, 0, 5, 2.4, '#E3E8EC');
      g.oval(1.8, 4.2, 4.6, 2.2, '#F4F6F8');
      g.oval(1.8, 5.4, 4.2, 0.9, '#DDE3E8');
      g.oval(1.8, 5.4, 3, 0.6, '#BFDDF0');
    },
    bathtub(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rect(-7.6, 0, 1.4, 2.6, GOLD);
      g.rect(6.2, 0, 1.4, 2.6, GOLD);
      g.rrect(-9, 2.4, 18, 5.6, 2, '#F4F6F8');
      g.rrect(-8, 5.8, 16, 2.2, 1, '#BFDDF0');
      g.rect(-8.6, 8, 0.8, 3, METAL);
      g.circ(-2, 8.6, 0.9, 'rgba(255, 255, 255, 0.8)');
      g.circ(1.4, 8.9, 0.6, 'rgba(255, 255, 255, 0.8)');
      g.circ(3.4, 8.4, 1, 'rgba(255, 255, 255, 0.8)');
    },
    shower(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rect(-0.3, 0, 0.6, 19, METAL);
      g.line(0, 19, 3, 19, METAL, 0.6);
      g.poly([[2, 19.4], [5.6, 19.4], [4.6, 17.8], [3, 17.8]], METAL);
      for (const dx of [3, 3.8, 4.6]) g.line(dx, 17.4, dx - 0.4, 9, 'rgba(123, 196, 245, 0.75)', 0.3);
      g.circ(0, 9, 0.7, '#E5484D');
    },
    towel(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.rect(-5, 10, 10, 0.6, METAL);
      g.rect(-3.4, 2, 6.8, 8.4, color);
      g.rect(-3.4, 4, 6.8, 0.8, '#FFFFFF');
      g.rect(-3.4, 2, 6.8, 0.6, shade(color, 0.75));
    },
    bomb(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.circ(0, 4.6, 4.4, '#2A2E36');
      g.circ(-1.6, 6, 1.2, '#4A505A');
      g.rect(-1, 8.8, 2, 1.2, '#444444');
      g.line(0, 10, 1.6, 11.6, '#C9A06B', 0.5);
      star(ctx, x + 1.9 * u, y - 12 * u, 1.3 * u, 4, 0.4, '#FFD60A');
    },
    rocket(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.poly([[-1.4, 2], [0, -0.2], [1.4, 2]], '#F76B15');
      g.oval(0, 9.6, 2.8, 7.6, '#EDEFF2');
      g.poly([[-2.8, 15], [0, 21], [2.8, 15]], '#E5484D');
      g.circ(0, 11.4, 1.4, '#7BC4F5');
      g.poly([[-2.6, 5], [-5.4, 2], [-2.8, 8.4]], '#E5484D');
      g.poly([[2.6, 5], [5.4, 2], [2.8, 8.4]], '#E5484D');
    },
    cannon(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.poly([[-3, 3.6], [8, 6.4], [7.2, 8.8], [-3.8, 6]], '#3A3F47');
      g.circ(8, 7.6, 1.5, '#23262C');
      g.circ(-1, 3, 3, '#6B4A3A');
      g.circ(-1, 3, 0.8, '#3A2A1F');
      for (let index = 0; index < 4; index += 1) {
        const angle = (index * Math.PI) / 4;
        g.line(-1 - Math.cos(angle) * 2.8, 3 - Math.sin(angle) * 2.8, -1 + Math.cos(angle) * 2.8, 3 + Math.sin(angle) * 2.8, '#3A2A1F', 0.3);
      }
    },
    bow(ctx, x, y, u) {
      ctx.strokeStyle = WOOD;
      ctx.lineWidth = 1.1 * u;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + 2 * u, y);
      ctx.quadraticCurveTo(x - 6 * u, y - 8 * u, x + 2 * u, y - 16 * u);
      ctx.stroke();
      const g = pen(ctx, x, y, u);
      g.line(2, 0, 2, 16, '#EDEDED', 0.3);
      g.line(-1.4, 8, 7.4, 8, '#C9A06B', 0.4);
      g.poly([[7, 8.9], [9, 8], [7, 7.1]], '#C9D1DB');
    },
    arrow(ctx, x, y, u) {
      rotated(ctx, x, y - 8 * u, -0.9, () => {
        const g = pen(ctx, 0, 0, u);
        g.line(-7, 0, 6, 0, '#C9A06B', 0.7);
        g.poly([[6, 1.3], [9, 0], [6, -1.3]], '#C9D1DB');
        g.poly([[-7, 0], [-8.6, 1.6], [-5.4, 1.6]], '#E5484D');
        g.poly([[-7, 0], [-8.6, -1.6], [-5.4, -1.6]], '#E5484D');
      });
    },
    shield(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.poly([[-5.4, 15], [5.4, 15], [5.4, 8], [3, 3.6], [0, 0.6], [-3, 3.6], [-5.4, 8]], '#8A8F98');
      g.poly([[-4.4, 14], [4.4, 14], [4.4, 8.2], [2.4, 4.4], [0, 1.8], [-2.4, 4.4], [-4.4, 8.2]], color);
      g.rect(-0.5, 4, 1, 9, '#F4F1E8');
      g.rect(-3, 9, 6, 1, '#F4F1E8');
    },
    tool(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rect(-0.7, 0, 1.4, 11, WOOD);
      g.rect(-4, 10.4, 8, 3.2, '#6B7580');
      g.poly([[4, 10.8], [6.4, 12.4], [4, 13.4]], '#6B7580');
      g.rect(-4, 10.4, 8, 0.6, '#8895A0');
    },
    rope(ctx, x, y, u) {
      for (const [ry, shiftY, rx] of [[1.2, 1, 4.6], [1, 2.2, 3.6], [0.8, 3.2, 2.6]]) {
        ctx.strokeStyle = '#C9A06B';
        ctx.lineWidth = 1 * u;
        ctx.beginPath();
        ctx.ellipse(x, y - shiftY * u, rx * u, ry * u, 0, 0, TAU);
        ctx.stroke();
      }
    },
    food(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.oval(-2.6, 2.4, 4.6, 2.4, '#D9A55B');
      for (const dx of [-4.4, -2.6, -0.8]) g.line(dx, 3.8, dx + 0.6, 2.4, '#B77F3A', 0.3);
      g.circ(4.4, 2.6, 2.6, '#D6403A');
      g.oval(5, 5.4, 1.2, 0.5, '#6AA84F', -0.5);
    },
    cake(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rect(-6, 0, 12, 3.4, '#F4C7D0');
      g.rect(-4.4, 3.4, 8.8, 2.8, '#FCE9EE');
      g.oval(0, 6.2, 4.4, 0.8, '#FFFFFF');
      g.circ(0, 7.2, 1, '#D6403A');
      g.rect(-0.3, 7.6, 0.6, 2, '#4F81BD');
      g.oval(0, 10.4, 0.5, 0.9, '#FFC83D');
    },
    bone(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.line(-4.6, 1.8, 4.6, 1.8, '#F4EFE0', 1.8);
      for (const [dx, dy] of [[-5.6, 2.8], [-5.6, 0.8], [5.6, 2.8], [5.6, 0.8]]) g.circ(dx, dy, 1.1, '#F4EFE0');
    },
    suitcase(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.rrect(-7, 1.2, 14, 9.6, 1.2, color);
      g.rect(-7, 5.6, 14, 0.6, shade(color, 0.7));
      g.rect(-3, 6.6, 1.6, 1.2, GOLD);
      g.rect(1.4, 6.6, 1.6, 1.2, GOLD);
      g.arc(0, 10.8, 2.6, Math.PI, 0, shade(color, 0.6), 0.7);
      g.circ(-5, 0.6, 0.8, DARK_METAL);
      g.circ(5, 0.6, 0.8, DARK_METAL);
    },
    clothes(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.rect(-3.4, 0, 6.8, 9, color);
      g.poly([[-3.4, 9], [-6.8, 6.8], [-5.6, 4.6], [-3.4, 6]], shade(color, 0.9));
      g.poly([[3.4, 9], [6.8, 6.8], [5.6, 4.6], [3.4, 6]], shade(color, 0.9));
      g.oval(0, 9, 1.5, 0.9, shade(color, 0.65));
    },
    medicine(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.rrect(-2.6, 0, 5.2, 6.4, 0.8, '#E8A33A');
      g.rect(-2.2, 6.4, 4.4, 1.4, '#FFFFFF');
      g.rect(-2.6, 2, 5.2, 2.6, '#F4F1E8');
      g.rect(-0.3, 2.3, 0.6, 2, '#D6403A');
      g.rect(-1, 3, 2, 0.6, '#D6403A');
    },
    bottle(ctx, x, y, u, color) {
      const g = pen(ctx, x, y, u);
      g.rrect(-2.2, 0, 4.4, 6.6, 1.2, color);
      g.rect(-1, 6.6, 2, 2.8, color);
      g.rect(-1.2, 9.4, 2.4, 0.9, WOOD);
      g.rect(-2.2, 2.4, 4.4, 2.4, '#F4F1E8');
      g.rect(-1.6, 0.8, 0.5, 4.8, 'rgba(255, 255, 255, 0.35)');
    },
    glasses(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      for (const dx of [-3, 3]) {
        g.circ(dx, 1.8, 2, 'rgba(200, 225, 245, 0.5)');
        g.arc(dx, 1.8, 2, 0, TAU, '#2A2E36', 0.4);
      }
      g.line(-1, 2.2, 1, 2.2, '#2A2E36', 0.4);
      g.line(-5, 2.2, -6.6, 1.2, '#2A2E36', 0.4);
      g.line(5, 2.2, 6.6, 1.2, '#2A2E36', 0.4);
    },
    telescope(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.line(0, 7, -3.4, 0, '#555555', 0.6);
      g.line(0, 7, 3.4, 0, '#555555', 0.6);
      g.line(0, 7, 0, 0, '#555555', 0.6);
      rotated(ctx, x, y - 8.4 * u, -0.5, () => {
        const h = pen(ctx, 0, 0, u);
        h.rrect(-6, -1.6, 12, 3.2, 0.8, '#3A5A8A');
        h.rect(-6.6, -2, 1.6, 4, GOLD);
        h.rect(4.8, -1.3, 2.6, 2.6, '#1F2229');
      });
    },
    trophy(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.poly([[-3.6, 11.4], [3.6, 11.4], [2.6, 5.6], [-2.6, 5.6]], GOLD);
      g.arc(-3.6, 8.8, 1.8, Math.PI * 0.5, Math.PI * 1.5, GOLD, 0.6);
      g.arc(3.6, 8.8, 1.8, -Math.PI * 0.5, Math.PI * 0.5, GOLD, 0.6);
      g.rect(-0.7, 2.4, 1.4, 3.4, GOLD);
      g.rect(-3, 0, 6, 2.4, WOOD);
      g.rect(-1.6, 7.4, 0.6, 3, 'rgba(255, 255, 255, 0.5)');
    },
    lantern(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.line(0, 9.8, 0, 12.4, '#555555', 0.4);
      g.oval(0, 5.2, 3.6, 4.2, '#D6403A');
      g.arc(0, 5.2, 2, -Math.PI * 0.5, Math.PI * 0.5, '#A82B2B', 0.3);
      g.arc(0, 5.2, 2, Math.PI * 0.5, Math.PI * 1.5, '#A82B2B', 0.3);
      g.rect(-1.8, 9.2, 3.6, 0.8, GOLD);
      g.rect(-1.8, 0.4, 3.6, 0.8, GOLD);
      g.line(0, 0.4, 0, -0.6, GOLD, 0.4);
    },
    flashlight(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.alpha(0.22);
      g.poly([[-2, 9.8], [2, 9.8], [5.6, 17], [-5.6, 17]], '#FFF3B0');
      g.alpha(1);
      g.rect(-1.4, 0, 2.8, 7, '#444444');
      g.rect(-2.4, 7, 4.8, 2.4, METAL);
      g.oval(0, 9.4, 2, 0.5, '#FFF3B0');
      g.rect(-0.4, 3.4, 0.8, 1.2, '#E5484D');
    },
    campfire(ctx, x, y, u) {
      const g = pen(ctx, x, y, u);
      g.alpha(0.25);
      g.circ(0, 4.6, 5.4, '#FFB020');
      g.alpha(1);
      g.line(-5, 1, 3, 3, '#6B4A3A', 1.6);
      g.line(5, 1, -3, 3, WOOD, 1.6);
      g.poly([[-2.6, 2], [-1.8, 6.6], [-0.6, 4.2], [0.4, 8.6], [1.6, 4.4], [2.8, 6], [3, 2]], '#F76B15');
      g.poly([[-1.2, 2], [-0.4, 5], [0.6, 3.2], [1.4, 2]], '#FFD60A');
      for (const dx of [-6, -3.6, 3.6, 6]) g.circ(dx, 0.8, 1, '#8A8F98');
    }
  };

  /** 各图形的高度（单位 u）。 */
  const HEIGHTS = {
    cabinet: 17, shelf: 18, sofa: 10, bench: 10, curtain: 18, carpet: 2.6, chandelier: 26, candle: 10.4, fireplace: 16, pillar: 19, blackboard: 15.8, well: 18.6, bridge: 7.4,
    fridge: 19, aircon: 19, washer: 12.4, microwave: 7.4, fan: 18.6, kettle: 8, speaker: 10, camera: 7.4, socket: 4.8,
    stove: 11, hood: 25.6, sink: 14, faucet: 9, pan: 4, knife: 7.4, board: 3.6, bowl: 6.6, plate: 2.6, cutlery: 9.8,
    toilet: 12, bathtub: 11, shower: 22, towel: 11,
    bomb: 12.6, rocket: 21, cannon: 10, bow: 16, arrow: 14, shield: 15, tool: 13.6, rope: 4.4, food: 5.4, cake: 11, bone: 3.6, suitcase: 12.4, clothes: 10, medicine: 7.8, bottle: 10.3, glasses: 4, telescope: 14, trophy: 11.4, lantern: 12.4, flashlight: 17, campfire: 9
  };

  /** 会说话时脸的位置：按图形高度估算，圆心在中部偏上，半径随高度增大但不超过 3.4u；少数形状单独指定。 */
  const FACE_OVERRIDES = {
    cabinet: { cy: 11, r: 3.2 },
    fridge: { cy: 14, r: 3 },
    aircon: { cy: 13, r: 2.8 },
    washer: { cy: 5, r: 3 },
    microwave: { cy: 3.8, r: 2.2 },
    hood: { cy: 17.4, r: 2.6 },
    shower: { cy: 14, r: 2 },
    chandelier: { cy: 14, r: 2.6 },
    fireplace: { cy: 4, r: 3 },
    sink: { cy: 4, r: 3 },
    toilet: { cy: 8.4, r: 2.6 },
    plate: { cy: 1.4, r: 1.3 },
    carpet: { cy: 1.4, r: 1.3 }
  };
  const FACES = {};
  for (const [glyph, height] of Object.entries(HEIGHTS)) {
    FACES[glyph] = FACE_OVERRIDES[glyph] || { cy: Math.round(height * 0.55 * 10) / 10, r: Math.round(Math.min(3.4, Math.max(1.3, height * 0.24)) * 10) / 10 };
  }
  art.registerProps(PAINTERS, HEIGHTS, FACES);

  // ---------- 特效 ----------

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
      star(ctx, x, cy, r * (0.5 + 1.1 * grow), 12, 0.6, '#F76B15');
      star(ctx, x, cy, r * (0.35 + 0.75 * grow), 9, 0.6, '#FFB020');
      circle(ctx, x, cy, r * (0.2 + 0.4 * grow), '#FFF3B0');
      ctx.strokeStyle = '#FFD60A';
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
      const colors = ['#FF5C7A', '#FFD60A', '#6FD3FF', '#9BE564', '#C084FC'];
      ctx.save();
      const base = ctx.globalAlpha;
      ctx.lineCap = 'round';
      for (let burst = 0; burst < 2; burst += 1) {
        const t = loop(cycle + burst * 0.8, 1.6, reduced, 0.55);
        const bx = x + (burst - 0.5) * r * 2.2;
        const by = y - r * (1.8 + burst * 0.5);
        if (t < 0.25) {
          ctx.strokeStyle = '#FFE9A8';
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
        ctx.strokeStyle = '#C9A06B';
        ctx.lineWidth = Math.max(2, r * 0.13);
        ctx.beginPath();
        ctx.moveTo(-r * 1.1, 0);
        ctx.lineTo(r * 0.9, 0);
        ctx.stroke();
        ctx.fillStyle = '#C9D1DB';
        ctx.beginPath();
        ctx.moveTo(r * 0.9, -r * 0.2);
        ctx.lineTo(r * 1.5, 0);
        ctx.lineTo(r * 0.9, r * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#E5484D';
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
        ctx.fillStyle = '#F76B15';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(r * 0.5, -r * 0.55 * flicker);
        ctx.lineTo(r * 0.9, -r * 0.1);
        ctx.lineTo(r * 2 * flicker, 0);
        ctx.lineTo(r * 0.9, r * 0.1);
        ctx.lineTo(r * 0.5, r * 0.55 * flicker);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#FFE24A';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(r * 0.4, -r * 0.25);
        ctx.lineTo(r * 1.3 * flicker, 0);
        ctx.lineTo(r * 0.4, r * 0.25);
        ctx.closePath();
        ctx.fill();
        circle(ctx, r * 0.1, 0, r * 0.2, '#FFFFFF');
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
      ctx.fillStyle = '#FFF3B0';
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.1, r * 0.3, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      circle(ctx, x, top, r * 0.22, '#FFFFFF');
    },
    laser(ctx, x, y, r, color, cycle, reduced, options) {
      const pulse = reduced ? 1 : 0.8 + 0.2 * Math.sin(cycle * 30);
      rotated(ctx, x, y - r, options.angle || 0, () => {
        ctx.lineCap = 'round';
        for (const [width, stroke] of [[0.34, 'rgba(255, 60, 60, 0.25)'], [0.16, 'rgba(255, 90, 90, 0.6)'], [0.07, '#FFFFFF']]) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = Math.max(1, r * width * pulse);
          ctx.beginPath();
          ctx.moveTo(-r * 0.2, 0);
          ctx.lineTo(r * 2.6, 0);
          ctx.stroke();
        }
        circle(ctx, r * 2.6, 0, r * 0.18 * pulse, '#FFFFFF');
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
        ctx.fillStyle = '#EAF6FF';
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
  art.registerEffects(EFFECTS);

  // ---------- 场景背景 ----------

  /** 室内背景的底：墙面渐变、踢脚线与地面，返回地平线的位置。 */
  function room(ctx, width, height, wall, floor) {
    const horizon = height * art.HORIZON;
    ctx.fillStyle = linear(ctx, 0, 0, 0, horizon, [[0, shade(wall, 0.88)], [1, wall]]);
    ctx.fillRect(-width, -height, width * 3, horizon + height);
    ctx.fillStyle = shade(wall, 0.72);
    ctx.fillRect(-width, horizon - height * 0.018, width * 3, height * 0.018);
    art.drawGround(ctx, width, height, horizon, floor, shade(floor, 0.75));
    return horizon;
  }

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
      const horizon = room(ctx, width, height, '#EFE7D6', '#B9A184');
      tiles(ctx, width, horizon, 'rgba(120, 100, 70, 0.18)', height * 0.07);
      for (const [left, span] of [[0.04, 0.2], [0.26, 0.2]]) {
        fillRect(ctx, width * left, height * 0.05, width * span, height * 0.17, '#C79A63');
        fillRect(ctx, width * (left + span / 2) - 1, height * 0.05, 2, height * 0.17, '#8E6A3E');
        fillRect(ctx, width * (left + span / 2) - width * 0.012, height * 0.16, width * 0.006, height * 0.03, '#E8D28A');
      }
      const counterTop = horizon - height * 0.17;
      fillRect(ctx, width * 0.04, counterTop, width * 0.46, height * 0.17, '#C79A63');
      fillRect(ctx, width * 0.04, counterTop - height * 0.018, width * 0.46, height * 0.018, '#E7E2D8');
      fillRect(ctx, width * 0.1, counterTop - height * 0.012, width * 0.1, height * 0.012, '#9FB2C4');
      fillRect(ctx, width * 0.15 - 1, counterTop - height * 0.06, 2, height * 0.05, '#B8BEC6');
      for (const left of [0.22, 0.34]) fillRect(ctx, width * left, counterTop, 1, height * 0.17, '#8E6A3E');
      const stoveX = width * 0.6;
      fillRect(ctx, stoveX, counterTop, width * 0.2, height * 0.17, '#CFD4DA');
      fillRect(ctx, stoveX, counterTop - height * 0.012, width * 0.2, height * 0.012, '#8A929B');
      fillRect(ctx, stoveX + width * 0.03, counterTop + height * 0.05, width * 0.14, height * 0.1, DARK_METAL);
      for (const dx of [0.05, 0.15]) circle(ctx, stoveX + width * dx, counterTop - height * 0.018, height * 0.012, '#F76B15');
      ctx.fillStyle = '#C9CED4';
      ctx.beginPath();
      ctx.moveTo(stoveX - width * 0.01, height * 0.2);
      ctx.lineTo(stoveX + width * 0.21, height * 0.2);
      ctx.lineTo(stoveX + width * 0.15, height * 0.1);
      ctx.lineTo(stoveX + width * 0.05, height * 0.1);
      ctx.closePath();
      ctx.fill();
      fillRect(ctx, stoveX + width * 0.09, 0, width * 0.02, height * 0.1, '#B8BEC6');
    },
    bathroom(ctx, scene, width, height) {
      const horizon = room(ctx, width, height, '#DCEAF0', '#C7D3D9');
      tiles(ctx, width, horizon, 'rgba(90, 120, 140, 0.2)', height * 0.07);
      ctx.fillStyle = '#B8D4E4';
      ctx.beginPath();
      ctx.ellipse(width * 0.22, height * 0.2, width * 0.06, height * 0.14, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#8895A0';
      ctx.lineWidth = Math.max(2, height * 0.008);
      ctx.stroke();
      fillRect(ctx, width * 0.14, horizon - height * 0.2, width * 0.16, height * 0.015, '#F4F6F8');
      fillRect(ctx, width * 0.16, horizon - height * 0.185, width * 0.12, height * 0.185, '#E3E8EC');
      fillRect(ctx, width * 0.22 - 1, horizon - height * 0.27, 2, height * 0.07, METAL);
      const tubX = width * 0.56;
      ctx.fillStyle = '#F4F6F8';
      roundedRect(ctx, tubX, horizon - height * 0.1, width * 0.34, height * 0.16, height * 0.04);
      ctx.fill();
      fillRect(ctx, tubX + width * 0.02, horizon - height * 0.06, width * 0.3, height * 0.05, '#BFDDF0');
      fillRect(ctx, tubX + width * 0.31, height * 0.06, width * 0.006, horizon - height * 0.16, METAL);
      fillRect(ctx, tubX + width * 0.26, height * 0.06, width * 0.05, height * 0.012, METAL);
    },
    bedroom(ctx, scene, width, height) {
      const horizon = room(ctx, width, height, '#DCCBB8', '#9C7B5B');
      art.drawWindow(ctx, scene, width * 0.1, height * 0.1, width * 0.18, height * 0.26);
      fillRect(ctx, width * 0.07, height * 0.08, width * 0.05, height * 0.3, '#B96A6A');
      fillRect(ctx, width * 0.26, height * 0.08, width * 0.05, height * 0.3, '#B96A6A');
      fillRect(ctx, width * 0.5, horizon - height * 0.24, width * 0.4, height * 0.24, '#7A5A3C');
      fillRect(ctx, width * 0.52, horizon - height * 0.1, width * 0.36, height * 0.1, '#E7E2D8');
      fillRect(ctx, width * 0.52, horizon - height * 0.06, width * 0.36, height * 0.06, '#7FA4CF');
      ctx.fillStyle = '#FFFFFF';
      roundedRect(ctx, width * 0.53, horizon - height * 0.13, width * 0.1, height * 0.04, height * 0.02);
      ctx.fill();
      fillRect(ctx, width * 0.4 - 1, horizon - height * 0.13, 2, height * 0.13, '#6B4A3A');
      ctx.save();
      ctx.globalAlpha *= 0.28;
      circle(ctx, width * 0.4, horizon - height * 0.15, height * 0.07, '#FFE9A8');
      ctx.restore();
      circle(ctx, width * 0.4, horizon - height * 0.15, height * 0.02, '#FFF3B0');
    },
    hospital(ctx, scene, width, height) {
      const horizon = room(ctx, width, height, '#E8F0EE', '#C9D9D2');
      fillRect(ctx, -width, horizon - height * 0.22, width * 3, height * 0.03, '#8FC4B0');
      fillRect(ctx, width * 0.1, height * 0.1, width * 0.08, height * 0.14, '#FFFFFF');
      fillRect(ctx, width * 0.13, height * 0.11, width * 0.02, height * 0.12, '#D6403A');
      fillRect(ctx, width * 0.11, height * 0.15, width * 0.06, height * 0.04, '#D6403A');
      fillRect(ctx, width * 0.55, horizon - height * 0.26, width * 0.3, height * 0.12, '#8FC4B0');
      fillRect(ctx, width * 0.55, horizon - height * 0.14, width * 0.3, height * 0.14, '#F4F6F8');
      fillRect(ctx, width * 0.55, horizon - height * 0.08, width * 0.3, height * 0.02, '#BFDDF0');
      fillRect(ctx, width * 0.4, horizon - height * 0.3, 2, height * 0.3, METAL);
      circle(ctx, width * 0.4, horizon - height * 0.3, height * 0.02, '#BFDDF0');
      art.drawWindow(ctx, scene, width * 0.3, height * 0.1, width * 0.14, height * 0.2);
    },
    classroom(ctx, scene, width, height) {
      const horizon = room(ctx, width, height, '#E4DCC0', '#B8946B');
      fillRect(ctx, width * 0.2, height * 0.08, width * 0.46, height * 0.22, WOOD);
      fillRect(ctx, width * 0.21, height * 0.09, width * 0.44, height * 0.2, '#2F4A3A');
      ctx.strokeStyle = '#F4F1E8';
      ctx.lineWidth = Math.max(1, height * 0.004);
      ctx.beginPath();
      for (const [dx, dy, length] of [[0.24, 0.14, 0.2], [0.24, 0.19, 0.28], [0.24, 0.24, 0.14]]) {
        ctx.moveTo(width * dx, height * dy);
        ctx.lineTo(width * (dx + length), height * dy);
      }
      ctx.stroke();
      art.drawWindow(ctx, scene, width * 0.74, height * 0.1, width * 0.16, height * 0.22);
      for (const [dx, dy] of [[0.1, 0.1], [0.4, 0.1], [0.7, 0.1], [0.2, 0.2], [0.55, 0.2]]) {
        fillRect(ctx, width * dx, horizon + height * dy, width * 0.14, height * 0.02, '#C9A06B');
        fillRect(ctx, width * dx + width * 0.01, horizon + height * dy + height * 0.02, width * 0.006, height * 0.07, '#8B6B4A');
        fillRect(ctx, width * (dx + 0.12), horizon + height * dy + height * 0.02, width * 0.006, height * 0.07, '#8B6B4A');
      }
    },
    shop(ctx, scene, width, height) {
      const horizon = room(ctx, width, height, '#D8B58A', '#7A5A3C');
      const goods = ['#C0504D', '#4F81BD', '#E8B84A', '#6AA84F', '#C084FC'];
      for (const row of [0.08, 0.2]) {
        fillRect(ctx, width * 0.04, height * (row + 0.1), width * 0.56, height * 0.012, WOOD);
        for (let index = 0; index < 12; index += 1) fillRect(ctx, width * (0.05 + index * 0.045), height * (row + 0.04), width * 0.03, height * 0.06, goods[(index + Math.round(row * 10)) % goods.length]);
      }
      fillRect(ctx, width * 0.62, horizon - height * 0.16, width * 0.32, height * 0.16, '#6B4A3A');
      fillRect(ctx, width * 0.62, horizon - height * 0.18, width * 0.32, height * 0.02, '#C9A06B');
      for (const dx of [0.2, 0.5, 0.78]) {
        fillRect(ctx, width * dx, 0, 1, height * 0.04, '#555555');
        ctx.save();
        ctx.globalAlpha *= 0.25;
        circle(ctx, width * dx, height * 0.06, height * 0.05, '#FFE9A8');
        ctx.restore();
        circle(ctx, width * dx, height * 0.05, height * 0.015, '#FFF3B0');
      }
    }
  };
  art.registerBackdrops(BACKDROPS);

  window.aiStoryboardProps = { PROP_GLYPHS: Object.keys(PAINTERS), EFFECT_GLYPHS: Object.keys(EFFECTS), BACKDROP_SETTINGS: Object.keys(BACKDROPS) };
})();
