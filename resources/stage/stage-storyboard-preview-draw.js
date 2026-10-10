// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-draw.js
// 说明：分镜动画矢量插画共用的基础绘制：颜色明暗、渐变、伪随机、圆角矩形、圆、椭圆、多边形、线段、多角星、圆形头像、箭头、以脚下中点为原点的作图工具，以及背景共用的地面、室内底、草丛与星空。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：只用 Canvas 2D 的路径与填充，不依赖页面与其他预览脚本，必须最先加载；通过 window.aiStoryboardDraw 暴露，供 art、props、creatures、bestiary、renderer、modes 共用；尺寸单位 u 为“画面高度的 1% × 纵深缩放”；绘制时 ctx.globalAlpha 都基于进入时的透明度叠乘并恢复。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const TAU = Math.PI * 2;
  /** 地平线在画面高度中的位置。 */
  const HORIZON = 0.5;
  /** 角色与道具脚下的影子颜色。 */
  const SHADOW = 'rgba(0, 0, 0, 0.28)';
  /** 角色五官与瞳孔的深色。 */
  const DARK = '#1A1A1A';
  /** 行走摆动与说话张嘴的角速度（弧度/秒）。 */
  const WALK_SPEED = 9;
  const MOUTH_SPEED = 14;
  /** 道具常用色：木头、金属、深色金属、金色。 */
  const WOOD = '#8B6B4A';
  const METAL = '#B8BEC6';
  const DARK_METAL = '#2A2E36';
  const GOLD = '#E8B84A';
  /** 背景横向铺开的范围：从画面宽度的 -0.25 倍起，跨 1.5 倍宽，运镜平移时不会露边。 */
  const SPREAD_LEFT = -0.25;
  const SPREAD_SPAN = 1.5;

  /** 颜色按系数变暗（小于 1）或变亮（大于 1，向白色混合）。 */
  function shade(hex, factor) {
    const value = Number.parseInt(hex.slice(1), 16);
    const channel = (shift) => {
      const base = (value >> shift) & 255;
      const out = factor <= 1 ? base * factor : base + (255 - base) * (factor - 1);
      return Math.round(Math.min(255, Math.max(0, out)));
    };
    return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
  }

  /** 线性渐变；上下文不支持渐变时退回第一个颜色。 */
  function linear(ctx, x0, y0, x1, y1, stops) {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    if (!gradient || typeof gradient.addColorStop !== 'function') return stops[0][1];
    for (const [at, color] of stops) gradient.addColorStop(at, color);
    return gradient;
  }

  /** 由种子和序号得到 0 到 1 之间的稳定伪随机数，同一场景每次画出来都一样。 */
  function rand(seed, index) {
    const value = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  /** 圆角矩形路径（只建路径，不填充）。 */
  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  /** 填充一个圆。 */
  function circle(ctx, x, y, radius, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }

  /** 填充一个椭圆，rotation 为旋转弧度。 */
  function ellipse(ctx, x, y, rx, ry, fill, rotation) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rotation || 0, 0, TAU);
    ctx.fill();
  }

  /** 填充一个多边形，points 为 [x, y] 数组。 */
  function polygon(ctx, points, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    points.forEach(([px, py], index) => (index === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fill();
  }

  /** 画一条圆头线段。 */
  function line(ctx, x0, y0, x1, y1, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  /**
   * 填充多角星。
   * @param {number} outer 尖角的半径。
   * @param {number} inner 凹角的半径。
   * @param {number} points 尖角数。
   * @param {number} [rotation] 整体旋转的弧度，缺省为 0（第一个尖角朝上）。
   */
  function star(ctx, cx, cy, outer, inner, points, fill, rotation) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let index = 0; index < points * 2; index += 1) {
      const angle = (Math.PI * index) / points - Math.PI / 2 + (rotation || 0);
      const length = index % 2 === 0 ? outer : inner;
      if (index === 0) ctx.moveTo(cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
      else ctx.lineTo(cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
    }
    ctx.closePath();
    ctx.fill();
  }

  /** 填充箭头的三角形：尖端在 (tipX, tipY)，angle 为前进方向，size 为箭头长度。 */
  function arrowHead(ctx, tipX, tipY, angle, size) {
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(angle - 0.45) * size, tipY - Math.sin(angle - 0.45) * size);
    ctx.lineTo(tipX - Math.cos(angle + 0.45) * size, tipY - Math.sin(angle + 0.45) * size);
    ctx.closePath();
    ctx.fill();
  }

  /** 绕 (cx, cy) 旋转 angle 弧度后执行绘制。 */
  function rotated(ctx, cx, cy, angle, draw) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    draw();
    ctx.restore();
  }

  /**
   * 把图片按“填满”方式画进矩形（居中裁剪，不变形）。
   * @param {{ element: CanvasImageSource, width: number, height: number }} image 已加载的图片。
   * @param {number} focusY 纵向裁剪的重心，0 为顶部、1 为底部；头像取偏上以保留脸部。
   */
  function drawCover(ctx, image, x, y, width, height, focusY) {
    const scale = Math.max(width / image.width, height / image.height);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sourceX = (image.width - sourceWidth) / 2;
    const sourceY = (image.height - sourceHeight) * (focusY === undefined ? 0.5 : focusY);
    ctx.drawImage(image.element, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
  }

  /** 圆形头像：把资产图按填满方式裁成圆，加白色描边。 */
  function drawAvatar(ctx, image, x, y, radius, lineWidth) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.clip();
    drawCover(ctx, image, x - radius, y - radius, radius * 2, radius * 2, 0.25);
    ctx.restore();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.stroke();
  }

  /**
   * 以脚下中点 (x, y) 为原点、向上为正的作图工具：位置与尺寸都以 u 为单位。
   * alpha() 在进入时的透明度基础上叠乘，调用方的叠化、淡出不会被覆盖。
   */
  function pen(ctx, x, y, u) {
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
        ellipse(ctx, x + cx * u, y - cy * u, rx * u, ry * u, fill, rotation);
      },
      circ(cx, cy, radius, fill) {
        circle(ctx, x + cx * u, y - cy * u, radius * u, fill);
      },
      poly(points, fill) {
        polygon(ctx, points.map(([px, py]) => [x + px * u, y - py * u]), fill);
      },
      line(x0, y0, x1, y1, color, width) {
        line(ctx, x + x0 * u, y - y0 * u, x + x1 * u, y - y1 * u, color, width * u);
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

  /** 地面：从 top 往下的渐变。 */
  function drawGround(ctx, width, height, top, near, far) {
    ctx.fillStyle = linear(ctx, 0, top, 0, height * 1.2, [[0, near], [1, far]]);
    ctx.fillRect(-width, top, width * 3, height * 1.5);
  }

  /**
   * 室内背景的底：墙面渐变、踢脚线与地面。
   * @param {number} wallTop 墙面顶部相对墙色的明暗系数。
   * @param {number} baseboard 踢脚线相对墙色的明暗系数。
   * @returns {number} 地平线的位置。
   */
  function drawRoom(ctx, width, height, wall, floor, wallTop, baseboard) {
    const horizon = height * HORIZON;
    ctx.fillStyle = linear(ctx, 0, 0, 0, horizon, [[0, shade(wall, wallTop)], [1, wall]]);
    ctx.fillRect(-width, -height, width * 3, horizon + height);
    ctx.fillStyle = shade(wall, baseboard);
    ctx.fillRect(-width, horizon - height * 0.018, width * 3, height * 0.018);
    drawGround(ctx, width, height, horizon, floor, shade(floor, 0.75));
    return horizon;
  }

  /**
   * 地面上的草丛：每丛是两道向上分开的短线。
   * @param {{ stroke: string, count: number, top: number, range: number, spread: number, rise: number }} spec 线条颜色、丛数、最靠上的位置与纵向范围（占画面高度）、两道线分开的距离与高度（占画面高度）。
   */
  function drawTufts(ctx, scene, width, height, spec) {
    ctx.strokeStyle = spec.stroke;
    ctx.lineWidth = 1.5;
    for (let index = 0; index < spec.count; index += 1) {
      const x = SPREAD_LEFT * width + rand(scene.seed, index + 400) * SPREAD_SPAN * width;
      const y = height * (spec.top + spec.range * rand(scene.seed, index + 500));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - height * spec.spread, y - height * spec.rise);
      ctx.moveTo(x, y);
      ctx.lineTo(x + height * spec.spread, y - height * spec.rise);
      ctx.stroke();
    }
  }

  /**
   * 星空：随机分布的白点，亮度各不相同。
   * @param {{ count: number, yRange: number, size: number, sizeRange: number }} spec 星数、纵向范围（像素）、半径（占画面高度）与随机增量。
   */
  function drawStars(ctx, scene, width, height, spec) {
    const base = ctx.globalAlpha;
    for (let index = 0; index < spec.count; index += 1) {
      ctx.globalAlpha = base * (0.4 + 0.6 * rand(scene.seed, index + 200));
      circle(ctx, SPREAD_LEFT * width + rand(scene.seed, index) * SPREAD_SPAN * width, rand(scene.seed, index + 100) * spec.yRange, height * (spec.size + spec.sizeRange * rand(scene.seed, index + 300)), '#FFFFFF');
    }
    ctx.globalAlpha = base;
  }

  window.aiStoryboardDraw = {
    TAU,
    HORIZON,
    SHADOW,
    DARK,
    WALK_SPEED,
    MOUTH_SPEED,
    WOOD,
    METAL,
    DARK_METAL,
    GOLD,
    SPREAD_LEFT,
    SPREAD_SPAN,
    shade,
    linear,
    rand,
    roundedRect,
    circle,
    ellipse,
    polygon,
    line,
    star,
    arrowHead,
    rotated,
    drawCover,
    drawAvatar,
    pen,
    drawGround,
    drawRoom,
    drawTufts,
    drawStars
  };
})();
