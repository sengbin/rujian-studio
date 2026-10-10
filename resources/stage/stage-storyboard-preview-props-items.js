// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-props-items.js
// 说明：分镜动画的武器与杂物道具图形：炸弹、火箭、大炮、弓箭、盾、工具、绳、食物、蛋糕、骨头、行李箱、衣服、药、瓶、眼镜、望远镜、奖杯、灯笼、手电筒、篝火。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：依赖 stage-storyboard-preview-draw.js 与 stage-storyboard-preview-art.js，通过 art.registerProps 登记（图形名称与归类关键词见 stage-storyboard-preview-rules.js 的 OBJECT_RULES）；每个图形登记绘制函数、高度和会说话时脸的位置（缺脸的位置时按高度估算）；只用画布路径与填充，颜色固定或取实体的识别色；道具以脚下中点为锚点，单位 u 为“画面高度的 1% × 纵深缩放”。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const { TAU, shade, star, rotated, pen, WOOD, METAL, DARK_METAL, GOLD } = window.aiStoryboardDraw;
  const { registerProps } = window.aiStoryboardArt;

  registerProps({
    bomb: {
      height: 12.6,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.circ(0, 4.6, 4.4, '#2A2E36');
        g.circ(-1.6, 6, 1.2, '#4A505A');
        g.rect(-1, 8.8, 2, 1.2, '#444444');
        g.line(0, 10, 1.6, 11.6, '#C9A06B', 0.5);
        star(ctx, x + 1.9 * u, y - 12 * u, 1.3 * u, 1.3 * u * 0.4, 4, '#FFD60A');
      }
    },
    rocket: {
      height: 21,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.poly([[-1.4, 2], [0, -0.2], [1.4, 2]], '#F76B15');
        g.oval(0, 9.6, 2.8, 7.6, '#EDEFF2');
        g.poly([[-2.8, 15], [0, 21], [2.8, 15]], '#E5484D');
        g.circ(0, 11.4, 1.4, '#7BC4F5');
        g.poly([[-2.6, 5], [-5.4, 2], [-2.8, 8.4]], '#E5484D');
        g.poly([[2.6, 5], [5.4, 2], [2.8, 8.4]], '#E5484D');
      }
    },
    cannon: {
      height: 10,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.poly([[-3, 3.6], [8, 6.4], [7.2, 8.8], [-3.8, 6]], '#3A3F47');
        g.circ(8, 7.6, 1.5, '#23262C');
        g.circ(-1, 3, 3, '#6B4A3A');
        g.circ(-1, 3, 0.8, '#3A2A1F');
        for (let index = 0; index < 4; index += 1) {
          const angle = (index * Math.PI) / 4;
          g.line(-1 - Math.cos(angle) * 2.8, 3 - Math.sin(angle) * 2.8, -1 + Math.cos(angle) * 2.8, 3 + Math.sin(angle) * 2.8, '#3A2A1F', 0.3);
        }
      }
    },
    bow: {
      height: 16,
      paint(ctx, x, y, u) {
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
      }
    },
    arrow: {
      height: 14,
      paint(ctx, x, y, u) {
        rotated(ctx, x, y - 8 * u, -0.9, () => {
          const g = pen(ctx, 0, 0, u);
          g.line(-7, 0, 6, 0, '#C9A06B', 0.7);
          g.poly([[6, 1.3], [9, 0], [6, -1.3]], '#C9D1DB');
          g.poly([[-7, 0], [-8.6, 1.6], [-5.4, 1.6]], '#E5484D');
          g.poly([[-7, 0], [-8.6, -1.6], [-5.4, -1.6]], '#E5484D');
        });
      }
    },
    shield: {
      height: 15,
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.poly([[-5.4, 15], [5.4, 15], [5.4, 8], [3, 3.6], [0, 0.6], [-3, 3.6], [-5.4, 8]], '#8A8F98');
        g.poly([[-4.4, 14], [4.4, 14], [4.4, 8.2], [2.4, 4.4], [0, 1.8], [-2.4, 4.4], [-4.4, 8.2]], color);
        g.rect(-0.5, 4, 1, 9, '#F4F1E8');
        g.rect(-3, 9, 6, 1, '#F4F1E8');
      }
    },
    tool: {
      height: 13.6,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rect(-0.7, 0, 1.4, 11, WOOD);
        g.rect(-4, 10.4, 8, 3.2, '#6B7580');
        g.poly([[4, 10.8], [6.4, 12.4], [4, 13.4]], '#6B7580');
        g.rect(-4, 10.4, 8, 0.6, '#8895A0');
      }
    },
    rope: {
      height: 4.4,
      paint(ctx, x, y, u) {
        for (const [ry, shiftY, rx] of [[1.2, 1, 4.6], [1, 2.2, 3.6], [0.8, 3.2, 2.6]]) {
          ctx.strokeStyle = '#C9A06B';
          ctx.lineWidth = 1 * u;
          ctx.beginPath();
          ctx.ellipse(x, y - shiftY * u, rx * u, ry * u, 0, 0, TAU);
          ctx.stroke();
        }
      }
    },
    food: {
      height: 5.4,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.oval(-2.6, 2.4, 4.6, 2.4, '#D9A55B');
        for (const dx of [-4.4, -2.6, -0.8]) g.line(dx, 3.8, dx + 0.6, 2.4, '#B77F3A', 0.3);
        g.circ(4.4, 2.6, 2.6, '#D6403A');
        g.oval(5, 5.4, 1.2, 0.5, '#6AA84F', -0.5);
      }
    },
    cake: {
      height: 11,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rect(-6, 0, 12, 3.4, '#F4C7D0');
        g.rect(-4.4, 3.4, 8.8, 2.8, '#FCE9EE');
        g.oval(0, 6.2, 4.4, 0.8, '#FFFFFF');
        g.circ(0, 7.2, 1, '#D6403A');
        g.rect(-0.3, 7.6, 0.6, 2, '#4F81BD');
        g.oval(0, 10.4, 0.5, 0.9, '#FFC83D');
      }
    },
    bone: {
      height: 3.6,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.line(-4.6, 1.8, 4.6, 1.8, '#F4EFE0', 1.8);
        for (const [dx, dy] of [[-5.6, 2.8], [-5.6, 0.8], [5.6, 2.8], [5.6, 0.8]]) g.circ(dx, dy, 1.1, '#F4EFE0');
      }
    },
    suitcase: {
      height: 12.4,
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.rrect(-7, 1.2, 14, 9.6, 1.2, color);
        g.rect(-7, 5.6, 14, 0.6, shade(color, 0.7));
        g.rect(-3, 6.6, 1.6, 1.2, GOLD);
        g.rect(1.4, 6.6, 1.6, 1.2, GOLD);
        g.arc(0, 10.8, 2.6, Math.PI, 0, shade(color, 0.6), 0.7);
        g.circ(-5, 0.6, 0.8, DARK_METAL);
        g.circ(5, 0.6, 0.8, DARK_METAL);
      }
    },
    clothes: {
      height: 10,
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.rect(-3.4, 0, 6.8, 9, color);
        g.poly([[-3.4, 9], [-6.8, 6.8], [-5.6, 4.6], [-3.4, 6]], shade(color, 0.9));
        g.poly([[3.4, 9], [6.8, 6.8], [5.6, 4.6], [3.4, 6]], shade(color, 0.9));
        g.oval(0, 9, 1.5, 0.9, shade(color, 0.65));
      }
    },
    medicine: {
      height: 7.8,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rrect(-2.6, 0, 5.2, 6.4, 0.8, '#E8A33A');
        g.rect(-2.2, 6.4, 4.4, 1.4, '#FFFFFF');
        g.rect(-2.6, 2, 5.2, 2.6, '#F4F1E8');
        g.rect(-0.3, 2.3, 0.6, 2, '#D6403A');
        g.rect(-1, 3, 2, 0.6, '#D6403A');
      }
    },
    bottle: {
      height: 10.3,
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.rrect(-2.2, 0, 4.4, 6.6, 1.2, color);
        g.rect(-1, 6.6, 2, 2.8, color);
        g.rect(-1.2, 9.4, 2.4, 0.9, WOOD);
        g.rect(-2.2, 2.4, 4.4, 2.4, '#F4F1E8');
        g.rect(-1.6, 0.8, 0.5, 4.8, 'rgba(255, 255, 255, 0.35)');
      }
    },
    glasses: {
      height: 4,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        for (const dx of [-3, 3]) {
          g.circ(dx, 1.8, 2, 'rgba(200, 225, 245, 0.5)');
          g.arc(dx, 1.8, 2, 0, TAU, '#2A2E36', 0.4);
        }
        g.line(-1, 2.2, 1, 2.2, '#2A2E36', 0.4);
        g.line(-5, 2.2, -6.6, 1.2, '#2A2E36', 0.4);
        g.line(5, 2.2, 6.6, 1.2, '#2A2E36', 0.4);
      }
    },
    telescope: {
      height: 14,
      paint(ctx, x, y, u) {
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
      }
    },
    trophy: {
      height: 11.4,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.poly([[-3.6, 11.4], [3.6, 11.4], [2.6, 5.6], [-2.6, 5.6]], GOLD);
        g.arc(-3.6, 8.8, 1.8, Math.PI * 0.5, Math.PI * 1.5, GOLD, 0.6);
        g.arc(3.6, 8.8, 1.8, -Math.PI * 0.5, Math.PI * 0.5, GOLD, 0.6);
        g.rect(-0.7, 2.4, 1.4, 3.4, GOLD);
        g.rect(-3, 0, 6, 2.4, WOOD);
        g.rect(-1.6, 7.4, 0.6, 3, 'rgba(255, 255, 255, 0.5)');
      }
    },
    lantern: {
      height: 12.4,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.line(0, 9.8, 0, 12.4, '#555555', 0.4);
        g.oval(0, 5.2, 3.6, 4.2, '#D6403A');
        g.arc(0, 5.2, 2, -Math.PI * 0.5, Math.PI * 0.5, '#A82B2B', 0.3);
        g.arc(0, 5.2, 2, Math.PI * 0.5, Math.PI * 1.5, '#A82B2B', 0.3);
        g.rect(-1.8, 9.2, 3.6, 0.8, GOLD);
        g.rect(-1.8, 0.4, 3.6, 0.8, GOLD);
        g.line(0, 0.4, 0, -0.6, GOLD, 0.4);
      }
    },
    flashlight: {
      height: 17,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.alpha(0.22);
        g.poly([[-2, 9.8], [2, 9.8], [5.6, 17], [-5.6, 17]], '#FFF3B0');
        g.alpha(1);
        g.rect(-1.4, 0, 2.8, 7, '#444444');
        g.rect(-2.4, 7, 4.8, 2.4, METAL);
        g.oval(0, 9.4, 2, 0.5, '#FFF3B0');
        g.rect(-0.4, 3.4, 0.8, 1.2, '#E5484D');
      }
    },
    campfire: {
      height: 9,
      paint(ctx, x, y, u) {
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
    }
  });
})();
