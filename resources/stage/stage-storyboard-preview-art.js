// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-art.js
// 说明：分镜动画的矢量插画：按场景类型与时间画背景（室内、街道、森林、洞穴、海边、旷野），画角色小人（可换成资产缩略图头像）、各类道具与特效的图形，以及按“填满”方式绘制图片。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：只用 Canvas 2D 的路径与填充，不依赖页面和图片文件，没有资产图时就用这里的矢量图形；尺寸单位 u 为“画面高度的 1% × 纵深缩放”；颜色固定，不随主题变化；通过 window.aiStoryboardArt 暴露，由 stage-storyboard-preview-renderer.js 调用。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const TAU = Math.PI * 2;
  const HORIZON = 0.5;
  const SKIN = '#F1C9A5';
  const HAIR = '#2B2623';
  const SHADOW = 'rgba(0, 0, 0, 0.28)';
  const WALK_SPEED = 9;
  const MOUTH_SPEED = 14;

  /** 角色图形从脚到头顶的高度（单位 u），用来摆放名字与气泡。 */
  const FIGURE_HEIGHT = 29;

  /** 天空渐变（上、下）与时间色调叠加。 */
  const SKY = { day: ['#6FB1E8', '#CFE8F7'], dusk: ['#4C3F7A', '#F4A261'], dawn: ['#7C93C9', '#F8D7B0'], night: ['#0A1030', '#27346A'] };
  const TIME_TINT = { day: '', dusk: 'rgba(255, 120, 40, 0.14)', dawn: 'rgba(255, 190, 140, 0.12)', night: 'rgba(8, 12, 40, 0.38)' };
  /** 远景建筑与树木的明暗系数。 */
  const FAR_LIGHT = { day: 0.85, dawn: 0.75, dusk: 0.6, night: 0.35 };

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

  /** 圆角矩形路径。 */
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

  function circle(ctx, x, y, radius, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
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

  // ---------- 背景 ----------

  /** 天空：渐变，夜晚有星星与月亮，黄昏与清晨有贴着地平线的太阳，白天有太阳与云。bottom 为天空下沿的 y。 */
  function drawSky(ctx, scene, width, height, bottom) {
    const base = ctx.globalAlpha;
    const colors = SKY[scene.time] || SKY.day;
    ctx.fillStyle = linear(ctx, 0, 0, 0, bottom, [[0, colors[0]], [1, colors[1]]]);
    ctx.fillRect(-width, -height, width * 3, bottom + height);
    const left = -0.25 * width;
    const span = 1.5 * width;
    if (scene.time === 'night') {
      for (let index = 0; index < 46; index += 1) {
        ctx.globalAlpha = base * (0.4 + 0.6 * rand(scene.seed, index + 200));
        circle(ctx, left + rand(scene.seed, index) * span, rand(scene.seed, index + 100) * bottom * 0.85, height * (0.0012 + 0.0018 * rand(scene.seed, index + 300)), '#FFFFFF');
      }
      ctx.globalAlpha = base;
      circle(ctx, width * 0.8, height * 0.17, height * 0.045, '#F3F1DC');
      return;
    }
    if (scene.time === 'day') {
      ctx.globalAlpha = base * 0.25;
      circle(ctx, width * 0.82, height * 0.15, height * 0.08, '#FFF3B0');
      ctx.globalAlpha = base;
      circle(ctx, width * 0.82, height * 0.15, height * 0.045, '#FFF3B0');
    } else {
      circle(ctx, width * (0.25 + 0.5 * rand(scene.seed, 7)), bottom, height * 0.08, '#FFD59A');
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    for (let index = 0; index < 3; index += 1) {
      const cx = width * (0.12 + 0.3 * index + 0.1 * rand(scene.seed, index + 10));
      const cy = height * (0.08 + 0.1 * rand(scene.seed, index + 20));
      for (const [dx, dy, rx] of [[0, 0, 0.08], [-0.05, 0.008, 0.05], [0.05, 0.008, 0.055]]) {
        ctx.beginPath();
        ctx.ellipse(cx + dx * width, cy + dy * height, rx * width, height * 0.028, 0, 0, TAU);
        ctx.fill();
      }
    }
  }

  /** 地面：从 top 往下的渐变。 */
  function drawGround(ctx, width, height, top, near, far) {
    ctx.fillStyle = linear(ctx, 0, top, 0, height * 1.2, [[0, near], [1, far]]);
    ctx.fillRect(-width, top, width * 3, height * 1.5);
  }

  /** 墙上的窗户：窗外是当前时间的天空。 */
  function drawWindow(ctx, scene, x, y, width, height) {
    const colors = SKY[scene.time] || SKY.day;
    ctx.fillStyle = '#E7DFD0';
    ctx.fillRect(x - height * 0.04, y - height * 0.04, width + height * 0.08, height + height * 0.08);
    ctx.fillStyle = linear(ctx, 0, y, 0, y + height, [[0, colors[0]], [1, colors[1]]]);
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#E7DFD0';
    ctx.lineWidth = Math.max(1, height * 0.03);
    ctx.beginPath();
    ctx.moveTo(x + width / 2, y);
    ctx.lineTo(x + width / 2, y + height);
    ctx.moveTo(x, y + height / 2);
    ctx.lineTo(x + width, y + height / 2);
    ctx.stroke();
  }

  function drawIndoor(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    ctx.fillStyle = linear(ctx, 0, 0, 0, horizon, [[0, shade(scene.wall, 0.85)], [1, scene.wall]]);
    ctx.fillRect(-width, -height, width * 3, horizon + height);
    ctx.fillStyle = shade(scene.wall, 0.7);
    ctx.fillRect(-width, horizon - height * 0.018, width * 3, height * 0.018);
    drawGround(ctx, width, height, horizon, scene.floor, shade(scene.floor, 0.75));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    for (let index = -8; index <= 8; index += 1) {
      ctx.beginPath();
      ctx.moveTo(width * 0.5 + index * width * 0.025, horizon);
      ctx.lineTo(width * 0.5 + index * width * 0.22, height * 1.15);
      ctx.stroke();
    }
    const windowOnRight = scene.seed % 2 === 0;
    drawWindow(ctx, scene, width * (windowOnRight ? 0.64 : 0.1), height * 0.12, width * 0.2, height * 0.24);
    // 另一侧挂一幅画。
    const frameX = width * (windowOnRight ? 0.12 : 0.7);
    ctx.fillStyle = shade(scene.wall, 0.6);
    ctx.fillRect(frameX, height * 0.14, width * 0.13, height * 0.17);
    ctx.fillStyle = shade(scene.wall, 1.25);
    ctx.fillRect(frameX + width * 0.008, height * 0.14 + height * 0.014, width * 0.114, height * 0.142);
  }

  function drawStreet(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    drawSky(ctx, scene, width, height, horizon);
    const light = FAR_LIGHT[scene.time] || 0.85;
    const lit = scene.time === 'night' || scene.time === 'dusk';
    const left = -0.25 * width;
    const step = (1.5 * width) / 9;
    for (let index = 0; index < 9; index += 1) {
      const buildingWidth = width * (0.08 + 0.06 * rand(scene.seed, index));
      const buildingHeight = height * (0.14 + 0.2 * rand(scene.seed, index + 30));
      const x = left + index * step;
      ctx.fillStyle = shade('#6B7587', light);
      ctx.fillRect(x, horizon - buildingHeight, buildingWidth, buildingHeight);
      for (let row = 0; row < Math.floor(buildingHeight / (height * 0.045)); row += 1) {
        for (let column = 0; column < 3; column += 1) {
          ctx.fillStyle = lit && rand(scene.seed, index * 31 + row * 3 + column) > 0.4 ? '#FFD98A' : 'rgba(255, 255, 255, 0.2)';
          ctx.fillRect(x + buildingWidth * (0.14 + column * 0.29), horizon - buildingHeight + height * (0.012 + row * 0.045), buildingWidth * 0.18, height * 0.022);
        }
      }
    }
    drawGround(ctx, width, height, horizon, '#4E5460', '#363A43');
    ctx.fillStyle = '#7A808C';
    ctx.fillRect(-width, horizon, width * 3, height * 0.045);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    for (let x = left; x < width * 1.25; x += width * 0.12) ctx.fillRect(x, height * 0.8, width * 0.06, height * 0.008);
    // 路灯。
    const lampX = width * 0.14;
    ctx.fillStyle = '#2B2F38';
    ctx.fillRect(lampX - height * 0.004, height * 0.2, height * 0.008, height * 0.33);
    if (lit) {
      const base = ctx.globalAlpha;
      ctx.globalAlpha = base * 0.2;
      circle(ctx, lampX, height * 0.2, height * 0.07, '#FFE6A0');
      ctx.globalAlpha = base;
    }
    circle(ctx, lampX, height * 0.2, height * 0.014, lit ? '#FFE6A0' : '#D8DCE2');
  }

  function drawForest(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    drawSky(ctx, scene, width, height, horizon);
    const light = FAR_LIGHT[scene.time] || 0.85;
    const left = -0.25 * width;
    for (const [layer, color, count, crown] of [[0, '#2A6B4A', 12, 0.075], [1, '#3C8A58', 9, 0.095]]) {
      const step = (1.5 * width) / count;
      for (let index = 0; index < count; index += 1) {
        const x = left + index * step + step * 0.5 * rand(scene.seed, index + layer * 50);
        const treeHeight = height * (0.1 + 0.07 * rand(scene.seed, index + layer * 50 + 10));
        const base = horizon + layer * height * 0.02;
        ctx.fillStyle = shade('#4A3A2A', light);
        ctx.fillRect(x - width * 0.006, base - treeHeight, width * 0.012, treeHeight);
        circle(ctx, x, base - treeHeight, height * crown, shade(color, light));
      }
    }
    drawGround(ctx, width, height, horizon + height * 0.03, shade('#4C7F3E', light + 0.1), shade('#2E4F2C', light + 0.1));
    ctx.strokeStyle = 'rgba(20, 50, 20, 0.5)';
    ctx.lineWidth = 1.5;
    for (let index = 0; index < 40; index += 1) {
      const x = left + rand(scene.seed, index + 400) * 1.5 * width;
      const y = height * (0.56 + 0.4 * rand(scene.seed, index + 500));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - height * 0.008, y - height * 0.02);
      ctx.moveTo(x, y);
      ctx.lineTo(x + height * 0.008, y - height * 0.02);
      ctx.stroke();
    }
  }

  function drawCave(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    ctx.fillStyle = linear(ctx, 0, 0, 0, horizon, [[0, '#17151C'], [1, '#2A2733']]);
    ctx.fillRect(-width, -height, width * 3, horizon + height);
    const left = -0.25 * width;
    for (let index = 0; index < 6; index += 1) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.beginPath();
      ctx.ellipse(left + rand(scene.seed, index) * 1.5 * width, height * (0.15 + 0.3 * rand(scene.seed, index + 9)), width * 0.09, height * 0.08, 0, 0, TAU);
      ctx.fill();
    }
    // 洞顶的钟乳石。
    ctx.fillStyle = '#121016';
    for (let index = 0; index < 12; index += 1) {
      const x = left + (index / 11) * 1.5 * width;
      ctx.beginPath();
      ctx.moveTo(x - width * 0.03, -height * 0.05);
      ctx.lineTo(x + width * 0.03, -height * 0.05);
      ctx.lineTo(x, height * (0.07 + 0.16 * rand(scene.seed, index + 60)));
      ctx.closePath();
      ctx.fill();
    }
    drawGround(ctx, width, height, horizon, '#3A3542', '#26222D');
    for (let index = 0; index < 14; index += 1) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.beginPath();
      ctx.ellipse(left + rand(scene.seed, index + 700) * 1.5 * width, height * (0.56 + 0.4 * rand(scene.seed, index + 800)), width * 0.012, height * 0.008, 0, 0, TAU);
      ctx.fill();
    }
    const glowAlpha = ctx.globalAlpha;
    ctx.globalAlpha = glowAlpha * 0.14;
    circle(ctx, width * 0.5, height * 0.62, height * 0.36, '#FFC27A');
    ctx.globalAlpha = glowAlpha;
  }

  function drawSea(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    drawSky(ctx, scene, width, height, horizon);
    const shore = height * 0.6;
    ctx.fillStyle = linear(ctx, 0, horizon, 0, shore, [[0, '#2D6FA3'], [1, '#1C4C7A']]);
    ctx.fillRect(-width, horizon, width * 3, shore - horizon);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    const left = -0.25 * width;
    for (let index = 0; index < 14; index += 1) {
      const x = left + rand(scene.seed, index) * 1.5 * width;
      const y = horizon + (shore - horizon) * (0.15 + 0.7 * rand(scene.seed, index + 40));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + width * 0.035, y);
      ctx.stroke();
    }
    // 远处的帆船。
    ctx.fillStyle = '#F2F2F2';
    ctx.beginPath();
    ctx.moveTo(width * 0.7, horizon - height * 0.07);
    ctx.lineTo(width * 0.7, horizon - height * 0.005);
    ctx.lineTo(width * 0.73, horizon - height * 0.005);
    ctx.closePath();
    ctx.fill();
    drawGround(ctx, width, height, shore, '#CDB88C', '#A89066');
  }

  function drawField(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    drawSky(ctx, scene, width, height, horizon);
    const light = FAR_LIGHT[scene.time] || 0.85;
    ctx.fillStyle = shade('#6E8FA8', light);
    ctx.beginPath();
    ctx.ellipse(width * 0.25, horizon + height * 0.03, width * 0.4, height * 0.1, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = shade('#5E9A5A', light);
    ctx.beginPath();
    ctx.ellipse(width * 0.8, horizon + height * 0.04, width * 0.45, height * 0.08, 0, 0, TAU);
    ctx.fill();
    drawGround(ctx, width, height, horizon + height * 0.02, shade('#6FA146', light + 0.1), shade('#44702E', light + 0.1));
    ctx.strokeStyle = 'rgba(30, 70, 20, 0.45)';
    ctx.lineWidth = 1.5;
    for (let index = 0; index < 50; index += 1) {
      const x = -0.25 * width + rand(scene.seed, index + 400) * 1.5 * width;
      const y = height * (0.55 + 0.42 * rand(scene.seed, index + 500));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - height * 0.006, y - height * 0.018);
      ctx.moveTo(x, y);
      ctx.lineTo(x + height * 0.006, y - height * 0.018);
      ctx.stroke();
    }
  }

  function drawGeneric(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    ctx.fillStyle = linear(ctx, 0, 0, 0, horizon, [[0, shade(scene.wall, 0.85)], [1, scene.wall]]);
    ctx.fillRect(-width, -height, width * 3, horizon + height);
    drawGround(ctx, width, height, horizon, scene.floor, shade(scene.floor, 0.75));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-width, horizon);
    ctx.lineTo(width * 2, horizon);
    ctx.stroke();
  }

  function poly(ctx, points, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    points.forEach(([px, py], index) => (index === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fill();
  }

  function drawSpace(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    ctx.fillStyle = linear(ctx, 0, 0, 0, horizon, [[0, '#04051A'], [1, '#1B1B4A']]);
    ctx.fillRect(-width, -height, width * 3, horizon + height);
    const left = -0.25 * width;
    const base = ctx.globalAlpha;
    for (let index = 0; index < 90; index += 1) {
      ctx.globalAlpha = base * (0.4 + 0.6 * rand(scene.seed, index + 200));
      circle(ctx, left + rand(scene.seed, index) * 1.5 * width, rand(scene.seed, index + 100) * horizon, height * (0.0012 + 0.002 * rand(scene.seed, index + 300)), '#FFFFFF');
    }
    ctx.globalAlpha = base;
    circle(ctx, width * 0.78, height * 0.26, height * 0.13, '#D98C5F');
    ctx.strokeStyle = 'rgba(255, 225, 190, 0.7)';
    ctx.lineWidth = height * 0.012;
    ctx.beginPath();
    ctx.ellipse(width * 0.78, height * 0.26, height * 0.2, height * 0.045, -0.3, 0, TAU);
    ctx.stroke();
    circle(ctx, width * 0.18, height * 0.16, height * 0.04, '#C9CCD6');
    drawGround(ctx, width, height, horizon, '#4A4A5C', '#22222E');
    for (let index = 0; index < 8; index += 1) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.beginPath();
      ctx.ellipse(left + rand(scene.seed, index + 600) * 1.5 * width, height * (0.56 + 0.4 * rand(scene.seed, index + 700)), width * 0.04, height * 0.014, 0, 0, TAU);
      ctx.fill();
    }
  }

  function drawUnderwater(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    ctx.fillStyle = linear(ctx, 0, 0, 0, height, [[0, '#0B6AA0'], [1, '#07324F']]);
    ctx.fillRect(-width, -height, width * 3, height * 3);
    const left = -0.25 * width;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    for (let index = 0; index < 5; index += 1) {
      const x = left + (index / 4) * 1.5 * width;
      poly(ctx, [[x, -height * 0.1], [x + width * 0.05, -height * 0.1], [x + width * 0.16, horizon + height * 0.1], [x + width * 0.04, horizon + height * 0.1]], 'rgba(255, 255, 255, 0.07)');
    }
    drawGround(ctx, width, height, horizon + height * 0.04, '#B9A67A', '#7E6F4E');
    ctx.strokeStyle = '#2F9B5A';
    ctx.lineWidth = height * 0.012;
    ctx.lineCap = 'round';
    for (let index = 0; index < 9; index += 1) {
      const x = left + rand(scene.seed, index) * 1.5 * width;
      const base = horizon + height * (0.04 + 0.1 * rand(scene.seed, index + 20));
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.quadraticCurveTo(x - height * 0.03, base - height * 0.07, x + height * 0.01, base - height * 0.14);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    for (let index = 0; index < 14; index += 1) {
      ctx.beginPath();
      ctx.arc(left + rand(scene.seed, index + 40) * 1.5 * width, height * (0.05 + 0.5 * rand(scene.seed, index + 60)), height * (0.006 + 0.01 * rand(scene.seed, index + 80)), 0, TAU);
      ctx.stroke();
    }
  }

  function drawSkyScene(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    drawSky(ctx, scene, width, height, height * 0.75);
    ctx.fillStyle = linear(ctx, 0, horizon, 0, height * 1.2, [[0, '#F7FAFF'], [1, '#C4D4EE']]);
    ctx.fillRect(-width, horizon, width * 3, height * 1.5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    for (let index = 0; index < 12; index += 1) {
      const x = -0.2 * width + (index / 11) * 1.4 * width;
      ctx.beginPath();
      ctx.ellipse(x, horizon + height * 0.01 * Math.sin(index * 2), width * 0.09, height * 0.05, 0, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(190, 205, 235, 0.45)';
    for (let index = 0; index < 8; index += 1) {
      ctx.beginPath();
      ctx.ellipse(-0.2 * width + rand(scene.seed, index) * 1.4 * width, height * (0.6 + 0.35 * rand(scene.seed, index + 9)), width * 0.1, height * 0.025, 0, 0, TAU);
      ctx.fill();
    }
  }

  function drawDesert(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    drawSky(ctx, scene, width, height, horizon);
    const light = FAR_LIGHT[scene.time] || 0.85;
    for (const [cx, rx, ry, tone] of [[0.2, 0.45, 0.08, '#D9B26B'], [0.75, 0.5, 0.1, '#CFA35C']]) {
      ctx.fillStyle = shade(tone, light);
      ctx.beginPath();
      ctx.ellipse(width * cx, horizon + height * 0.03, width * rx, height * ry, 0, Math.PI, 0);
      ctx.fill();
    }
    drawGround(ctx, width, height, horizon + height * 0.02, shade('#E3C27E', light + 0.1), shade('#B58F4E', light + 0.1));
    ctx.strokeStyle = 'rgba(120, 85, 30, 0.3)';
    ctx.lineWidth = 1.5;
    for (let index = 0; index < 10; index += 1) {
      const y = height * (0.58 + 0.38 * rand(scene.seed, index));
      const x = -0.2 * width + rand(scene.seed, index + 30) * 1.4 * width;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + width * 0.04, y - height * 0.01, x + width * 0.09, y);
      ctx.stroke();
    }
    PROP_PAINTERS.cactus(ctx, width * 0.12, horizon + height * 0.08, height * 0.012);
  }

  function drawSnowScene(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    drawSky(ctx, scene, width, height, horizon);
    const light = FAR_LIGHT[scene.time] || 0.85;
    for (const [cx, peak, base, tone] of [[0.22, 0.2, 0.32, '#B8C8E0'], [0.62, 0.12, 0.4, '#C9D6EA'], [0.92, 0.24, 0.3, '#B1C2DC']]) {
      poly(ctx, [[width * (cx - base), horizon], [width * cx, height * peak], [width * (cx + base), horizon]], shade(tone, light));
      poly(ctx, [[width * (cx - base * 0.28), height * (peak + 0.09)], [width * cx, height * peak], [width * (cx + base * 0.28), height * (peak + 0.09)]], '#FFFFFF');
    }
    drawGround(ctx, width, height, horizon, shade('#F4F8FF', light + 0.1), shade('#CFDDF0', light + 0.1));
    for (let index = 0; index < 6; index += 1) {
      const x = -0.2 * width + rand(scene.seed, index) * 1.4 * width;
      const y = horizon + height * 0.02 * rand(scene.seed, index + 9);
      ctx.fillStyle = shade('#2F6B4A', light);
      poly(ctx, [[x - width * 0.02, y], [x, y - height * 0.12], [x + width * 0.02, y]], shade('#2F6B4A', light));
      poly(ctx, [[x - width * 0.012, y - height * 0.06], [x, y - height * 0.12], [x + width * 0.012, y - height * 0.06]], '#FFFFFF');
    }
    for (let index = 0; index < 40; index += 1) circle(ctx, -0.2 * width + rand(scene.seed, index + 400) * 1.4 * width, rand(scene.seed, index + 500) * height, height * 0.004, 'rgba(255, 255, 255, 0.85)');
  }

  function drawMountainScene(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    drawSky(ctx, scene, width, height, horizon);
    const light = FAR_LIGHT[scene.time] || 0.85;
    for (const [layer, tone, count] of [[0, '#7E8FAA', 4], [1, '#56667F', 3]]) {
      for (let index = 0; index < count; index += 1) {
        const cx = -0.1 + (index + 0.5 + 0.3 * rand(scene.seed, index + layer * 10)) / count * 1.2;
        const peak = 0.14 + 0.16 * rand(scene.seed, index + layer * 10 + 4) + layer * 0.08;
        const half = 0.2 + 0.12 * rand(scene.seed, index + layer * 10 + 8);
        poly(ctx, [[width * (cx - half), horizon], [width * cx, height * peak], [width * (cx + half), horizon]], shade(tone, light));
        poly(ctx, [[width * (cx - half * 0.22), height * (peak + 0.07)], [width * cx, height * peak], [width * (cx + half * 0.22), height * (peak + 0.07)]], 'rgba(255, 255, 255, 0.85)');
      }
    }
    drawGround(ctx, width, height, horizon, shade('#7A7064', light + 0.1), shade('#4A443C', light + 0.1));
    for (let index = 0; index < 8; index += 1) {
      ctx.fillStyle = shade('#5E564C', light + 0.1);
      ctx.beginPath();
      ctx.ellipse(-0.2 * width + rand(scene.seed, index + 300) * 1.4 * width, height * (0.56 + 0.4 * rand(scene.seed, index + 400)), width * 0.03, height * 0.02, 0, 0, TAU);
      ctx.fill();
    }
  }

  function drawRuinsScene(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    drawSky(ctx, scene, width, height, horizon);
    const light = FAR_LIGHT[scene.time] || 0.85;
    for (let index = 0; index < 6; index += 1) {
      const x = -0.15 * width + (index / 5) * 1.3 * width;
      const columnHeight = height * (0.12 + 0.2 * rand(scene.seed, index));
      ctx.fillStyle = shade('#B9B1A0', light);
      ctx.fillRect(x, horizon - columnHeight, width * 0.03, columnHeight);
      poly(ctx, [[x, horizon - columnHeight], [x + width * 0.012, horizon - columnHeight - height * 0.02], [x + width * 0.02, horizon - columnHeight + height * 0.01], [x + width * 0.03, horizon - columnHeight - height * 0.01], [x + width * 0.03, horizon - columnHeight]], shade('#B9B1A0', light));
    }
    drawGround(ctx, width, height, horizon, shade('#8B7F6A', light + 0.1), shade('#5E5646', light + 0.1));
    for (let index = 0; index < 12; index += 1) {
      ctx.fillStyle = shade('#6E6454', light + 0.1);
      ctx.beginPath();
      ctx.ellipse(-0.2 * width + rand(scene.seed, index + 300) * 1.4 * width, height * (0.55 + 0.4 * rand(scene.seed, index + 400)), width * 0.022, height * 0.014, 0, 0, TAU);
      ctx.fill();
    }
  }

  function drawVillageScene(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    drawSky(ctx, scene, width, height, horizon);
    const light = FAR_LIGHT[scene.time] || 0.85;
    ctx.fillStyle = shade('#5E9A5A', light);
    ctx.beginPath();
    ctx.ellipse(width * 0.3, horizon + height * 0.04, width * 0.5, height * 0.09, 0, Math.PI, 0);
    ctx.fill();
    drawGround(ctx, width, height, horizon + height * 0.02, shade('#6FA146', light + 0.1), shade('#44702E', light + 0.1));
    const tones = ['#D9C7A3', '#E8D9B5', '#C9B48A'];
    for (let index = 0; index < 4; index += 1) {
      PROP_PAINTERS.house(ctx, width * (0.1 + index * 0.27 + 0.04 * rand(scene.seed, index)), horizon + height * 0.03, height * 0.01 * (0.9 + 0.2 * rand(scene.seed, index + 9)), shade(tones[index % 3], light));
    }
    poly(ctx, [[width * 0.4, height], [width * 0.46, horizon + height * 0.03], [width * 0.54, horizon + height * 0.03], [width * 0.72, height]], shade('#B79B6A', light + 0.1));
    PROP_PAINTERS.fence(ctx, width * 0.9, horizon + height * 0.12, height * 0.012, '#B98B5A');
  }

  const BACKDROPS = { indoor: drawIndoor, street: drawStreet, forest: drawForest, cave: drawCave, sea: drawSea, field: drawField, space: drawSpace, underwater: drawUnderwater, sky: drawSkyScene, desert: drawDesert, snow: drawSnowScene, mountain: drawMountainScene, ruins: drawRuinsScene, village: drawVillageScene, generic: drawGeneric };

  /** 画场景背景：按地点类型画，再叠加时间色调；范围比画布大，运镜平移与缩放时不会露边。 */
  function drawBackdrop(ctx, scene, width, height) {
    (BACKDROPS[scene.setting] || drawGeneric)(ctx, scene, width, height);
    const tint = TIME_TINT[scene.time];
    if (tint && scene.setting !== 'space' && scene.setting !== 'underwater') {
      ctx.fillStyle = tint;
      ctx.fillRect(-width, -height, width * 3, height * 3);
    }
  }

  // ---------- 角色 ----------

  /** 脸：肤色、头发、眼睛、鼻子与嘴；说话时嘴一开一合，背对镜头只有头发。 */
  function drawFace(ctx, x, y, radius, spec) {
    const skin = spec.skin || SKIN;
    const hair = spec.hair === undefined ? HAIR : spec.hair;
    circle(ctx, x, y, radius, skin);
    if (spec.facing === 'away') {
      if (hair) circle(ctx, x, y, radius * 1.02, hair);
      return;
    }
    const side = spec.facing === 'left' ? -1 : spec.facing === 'right' ? 1 : 0;
    if (hair) {
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.04, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      if (side !== 0) {
        ctx.beginPath();
        ctx.ellipse(x - side * radius * 0.55, y - radius * 0.1, radius * 0.5, radius * 0.85, 0, 0, TAU);
        ctx.fill();
      }
    }
    const eye = radius * 0.13;
    ctx.fillStyle = '#1A1A1A';
    for (const offset of side === 0 ? [-0.38, 0.38] : [0.45 * side]) {
      ctx.beginPath();
      ctx.arc(x + offset * radius, y - radius * 0.05, eye, 0, TAU);
      ctx.fill();
    }
    if (side !== 0) {
      ctx.fillStyle = shade(skin, 0.88);
      ctx.beginPath();
      ctx.moveTo(x + side * radius * 0.95, y);
      ctx.lineTo(x + side * radius * 1.25, y + radius * 0.2);
      ctx.lineTo(x + side * radius * 0.9, y + radius * 0.3);
      ctx.closePath();
      ctx.fill();
    }
    const open = spec.speaking ? radius * (0.1 + 0.14 * Math.abs(Math.sin(spec.phase * MOUTH_SPEED))) : radius * 0.045;
    ctx.fillStyle = '#7A3B3B';
    ctx.beginPath();
    ctx.ellipse(x + side * radius * 0.35, y + radius * 0.5, radius * 0.28, open, 0, 0, TAU);
    ctx.fill();
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
   * 小人的头：圆心与半径（像素），headScale 放大头（儿童、婴儿头身比更大），extra 是头放大后图形增加的高度（单位 u）。
   * @param {{ x: number, y: number, unit: number, image?: object|null, headScale?: number }} spec
   */
  function headOf(spec) {
    const u = spec.unit;
    const scale = spec.headScale || 1;
    const baseR = spec.image ? 5.4 : 4.4;
    const baseY = spec.image ? 23.2 : 22.6;
    return { headY: spec.y - baseY * u - (scale - 1) * baseR * 0.9 * u, headR: baseR * scale * u, extra: (scale - 1) * baseR * 1.9 };
  }

  /**
   * 画一个角色小人：影子、腿、手臂、躯干与头；有资产图时头部换成圆形头像。
   * @param {{ x: number, y: number, unit: number, color: string, facing: string, walking: boolean, speaking: boolean, placed: boolean,
   *   phase: number, image: object|null, skin?: string, hair?: string|null, armsUp?: boolean, noHead?: boolean, noShadow?: boolean, headScale?: number }} spec
   *   x、y 为脚下位置，unit 为单位长度（画面高度的 1% × 纵深缩放），phase 为动画时间（秒）；skin、hair 换肤色与发色（hair 为 null 表示没有头发），
   *   armsUp 为双臂向前平举（僵尸），noHead 为不画头、noShadow 为不画影子（由调用方画），headScale 为头的放大倍数。
   * @returns {{ headX: number, headY: number, headR: number, height: number }} 头的位置与图形总高度（单位 u）。
   */
  function drawFigure(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const skin = spec.skin || SKIN;
    const swing = spec.walking ? Math.sin(spec.phase * WALK_SPEED) : 0;
    if (!spec.noShadow) {
      ctx.fillStyle = SHADOW;
      ctx.beginPath();
      ctx.ellipse(x, y, 7 * u, 1.6 * u, 0, 0, TAU);
      ctx.fill();
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = shade(color, 0.55);
    ctx.lineWidth = 2.6 * u;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * 1.7 * u, y - 8 * u);
      ctx.lineTo(x + side * 1.9 * u + swing * side * 2.4 * u, y - 0.6 * u);
      ctx.stroke();
    }
    ctx.strokeStyle = shade(color, 0.8);
    ctx.lineWidth = 2.2 * u;
    for (const side of [-1, 1]) {
      const handX = spec.armsUp ? x + side * 9 * u : x + side * 5.3 * u - swing * side * 2.2 * u;
      const handY = spec.armsUp ? y - 15 * u : y - 9.2 * u;
      ctx.beginPath();
      ctx.moveTo(x + side * 4.1 * u, y - 16.5 * u);
      ctx.lineTo(handX, handY + (spec.armsUp ? 0 : -0.4 * u));
      ctx.stroke();
      circle(ctx, handX, handY, 1.2 * u, skin);
    }
    ctx.fillStyle = color;
    roundedRect(ctx, x - 4 * u, y - 18.5 * u, 8 * u, 11 * u, 3 * u);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 0.4 * u;
    ctx.stroke();
    const head = headOf(spec);
    if (spec.noHead) {
      // 头由调用方画。
    } else if (spec.image) {
      drawAvatar(ctx, spec.image, x, head.headY, head.headR, 0.6 * u);
    } else {
      drawFace(ctx, x, head.headY, head.headR, spec);
    }
    if (!spec.placed) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      roundedRect(ctx, x - 7 * u, y - (29 + head.extra) * u, 14 * u, (29.6 + head.extra) * u, 3 * u);
      ctx.stroke();
      ctx.restore();
    }
    return { headX: x, headY: head.headY, headR: head.headR, height: FIGURE_HEIGHT + head.extra };
  }

  // ---------- 道具 ----------

  /** 道具图形：以脚下中点 (x, y) 为锚点，u 为单位长度；每种图形占约 12u 宽。 */
  const PROP_PAINTERS = {
    table(ctx, x, y, u, color) {
      ctx.fillStyle = shade(color, 0.7);
      ctx.fillRect(x - 7 * u, y - 5.2 * u, 1.6 * u, 5.2 * u);
      ctx.fillRect(x + 5.4 * u, y - 5.2 * u, 1.6 * u, 5.2 * u);
      ctx.fillStyle = color;
      roundedRect(ctx, x - 8.5 * u, y - 7 * u, 17 * u, 2 * u, 0.6 * u);
      ctx.fill();
    },
    chair(ctx, x, y, u, color) {
      ctx.fillStyle = shade(color, 0.7);
      ctx.fillRect(x - 3.8 * u, y - 4.2 * u, 1.2 * u, 4.2 * u);
      ctx.fillRect(x + 2.6 * u, y - 4.2 * u, 1.2 * u, 4.2 * u);
      ctx.fillRect(x - 4 * u, y - 12 * u, 1.4 * u, 8 * u);
      ctx.fillStyle = color;
      ctx.fillRect(x - 4.4 * u, y - 5.6 * u, 8.8 * u, 1.6 * u);
    },
    door(ctx, x, y, u, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x - 5 * u, y - 19 * u, 10 * u, 19 * u);
      ctx.strokeStyle = shade(color, 0.7);
      ctx.lineWidth = 0.6 * u;
      ctx.strokeRect(x - 3.6 * u, y - 17.4 * u, 7.2 * u, 7 * u);
      ctx.strokeRect(x - 3.6 * u, y - 8.8 * u, 7.2 * u, 7 * u);
      circle(ctx, x + 3 * u, y - 9.5 * u, 0.7 * u, '#E8D28A');
    },
    window(ctx, x, y, u, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x - 6.6 * u, y - 14.6 * u, 13.2 * u, 13.2 * u);
      ctx.fillStyle = '#9CC8EA';
      ctx.fillRect(x - 5.6 * u, y - 13.6 * u, 11.2 * u, 11.2 * u);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.8 * u;
      ctx.beginPath();
      ctx.moveTo(x, y - 13.6 * u);
      ctx.lineTo(x, y - 2.4 * u);
      ctx.moveTo(x - 5.6 * u, y - 8 * u);
      ctx.lineTo(x + 5.6 * u, y - 8 * u);
      ctx.stroke();
    },
    light(ctx, x, y, u, color) {
      const base = ctx.globalAlpha;
      ctx.globalAlpha = base * 0.25;
      circle(ctx, x, y - 13 * u, 7 * u, '#FFE9A8');
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
      circle(ctx, x, y - 12.4 * u, 1 * u, '#FFF3B0');
    },
    weapon(ctx, x, y, u, color) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#C9D1DB';
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
    },
    book(ctx, x, y, u, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x - 5 * u, y - 3.4 * u, 10 * u, 3.4 * u);
      ctx.fillStyle = '#F4EFE0';
      ctx.fillRect(x - 4.6 * u, y - 2.6 * u, 9.2 * u, 1.6 * u);
    },
    box(ctx, x, y, u, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x - 5.4 * u, y - 8 * u, 10.8 * u, 8 * u);
      ctx.fillStyle = shade(color, 0.75);
      ctx.fillRect(x - 5.4 * u, y - 8 * u, 10.8 * u, 2.4 * u);
      ctx.fillStyle = '#E8D28A';
      ctx.fillRect(x - 0.8 * u, y - 6 * u, 1.6 * u, 2 * u);
    },
    bed(ctx, x, y, u, color) {
      ctx.fillStyle = shade(color, 0.7);
      ctx.fillRect(x - 9 * u, y - 10 * u, 1.4 * u, 10 * u);
      ctx.fillRect(x - 9 * u, y - 4 * u, 18 * u, 4 * u);
      ctx.fillStyle = '#E7E2D8';
      ctx.fillRect(x - 7.6 * u, y - 7 * u, 16.6 * u, 3 * u);
      ctx.fillStyle = '#FFFFFF';
      roundedRect(ctx, x - 7.4 * u, y - 9 * u, 5 * u, 2.2 * u, 1 * u);
      ctx.fill();
    },
    vehicle(ctx, x, y, u, color) {
      ctx.fillStyle = color;
      roundedRect(ctx, x - 9 * u, y - 7 * u, 18 * u, 4.6 * u, 1.2 * u);
      ctx.fill();
      ctx.fillStyle = shade(color, 1.3);
      roundedRect(ctx, x - 5 * u, y - 11 * u, 10 * u, 4.4 * u, 1.4 * u);
      ctx.fill();
      circle(ctx, x - 5.6 * u, y - 2.2 * u, 2.2 * u, '#1F2229');
      circle(ctx, x + 5.6 * u, y - 2.2 * u, 2.2 * u, '#1F2229');
    },
    plant(ctx, x, y, u) {
      for (const [dx, dy, r] of [[0, 9, 3.2], [-3, 7, 2.4], [3, 7, 2.4]]) circle(ctx, x + dx * u, y - dy * u, r * u, '#3F9B5A');
      ctx.fillStyle = '#A0623E';
      ctx.fillRect(x - 2.6 * u, y - 4.2 * u, 5.2 * u, 4.2 * u);
    },
    flower(ctx, x, y, u, color) {
      ctx.strokeStyle = '#3F9B5A';
      ctx.lineWidth = 1 * u;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 9 * u);
      ctx.stroke();
      ctx.fillStyle = '#3F9B5A';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(x + side * 2.2 * u, y - 3.6 * u, 2.2 * u, 1 * u, side * -0.5, 0, TAU);
        ctx.fill();
      }
      for (let index = 0; index < 6; index += 1) circle(ctx, x + Math.cos((index * TAU) / 6) * 3.8 * u, y - 11.8 * u + Math.sin((index * TAU) / 6) * 3.8 * u, 2.1 * u, color);
      circle(ctx, x, y - 11.8 * u, 3 * u, '#F5D90A');
    },
    grass(ctx, x, y, u) {
      for (const [dx, height, half, tip] of [[-3.2, 8, 1.8, -1.4], [0, 10.5, 2.4, 0.6], [3.2, 7.5, 1.8, 1.4]]) {
        ctx.fillStyle = height > 10 ? '#58AE45' : '#4C9A3E';
        ctx.beginPath();
        ctx.moveTo(x + (dx - half) * u, y);
        ctx.quadraticCurveTo(x + (dx - half * 0.2) * u, y - height * 0.6 * u, x + (dx + tip) * u, y - height * u);
        ctx.quadraticCurveTo(x + (dx + half * 0.6) * u, y - height * 0.5 * u, x + (dx + half) * u, y);
        ctx.closePath();
        ctx.fill();
      }
    },
    tree(ctx, x, y, u) {
      ctx.fillStyle = '#7A5A3C';
      ctx.fillRect(x - 1.6 * u, y - 9 * u, 3.2 * u, 9 * u);
      for (const [dx, dy, r] of [[-4, 11, 4.4], [4, 11, 4.4], [0, 14.2, 5.8]]) circle(ctx, x + dx * u, y - dy * u, r * u, '#3C8A58');
      circle(ctx, x - 1.6 * u, y - 15.4 * u, 2 * u, '#58AE75');
    },
    stone(ctx, x, y, u) {
      ctx.fillStyle = '#8C9097';
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
    },
    mushroom(ctx, x, y, u, color) {
      ctx.fillStyle = '#F2E8D5';
      roundedRect(ctx, x - 2.2 * u, y - 5.6 * u, 4.4 * u, 5.6 * u, 1.4 * u);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y - 5.4 * u, 6 * u, 4.6 * u, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      for (const [dx, dy] of [[-2.6, 7.6], [1.2, 8.8], [3.2, 6.6]]) circle(ctx, x + dx * u, y - dy * u, 0.9 * u, 'rgba(255, 255, 255, 0.85)');
    },
    cactus(ctx, x, y, u) {
      ctx.fillStyle = '#4C9A5E';
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
    },
    screen(ctx, x, y, u) {
      ctx.fillStyle = '#2A2E36';
      roundedRect(ctx, x - 6 * u, y - 9 * u, 12 * u, 7.6 * u, 0.8 * u);
      ctx.fill();
      ctx.fillStyle = '#7BC4F5';
      ctx.fillRect(x - 5.2 * u, y - 8.2 * u, 10.4 * u, 6 * u);
      ctx.fillStyle = '#2A2E36';
      ctx.fillRect(x - 0.8 * u, y - 1.6 * u, 1.6 * u, 1.2 * u);
      ctx.fillRect(x - 3 * u, y - 0.8 * u, 6 * u, 0.8 * u);
    },
    clock(ctx, x, y, u, color) {
      circle(ctx, x, y - 6.2 * u, 5.4 * u, color);
      circle(ctx, x, y - 6.2 * u, 4.4 * u, '#F4EFE0');
      ctx.strokeStyle = '#2A2E36';
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
    },
    mirror(ctx, x, y, u, color) {
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
      ctx.fillStyle = '#BFE3F2';
      ctx.beginPath();
      ctx.ellipse(x, y - 9.2 * u, 3.8 * u, 6.2 * u, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.beginPath();
      ctx.ellipse(x - 1.4 * u, y - 11.4 * u, 0.9 * u, 2.4 * u, 0.4, 0, TAU);
      ctx.fill();
    },
    key(ctx, x, y, u, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2 * u;
      ctx.beginPath();
      ctx.arc(x, y - 9 * u, 2.6 * u, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(x - 0.6 * u, y - 6.4 * u, 1.2 * u, 6.2 * u);
      ctx.fillRect(x, y - 2.4 * u, 2.4 * u, 1 * u);
      ctx.fillRect(x, y - 4.2 * u, 1.8 * u, 1 * u);
    },
    umbrella(ctx, x, y, u, color) {
      ctx.strokeStyle = '#4A4F59';
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
    },
    ball(ctx, x, y, u, color) {
      circle(ctx, x, y - 5 * u, 5 * u, color);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 0.6 * u;
      ctx.beginPath();
      ctx.arc(x, y - 5 * u, 3.6 * u, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      circle(ctx, x - 1.8 * u, y - 7 * u, 1.1 * u, 'rgba(255, 255, 255, 0.5)');
    },
    flag(ctx, x, y, u, color) {
      ctx.fillStyle = '#7A5A3C';
      ctx.fillRect(x - 3.4 * u, y - 16 * u, 0.8 * u, 16 * u);
      poly(ctx, [[x - 2.6 * u, y - 16 * u], [x + 6 * u, y - 14.2 * u], [x - 2.6 * u, y - 10.6 * u]], color);
      circle(ctx, x - 3 * u, y - 16.4 * u, 0.7 * u, '#F0C84A');
    },
    tent(ctx, x, y, u, color) {
      poly(ctx, [[x - 8 * u, y], [x, y - 11 * u], [x + 8 * u, y]], color);
      poly(ctx, [[x - 2.2 * u, y], [x, y - 5.4 * u], [x + 2.2 * u, y]], shade(color, 0.5));
      ctx.strokeStyle = shade(color, 0.7);
      ctx.lineWidth = 0.5 * u;
      ctx.beginPath();
      ctx.moveTo(x, y - 11 * u);
      ctx.lineTo(x, y - 5.4 * u);
      ctx.stroke();
    },
    barrel(ctx, x, y, u) {
      ctx.fillStyle = '#9C6B3F';
      roundedRect(ctx, x - 4.4 * u, y - 8 * u, 8.8 * u, 8 * u, 2 * u);
      ctx.fill();
      ctx.fillStyle = '#5A4A3A';
      ctx.fillRect(x - 4.4 * u, y - 6.4 * u, 8.8 * u, 0.8 * u);
      ctx.fillRect(x - 4.4 * u, y - 2.4 * u, 8.8 * u, 0.8 * u);
    },
    sign(ctx, x, y, u, color) {
      ctx.fillStyle = '#7A5A3C';
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
    },
    gem(ctx, x, y, u, color) {
      poly(ctx, [[x, y - 0.6 * u], [x - 4.4 * u, y - 5.6 * u], [x - 2.4 * u, y - 9 * u], [x + 2.4 * u, y - 9 * u], [x + 4.4 * u, y - 5.6 * u]], color);
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
    },
    instrument(ctx, x, y, u, color) {
      ctx.fillStyle = '#4A3A2A';
      ctx.fillRect(x - 0.7 * u, y - 18 * u, 1.4 * u, 10 * u);
      circle(ctx, x, y - 4 * u, 4 * u, color);
      circle(ctx, x, y - 9 * u, 3 * u, color);
      circle(ctx, x, y - 5 * u, 1.2 * u, '#2A2E36');
    },
    pot(ctx, x, y, u) {
      ctx.fillStyle = '#4A4F59';
      ctx.beginPath();
      ctx.ellipse(x, y - 5 * u, 6 * u, 5 * u, 0, 0, Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, y - 5 * u, 6.2 * u, 1.4 * u, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#7C828D';
      ctx.beginPath();
      ctx.ellipse(x, y - 5 * u, 5 * u, 0.9 * u, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#4A4F59';
      ctx.fillRect(x - 4 * u, y - 0.8 * u, 1.2 * u, 1.2 * u);
      ctx.fillRect(x + 2.8 * u, y - 0.8 * u, 1.2 * u, 1.2 * u);
    },
    crown(ctx, x, y, u) {
      poly(ctx, [[x - 5 * u, y - 2 * u], [x - 5 * u, y - 7.6 * u], [x - 2.5 * u, y - 4.6 * u], [x, y - 8.4 * u], [x + 2.5 * u, y - 4.6 * u], [x + 5 * u, y - 7.6 * u], [x + 5 * u, y - 2 * u]], '#F0C84A');
      ctx.fillStyle = '#C79A1E';
      ctx.fillRect(x - 5 * u, y - 2.8 * u, 10 * u, 0.9 * u);
      for (const [dx, color] of [[-3, '#E5484D'], [0, '#3E63DD'], [3, '#30A46C']]) circle(ctx, x + dx * u, y - 4.2 * u, 0.7 * u, color);
    },
    fence(ctx, x, y, u, color) {
      ctx.fillStyle = shade(color, 1.1);
      ctx.fillRect(x - 7 * u, y - 6.4 * u, 14 * u, 1 * u);
      ctx.fillRect(x - 7 * u, y - 3 * u, 14 * u, 1 * u);
      for (let index = 0; index < 4; index += 1) {
        const px = x - 7 * u + index * 4.2 * u;
        poly(ctx, [[px, y], [px, y - 7.4 * u], [px + 0.9 * u, y - 8.8 * u], [px + 1.8 * u, y - 7.4 * u], [px + 1.8 * u, y]], shade(color, 0.9));
      }
    },
    stairs(ctx, x, y, u, color) {
      for (let index = 0; index < 4; index += 1) {
        ctx.fillStyle = shade(color, 0.8 + index * 0.1);
        ctx.fillRect(x - 6 * u + index * 3 * u, y - (index + 1) * 2.4 * u, 12 * u - index * 3 * u, (index + 1) * 2.4 * u);
      }
    },
    tower(ctx, x, y, u, color) {
      poly(ctx, [[x - 3.4 * u, y], [x + 3.4 * u, y], [x + 2.4 * u, y - 14 * u], [x - 2.4 * u, y - 14 * u]], '#F4EFE0');
      poly(ctx, [[x - 2.9 * u, y - 4 * u], [x + 2.9 * u, y - 4 * u], [x + 2.6 * u, y - 7 * u], [x - 2.6 * u, y - 7 * u]], color);
      poly(ctx, [[x - 2.2 * u, y - 10.4 * u], [x + 2.2 * u, y - 10.4 * u], [x + 2.4 * u, y - 14 * u], [x - 2.4 * u, y - 14 * u]], color);
      ctx.fillStyle = '#FFE9A8';
      ctx.fillRect(x - 2.6 * u, y - 17 * u, 5.2 * u, 3 * u);
      poly(ctx, [[x - 3.4 * u, y - 17 * u], [x, y - 21 * u], [x + 3.4 * u, y - 17 * u]], shade(color, 0.6));
    },
    house(ctx, x, y, u, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x - 6 * u, y - 7 * u, 12 * u, 7 * u);
      poly(ctx, [[x - 7.4 * u, y - 7 * u], [x, y - 13.4 * u], [x + 7.4 * u, y - 7 * u]], '#B5503C');
      ctx.fillStyle = shade(color, 0.5);
      ctx.fillRect(x - 1.2 * u, y - 4.4 * u, 2.4 * u, 4.4 * u);
      ctx.fillStyle = '#BFE3F2';
      ctx.fillRect(x + 2.6 * u, y - 5.4 * u, 2.2 * u, 2.2 * u);
      ctx.fillRect(x - 4.8 * u, y - 5.4 * u, 2.2 * u, 2.2 * u);
    },
    castle(ctx, x, y, u, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x - 7 * u, y - 9 * u, 14 * u, 9 * u);
      for (const side of [-1, 1]) {
        ctx.fillRect(x + side * 6.4 * u - 2 * u, y - 14 * u, 4 * u, 14 * u);
        poly(ctx, [[x + side * 6.4 * u - 2.6 * u, y - 14 * u], [x + side * 6.4 * u, y - 17.6 * u], [x + side * 6.4 * u + 2.6 * u, y - 14 * u]], '#B5503C');
      }
      ctx.fillStyle = shade(color, 0.5);
      ctx.beginPath();
      ctx.arc(x, y - 3.4 * u, 2 * u, Math.PI, 0);
      ctx.lineTo(x + 2 * u, y);
      ctx.lineTo(x - 2 * u, y);
      ctx.closePath();
      ctx.fill();
      for (const dx of [-3.4, -1, 1.4, 3.8]) ctx.fillRect(x + dx * u - 0.5 * u, y - 10.4 * u, 1 * u, 1.4 * u);
    },
    bag(ctx, x, y, u, color) {
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
    },
    cup(ctx, x, y, u, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x - 2.4 * u, y - 4.4 * u, 4.8 * u, 4.4 * u);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.8 * u;
      ctx.beginPath();
      ctx.arc(x + 2.8 * u, y - 2.4 * u, 1.4 * u, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
    },
    phone(ctx, x, y, u) {
      ctx.fillStyle = '#2A2E36';
      roundedRect(ctx, x - 2.4 * u, y - 6 * u, 4.8 * u, 6 * u, 0.8 * u);
      ctx.fill();
      ctx.fillStyle = '#7BC4F5';
      ctx.fillRect(x - 1.8 * u, y - 5.4 * u, 3.6 * u, 4.2 * u);
    },
    generic(ctx, x, y, u, color) {
      ctx.fillStyle = color;
      roundedRect(ctx, x - 5 * u, y - 6.5 * u, 10 * u, 6.5 * u, 1.2 * u);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 0.4 * u;
      ctx.stroke();
    }
  };

  /** 各图形的高度，以及“会说话的物品”脸的位置（圆心离地高度 cy、半径 r，单位同图形的 u）。 */
  const PROP_HEIGHT = { table: 7, chair: 12, door: 19, window: 14.6, light: 15.4, weapon: 17, book: 3.4, box: 8, bed: 10, vehicle: 11, plant: 12, cup: 4.4, phone: 6, generic: 6.5, flower: 15, grass: 10.5, tree: 20, stone: 8.6, mushroom: 10, cactus: 12.4, screen: 9, clock: 11.6, mirror: 16.4, key: 11.6, umbrella: 14.2, ball: 10, flag: 16, tent: 11, barrel: 8, sign: 14, gem: 9, instrument: 18, pot: 10, crown: 8.4, fence: 8.8, stairs: 9.6, tower: 21, house: 13.4, castle: 17.6, bag: 10 };
  const PROP_FACE = {
    screen: { cy: 5.6, r: 2.8 },
    clock: { cy: 6.2, r: 3.2 },
    mirror: { cy: 9.2, r: 3 },
    key: { cy: 9, r: 1.8 },
    umbrella: { cy: 9.6, r: 3 },
    ball: { cy: 5, r: 3 },
    flag: { cy: 13.4, r: 2 },
    tent: { cy: 4.4, r: 2.6 },
    barrel: { cy: 4.2, r: 3 },
    sign: { cy: 11, r: 2.6 },
    gem: { cy: 5.6, r: 2.4 },
    instrument: { cy: 4, r: 2.5 },
    pot: { cy: 4.4, r: 3 },
    crown: { cy: 4.6, r: 2.2 },
    fence: { cy: 5, r: 2 },
    stairs: { cy: 6, r: 2.2 },
    tower: { cy: 8, r: 2.2 },
    house: { cy: 3.8, r: 2.6 },
    castle: { cy: 5, r: 3 },
    bag: { cy: 5, r: 3 },
    table: { cy: 3, r: 2.2 },
    chair: { cy: 8.6, r: 2.2 },
    door: { cy: 11, r: 3.4 },
    window: { cy: 8, r: 3.4 },
    light: { cy: 13.8, r: 1.7 },
    weapon: { cy: 11, r: 1.5 },
    book: { cy: 1.7, r: 1.5 },
    box: { cy: 4.2, r: 3.1 },
    bed: { cy: 3.6, r: 2.3 },
    vehicle: { cy: 5.2, r: 3.4 },
    plant: { cy: 8, r: 3.2 },
    cup: { cy: 2.2, r: 1.8 },
    phone: { cy: 3, r: 1.7 },
    generic: { cy: 3.3, r: 2.7 },
    flower: { cy: 11.8, r: 2.8 },
    grass: { cy: 4.4, r: 2.2 },
    tree: { cy: 12.6, r: 4.4 },
    stone: { cy: 4.2, r: 3.4 },
    mushroom: { cy: 4.6, r: 2.4 },
    cactus: { cy: 6.8, r: 2 }
  };

  /**
   * 登记扩展的道具图形（由 stage-storyboard-preview-props.js 调用）：图形、高度与会说话时脸的位置三者的键必须一致。
   * @param {Record<string, Function>} painters 图形绘制函数。
   * @param {Record<string, number>} heights 图形高度（单位 u）。
   * @param {Record<string, { cy: number, r: number }>} faces 脸的位置。
   */
  function registerProps(painters, heights, faces) {
    Object.assign(PROP_PAINTERS, painters);
    Object.assign(PROP_HEIGHT, heights);
    Object.assign(PROP_FACE, faces);
  }

  /** 画一个道具：影子（noShadow 时不画）加对应的图形。 */
  function drawProp(ctx, glyph, x, y, u, color, noShadow) {
    if (!noShadow) {
      ctx.fillStyle = SHADOW;
      ctx.beginPath();
      ctx.ellipse(x, y, 7 * u, 1.3 * u, 0, 0, TAU);
      ctx.fill();
    }
    (PROP_PAINTERS[glyph] || PROP_PAINTERS.generic)(ctx, x, y, u, color);
  }

  /** 道具的资产缩略图：圆角方块里按填满方式画图，加描边。 */
  function drawImageTile(ctx, image, x, y, u) {
    const size = 12 * u;
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.ellipse(x, y, 7 * u, 1.3 * u, 0, 0, TAU);
    ctx.fill();
    ctx.save();
    roundedRect(ctx, x - size / 2, y - size, size, size, 1.6 * u);
    ctx.clip();
    drawCover(ctx, image, x - size / 2, y - size, size, size);
    ctx.restore();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 0.6 * u;
    roundedRect(ctx, x - size / 2, y - size, size, size, 1.6 * u);
    ctx.stroke();
  }

  // ---------- 特效 ----------

  /** 扩展特效的绘制函数表，由 registerEffects 登记。 */
  const EXTRA_EFFECTS = {};

  /** 四角星：spark 与 light 特效共用。 */
  function drawStar(ctx, cx, cy, radius, points, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let index = 0; index < points * 2; index += 1) {
      const angle = (Math.PI * index) / points - Math.PI / 2;
      const length = index % 2 === 0 ? radius : radius * 0.32;
      if (index === 0) ctx.moveTo(cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
      else ctx.lineTo(cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
    }
    ctx.closePath();
    ctx.fill();
  }

  /** 火焰：外焰与内焰，随时间摇曳。 */
  function drawFlame(ctx, x, y, radius, flicker, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x, y - radius * (1.7 + flicker));
    ctx.quadraticCurveTo(x + radius * 0.95, y - radius * 0.6, x, y);
    ctx.quadraticCurveTo(x - radius * 0.95, y - radius * 0.6, x, y - radius * (1.7 + flicker));
    ctx.fill();
  }

  /** 画一个特效：按图形类型画火焰、烟、雨、雪、光芒或火花；r 为特效半径。 */
  function drawEffect(ctx, glyph, x, y, r, color, time, reducedMotion, options) {
    const base = ctx.globalAlpha;
    const cycle = reducedMotion ? 0.25 : time;
    const cy = y - r;
    switch (glyph) {
      case 'fire':
        drawFlame(ctx, x, y, r, 0.08 * Math.sin(cycle * 12), '#F76B15');
        drawFlame(ctx, x, y, r * 0.55, 0.1 * Math.sin(cycle * 15 + 1), '#FFD60A');
        break;
      case 'smoke':
        for (let index = 0; index < 3; index += 1) {
          const rise = ((cycle * 0.3 + index / 3) % 1) * r * 0.4;
          circle(ctx, x + (index - 1) * r * 0.25, y - r * (0.4 + 0.5 * index) - rise, r * (0.45 + 0.15 * index), 'rgba(200, 205, 212, 0.55)');
        }
        break;
      case 'rain':
        ctx.strokeStyle = '#9CC8EA';
        ctx.lineWidth = Math.max(1, r * 0.06);
        for (let index = -2; index <= 2; index += 1) {
          const drop = ((cycle * 1.5 + index * 0.37) % 1) * r * 0.5;
          ctx.beginPath();
          ctx.moveTo(x + index * r * 0.5, y - r * 1.8 + drop);
          ctx.lineTo(x + index * r * 0.5 - r * 0.2, y - r * 1.2 + drop);
          ctx.stroke();
        }
        break;
      case 'snow':
        for (let index = -3; index <= 3; index += 1) {
          const fall = ((cycle * 0.4 + index * 0.21 + 1) % 1) * r * 1.4;
          circle(ctx, x + index * r * 0.3, y - r * 1.8 + fall, Math.max(1.5, r * 0.07), '#FFFFFF');
        }
        break;
      case 'light':
        ctx.globalAlpha = base * 0.3;
        circle(ctx, x, cy, r, '#FFF3B0');
        ctx.globalAlpha = base;
        drawStar(ctx, x, cy, r, 8, '#FFF3B0');
        break;
      case 'lightning': {
        ctx.strokeStyle = '#FFF3B0';
        ctx.lineWidth = Math.max(2, r * 0.14);
        ctx.lineJoin = 'miter';
        ctx.beginPath();
        ctx.moveTo(x + r * 0.3, y - r * 2.1);
        ctx.lineTo(x - r * 0.25, y - r * 1.2);
        ctx.lineTo(x + r * 0.25, y - r * 1.15);
        ctx.lineTo(x - r * 0.3, y - r * 0.1);
        ctx.stroke();
        ctx.globalAlpha = base * 0.25;
        circle(ctx, x, y - r * 1.1, r * 0.9, '#9CC8FF');
        break;
      }
      case 'magic': {
        ctx.strokeStyle = '#A78BFA';
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
        ctx.fillStyle = '#A78BFA';
        ctx.fill();
        break;
      }
      case 'heart': {
        const beat = reducedMotion ? 1 : 1 + 0.12 * Math.sin(cycle * TAU * 1.5);
        const size = r * 0.9 * beat;
        ctx.fillStyle = '#F0457A';
        ctx.beginPath();
        ctx.moveTo(x, cy + size * 0.9);
        ctx.bezierCurveTo(x - size * 1.5, cy - size * 0.1, x - size * 0.7, cy - size * 1.2, x, cy - size * 0.35);
        ctx.bezierCurveTo(x + size * 0.7, cy - size * 1.2, x + size * 1.5, cy - size * 0.1, x, cy + size * 0.9);
        ctx.fill();
        break;
      }
      case 'notes': {
        ctx.strokeStyle = '#FFFFFF';
        ctx.fillStyle = '#FFFFFF';
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
        break;
      }
      case 'wind': {
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
        break;
      }
      case 'bubbles': {
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
        break;
      }
      case 'leaves': {
        for (let index = 0; index < 4; index += 1) {
          const fall = ((cycle * 0.3 + index / 4) % 1) * r * 1.8;
          ctx.fillStyle = index % 2 === 0 ? '#E58F2A' : '#6FA83F';
          ctx.beginPath();
          ctx.ellipse(x + Math.sin(cycle * 2 + index) * r * 0.4 + (index - 1.5) * r * 0.35, y - r * 1.9 + fall, r * 0.22, r * 0.11, cycle * 2 + index, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'dark': {
        ctx.globalAlpha = base * 0.7;
        for (const [dx, dy, scale] of [[-0.5, 0.2, 0.7], [0.5, 0, 0.8], [0, -0.5, 0.9], [0.1, 0.4, 0.6]]) {
          circle(ctx, x + dx * r + Math.sin(cycle * 1.5 + dy) * r * 0.1, cy + dy * r, r * scale, 'rgba(40, 25, 60, 0.7)');
        }
        break;
      }
      case 'shockwave': {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        for (let index = 0; index < 2; index += 1) {
          const grow = (cycle * 0.6 + index * 0.5) % 1;
          ctx.lineWidth = Math.max(1, r * 0.1 * (1 - grow));
          ctx.globalAlpha = base * (1 - grow);
          ctx.beginPath();
          ctx.ellipse(x, y - r * 0.2, r * (0.4 + 1.4 * grow), r * (0.15 + 0.5 * grow), 0, 0, TAU);
          ctx.stroke();
        }
        break;
      }
      default:
        if (EXTRA_EFFECTS[glyph]) EXTRA_EFFECTS[glyph](ctx, x, y, r, color, cycle, Boolean(reducedMotion), options || {});
        else drawStar(ctx, x, cy, r * (reducedMotion ? 1 : 1 + 0.1 * Math.sin(cycle * TAU)), 4, color);
    }
    ctx.globalAlpha = base;
  }

  /** 登记扩展的特效图形；绘制函数的参数为 (ctx, x, y, r, color, cycle, reducedMotion, { angle })，angle 是特效前进方向（弧度，0 朝右）。 */
  function registerEffects(painters) {
    Object.assign(EXTRA_EFFECTS, painters);
  }

  /** 登记扩展的场景背景，键为场景类型。 */
  function registerBackdrops(painters) {
    Object.assign(BACKDROPS, painters);
  }

  window.aiStoryboardArt = { FIGURE_HEIGHT, TAU, PROP_HEIGHT, PROP_FACE, shade, linear, circle, roundedRect, drawCover, drawAvatar, headOf, drawBackdrop, drawFigure, drawProp, drawImageTile, drawEffect, registerProps, registerEffects, registerBackdrops, drawGround, drawWindow, rand, SKY, HORIZON };
})();
