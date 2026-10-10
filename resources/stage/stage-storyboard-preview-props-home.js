// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-props-home.js
// 说明：分镜动画的家居、家电、厨具与卫浴道具图形：柜、架、沙发、长椅、窗帘、地毯、吊灯、蜡烛、壁炉、立柱、黑板、水井、桥，冰箱、空调、洗衣机、微波炉、风扇、水壶、音响、相机、插座，灶台、油烟机、水槽、水龙头、锅、刀、砧板、碗盘、刀叉，马桶、浴缸、淋浴、毛巾。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：依赖 stage-storyboard-preview-draw.js 与 stage-storyboard-preview-art.js，通过 art.registerProps 登记（图形名称与归类关键词见 stage-storyboard-preview-rules.js 的 OBJECT_RULES）；每个图形登记绘制函数、高度和会说话时脸的位置（缺脸的位置时按高度估算）；只用画布路径与填充，颜色固定或取实体的识别色；道具以脚下中点为锚点，单位 u 为“画面高度的 1% × 纵深缩放”。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const { TAU, shade, pen, WOOD, METAL, DARK_METAL, GOLD } = window.aiStoryboardDraw;
  const { registerProps } = window.aiStoryboardArt;

  registerProps({
    cabinet: {
      height: 17,
      face: { cy: 11, r: 3.2 },
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.rect(-6, 0.8, 12, 15.2, shade(color, 0.85));
        g.rect(-5.4, 1.4, 5.2, 14, color);
        g.rect(0.2, 1.4, 5.2, 14, color);
        g.rect(-6.5, 15.8, 13, 1, shade(color, 0.65));
        g.rect(-5.6, 0, 1, 0.8, shade(color, 0.5));
        g.rect(4.6, 0, 1, 0.8, shade(color, 0.5));
        g.circ(-1, 8, 0.5, '#E8D28A');
        g.circ(1.4, 8, 0.5, '#E8D28A');
      }
    },
    shelf: {
      height: 18,
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.rect(-6, 0, 1, 18, shade(color, 0.7));
        g.rect(5, 0, 1, 18, shade(color, 0.7));
        for (const bottom of [0, 6, 12, 17]) g.rect(-6, bottom, 12, 1, shade(color, 0.85));
        const tones = ['#C0504D', '#4F81BD', '#E8B84A', '#6AA84F'];
        for (const row of [1, 7, 13]) for (let index = 0; index < 5; index += 1) g.rect(-5 + index * 2, row, 1.6, 4 + (index % 2), tones[(index + row) % 4]);
      }
    },
    sofa: {
      height: 10,
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.rrect(-9, 2, 18, 7, 1.6, shade(color, 0.8));
        g.rrect(-9, 0.8, 18, 4.4, 1, color);
        g.rrect(-10.4, 1.2, 3, 6.4, 1.2, shade(color, 0.9));
        g.rrect(7.4, 1.2, 3, 6.4, 1.2, shade(color, 0.9));
        g.rrect(-6.6, 4.6, 6, 2.4, 0.8, shade(color, 1.15));
        g.rrect(0.6, 4.6, 6, 2.4, 0.8, shade(color, 1.15));
        g.rect(-9, 0, 1, 0.8, '#4A3A2A');
        g.rect(8, 0, 1, 0.8, '#4A3A2A');
      }
    },
    bench: {
      height: 10,
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.rect(-7, 0, 1.2, 5, shade(color, 0.7));
        g.rect(5.8, 0, 1.2, 5, shade(color, 0.7));
        g.rect(-7, 5, 1, 5, shade(color, 0.7));
        g.rect(6, 5, 1, 5, shade(color, 0.7));
        g.rrect(-8, 5, 16, 1.4, 0.5, color);
        g.rect(-7.6, 7.4, 15.2, 1.1, color);
        g.rect(-7.6, 9.2, 15.2, 1.1, color);
      }
    },
    curtain: {
      height: 18,
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.rect(-9, 17.4, 18, 0.7, WOOD);
        g.poly([[-8, 17.4], [-0.6, 17.4], [-1.8, 0], [-8, 0]], color);
        g.poly([[0.6, 17.4], [8, 17.4], [8, 0], [1.8, 0]], color);
        for (const dx of [-6, -4, -2.4, 2.8, 4.8, 6.6]) g.line(dx, 17, dx * 0.9, 0.4, shade(color, 0.75), 0.4);
      }
    },
    carpet: {
      height: 2.6,
      face: { cy: 1.4, r: 1.3 },
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.oval(0, 0.9, 10, 1.7, color);
        g.oval(0, 0.9, 7.4, 1.1, shade(color, 1.25));
        g.oval(0, 0.9, 4, 0.55, shade(color, 0.8));
      }
    },
    chandelier: {
      height: 26,
      face: { cy: 14, r: 2.6 },
      paint(ctx, x, y, u, color) {
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
      }
    },
    candle: {
      height: 10.4,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rect(-1.4, 0.8, 2.8, 6, '#F5EBD0');
        g.rect(-2.6, 0, 5.2, 0.8, '#B58B4A');
        g.rect(-0.15, 6.8, 0.3, 0.9, '#333333');
        g.alpha(0.3);
        g.circ(0, 8.8, 3, '#FFE9A8');
        g.alpha(1);
        g.oval(0, 8.9, 0.95, 1.5, '#FFC83D');
        g.oval(0, 8.6, 0.45, 0.8, '#FFF3B0');
      }
    },
    fireplace: {
      height: 16,
      face: { cy: 4, r: 3 },
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rect(-7, 0, 14, 14, '#8E5A44');
        for (const row of [3, 6.4, 9.8]) g.rect(-7, row, 14, 0.3, '#6B3F2E');
        g.rect(-8, 14, 16, 1.6, '#6B4A3A');
        g.rect(-4, 0, 8, 7.4, '#2A1A16');
        g.oval(0, 7.4, 4, 1.6, '#2A1A16');
        g.poly([[-2.6, 0.4], [-1.6, 4.4], [-0.4, 2], [0.6, 5.4], [1.6, 2.2], [2.8, 0.4]], '#F76B15');
        g.poly([[-1.2, 0.4], [-0.4, 2.8], [0.4, 1.4], [1.2, 0.4]], '#FFD60A');
      }
    },
    pillar: {
      height: 19,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rect(-2.4, 2, 4.8, 15, '#D9D4C7');
        for (const dx of [-1.2, 0, 1.2]) g.line(dx, 2.2, dx, 16.8, '#BFB8A8', 0.3);
        g.rect(-3.5, 0, 7, 2, '#BFB8A8');
        g.rect(-3.5, 17, 7, 2, '#BFB8A8');
      }
    },
    blackboard: {
      height: 15.8,
      paint(ctx, x, y, u) {
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
      }
    },
    well: {
      height: 18.6,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rect(-5, 0, 10, 6, '#8A8F98');
        for (const row of [2, 4]) g.rect(-5, row, 10, 0.3, '#6B7078');
        g.rect(-5, 6, 1, 8, WOOD);
        g.rect(4, 6, 1, 8, WOOD);
        g.poly([[-7, 14], [0, 18.6], [7, 14]], '#A0522D');
        g.line(0, 14, 0, 9.6, '#6B4A3A', 0.4);
        g.rect(-1.2, 7.6, 2.4, 2, '#6B4A3A');
      }
    },
    bridge: {
      height: 7.4,
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.rect(-9, 0, 3, 3.4, '#8A7F70');
        g.rect(6, 0, 3, 3.4, '#8A7F70');
        g.rect(-9.4, 3.4, 18.8, 1.6, '#9B8F7E');
        g.rect(-9.4, 5.8, 18.8, 0.6, color);
        for (const dx of [-9, -4.5, 0, 4.5, 8.6]) g.rect(dx, 5, 0.8, 2.4, shade(color, 0.8));
      }
    },
    fridge: {
      height: 19,
      face: { cy: 14, r: 3 },
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rrect(-5, 0.6, 10, 18.4, 1.2, '#E9EEF2');
        g.rect(-5, 12.4, 10, 0.4, '#B8C2CC');
        g.rect(3, 13.6, 0.8, 3.4, '#8895A0');
        g.rect(3, 8, 0.8, 3, '#8895A0');
        g.rect(-3.8, 0, 1.2, 0.6, '#555555');
        g.rect(2.6, 0, 1.2, 0.6, '#555555');
        g.rect(-3, 15, 1.6, 1.2, '#E5484D');
      }
    },
    aircon: {
      height: 19,
      face: { cy: 13, r: 2.8 },
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rrect(-4.6, 0, 9.2, 19, 1.2, '#F2F5F8');
        for (let row = 0; row < 4; row += 1) g.rect(-3.6, 11 + row * 1.2, 7.2, 0.4, '#C7CED6');
        g.rect(-1.6, 16.4, 3.2, 1.2, DARK_METAL);
        g.circ(1, 17, 0.25, '#7CF0A0');
        for (let row = 0; row < 3; row += 1) g.rect(-3.4, 2 + row * 1.6, 6.8, 0.4, '#C7CED6');
      }
    },
    washer: {
      height: 12.4,
      face: { cy: 5, r: 3 },
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rrect(-5.4, 0, 10.8, 12.4, 0.8, '#EDF1F4');
        g.rect(-5.4, 10.2, 10.8, 2.2, '#D4DBE2');
        g.circ(-3.6, 11.3, 0.6, '#8895A0');
        g.rect(1.4, 10.9, 3, 0.8, '#7BC4F5');
        g.circ(0, 5, 3.6, '#B0BAC4');
        g.circ(0, 5, 2.9, '#6FA8DC');
        g.circ(-0.9, 5.9, 0.8, 'rgba(255, 255, 255, 0.5)');
      }
    },
    microwave: {
      height: 7.4,
      face: { cy: 3.8, r: 2.2 },
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rrect(-6.4, 0, 12.8, 7.4, 0.8, '#D9DEE3');
        g.rect(-5.4, 1, 7.8, 5.4, DARK_METAL);
        g.rect(-4.8, 1.6, 6.6, 4.2, '#4A505A');
        g.rect(3.2, 1, 2.4, 5.4, '#B0BAC4');
        g.circ(4.4, 5, 0.5, '#FFD60A');
        g.circ(4.4, 3.4, 0.5, '#FFFFFF');
        g.circ(4.4, 2, 0.5, '#FFFFFF');
      }
    },
    fan: {
      height: 18.6,
      paint(ctx, x, y, u) {
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
      }
    },
    kettle: {
      height: 8,
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.oval(0, 3.2, 3.8, 3.2, color);
        g.rect(-1.5, 6.2, 3, 0.8, shade(color, 0.7));
        g.circ(0, 7.4, 0.6, shade(color, 0.6));
        g.poly([[3, 2.6], [5.8, 5.4], [5, 6], [2.6, 4]], color);
        g.arc(-3.6, 3.6, 2.2, Math.PI * 0.6, Math.PI * 1.6, shade(color, 0.6), 0.7);
      }
    },
    speaker: {
      height: 10,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rrect(-3.6, 0, 7.2, 10, 0.8, '#2B2F36');
        g.circ(0, 3.2, 2.3, '#4A505A');
        g.circ(0, 3.2, 1, '#2B2F36');
        g.circ(0, 7.6, 1.4, '#4A505A');
        g.circ(0, 7.6, 0.5, '#2B2F36');
      }
    },
    camera: {
      height: 7.4,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rrect(-4.4, 1, 8.8, 5.4, 0.8, '#2B2F36');
        g.rect(-3.2, 6.4, 3, 1, '#2B2F36');
        g.circ(0, 3.8, 2.4, '#4A505A');
        g.circ(0, 3.8, 1.4, '#7BC4F5');
        g.circ(-0.5, 4.3, 0.4, 'rgba(255, 255, 255, 0.7)');
        g.circ(3.2, 5.2, 0.5, '#E5484D');
        g.rect(-1.4, 0, 2.8, 1, '#555555');
      }
    },
    socket: {
      height: 4.8,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rrect(-2.4, 0, 4.8, 4.8, 0.6, '#F4F1E8');
        g.rect(-1.2, 2, 0.5, 1.2, '#444444');
        g.rect(0.7, 2, 0.5, 1.2, '#444444');
        g.circ(0, 1, 0.3, '#444444');
      }
    },
    stove: {
      height: 11,
      paint(ctx, x, y, u) {
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
      }
    },
    hood: {
      height: 25.6,
      face: { cy: 17.4, r: 2.6 },
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rect(-1.6, 21, 3.2, 4.6, METAL);
        g.poly([[-6, 15], [6, 15], [2.4, 21], [-2.4, 21]], '#C9CED4');
        g.rect(-6.4, 14.1, 12.8, 0.9, '#8A929B');
        g.circ(-3.2, 14, 0.5, '#FFF3B0');
        g.circ(3.2, 14, 0.5, '#FFF3B0');
        g.rect(-2, 16.4, 4, 0.4, '#8A929B');
        g.rect(-2, 18, 4, 0.4, '#8A929B');
      }
    },
    sink: {
      height: 14,
      face: { cy: 4, r: 3 },
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.rect(-7, 0, 14, 8, shade(color, 0.9));
        g.rect(-0.1, 0.8, 0.2, 6.4, shade(color, 0.6));
        g.rect(-7.6, 8, 15.2, 1, '#D8D8D8');
        g.rect(-4, 8.8, 8, 0.5, '#9FB2C4');
        g.line(-2.4, 9, -2.4, 12, METAL, 0.7);
        g.line(-2.4, 12, -0.4, 12, METAL, 0.7);
        g.circ(-0.4, 11, 0.35, '#7BC4F5');
      }
    },
    faucet: {
      height: 9,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rect(-0.7, 0, 1.4, 6, METAL);
        g.line(0, 6, 0, 8.4, METAL, 1.2);
        g.line(0, 8.4, 3.4, 8.4, METAL, 1.2);
        g.line(3.4, 8.4, 3.4, 7, METAL, 1.2);
        g.rect(-2.4, 5.4, 1.6, 0.9, '#E5484D');
        g.oval(3.4, 5.4, 0.5, 0.8, '#7BC4F5');
        g.oval(3.4, 3.2, 0.4, 0.6, '#7BC4F5');
      }
    },
    pan: {
      height: 4,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.oval(0, 1.6, 5, 1.4, '#3A3F47');
        g.oval(0, 2, 4.2, 1, '#23262C');
        g.line(5, 2, 11, 3.2, '#6B4A3A', 1.3);
      }
    },
    knife: {
      height: 7.4,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.poly([[-6, 1.4], [3, 1.4], [3, 7.4], [-6, 6]], '#C9D1DB');
        g.rect(-6, 1.4, 9, 0.5, '#8A929B');
        g.rrect(3, 2.8, 4.4, 2.4, 1, '#6B4A3A');
        g.circ(-4.6, 5, 0.5, '#8A929B');
      }
    },
    board: {
      height: 3.6,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rrect(-6, 0, 12, 2, 0.8, '#C9A06B');
        g.rect(-6, 1.4, 12, 0.5, '#B38A56');
        g.poly([[-3, 2], [2.4, 2.4], [-3, 3.6]], '#F28C28');
        g.poly([[-3, 2.8], [-4.6, 3.8], [-3.6, 2.2]], '#6AA84F');
      }
    },
    bowl: {
      height: 6.6,
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(x, y - 3.4 * u, 4.8 * u, 3.2 * u, 0, 0, Math.PI);
        ctx.fill();
        g.oval(0, 3.4, 4.8, 1, shade(color, 1.25));
        g.oval(0, 3.4, 3.8, 0.6, '#D9A55B');
        g.rect(-1.8, 0, 3.6, 0.7, shade(color, 0.7));
      }
    },
    plate: {
      height: 2.6,
      face: { cy: 1.4, r: 1.3 },
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.oval(0, 1, 6, 1.2, '#F4F1E8');
        g.oval(0, 1.1, 4, 0.7, '#E3DED0');
        g.oval(0, 1.6, 2, 0.6, color);
      }
    },
    cutlery: {
      height: 9.8,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.oval(-3, 8, 1.2, 1.8, '#C9D1DB');
        g.rect(-3.2, 0, 0.5, 6.6, '#C9D1DB');
        g.rect(-0.2, 0, 0.5, 6.4, '#C9D1DB');
        for (const dx of [-0.9, 0.5, 1.9]) g.rect(dx - 0.2, 6.4, 0.4, 2.6, '#C9D1DB');
        g.rect(-0.9, 6.4, 2.8, 0.5, '#C9D1DB');
        g.poly([[3.4, 0], [4.2, 0], [4.2, 9], [3.4, 9], [3, 5]], '#C9D1DB');
      }
    },
    toilet: {
      height: 12,
      face: { cy: 8.4, r: 2.6 },
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rrect(-4, 6, 6, 5.6, 0.8, '#F4F6F8');
        g.circ(-1, 11.8, 0.5, '#8895A0');
        g.rect(-1.6, 0, 5, 2.4, '#E3E8EC');
        g.oval(1.8, 4.2, 4.6, 2.2, '#F4F6F8');
        g.oval(1.8, 5.4, 4.2, 0.9, '#DDE3E8');
        g.oval(1.8, 5.4, 3, 0.6, '#BFDDF0');
      }
    },
    bathtub: {
      height: 11,
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rect(-7.6, 0, 1.4, 2.6, GOLD);
        g.rect(6.2, 0, 1.4, 2.6, GOLD);
        g.rrect(-9, 2.4, 18, 5.6, 2, '#F4F6F8');
        g.rrect(-8, 5.8, 16, 2.2, 1, '#BFDDF0');
        g.rect(-8.6, 8, 0.8, 3, METAL);
        g.circ(-2, 8.6, 0.9, 'rgba(255, 255, 255, 0.8)');
        g.circ(1.4, 8.9, 0.6, 'rgba(255, 255, 255, 0.8)');
        g.circ(3.4, 8.4, 1, 'rgba(255, 255, 255, 0.8)');
      }
    },
    shower: {
      height: 22,
      face: { cy: 14, r: 2 },
      paint(ctx, x, y, u) {
        const g = pen(ctx, x, y, u);
        g.rect(-0.3, 0, 0.6, 19, METAL);
        g.line(0, 19, 3, 19, METAL, 0.6);
        g.poly([[2, 19.4], [5.6, 19.4], [4.6, 17.8], [3, 17.8]], METAL);
        for (const dx of [3, 3.8, 4.6]) g.line(dx, 17.4, dx - 0.4, 9, 'rgba(123, 196, 245, 0.75)', 0.3);
        g.circ(0, 9, 0.7, '#E5484D');
      }
    },
    towel: {
      height: 11,
      paint(ctx, x, y, u, color) {
        const g = pen(ctx, x, y, u);
        g.rect(-5, 10, 10, 0.6, METAL);
        g.rect(-3.4, 2, 6.8, 8.4, color);
        g.rect(-3.4, 4, 6.8, 0.8, '#FFFFFF');
        g.rect(-3.4, 2, 6.8, 0.6, shade(color, 0.75));
      }
    }
  });
})();
