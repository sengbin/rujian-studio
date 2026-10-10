// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-art-backdrops.js
// 说明：分镜动画的场景背景矢量插画：按场景类型与时间画室内、街道、森林、洞穴、海边、旷野、太空、水下、天空、沙漠、雪地、高山、废墟、村庄与通用背景，再叠加时间色调，并提供墙上的窗户。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：依赖 stage-storyboard-preview-draw.js 与 stage-storyboard-preview-art-props.js（沙漠、村庄背景里摆的道具），通过 window.aiStoryboardArtBackdrops 暴露，由 stage-storyboard-preview-art.js 汇总；厨房、卫生间、卧室、医院、教室、商店背景由 stage-storyboard-preview-props-backdrops.js 经 registerBackdrops 登记；颜色固定，不随主题变化。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const { TAU, HORIZON, shade, linear, rand, circle, polygon, drawGround, drawRoom, drawTufts, drawStars } = window.aiStoryboardDraw;
  const { PROPS } = window.aiStoryboardArtProps;

  /** 天空渐变（上、下）与时间色调叠加。 */
  const SKY = { day: ['#6FB1E8', '#CFE8F7'], dusk: ['#4C3F7A', '#F4A261'], dawn: ['#7C93C9', '#F8D7B0'], night: ['#0A1030', '#27346A'] };
  const TIME_TINT = { day: '', dusk: 'rgba(255, 120, 40, 0.14)', dawn: 'rgba(255, 190, 140, 0.12)', night: 'rgba(8, 12, 40, 0.38)' };
  /** 远景建筑与树木的明暗系数。 */
  const FAR_LIGHT = { day: 0.85, dawn: 0.75, dusk: 0.6, night: 0.35 };


  /** 天空：渐变，夜晚有星星与月亮，黄昏与清晨有贴着地平线的太阳，白天有太阳与云。bottom 为天空下沿的 y。 */
  function drawSky(ctx, scene, width, height, bottom) {
    const base = ctx.globalAlpha;
    const colors = SKY[scene.time] || SKY.day;
    ctx.fillStyle = linear(ctx, 0, 0, 0, bottom, [[0, colors[0]], [1, colors[1]]]);
    ctx.fillRect(-width, -height, width * 3, bottom + height);
    if (scene.time === 'night') {
      drawStars(ctx, scene, width, height, { count: 46, yRange: bottom * 0.85, size: 0.0012, sizeRange: 0.0018 });
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

  /** 室内：墙面、踢脚线与地板，一侧开窗、另一侧挂画。 */
  function drawIndoor(ctx, scene, width, height) {
    const horizon = drawRoom(ctx, width, height, scene.wall, scene.floor, 0.85, 0.7);
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

  /** 街道：远处的楼房（夜晚亮窗）、路面、人行道与路灯。 */
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

  /** 森林：两层远处的树冠、草地与草丛。 */
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
    drawTufts(ctx, scene, width, height, { stroke: 'rgba(20, 50, 20, 0.5)', count: 40, top: 0.56, range: 0.4, spread: 0.008, rise: 0.02 });
  }

  /** 洞穴：暗色岩壁、钟乳石、地面与中央的暖光。 */
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

  /** 海边：海面、浪纹、远处的帆船与沙滩。 */
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

  /** 旷野：远山、草地与草丛。 */
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
    drawTufts(ctx, scene, width, height, { stroke: 'rgba(30, 70, 20, 0.45)', count: 50, top: 0.55, range: 0.42, spread: 0.006, rise: 0.018 });
  }

  /** 通用背景：用场景实体的墙色与地面色画一面墙和一片地。 */
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

  /** 太空：星空、带环的行星、卫星与布满陨石坑的地面。 */
  function drawSpace(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    ctx.fillStyle = linear(ctx, 0, 0, 0, horizon, [[0, '#04051A'], [1, '#1B1B4A']]);
    ctx.fillRect(-width, -height, width * 3, horizon + height);
    const left = -0.25 * width;
    drawStars(ctx, scene, width, height, { count: 90, yRange: horizon, size: 0.0012, sizeRange: 0.002 });
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

  /** 水下：渐变水色、光束、海底沙地、海草与气泡。 */
  function drawUnderwater(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    ctx.fillStyle = linear(ctx, 0, 0, 0, height, [[0, '#0B6AA0'], [1, '#07324F']]);
    ctx.fillRect(-width, -height, width * 3, height * 3);
    const left = -0.25 * width;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    for (let index = 0; index < 5; index += 1) {
      const x = left + (index / 4) * 1.5 * width;
      polygon(ctx, [[x, -height * 0.1], [x + width * 0.05, -height * 0.1], [x + width * 0.16, horizon + height * 0.1], [x + width * 0.04, horizon + height * 0.1]], 'rgba(255, 255, 255, 0.07)');
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

  /** 天空：天空渐变、脚下的云海与远处的云。 */
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

  /** 沙漠：沙丘、沙地、风成的纹路与仙人掌。 */
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
    PROPS.cactus.paint(ctx, width * 0.12, horizon + height * 0.08, height * 0.012);
  }

  /** 雪地：雪山、雪地、杂树与飘落的雪花。 */
  function drawSnowScene(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    drawSky(ctx, scene, width, height, horizon);
    const light = FAR_LIGHT[scene.time] || 0.85;
    for (const [cx, peak, base, tone] of [[0.22, 0.2, 0.32, '#B8C8E0'], [0.62, 0.12, 0.4, '#C9D6EA'], [0.92, 0.24, 0.3, '#B1C2DC']]) {
      polygon(ctx, [[width * (cx - base), horizon], [width * cx, height * peak], [width * (cx + base), horizon]], shade(tone, light));
      polygon(ctx, [[width * (cx - base * 0.28), height * (peak + 0.09)], [width * cx, height * peak], [width * (cx + base * 0.28), height * (peak + 0.09)]], '#FFFFFF');
    }
    drawGround(ctx, width, height, horizon, shade('#F4F8FF', light + 0.1), shade('#CFDDF0', light + 0.1));
    for (let index = 0; index < 6; index += 1) {
      const x = -0.2 * width + rand(scene.seed, index) * 1.4 * width;
      const y = horizon + height * 0.02 * rand(scene.seed, index + 9);
      polygon(ctx, [[x - width * 0.02, y], [x, y - height * 0.12], [x + width * 0.02, y]], shade('#2F6B4A', light));
      polygon(ctx, [[x - width * 0.012, y - height * 0.06], [x, y - height * 0.12], [x + width * 0.012, y - height * 0.06]], '#FFFFFF');
    }
    for (let index = 0; index < 40; index += 1) circle(ctx, -0.2 * width + rand(scene.seed, index + 400) * 1.4 * width, rand(scene.seed, index + 500) * height, height * 0.004, 'rgba(255, 255, 255, 0.85)');
  }

  /** 高山：两层远山（山顶有积雪）、岩石地面与碎石。 */
  function drawMountainScene(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    drawSky(ctx, scene, width, height, horizon);
    const light = FAR_LIGHT[scene.time] || 0.85;
    for (const [layer, tone, count] of [[0, '#7E8FAA', 4], [1, '#56667F', 3]]) {
      for (let index = 0; index < count; index += 1) {
        const cx = -0.1 + (index + 0.5 + 0.3 * rand(scene.seed, index + layer * 10)) / count * 1.2;
        const peak = 0.14 + 0.16 * rand(scene.seed, index + layer * 10 + 4) + layer * 0.08;
        const half = 0.2 + 0.12 * rand(scene.seed, index + layer * 10 + 8);
        polygon(ctx, [[width * (cx - half), horizon], [width * cx, height * peak], [width * (cx + half), horizon]], shade(tone, light));
        polygon(ctx, [[width * (cx - half * 0.22), height * (peak + 0.07)], [width * cx, height * peak], [width * (cx + half * 0.22), height * (peak + 0.07)]], 'rgba(255, 255, 255, 0.85)');
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

  /** 废墟：残缺的立柱、碎石地面。 */
  function drawRuinsScene(ctx, scene, width, height) {
    const horizon = height * HORIZON;
    drawSky(ctx, scene, width, height, horizon);
    const light = FAR_LIGHT[scene.time] || 0.85;
    for (let index = 0; index < 6; index += 1) {
      const x = -0.15 * width + (index / 5) * 1.3 * width;
      const columnHeight = height * (0.12 + 0.2 * rand(scene.seed, index));
      ctx.fillStyle = shade('#B9B1A0', light);
      ctx.fillRect(x, horizon - columnHeight, width * 0.03, columnHeight);
      polygon(ctx, [[x, horizon - columnHeight], [x + width * 0.012, horizon - columnHeight - height * 0.02], [x + width * 0.02, horizon - columnHeight + height * 0.01], [x + width * 0.03, horizon - columnHeight - height * 0.01], [x + width * 0.03, horizon - columnHeight]], shade('#B9B1A0', light));
    }
    drawGround(ctx, width, height, horizon, shade('#8B7F6A', light + 0.1), shade('#5E5646', light + 0.1));
    for (let index = 0; index < 12; index += 1) {
      ctx.fillStyle = shade('#6E6454', light + 0.1);
      ctx.beginPath();
      ctx.ellipse(-0.2 * width + rand(scene.seed, index + 300) * 1.4 * width, height * (0.55 + 0.4 * rand(scene.seed, index + 400)), width * 0.022, height * 0.014, 0, 0, TAU);
      ctx.fill();
    }
  }

  /** 村庄：远山、草地、几座房子、小路与篱笆。 */
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
      PROPS.house.paint(ctx, width * (0.1 + index * 0.27 + 0.04 * rand(scene.seed, index)), horizon + height * 0.03, height * 0.01 * (0.9 + 0.2 * rand(scene.seed, index + 9)), shade(tones[index % 3], light));
    }
    polygon(ctx, [[width * 0.4, height], [width * 0.46, horizon + height * 0.03], [width * 0.54, horizon + height * 0.03], [width * 0.72, height]], shade('#B79B6A', light + 0.1));
    PROPS.fence.paint(ctx, width * 0.9, horizon + height * 0.12, height * 0.012, '#B98B5A');
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

  /** 登记扩展的场景背景，键为场景类型。 */
  function registerBackdrops(painters) {
    Object.assign(BACKDROPS, painters);
  }

  window.aiStoryboardArtBackdrops = { drawBackdrop, drawWindow, registerBackdrops };
})();
