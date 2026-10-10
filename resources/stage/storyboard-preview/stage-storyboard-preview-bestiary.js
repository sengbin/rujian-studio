// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-bestiary.js
// 说明：分镜动画的动物与微生物扩展：鸟类（鸡、鸭、鹅、猫头鹰、鹦鹉、企鹅、鹰、孔雀、鸵鸟）、水生动物（鲨、鲸与海豚、章鱼、水母、蟹虾、海星）、昆虫与节肢动物（蝴蝶、蜜蜂、瓢虫、蚂蚁、蜘蛛、蜻蜓、蜗牛、虫、甲虫），以及病毒、细菌、真菌、变形虫。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：依赖 stage-storyboard-preview-draw.js 与 stage-storyboard-preview-creatures.js，通过它的 register 登记种类，种类的归类关键词见 stage-storyboard-preview-rules.js 的 SPECIES_RULES；每个图形返回头部位置与总高度（单位 u），有资产图时头部换成圆形头像；颜色沿用角色的识别色，少数有固定配色（企鹅、瓢虫、鹅等）。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const creatures = window.aiStoryboardCreatures;
  const { TAU, SHADOW, WALK_SPEED, DARK, shade, circle, ellipse, polygon, line, star, roundedRect, drawAvatar } = window.aiStoryboardDraw;
  const { sideOf, mouthOpen, finish, cuteFace } = creatures.toolkit;

  /** 脸的位置有头像时画头像，否则画圆脸。 */
  function faceOrAvatar(ctx, spec, cx, cy, r) {
    if (spec.image) drawAvatar(ctx, spec.image, cx, cy, r * 1.3, 0.5 * spec.unit);
    else cuteFace(ctx, spec, cx, cy, r);
  }

  // ---------- 鸟类 ----------

  /** 各种鸟的参数：body 为身体半宽半高，neck 为脖子长度，legLen 为腿长，其余是特征。 */
  const BIRDS = {
    chicken: { body: [5.2, 4.2], headR: 2.6, neck: 0, legLen: 3, beak: 'short', comb: true, wattle: true, tail: 'up', height: 15 },
    duck: { body: [5.4, 3.6], headR: 2.4, neck: 0, legLen: 2.4, beak: 'flat', tail: 'short', legTone: 'rgb(242, 163, 58)', height: 13 },
    goose: { body: [6, 4], headR: 2.2, neck: 5, legLen: 3, beak: 'flat', tail: 'short', color: 'rgb(246, 246, 242)', legTone: 'rgb(242, 163, 58)', height: 20 },
    owl: { body: [4.6, 5.6], headR: 3.2, neck: 0, legLen: 2, beak: 'tiny', tufts: true, bigEyes: true, tail: 'short', height: 17 },
    parrot: { body: [3.6, 5], headR: 2.6, neck: 0, legLen: 2.4, beak: 'hook', beakTone: 'rgb(232, 184, 74)', tail: 'long', wingTone: 'rgb(63, 155, 90)', height: 18 },
    penguin: { body: [4.2, 6.4], headR: 2.6, neck: 0, legLen: 1.6, beak: 'short', upright: true, color: 'rgb(42, 46, 54)', bellyTone: 'rgb(255, 255, 255)', headTone: 'rgb(42, 46, 54)', legTone: 'rgb(242, 163, 58)', tail: 'none', height: 17 },
    eagle: { body: [5, 4.6], headR: 2.6, neck: 0, legLen: 3, beak: 'hook', headTone: 'rgb(244, 244, 244)', tail: 'short', bigWing: true, height: 17 },
    peacock: { body: [4.4, 3.6], headR: 2, neck: 4, legLen: 5, beak: 'short', tail: 'fan', color: 'rgb(46, 125, 154)', height: 22 },
    ostrich: { body: [5.4, 4.6], headR: 2.2, neck: 7, legLen: 9, beak: 'flat', tail: 'short', color: 'rgb(90, 74, 68)', bellyTone: 'rgb(244, 244, 244)', height: 31 }
  };

  /** 画鸟的尾巴。 */
  function drawBirdTail(ctx, cfg, spec, side, x, bodyY, color) {
    const u = spec.unit;
    const [rx] = cfg.body;
    const back = x - side * rx * u;
    if (cfg.tail === 'up') {
      for (const [dx, dy] of [[0, -4.6], [0.8, -3.8], [-0.6, -3.4]]) polygon(ctx, [[back + side * 0.4 * u, bodyY - 0.4 * u], [back + side * dx * u - side * 1.4 * u, bodyY + dy * u], [back + side * 1.2 * u, bodyY - 1.4 * u]], shade(color, 0.6 + 0.1 * dx));
    } else if (cfg.tail === 'short') {
      polygon(ctx, [[back + side * 1 * u, bodyY - 1 * u], [back - side * 4 * u, bodyY - 2 * u], [back - side * 3.4 * u, bodyY + 1.4 * u]], shade(color, 0.7));
    } else if (cfg.tail === 'long') {
      polygon(ctx, [[back + side * 1 * u, bodyY - 0.6 * u], [back - side * 9 * u, bodyY + 3.4 * u], [back - side * 7 * u, bodyY + 4.6 * u], [back + side * 1 * u, bodyY + 1.6 * u]], 'rgb(229, 72, 77)');
    } else if (cfg.tail === 'fan') {
      const tones = ['rgb(63, 155, 90)', 'rgb(46, 125, 154)', 'rgb(232, 184, 74)'];
      for (let index = 0; index < 7; index += 1) {
        const angle = -0.9 + index * 0.3;
        const ex = back - side * Math.cos(angle) * 9 * u;
        const ey = bodyY - Math.sin(angle) * 9 * u;
        line(ctx, back + side * 0.6 * u, bodyY - 0.4 * u, ex, ey, 'rgb(63, 155, 90)', 0.5 * u);
        circle(ctx, ex, ey, 1.4 * u, tones[index % 3]);
        circle(ctx, ex, ey, 0.55 * u, 'rgb(31, 63, 138)');
      }
    }
  }

  /** 鸟的通用画法：身体、翅膀、尾巴、腿、脖子、头与嘴，按参数表变化。 */
  function drawBirdKind(ctx, spec, cfg) {
    const { x, y, unit: u } = spec;
    const color = cfg.color || spec.color;
    const side = sideOf(spec);
    const [rx, ry] = cfg.body;
    const hop = spec.walking ? Math.abs(Math.sin(spec.phase * WALK_SPEED)) * 1.2 * u : 0;
    const flap = spec.walking || spec.speaking ? Math.sin(spec.phase * 12) * 0.5 : 0;
    const bodyY = y - (cfg.legLen + ry) * u - hop;
    const headX = x + side * (cfg.upright ? 0.4 : 3.6 + (cfg.neck ? cfg.neck * 0.3 : 0)) * u;
    const headY = cfg.upright ? bodyY - (ry + cfg.headR * 0.5) * u : bodyY - (ry * 0.8 + (cfg.neck || 0)) * u;

    ellipse(ctx, x, y, rx * 1.05 * u, 1.3 * u, SHADOW);
    for (const dx of [-0.8, 1.2]) {
      line(ctx, x + dx * u, bodyY + ry * 0.6 * u, x + dx * u, y - 0.2 * u, cfg.legTone || 'rgb(217, 138, 43)', 0.7 * u);
      if (cfg.upright) ellipse(ctx, x + dx * u + side * 0.8 * u, y - 0.3 * u, 1.3 * u, 0.5 * u, cfg.legTone);
    }
    drawBirdTail(ctx, cfg, spec, side, x, bodyY, color);
    ellipse(ctx, x, bodyY, rx * u, ry * u, color);
    ellipse(ctx, x + side * 0.8 * u, bodyY + ry * 0.3 * u, rx * 0.6 * u, ry * 0.55 * u, cfg.bellyTone || shade(color, 1.4));
    const wingScale = cfg.bigWing ? 1.25 : 1;
    ellipse(ctx, x - side * 0.8 * u, bodyY - 0.4 * u, rx * 0.65 * wingScale * u, ry * 0.45 * wingScale * u, cfg.wingTone || shade(color, 0.7), -side * (0.5 + flap));
    if (cfg.neck) line(ctx, x + side * rx * 0.5 * u, bodyY - ry * 0.3 * u, headX, headY, color, cfg.headR * 0.9 * u);

    if (cfg.tufts) for (const s of [-1, 1]) polygon(ctx, [[headX + s * cfg.headR * 0.4 * u, headY - cfg.headR * 0.8 * u], [headX + s * cfg.headR * 0.9 * u, headY - cfg.headR * 1.7 * u], [headX + s * cfg.headR * 1.05 * u, headY - cfg.headR * 0.5 * u]], shade(color, 0.7));
    if (spec.image) {
      drawAvatar(ctx, spec.image, headX, headY, cfg.headR * 1.4 * u, 0.5 * u);
    } else {
      circle(ctx, headX, headY, cfg.headR * u, cfg.headTone || shade(color, 1.1));
      if (cfg.comb) for (const dx of [-0.5, 0.2, 0.9]) circle(ctx, headX + dx * u, headY - cfg.headR * 1.05 * u, 0.8 * u, 'rgb(214, 64, 58)');
      const open = mouthOpen(spec) * 1.1 * u;
      const bx = headX + side * cfg.headR * 0.85 * u;
      const tone = cfg.beakTone || 'rgb(242, 163, 58)';
      if (cfg.beak === 'flat') ellipse(ctx, bx + side * 1.2 * u, headY + 0.5 * u + open * 0.2, 2 * u, 0.8 * u + open * 0.3, tone);
      else if (cfg.beak === 'hook') polygon(ctx, [[bx, headY - 0.9 * u], [bx + side * 2.8 * u, headY + 0.2 * u], [bx + side * 1.6 * u, headY + 1.8 * u + open], [bx, headY + 0.9 * u]], tone);
      else if (cfg.beak === 'tiny') polygon(ctx, [[bx - side * 0.6 * u, headY - 0.3 * u], [bx + side * 1.2 * u, headY + 0.5 * u], [bx - side * 0.6 * u, headY + 1 * u]], tone);
      else polygon(ctx, [[bx, headY - 0.7 * u - open * 0.4], [bx + side * 2.6 * u, headY + 0.1 * u], [bx, headY + 0.7 * u]], tone);
      if (cfg.wattle) ellipse(ctx, bx + side * 0.3 * u, headY + 1.6 * u, 0.5 * u, 0.9 * u, 'rgb(214, 64, 58)');
      if (cfg.bigEyes) {
        for (const s of [-1, 1]) {
          circle(ctx, headX + s * cfg.headR * 0.42 * u + side * 0.2 * u, headY - 0.2 * u, 1.1 * u, 'rgb(255, 233, 160)');
          circle(ctx, headX + s * cfg.headR * 0.42 * u + side * 0.3 * u, headY - 0.2 * u, 0.5 * u, DARK);
        }
      } else {
        circle(ctx, headX + side * 0.7 * u, headY - 0.5 * u, 0.55 * u, DARK);
      }
    }
    return finish(ctx, spec, cfg.height, Math.max(7, rx + 2), { headX, headY, headR: (spec.image ? 1.4 : 1) * cfg.headR * u });
  }

  const BIRD_PAINTERS = {};
  for (const [kind, cfg] of Object.entries(BIRDS)) BIRD_PAINTERS[kind] = (ctx, spec) => drawBirdKind(ctx, spec, cfg);

  // ---------- 水生动物 ----------

  /** 鲨鱼：侧视图，背鳍、胸鳍与尖牙，尾巴摆动。 */
  function drawShark(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const side = sideOf(spec);
    const cy = y - 10 * u + Math.sin(spec.phase * 3) * 0.8 * u;
    const wag = Math.sin(spec.phase * (spec.walking ? 10 : 4)) * 1.4 * u;
    ellipse(ctx, x, y, 8 * u, 1.3 * u, SHADOW);
    polygon(ctx, [[x - side * 7 * u, cy], [x - side * 12 * u, cy - 4.4 * u + wag], [x - side * 11 * u, cy + wag * 0.4], [x - side * 12 * u, cy + 4 * u + wag]], shade(color, 0.7));
    ellipse(ctx, x, cy, 8.4 * u, 3.6 * u, color);
    ellipse(ctx, x + side * 0.6 * u, cy + 1.6 * u, 6.8 * u, 1.9 * u, 'rgb(240, 242, 244)');
    polygon(ctx, [[x - side * 1 * u, cy - 3.2 * u], [x - side * 3.2 * u, cy - 8 * u], [x - side * 4.2 * u, cy - 3 * u]], shade(color, 0.7));
    polygon(ctx, [[x + side * 1 * u, cy + 2.4 * u], [x - side * 1.6 * u, cy + 5.4 * u], [x - side * 2.4 * u, cy + 2.4 * u]], shade(color, 0.7));
    const headX = x + side * 5 * u;
    if (spec.image) {
      drawAvatar(ctx, spec.image, headX, cy, 3.4 * u, 0.5 * u);
    } else {
      circle(ctx, headX + side * 0.4 * u, cy - 0.9 * u, 0.8 * u, 'rgb(255, 255, 255)');
      circle(ctx, headX + side * 0.6 * u, cy - 0.9 * u, 0.4 * u, DARK);
      const open = mouthOpen(spec);
      ellipse(ctx, x + side * 7.4 * u, cy + 1 * u, 1.8 * u, (0.3 + open) * u, 'rgb(90, 42, 42)');
      for (let index = 0; index < 3; index += 1) polygon(ctx, [[x + side * (6.2 + index * 0.9) * u - 0.4 * u, cy + 0.5 * u], [x + side * (6.2 + index * 0.9) * u, cy + 1.6 * u], [x + side * (6.2 + index * 0.9) * u + 0.4 * u, cy + 0.5 * u]], 'rgb(255, 255, 255)');
    }
    return finish(ctx, spec, 16, 12, { headX, headY: cy, headR: (spec.image ? 3.4 : 3.6) * u });
  }

  /** 鲸鱼与海豚：侧视图，肚皮浅色，头顶喷水，尾巴摆动。 */
  function drawWhale(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const side = sideOf(spec);
    const cy = y - 11 * u + Math.sin(spec.phase * 2.5) * 0.9 * u;
    const wag = Math.sin(spec.phase * (spec.walking ? 8 : 3)) * 1.6 * u;
    ellipse(ctx, x, y, 9 * u, 1.4 * u, SHADOW);
    polygon(ctx, [[x - side * 8 * u, cy], [x - side * 13 * u, cy - 4 * u + wag], [x - side * 11.4 * u, cy + 0.4 * u + wag * 0.4], [x - side * 13 * u, cy + 4.6 * u + wag]], shade(color, 0.7));
    ellipse(ctx, x, cy, 9.6 * u, 6 * u, color);
    ellipse(ctx, x + side * 0.6 * u, cy + 2.8 * u, 7.6 * u, 2.6 * u, shade(color, 1.6));
    polygon(ctx, [[x + side * 1 * u, cy + 3 * u], [x - side * 2.2 * u, cy + 7 * u], [x - side * 3 * u, cy + 3 * u]], shade(color, 0.7));
    const spout = ((spec.phase * 0.8) % 1) * 3 * u;
    for (const dx of [-0.8, 0, 0.8]) line(ctx, x + side * 2 * u + dx * u, cy - 6 * u, x + side * 2 * u + dx * 1.6 * u, cy - 6 * u - 2.4 * u - spout, 'rgba(160, 215, 250, 0.85)', 0.5 * u);
    const headX = x + side * 5.4 * u;
    if (spec.image) {
      drawAvatar(ctx, spec.image, headX, cy, 3.8 * u, 0.5 * u);
    } else {
      circle(ctx, headX, cy - 1.2 * u, 0.9 * u, 'rgb(255, 255, 255)');
      circle(ctx, headX + side * 0.2 * u, cy - 1.2 * u, 0.45 * u, DARK);
      ellipse(ctx, x + side * 7.2 * u, cy + 1.6 * u, 2.6 * u, (0.3 + mouthOpen(spec) * 1.2) * u, 'rgb(90, 42, 42)');
    }
    return finish(ctx, spec, 20, 13, { headX, headY: cy, headR: 4 * u });
  }

  /** 章鱼与乌贼：圆头加八条随时间摆动的触手。 */
  function drawOctopus(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const sway = spec.phase * (spec.walking ? 6 : 2);
    const headY = y - 12 * u;
    ellipse(ctx, x, y, 7 * u, 1.3 * u, SHADOW);
    for (let index = 0; index < 8; index += 1) {
      const baseX = x + (index - 3.5) * 1.5 * u;
      const wave = Math.sin(sway + index) * 1.2 * u;
      ctx.strokeStyle = shade(color, 0.85);
      ctx.lineWidth = 1.4 * u;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(baseX, headY + 3 * u);
      ctx.quadraticCurveTo(baseX + wave * 1.6 + (index - 3.5) * 0.9 * u, y - 5 * u, baseX + (index - 3.5) * 1.1 * u + wave, y - 0.6 * u);
      ctx.stroke();
    }
    ellipse(ctx, x, headY, 6.4 * u, 6 * u, color);
    ellipse(ctx, x - 2 * u, headY - 2.6 * u, 1.6 * u, 1 * u, 'rgba(255, 255, 255, 0.4)', -0.5);
    faceOrAvatar(ctx, spec, x, headY + 0.8 * u, 4.4 * u);
    return finish(ctx, spec, 19, 8, { headX: x, headY, headR: 6 * u });
  }

  /** 水母：半透明的伞盖加随时间飘动的触须，上下浮动。 */
  function drawJellyfish(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const bob = Math.sin(spec.phase * 2) * 1.2 * u;
    const topY = y - 13 * u - bob;
    ellipse(ctx, x, y, 6 * u, 1.2 * u, SHADOW);
    for (let index = 0; index < 5; index += 1) {
      const baseX = x + (index - 2) * 1.8 * u;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 0.7 * u;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(baseX, topY + 3.6 * u);
      for (let step = 1; step <= 6; step += 1) ctx.lineTo(baseX + Math.sin(spec.phase * 3 + step + index) * 0.9 * u, topY + (3.6 + step * 1.5) * u);
      ctx.stroke();
    }
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * 0.82;
    ctx.fillStyle = shade(color, 1.4);
    ctx.beginPath();
    ctx.ellipse(x, topY + 2 * u, 6.4 * u, 5.6 * u, 0, Math.PI, 0);
    ctx.lineTo(x + 6.4 * u, topY + 3.6 * u);
    ctx.lineTo(x - 6.4 * u, topY + 3.6 * u);
    ctx.fill();
    ctx.globalAlpha = base;
    faceOrAvatar(ctx, spec, x, topY + 0.6 * u, 4 * u);
    return finish(ctx, spec, 22, 7, { headX: x, headY: topY, headR: 5.6 * u });
  }

  /** 螃蟹与虾：扁圆的身体、两只大钳子、柄上的眼睛与横着爬的腿。 */
  function drawCrab(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const scuttle = spec.walking ? Math.sin(spec.phase * WALK_SPEED) : 0;
    const cy = y - 3.8 * u;
    ellipse(ctx, x, y, 7 * u, 1.2 * u, SHADOW);
    for (const side of [-1, 1]) {
      for (let index = 0; index < 3; index += 1) {
        const lx = x + side * (2.6 + index * 1.3) * u;
        line(ctx, lx, cy + 1 * u, lx + side * 2.4 * u + scuttle * side * 0.6 * u, y - 0.2 * u, shade(color, 0.75), 0.7 * u);
      }
      line(ctx, x + side * 4.6 * u, cy - 0.4 * u, x + side * 7 * u, cy - 4 * u, shade(color, 0.85), 0.9 * u);
      circle(ctx, x + side * 7.2 * u, cy - 4.6 * u, 1.9 * u, color);
      polygon(ctx, [[x + side * 7.2 * u, cy - 4.6 * u], [x + side * 8.6 * u, cy - 7.4 * u], [x + side * 8.9 * u, cy - 4.8 * u]], color);
    }
    ellipse(ctx, x, cy, 6 * u, 3.8 * u, color);
    ellipse(ctx, x, cy + 1.2 * u, 4.6 * u, 1.6 * u, shade(color, 1.35));
    for (const side of [-1, 1]) {
      line(ctx, x + side * 1.6 * u, cy - 3 * u, x + side * 1.6 * u, cy - 5.4 * u, shade(color, 0.8), 0.5 * u);
      circle(ctx, x + side * 1.6 * u, cy - 5.6 * u, 1 * u, 'rgb(255, 255, 255)');
      circle(ctx, x + side * 1.6 * u, cy - 5.6 * u, 0.45 * u, DARK);
    }
    if (spec.image) drawAvatar(ctx, spec.image, x, cy, 3.4 * u, 0.5 * u);
    else ellipse(ctx, x, cy + 0.2 * u, 1.6 * u, (0.3 + mouthOpen(spec) * 0.9) * u, 'rgb(90, 42, 42)');
    return finish(ctx, spec, 11, 10, { headX: x, headY: cy - 5 * u, headR: (spec.image ? 3.4 : 1.6) * u });
  }

  /** 海星：五角星形的身体加点状纹路，脸画在中央。 */
  function drawStarfish(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const cy = y - 6.2 * u;
    const turn = spec.walking ? Math.sin(spec.phase * 4) * 0.12 : 0;
    ellipse(ctx, x, y, 6 * u, 1.2 * u, SHADOW);
    star(ctx, x, cy, 6.4 * u, 2.8 * u, 5, color, turn);
    for (let index = 0; index < 5; index += 1) {
      const angle = (TAU * index) / 5 - Math.PI / 2 + turn;
      for (const frac of [0.5, 0.8]) circle(ctx, x + Math.cos(angle) * 6.4 * frac * u, cy + Math.sin(angle) * 6.4 * frac * u, 0.4 * u, shade(color, 1.5));
    }
    faceOrAvatar(ctx, spec, x, cy, 3 * u);
    return finish(ctx, spec, 13, 7, { headX: x, headY: cy, headR: 3.2 * u });
  }

  // ---------- 昆虫与节肢动物 ----------

  /** 蝴蝶：一对翅膀随时间扇动，悬空浮动。 */
  function drawButterfly(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const cy = y - 11 * u + Math.sin(spec.phase * 3) * 1 * u;
    const flap = 0.3 + 0.7 * Math.abs(Math.sin(spec.phase * (spec.walking ? 12 : 7)));
    ellipse(ctx, x, y, 4 * u, 1 * u, SHADOW);
    for (const side of [-1, 1]) {
      ellipse(ctx, x + side * 3.6 * u * flap, cy - 2.4 * u, 3.8 * u * flap, 3.8 * u, color, side * 0.4);
      ellipse(ctx, x + side * 2.8 * u * flap, cy + 2.4 * u, 2.6 * u * flap, 2.8 * u, shade(color, 1.4), -side * 0.3);
      circle(ctx, x + side * 3.8 * u * flap, cy - 2.6 * u, 1 * u * flap, 'rgba(255, 255, 255, 0.7)');
      line(ctx, x + side * 0.4 * u, cy - 3.6 * u, x + side * 2.2 * u, cy - 6.4 * u, DARK, 0.35 * u);
    }
    ellipse(ctx, x, cy, 0.9 * u, 3.2 * u, 'rgb(58, 42, 34)');
    let headY = cy - 3.6 * u;
    if (spec.image) {
      headY = cy - 4.6 * u;
      drawAvatar(ctx, spec.image, x, headY, 3 * u, 0.5 * u);
    } else {
      circle(ctx, x, headY, 1.2 * u, 'rgb(58, 42, 34)');
    }
    return finish(ctx, spec, 15, 8, { headX: x, headY, headR: (spec.image ? 3 : 1.2) * u });
  }

  /** 蜜蜂：飞行的小蜜蜂（侧视图）。 */
  function drawBee(ctx, spec) {
    const { x, y, unit: u } = spec;
    const side = sideOf(spec);
    const cy = y - 10 * u + Math.sin(spec.phase * 4) * 1 * u;
    const flap = 0.4 + 0.6 * Math.abs(Math.sin(spec.phase * 16));
    ellipse(ctx, x, y, 4 * u, 1 * u, SHADOW);
    for (const s of [-1, 1]) ellipse(ctx, x - side * 0.6 * u + s * 0.6 * u, cy - 3.4 * u * flap - 1 * u, 1.8 * u, 3.2 * u * flap, 'rgba(210, 235, 255, 0.8)', s * 0.5);
    ellipse(ctx, x, cy, 4.6 * u, 3.2 * u, 'rgb(245, 200, 66)');
    for (const dx of [-1.6, 0, 1.6]) ellipse(ctx, x + dx * u, cy, 0.7 * u, 3 * u, 'rgb(42, 42, 42)');
    polygon(ctx, [[x - side * 4.4 * u, cy - 0.6 * u], [x - side * 6.4 * u, cy], [x - side * 4.4 * u, cy + 0.6 * u]], 'rgb(42, 42, 42)');
    const headX = x + side * 4.4 * u;
    if (spec.image) drawAvatar(ctx, spec.image, headX, cy - 1 * u, 3 * u, 0.5 * u);
    else {
      circle(ctx, headX, cy - 0.4 * u, 2 * u, 'rgb(58, 42, 34)');
      circle(ctx, headX + side * 0.6 * u, cy - 0.8 * u, 0.6 * u, 'rgb(255, 255, 255)');
    }
    return finish(ctx, spec, 14, 7, { headX, headY: cy - 0.4 * u, headR: (spec.image ? 3 : 2) * u });
  }

  /** 瓢虫：圆圆的红色身体（固定配色）。 */
  function drawLadybug(ctx, spec) {
    const { x, y, unit: u } = spec;
    const side = sideOf(spec);
    const cy = y - 3.4 * u;
    const scuttle = spec.walking ? Math.sin(spec.phase * WALK_SPEED) : 0;
    ellipse(ctx, x, y, 5 * u, 1 * u, SHADOW);
    for (const dx of [-2.4, 0, 2.4]) {
      line(ctx, x + dx * u, cy + 1 * u, x + (dx - 1.4) * u + scuttle * 0.4 * u, y - 0.2 * u, 'rgb(42, 42, 42)', 0.5 * u);
      line(ctx, x + dx * u, cy + 1 * u, x + (dx + 1.4) * u - scuttle * 0.4 * u, y - 0.2 * u, 'rgb(42, 42, 42)', 0.5 * u);
    }
    ctx.fillStyle = 'rgb(214, 64, 58)';
    ctx.beginPath();
    ctx.ellipse(x, cy, 5.4 * u, 4.4 * u, 0, Math.PI, 0);
    ctx.lineTo(x + 5.4 * u, cy + 0.6 * u);
    ctx.lineTo(x - 5.4 * u, cy + 0.6 * u);
    ctx.fill();
    line(ctx, x, cy - 4.4 * u, x, cy + 0.4 * u, 'rgb(42, 42, 42)', 0.5 * u);
    for (const [dx, dy] of [[-2.8, -1.6], [2.8, -1.6], [-1.4, -3.2], [1.4, -3.2]]) circle(ctx, x + dx * u, cy + dy * u, 0.7 * u, 'rgb(42, 42, 42)');
    const headX = x + side * 5 * u;
    if (spec.image) drawAvatar(ctx, spec.image, headX, cy - 1 * u, 3 * u, 0.5 * u);
    else {
      circle(ctx, headX, cy - 0.4 * u, 1.8 * u, 'rgb(42, 42, 42)');
      circle(ctx, headX + side * 0.5 * u, cy - 0.8 * u, 0.5 * u, 'rgb(255, 255, 255)');
    }
    return finish(ctx, spec, 10, 7, { headX, headY: cy - 0.4 * u, headR: (spec.image ? 3 : 1.8) * u });
  }

  /** 蚂蚁：三节身体加细腿（侧视图）。 */
  function drawAnt(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const side = sideOf(spec);
    const cy = y - 4.4 * u;
    const scuttle = spec.walking ? Math.sin(spec.phase * WALK_SPEED) : 0;
    ellipse(ctx, x, y, 6 * u, 1 * u, SHADOW);
    for (const dx of [-1.6, 0.4, 2.2]) {
      line(ctx, x + dx * u, cy, x + (dx - 1.8) * u + scuttle * 0.5 * u, y - 0.2 * u, shade(color, 0.5), 0.5 * u);
      line(ctx, x + dx * u, cy, x + (dx + 1.8) * u - scuttle * 0.5 * u, y - 0.2 * u, shade(color, 0.5), 0.5 * u);
    }
    ellipse(ctx, x - side * 3.6 * u, cy, 3 * u, 2.4 * u, color);
    ellipse(ctx, x, cy - 0.4 * u, 1.6 * u, 1.4 * u, shade(color, 0.85));
    const headX = x + side * 3 * u;
    if (spec.image) drawAvatar(ctx, spec.image, headX, cy - 1.4 * u, 3 * u, 0.5 * u);
    else {
      circle(ctx, headX, cy - 0.6 * u, 2 * u, shade(color, 0.7));
      circle(ctx, headX + side * 0.6 * u, cy - 1 * u, 0.5 * u, 'rgb(255, 255, 255)');
    }
    line(ctx, headX + side * 0.8 * u, cy - 2 * u, headX + side * 2.6 * u, cy - 4.4 * u, shade(color, 0.5), 0.4 * u);
    line(ctx, headX + side * 0.2 * u, cy - 2.2 * u, headX + side * 0.8 * u, cy - 4.8 * u, shade(color, 0.5), 0.4 * u);
    return finish(ctx, spec, 9, 8, { headX, headY: cy - 0.6 * u, headR: (spec.image ? 3 : 2) * u });
  }

  /** 蜘蛛：圆身体与八条腿。 */
  function drawSpider(ctx, spec) {
    const { x, y, unit: u } = spec;
    const cy = y - 7.4 * u;
    const scuttle = spec.walking ? Math.sin(spec.phase * WALK_SPEED) : 0;
    ellipse(ctx, x, y, 7 * u, 1.2 * u, SHADOW);
    for (const side of [-1, 1]) {
      for (let index = 0; index < 4; index += 1) {
        const spread = (index - 1.5) * 1.6;
        const kneeX = x + side * (4 + index * 0.4) * u;
        const kneeY = cy - (3.6 - index * 0.8) * u;
        ctx.strokeStyle = 'rgb(42, 42, 42)';
        ctx.lineWidth = 0.5 * u;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + side * 1.4 * u, cy);
        ctx.lineTo(kneeX, kneeY);
        ctx.lineTo(x + side * (6.4 + spread * 0.2) * u + scuttle * (index % 2 === 0 ? 1 : -1) * 0.5 * u, y - 0.2 * u);
        ctx.stroke();
      }
    }
    ellipse(ctx, x, cy, 3.4 * u, 3 * u, 'rgb(58, 42, 58)');
    circle(ctx, x, cy - 1 * u, 1.4 * u, 'rgb(107, 63, 107)');
    const headY = cy - 3.4 * u;
    if (spec.image) {
      drawAvatar(ctx, spec.image, x, headY, 3 * u, 0.5 * u);
    } else {
      circle(ctx, x, headY, 2 * u, 'rgb(58, 42, 58)');
      for (const dx of [-0.8, 0.8]) {
        circle(ctx, x + dx * u, headY - 0.3 * u, 0.55 * u, 'rgb(255, 255, 255)');
        circle(ctx, x + dx * u, headY - 0.3 * u, 0.25 * u, 'rgb(214, 64, 58)');
      }
    }
    return finish(ctx, spec, 12, 8, { headX: x, headY, headR: (spec.image ? 3 : 2) * u });
  }

  /** 蜻蜓：细长的身体与两对翅膀，悬空飞行。 */
  function drawDragonfly(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const side = sideOf(spec);
    const cy = y - 11 * u + Math.sin(spec.phase * 3) * 1 * u;
    const flap = 0.5 + 0.5 * Math.abs(Math.sin(spec.phase * 15));
    ellipse(ctx, x, y, 5 * u, 1 * u, SHADOW);
    for (const dx of [-0.6, 1.6]) for (const s of [-1, 1]) ellipse(ctx, x + dx * u, cy + s * 3.2 * u * flap - 0.6 * u, 4.2 * u, 1.2 * u, 'rgba(190, 230, 255, 0.7)', s * 0.25);
    ellipse(ctx, x - side * 2 * u, cy, 7 * u, 0.9 * u, shade(color, 0.9));
    for (const dx of [-3, -5, -7]) circle(ctx, x + side * dx * u * -1, cy, 0.6 * u, shade(color, 0.6));
    const headX = x + side * 4.2 * u;
    if (spec.image) drawAvatar(ctx, spec.image, headX, cy - 0.6 * u, 3 * u, 0.5 * u);
    else {
      circle(ctx, headX, cy, 1.8 * u, shade(color, 1.1));
      circle(ctx, headX + side * 0.5 * u, cy - 0.6 * u, 0.9 * u, 'rgb(63, 155, 90)');
    }
    return finish(ctx, spec, 13, 8, { headX, headY: cy - 0.4 * u, headR: (spec.image ? 3 : 1.8) * u });
  }

  /** 蜗牛：螺旋的壳加柔软的身体与触角。 */
  function drawSnail(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const side = sideOf(spec);
    ellipse(ctx, x, y, 7 * u, 1.2 * u, SHADOW);
    ellipse(ctx, x + side * 0.8 * u, y - 1.2 * u, 6.6 * u, 1.4 * u, 'rgb(217, 201, 160)');
    const headX = x + side * 6 * u;
    const headY = y - 4 * u;
    line(ctx, x + side * 4 * u, y - 1.4 * u, headX, headY, 'rgb(217, 201, 160)', 2.4 * u);
    line(ctx, headX - side * 0.4 * u, headY - 1 * u, headX - side * 0.4 * u, headY - 4 * u, 'rgb(184, 166, 120)', 0.4 * u);
    line(ctx, headX + side * 0.6 * u, headY - 1 * u, headX + side * 1 * u, headY - 3.6 * u, 'rgb(184, 166, 120)', 0.4 * u);
    circle(ctx, headX - side * 0.4 * u, headY - 4.2 * u, 0.6 * u, DARK);
    circle(ctx, headX + side * 1 * u, headY - 3.8 * u, 0.6 * u, DARK);
    circle(ctx, x - side * 0.4 * u, y - 5.4 * u, 4.4 * u, color);
    ctx.strokeStyle = shade(color, 0.6);
    ctx.lineWidth = 0.6 * u;
    ctx.beginPath();
    for (let step = 0; step <= 24; step += 1) {
      const t = step / 24;
      const px = x - side * 0.4 * u + Math.cos(t * 9) * (3.6 * (1 - t)) * u;
      const py = y - 5.4 * u + Math.sin(t * 9) * (3.6 * (1 - t)) * u;
      if (step === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    if (spec.image) drawAvatar(ctx, spec.image, headX, headY, 3 * u, 0.5 * u);
    return finish(ctx, spec, 14, 8, { headX, headY, headR: (spec.image ? 3 : 1.4) * u });
  }

  /** 虫（毛毛虫、蚯蚓）：一节节蠕动的身体。 */
  function drawWorm(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const side = sideOf(spec);
    const crawl = spec.phase * (spec.walking ? 6 : 1.5);
    ellipse(ctx, x, y, 7 * u, 1.2 * u, SHADOW);
    let headX = x;
    let headY = y;
    for (let index = 0; index < 7; index += 1) {
      const px = x - side * (6 - index * 2) * u;
      const lift = Math.max(0, Math.sin(index * 0.9 + crawl)) * 2.6 * u;
      const py = y - 1.8 * u - lift;
      circle(ctx, px, py, 1.9 * u, index % 2 === 0 ? color : shade(color, 1.2));
      headX = px;
      headY = py;
    }
    if (spec.image) {
      drawAvatar(ctx, spec.image, headX, headY - 0.4 * u, 3 * u, 0.5 * u);
    } else {
      circle(ctx, headX + side * 0.4 * u, headY - 0.6 * u, 0.55 * u, 'rgb(255, 255, 255)');
      circle(ctx, headX + side * 0.6 * u, headY - 0.6 * u, 0.25 * u, DARK);
      ellipse(ctx, headX + side * 1 * u, headY + 0.8 * u, 0.5 * u, (0.2 + mouthOpen(spec) * 0.6) * u, 'rgb(90, 42, 42)');
    }
    return finish(ctx, spec, 8, 8, { headX, headY: headY - 0.4 * u, headR: (spec.image ? 3 : 1.9) * u });
  }

  /** 甲虫：带硬壳的小虫（侧视图）。 */
  function drawBeetle(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const side = sideOf(spec);
    const cy = y - 4 * u;
    const scuttle = spec.walking ? Math.sin(spec.phase * WALK_SPEED) : 0;
    ellipse(ctx, x, y, 5.6 * u, 1 * u, SHADOW);
    for (const dx of [-2.2, 0, 2.2]) {
      line(ctx, x + dx * u, cy + 1 * u, x + (dx - 1.6) * u + scuttle * 0.4 * u, y - 0.2 * u, 'rgb(42, 42, 42)', 0.5 * u);
      line(ctx, x + dx * u, cy + 1 * u, x + (dx + 1.6) * u - scuttle * 0.4 * u, y - 0.2 * u, 'rgb(42, 42, 42)', 0.5 * u);
    }
    ellipse(ctx, x - side * 0.4 * u, cy, 5 * u, 3.6 * u, shade(color, 0.75));
    line(ctx, x - side * 0.4 * u, cy - 3.4 * u, x - side * 0.4 * u, cy + 3.2 * u, shade(color, 0.4), 0.4 * u);
    ellipse(ctx, x - side * 1.6 * u, cy - 1.2 * u, 1.6 * u, 0.9 * u, 'rgba(255, 255, 255, 0.3)', -0.4);
    const headX = x + side * 4.6 * u;
    if (spec.image) drawAvatar(ctx, spec.image, headX, cy - 0.8 * u, 3 * u, 0.5 * u);
    else {
      circle(ctx, headX, cy - 0.4 * u, 1.8 * u, 'rgb(42, 42, 42)');
      circle(ctx, headX + side * 0.5 * u, cy - 0.8 * u, 0.5 * u, 'rgb(255, 255, 255)');
    }
    line(ctx, headX + side * 0.6 * u, cy - 1.8 * u, headX + side * 2.4 * u, cy - 4 * u, 'rgb(42, 42, 42)', 0.4 * u);
    line(ctx, headX - side * 0.2 * u, cy - 2 * u, headX + side * 0.4 * u, cy - 4.4 * u, 'rgb(42, 42, 42)', 0.4 * u);
    return finish(ctx, spec, 9, 8, { headX, headY: cy - 0.4 * u, headR: (spec.image ? 3 : 1.8) * u });
  }

  // ---------- 微生物 ----------

  /** 病毒：圆球加一圈随时间旋转的刺突。 */
  function drawVirus(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const cy = y - 9 * u - Math.abs(Math.sin(spec.phase * 2)) * 0.8 * u;
    const spin = spec.phase * 0.6;
    ellipse(ctx, x, y, 6 * u, 1.2 * u, SHADOW);
    for (let index = 0; index < 12; index += 1) {
      const angle = (TAU * index) / 12 + spin;
      const sx = x + Math.cos(angle) * 6 * u;
      const sy = cy + Math.sin(angle) * 6 * u;
      line(ctx, x + Math.cos(angle) * 4 * u, cy + Math.sin(angle) * 4 * u, sx, sy, shade(color, 0.7), 0.7 * u);
      circle(ctx, x + Math.cos(angle) * 6.6 * u, cy + Math.sin(angle) * 6.6 * u, 1.1 * u, shade(color, 1.2));
    }
    circle(ctx, x, cy, 5 * u, color);
    circle(ctx, x - 1.6 * u, cy - 1.8 * u, 1.2 * u, 'rgba(255, 255, 255, 0.4)');
    faceOrAvatar(ctx, spec, x, cy + 0.4 * u, 3.8 * u);
    return finish(ctx, spec, 17, 8, { headX: x, headY: cy, headR: 5.4 * u });
  }

  /** 细菌：胶囊形的身体、短毛与拖在后面的鞭毛。 */
  function drawBacteria(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const wob = Math.sin(spec.phase * 2.5) * 0.6 * u;
    const cy = y - 8 * u - wob;
    ellipse(ctx, x, y, 7 * u, 1.2 * u, SHADOW);
    ctx.strokeStyle = shade(color, 0.7);
    ctx.lineWidth = 0.6 * u;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 7 * u, cy);
    for (let step = 1; step <= 12; step += 1) ctx.lineTo(x - 7 * u - step * 0.9 * u, cy + Math.sin(spec.phase * 6 + step * 0.9) * 1.6 * u);
    ctx.stroke();
    ctx.fillStyle = shade(color, 1.1);
    roundedRect(ctx, x - 7.4 * u, cy - 4.6 * u, 14.8 * u, 9.2 * u, 4.6 * u);
    ctx.fill();
    ctx.fillStyle = shade(color, 1.45);
    roundedRect(ctx, x - 6.2 * u, cy - 3.4 * u, 12.4 * u, 6.8 * u, 3.4 * u);
    ctx.fill();
    for (const [dx, dy] of [[-4.4, -4.8], [-1, -5], [2.4, -4.8], [5, -4.4], [-4.4, 4.8], [-0.4, 5], [3.4, 4.8]]) line(ctx, x + dx * u, cy + dy * u, x + dx * 1.1 * u, cy + dy * 1.5 * u, shade(color, 0.7), 0.4 * u);
    for (const [dx, dy] of [[-5, 1.2], [4.6, -1.4]]) circle(ctx, x + dx * u, cy + dy * u, 0.7 * u, shade(color, 0.8));
    faceOrAvatar(ctx, spec, x, cy, 4.2 * u);
    return finish(ctx, spec, 14, 10, { headX: x, headY: cy, headR: 4.8 * u });
  }

  /** 真菌：一团团圆形菌体。 */
  function drawFungus(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const cy = y - 7 * u;
    ellipse(ctx, x, y, 7 * u, 1.2 * u, SHADOW);
    const base = shade(color, 0.8);
    for (const [dx, dy, r] of [[-4.4, 1.6, 3], [4.2, 1.4, 3.2], [0, -2.6, 4.4], [-3.2, -1.4, 3.2], [3.4, -1.6, 3.4]]) circle(ctx, x + dx * u, cy + dy * u, r * u, base);
    circle(ctx, x, cy, 4.8 * u, color);
    for (let index = 0; index < 16; index += 1) {
      const angle = (TAU * index) / 16;
      line(ctx, x + Math.cos(angle) * 6 * u, cy + Math.sin(angle) * 5.2 * u, x + Math.cos(angle) * 7.4 * u, cy + Math.sin(angle) * 6.4 * u, 'rgba(255, 255, 255, 0.6)', 0.4 * u);
    }
    for (let index = 0; index < 4; index += 1) {
      const rise = ((spec.phase * 0.3 + index / 4) % 1) * 5 * u;
      circle(ctx, x + (index - 1.5) * 2.4 * u, cy - 6.4 * u - rise, 0.5 * u, 'rgba(255, 255, 255, 0.7)');
    }
    faceOrAvatar(ctx, spec, x, cy + 0.4 * u, 3.8 * u);
    return finish(ctx, spec, 15, 8, { headX: x, headY: cy, headR: 5.4 * u });
  }

  /** 变形虫：边缘随时间起伏的不规则圆形细胞。 */
  function drawAmoeba(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const cy = y - 5.4 * u;
    const pulse = Math.sin(spec.phase * 2.2);
    ellipse(ctx, x, y, 8 * u, 1.3 * u, SHADOW);
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * 0.88;
    ctx.fillStyle = shade(color, 1.35);
    ctx.beginPath();
    for (let step = 0; step <= 32; step += 1) {
      const angle = (TAU * step) / 32;
      const radius = (6.4 + Math.sin(angle * 3 + spec.phase * 2) * 1.2 + (step % 8 === 0 ? 1.2 : 0)) * u;
      const px = x + Math.cos(angle) * radius * (1 + pulse * 0.04);
      const py = cy + Math.sin(angle) * radius * 0.75;
      if (step === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = base;
    circle(ctx, x - 2.8 * u, cy + 2.2 * u, 1.1 * u, 'rgba(255, 255, 255, 0.55)');
    circle(ctx, x + 3.4 * u, cy + 1.8 * u, 0.8 * u, 'rgba(255, 255, 255, 0.55)');
    circle(ctx, x + 2.4 * u, cy - 2.4 * u, 1.6 * u, shade(color, 0.7));
    faceOrAvatar(ctx, spec, x - 0.6 * u, cy + 0.4 * u, 3.6 * u);
    return finish(ctx, spec, 12, 10, { headX: x, headY: cy, headR: 5.6 * u });
  }

  creatures.register({
    ...BIRD_PAINTERS,
    shark: drawShark,
    whale: drawWhale,
    octopus: drawOctopus,
    jellyfish: drawJellyfish,
    crab: drawCrab,
    starfish: drawStarfish,
    butterfly: drawButterfly,
    bee: drawBee,
    ladybug: drawLadybug,
    ant: drawAnt,
    spider: drawSpider,
    dragonfly: drawDragonfly,
    snail: drawSnail,
    worm: drawWorm,
    beetle: drawBeetle,
    virus: drawVirus,
    bacteria: drawBacteria,
    fungus: drawFungus,
    amoeba: drawAmoeba
  });
})();
