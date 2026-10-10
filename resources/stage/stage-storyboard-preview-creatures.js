// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-creatures.js
// 说明：分镜动画的非人类角色矢量图形：动物（松鼠、刺猬、鼠、兔、猫、狗、狼、狐、熊、鹿、马、牛、羊、猪、蛙、鸟、蝙蝠、鱼、蛇、昆虫等）与奇幻角色（僵尸、神仙、精灵、怪物、邪灵、恶魔、机器人），人类仍用 stage-storyboard-preview-art.js 的小人。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：依赖 stage-storyboard-preview-draw.js 与 stage-storyboard-preview-art.js；种类由 stage-storyboard-preview-rules.js 的 classifyCharacterDetail 判断；人形的奇幻角色在小人基础上换肤色并加装饰，动物按种类的参数表画侧视图；颜色沿用角色的识别色；有资产图时头部换成圆形头像；尺寸单位 u 为“画面高度的 1% × 纵深缩放”；通过 window.aiStoryboardCreatures 暴露，扫展种类由 stage-storyboard-preview-bestiary.js 经 register 登记。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const art = window.aiStoryboardArt;
  const { TAU, SHADOW, DARK, WALK_SPEED, MOUTH_SPEED, shade, circle, ellipse, polygon, line, roundedRect, drawAvatar } = window.aiStoryboardDraw;

  /** 张嘴程度（0 到 1）：说话时随时间开合。 */
  function mouthOpen(spec) {
    return spec.speaking ? 0.35 + 0.65 * Math.abs(Math.sin(spec.phase * MOUTH_SPEED)) : 0;
  }

  /** 动物与侧视图生物的朝向：面朝左右时按朝向，否则按实体标识奇偶分配，避免所有角色都朝同一边。 */
  function sideOf(spec) {
    if (spec.facing === 'left') return -1;
    if (spec.facing === 'right') return 1;
    return spec.seed % 2 === 1 ? -1 : 1;
  }

  /** 没有摆放站位的角色加虚线轮廓。 */
  function outlineIfUnplaced(ctx, spec, height, halfWidth) {
    if (spec.placed) return;
    const u = spec.unit;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    roundedRect(ctx, spec.x - halfWidth * u, spec.y - height * u - 0.6 * u, halfWidth * 2 * u, height * u + 1.2 * u, 3 * u);
    ctx.stroke();
    ctx.restore();
  }

  /** 没有摆放站位时加虚线轮廓，并把头部位置与图形总高度（单位 u）一起返回。 */
  function finish(ctx, spec, height, halfWidth, info) {
    outlineIfUnplaced(ctx, spec, height, halfWidth);
    return { ...info, height };
  }

  /** 圆脸的比例（都乘脸的半径）：眼睛离中线、眼白、瞳孔、嘴的偏移、嘴离脸中心的距离与宽度。 */
  const FACE_CUTE = { eyeX: 0.42, eyeR: 0.28, pupilR: 0.14, mouthShift: 0.12, mouthY: 0.5, mouthW: 0.34 };
  const FACE_THING = { eyeX: 0.45, eyeR: 0.3, pupilR: 0.15, mouthShift: 0.15, mouthY: 0.52, mouthW: 0.36 };

  /** 圆脸：两只大眼睛（瞳孔朝向前进方向）和会开合的嘴；背对镜头时不画。shape 为 FACE_CUTE 或 FACE_THING。 */
  function roundFace(ctx, spec, cx, cy, r, shape) {
    if (spec.facing === 'away') return;
    const look = spec.facing === 'left' ? -1 : spec.facing === 'right' ? 1 : 0;
    for (const side of [-1, 1]) {
      circle(ctx, cx + side * r * shape.eyeX, cy - r * 0.1, r * shape.eyeR, '#FFFFFF');
      circle(ctx, cx + side * r * shape.eyeX + look * r * 0.1, cy - r * 0.08, r * shape.pupilR, DARK);
    }
    ellipse(ctx, cx + look * r * shape.mouthShift, cy + r * shape.mouthY, r * shape.mouthW, r * (0.08 + 0.3 * mouthOpen(spec)), '#5A2A2A');
  }

  /** 小动物与微生物用的圆脸。 */
  function cuteFace(ctx, spec, cx, cy, r) {
    roundFace(ctx, spec, cx, cy, r, FACE_CUTE);
  }

  // ---------- 四足动物 ----------

  /** 四足动物的参数（单位 u）：身体、腿高、头半径、颈高、耳朵、尾巴、口鼻长度与特征；height 是含耳朵、尾巴、角的总高度。 */
  const QUADRUPEDS = {
    squirrel: { bodyW: 8, bodyH: 6.5, legH: 2, headR: 3.2, neck: 3.2, ears: 'pointy', tail: 'bushy', snout: 1.8, height: 15 },
    hedgehog: { bodyW: 10, bodyH: 7, legH: 1.5, headR: 3, neck: 1.2, ears: 'round', tail: 'short', snout: 3.2, spikes: true, faceTone: '#EAC9A4', height: 11 },
    mouse: { bodyW: 7, bodyH: 5, legH: 1.5, headR: 2.6, neck: 2, ears: 'round', earScale: 1.5, tail: 'thin', snout: 2.2, height: 9 },
    rabbit: { bodyW: 8, bodyH: 7, legH: 2, headR: 3.2, neck: 4, ears: 'long', tail: 'short', snout: 1.4, height: 17 },
    cat: { bodyW: 10, bodyH: 6, legH: 3, headR: 3.4, neck: 4, ears: 'pointy', tail: 'thin', snout: 1.4, height: 14 },
    dog: { bodyW: 11, bodyH: 6.5, legH: 4, headR: 3.5, neck: 4, ears: 'floppy', tail: 'thin', snout: 3, height: 16 },
    wolf: { bodyW: 12, bodyH: 7, legH: 5, headR: 3.6, neck: 4.5, ears: 'pointy', tail: 'bushy', snout: 3.6, height: 18 },
    fox: { bodyW: 11, bodyH: 6, legH: 4, headR: 3.3, neck: 4, ears: 'pointy', tail: 'bushy', snout: 3.2, height: 16 },
    bear: { bodyW: 13, bodyH: 10, legH: 3.5, headR: 4.5, neck: 4, ears: 'round', tail: 'short', snout: 2, legW: 3, height: 21 },
    deer: { bodyW: 11, bodyH: 6.5, legH: 9, headR: 3, neck: 8, ears: 'pointy', tail: 'short', snout: 3, antlers: true, height: 30 },
    horse: { bodyW: 15, bodyH: 7.5, legH: 10, headR: 3.4, neck: 9, ears: 'pointy', tail: 'thin', snout: 4.8, height: 32 },
    cow: { bodyW: 14, bodyH: 9, legH: 5, headR: 4, neck: 4, ears: 'floppy', tail: 'thin', snout: 3.4, horns: true, snoutTone: '#F2B9B0', legW: 2.4, height: 22 },
    sheep: { bodyW: 12, bodyH: 8, legH: 4, headR: 3.2, neck: 3.5, ears: 'floppy', tail: 'short', snout: 2, wool: true, height: 17 },
    pig: { bodyW: 12, bodyH: 8, legH: 3, headR: 4, neck: 2.5, ears: 'floppy', tail: 'short', snout: 2.8, snoutTone: '#F2A9B4', height: 15 },
    frog: { bodyW: 8, bodyH: 6, legH: 1.5, headR: 3.2, neck: 1.5, ears: 'eyes', tail: 'none', snout: 1, height: 10 },
    hippo: { bodyW: 14, bodyH: 10, legH: 2.5, headR: 4.4, neck: 2, ears: 'round', earScale: 0.8, tail: 'short', snout: 4.6, legW: 3.2, snoutTone: '#D4A5AD', height: 17 },
    beast: { bodyW: 12, bodyH: 8, legH: 5, headR: 3.8, neck: 4.5, ears: 'round', tail: 'thin', snout: 3, height: 18 },
    elephant: { bodyW: 17, bodyH: 12, legH: 6, headR: 5, neck: 3, ears: 'bigfloppy', tail: 'thin', snout: 1, trunk: true, legW: 3.8, height: 28 },
    rhino: { bodyW: 16, bodyH: 10, legH: 4, headR: 4.2, neck: 2.5, ears: 'pointy', tail: 'thin', snout: 4, horn: 'nose', legW: 3.2, height: 22 },
    giraffe: { bodyW: 11, bodyH: 6.5, legH: 11, headR: 2.6, neck: 14, ears: 'pointy', tail: 'tuft', snout: 2.4, knobs: true, spots: true, height: 40 },
    monkey: { bodyW: 8, bodyH: 7, legH: 3, headR: 3.4, neck: 3, ears: 'round', earScale: 1.6, tail: 'long', tailW: 1, snout: 1.4, faceTone: '#EAC9A4', height: 17 },
    gorilla: { bodyW: 12, bodyH: 11, legH: 4.5, headR: 4.3, neck: 2.5, ears: 'round', tail: 'none', snout: 2.2, legW: 3.4, faceTone: '#5A4A44', height: 23 },
    panda: { bodyW: 13, bodyH: 10, legH: 3.5, headR: 4.5, neck: 4, ears: 'round', earTone: '#222222', tail: 'short', snout: 2, legW: 3, body: '#F4F4F4', limbTone: '#2A2A2A', patches: true, faceTone: '#FAFAFA', height: 21 },
    kangaroo: { bodyW: 8, bodyH: 9, legH: 6, headR: 3, neck: 5, ears: 'long', tail: 'thick', snout: 2.4, height: 25 },
    camel: { bodyW: 14, bodyH: 7.5, legH: 10, headR: 3.2, neck: 9, ears: 'round', tail: 'short', snout: 3.6, humps: 2, height: 34 },
    lion: { bodyW: 12, bodyH: 7, legH: 4.5, headR: 3.8, neck: 4, ears: 'round', tail: 'tuft', snout: 2.4, mane: true, height: 19 },
    tiger: { bodyW: 12, bodyH: 6.5, legH: 4.5, headR: 3.6, neck: 4, ears: 'round', tail: 'thin', snout: 2.2, stripes: true, height: 17 },
    leopard: { bodyW: 12, bodyH: 6, legH: 4, headR: 3.3, neck: 4, ears: 'round', tail: 'thin', snout: 2.2, spots: true, height: 16 },
    crocodile: { bodyW: 16, bodyH: 4.5, legH: 1.8, headR: 2.6, neck: 1, ears: 'none', tail: 'long', tailW: 2, snout: 9, teeth: true, legW: 1.8, height: 8 },
    turtle: { bodyW: 10, bodyH: 6, legH: 1.5, headR: 2.4, neck: 2, ears: 'none', tail: 'short', snout: 1.2, shell: true, legW: 2, height: 11 },
    lizard: { bodyW: 11, bodyH: 3.2, legH: 1.8, headR: 2.4, neck: 1, ears: 'none', tail: 'long', tailW: 1, snout: 2.4, height: 8 },
    dinosaur: { bodyW: 14, bodyH: 10, legH: 7, headR: 4, neck: 6, ears: 'none', tail: 'long', tailW: 2.4, snout: 5, spikes: true, teeth: true, legW: 3, height: 31 },
    zebra: { bodyW: 15, bodyH: 7.5, legH: 10, headR: 3.4, neck: 9, ears: 'pointy', tail: 'thin', snout: 4.8, stripes: true, body: '#F4F4F4', stripeTone: '#222222', height: 32 },
    unicorn: { bodyW: 15, bodyH: 7.5, legH: 10, headR: 3.4, neck: 9, ears: 'pointy', tail: 'thin', snout: 4.8, horn: 'forehead', body: '#F5F0FA', height: 36 }
  };

  /** 画四足动物的尾巴：蓬松、细、短、长、穗状或粗大。 */
  function drawTail(ctx, cfg, spec, side, bodyCx, bodyCy) {
    const { unit: u, color } = spec;
    const baseX = bodyCx - side * cfg.bodyW * 0.48 * u;
    if (cfg.tail === 'bushy') {
      ellipse(ctx, baseX - side * 1.6 * u, bodyCy - cfg.bodyH * 0.55 * u, 2.6 * u, 5.8 * u, shade(color, 1.1), -side * 0.45);
    } else if (cfg.tail === 'thin') {
      ctx.strokeStyle = shade(color, 0.85);
      ctx.lineWidth = 0.9 * u;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(baseX, bodyCy - cfg.bodyH * 0.15 * u);
      ctx.quadraticCurveTo(baseX - side * 4 * u, bodyCy - cfg.bodyH * 0.2 * u, baseX - side * 4.6 * u, bodyCy - (cfg.bodyH * 0.2 + 4) * u);
      ctx.stroke();
    } else if (cfg.tail === 'short') {
      circle(ctx, baseX - side * 0.6 * u, bodyCy - cfg.bodyH * 0.1 * u, 1.3 * u, shade(color, 1.35));
    } else if (cfg.tail === 'long') {
      ctx.strokeStyle = shade(color, 0.85);
      ctx.lineWidth = (cfg.tailW || 1.4) * u;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(baseX, bodyCy);
      ctx.quadraticCurveTo(baseX - side * 6 * u, bodyCy + 1.2 * u, baseX - side * 10 * u, bodyCy - 1 * u);
      ctx.stroke();
    } else if (cfg.tail === 'tuft') {
      line(ctx, baseX, bodyCy - cfg.bodyH * 0.15 * u, baseX - side * 4.4 * u, bodyCy + 1.6 * u, shade(color, 0.85), 0.9 * u);
      circle(ctx, baseX - side * 4.6 * u, bodyCy + 2 * u, 1.2 * u, shade(color, 0.5));
    } else if (cfg.tail === 'thick') {
      polygon(ctx, [[baseX, bodyCy - 1.6 * u], [baseX - side * 8 * u, bodyCy + 2.4 * u], [baseX, bodyCy + 1.6 * u]], shade(color, 0.9));
    }
  }

  /** 画四足动物的耳朵：尖、圆、长、垂、大垂耳或顶上的眼睛（蛙）。 */
  function drawEars(ctx, cfg, spec, side, headX, headY) {
    const { unit: u, color } = spec;
    const r = cfg.headR * u;
    const tone = cfg.earTone || shade(color, 0.85);
    const kinds = { pointy: 0, round: 1, long: 2, floppy: 3, eyes: 4 };
    const kind = kinds[cfg.ears];
    if (cfg.ears === 'bigfloppy') {
      ellipse(ctx, headX - side * r * 0.45, headY + r * 0.15, r * 0.85, r * 1.25, shade(color, 0.85), side * 0.15);
      return;
    }
    for (const [scale, offset] of [[0.55, -0.15], [1, 0.4]]) {
      const ex = headX + side * offset * r;
      if (kind === 0) polygon(ctx, [[ex - 0.4 * r * scale, headY - r * 0.7], [ex, headY - r * 1.65 * scale], [ex + 0.5 * r * scale, headY - r * 0.6]], tone);
      else if (kind === 1) circle(ctx, ex, headY - r * 0.85, r * 0.4 * (cfg.earScale || 1) * scale, tone);
      else if (kind === 2) ellipse(ctx, ex - side * r * 0.2, headY - r * 1.55, r * 0.28 * scale, r * 1.05 * scale, tone, -side * 0.25);
      else if (kind === 3) ellipse(ctx, ex - side * r * 0.35, headY - r * 0.1, r * 0.35 * scale, r * 0.75 * scale, shade(color, 0.7), side * 0.2);
    }
  }

  /** 四足动物：侧视图，头在前、尾在后，行走时四条腿交替摆动。 */
  function drawQuadruped(ctx, base, cfg) {
    const spec = cfg.body ? { ...base, color: cfg.body } : base;
    const { x, y, unit: u, color } = spec;
    const side = sideOf(spec);
    const swing = spec.walking ? Math.sin(spec.phase * WALK_SPEED) : 0;
    const bodyCx = x;
    const bodyCy = y - (cfg.legH + cfg.bodyH / 2) * u;
    const headX = x + side * (cfg.bodyW / 2 + cfg.headR * 0.1) * u;
    const headY = y - (cfg.legH + cfg.bodyH / 2 + cfg.neck) * u;
    const legWidth = (cfg.legW || 1.8) * u;
    const open = mouthOpen(spec);

    ellipse(ctx, x, y, cfg.bodyW * 0.6 * u, 1.5 * u, SHADOW);
    drawTail(ctx, cfg, spec, side, bodyCx, bodyCy);
    const legs = [[0.3, -1.6, 1], [-0.3, -1.6, -1], [0.3, 0, -1], [-0.3, 0, 1]];
    const drawLegs = (near) => {
      for (const [fraction, shift, phase] of legs.filter((leg) => (leg[1] === 0) === near)) {
        const lx = x + side * fraction * cfg.bodyW * u + side * shift * u;
        line(ctx, lx, bodyCy + cfg.bodyH * 0.3 * u, lx + swing * phase * 1.6 * u, y - 0.2 * u, near ? cfg.limbTone || shade(color, 0.7) : cfg.limbTone || shade(color, 0.5), legWidth);
      }
    };
    drawLegs(false);
    if (cfg.wool) {
      for (const [dx, dy] of [[-0.35, 0.15], [0.35, 0.15], [0, -0.2], [-0.2, 0.3], [0.2, 0.3]]) circle(ctx, bodyCx + dx * cfg.bodyW * u, bodyCy + dy * cfg.bodyH * u, cfg.bodyH * 0.42 * u, shade(color, 1.75));
    } else {
      ellipse(ctx, bodyCx, bodyCy, (cfg.bodyW / 2) * u, (cfg.bodyH / 2) * u, color);
      ellipse(ctx, bodyCx, bodyCy + cfg.bodyH * 0.18 * u, (cfg.bodyW / 2.4) * u, (cfg.bodyH / 3.2) * u, shade(color, 1.3));
    }
    if (cfg.stripes) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(bodyCx, bodyCy, (cfg.bodyW / 2) * u, (cfg.bodyH / 2) * u, 0, 0, TAU);
      ctx.clip();
      for (let index = -3; index <= 3; index += 1) {
        const sx = bodyCx + index * cfg.bodyW * 0.13 * u;
        line(ctx, sx, bodyCy - cfg.bodyH * 0.6 * u, sx + 0.6 * u, bodyCy + cfg.bodyH * 0.6 * u, cfg.stripeTone || shade(color, 0.35), 0.9 * u);
      }
      ctx.restore();
    }
    if (cfg.spots) {
      for (const [dx, dy] of [[-0.3, -0.15], [-0.1, 0.2], [0.1, -0.2], [0.3, 0.1], [0, 0], [-0.4, 0.15]]) circle(ctx, bodyCx + dx * cfg.bodyW * u, bodyCy + dy * cfg.bodyH * u, 1 * u, cfg.spotTone || shade(color, 0.5));
    }
    if (cfg.patches) {
      ellipse(ctx, bodyCx + side * cfg.bodyW * 0.28 * u, bodyCy, cfg.bodyW * 0.14 * u, cfg.bodyH * 0.5 * u, '#222222');
      ellipse(ctx, bodyCx - side * cfg.bodyW * 0.3 * u, bodyCy + cfg.bodyH * 0.1 * u, cfg.bodyW * 0.12 * u, cfg.bodyH * 0.42 * u, '#222222');
    }
    for (let index = 0; index < (cfg.humps || 0); index += 1) ellipse(ctx, bodyCx + (index - (cfg.humps - 1) / 2) * 4.4 * u, bodyCy - cfg.bodyH * 0.55 * u, 2.4 * u, 3 * u, shade(color, 1.05));
    if (cfg.shell) {
      ellipse(ctx, bodyCx, bodyCy - cfg.bodyH * 0.1 * u, cfg.bodyW * 0.6 * u, cfg.bodyH * 0.85 * u, '#5E8F3E');
      for (const dx of [-0.25, 0, 0.25]) ellipse(ctx, bodyCx + dx * cfg.bodyW * u, bodyCy - cfg.bodyH * 0.3 * u, cfg.bodyW * 0.1 * u, cfg.bodyH * 0.22 * u, '#7DAF56');
    }
    if (cfg.spikes) {
      for (let index = 0; index < 9; index += 1) {
        const theta = Math.PI * (0.12 + (0.76 * index) / 8);
        const px = bodyCx - side * Math.cos(theta) * (cfg.bodyW / 2) * u;
        const py = bodyCy - Math.sin(theta) * (cfg.bodyH / 2) * u;
        polygon(ctx, [[px - 0.9 * u, py], [px - side * Math.cos(theta) * 3.4 * u, py - Math.sin(theta) * 3.4 * u], [px + 0.9 * u, py]], shade(color, 0.4));
      }
    }
    if (cfg.neck > 5) line(ctx, x + side * cfg.bodyW * 0.32 * u, bodyCy - cfg.bodyH * 0.1 * u, headX, headY, color, cfg.headR * 1.25 * u);
    drawLegs(true);

    const faceTone = cfg.faceTone || shade(color, 1.12);
    if (cfg.mane) circle(ctx, headX - side * cfg.headR * 0.35 * u, headY + cfg.headR * 0.1 * u, cfg.headR * 1.55 * u, shade(color, 0.55));
    drawEars(ctx, cfg, spec, side, headX, headY);
    if (cfg.knobs) {
      for (const offset of [-0.1, 0.45]) {
        const kx = headX + side * offset * cfg.headR * u;
        const ky = headY - cfg.headR * 0.8 * u;
        line(ctx, kx, ky, kx, ky - 2.4 * u, shade(color, 0.7), 0.7 * u);
        circle(ctx, kx, ky - 2.6 * u, 0.7 * u, shade(color, 0.5));
      }
    }
    if (cfg.horns) for (const offset of [-0.2, 0.55]) polygon(ctx, [[headX + side * (offset - 0.15) * cfg.headR * u, headY - cfg.headR * 0.8 * u], [headX + side * (offset + 0.2) * cfg.headR * u, headY - cfg.headR * 1.7 * u], [headX + side * (offset + 0.35) * cfg.headR * u, headY - cfg.headR * 0.8 * u]], '#F0E6C8');
    if (cfg.antlers) {
      for (const offset of [-0.1, 0.45]) {
        const bx = headX + side * offset * cfg.headR * u;
        const by = headY - cfg.headR * 0.8 * u;
        line(ctx, bx, by, bx - side * 1.2 * u, by - 5.2 * u, '#8B6B4A', 0.8 * u);
        line(ctx, bx - side * 0.5 * u, by - 2.6 * u, bx + side * 1.6 * u, by - 4.4 * u, '#8B6B4A', 0.7 * u);
      }
    }
    if (spec.image) {
      drawAvatar(ctx, spec.image, headX, headY, cfg.headR * 1.35 * u, 0.5 * u);
    } else {
      circle(ctx, headX, headY, cfg.headR * u, faceTone);
      if (cfg.patches) ellipse(ctx, headX + side * cfg.headR * 0.25 * u, headY - cfg.headR * 0.2 * u, 0.95 * u, 1.3 * u, '#222222', side * 0.4);
      const snoutX = headX + side * (cfg.headR * 0.5 + cfg.snout * 0.35) * u;
      ellipse(ctx, snoutX, headY + cfg.headR * 0.3 * u, cfg.snout * 0.6 * u, cfg.headR * 0.42 * u, cfg.snoutTone || shade(color, 1.35));
      circle(ctx, headX + side * (cfg.headR * 0.5 + cfg.snout * 0.9) * u, headY + cfg.headR * 0.12 * u, 0.7 * u, DARK);
      if (cfg.ears === 'eyes') {
        for (const offset of [-0.2, 0.55]) {
          circle(ctx, headX + side * offset * cfg.headR * u, headY - cfg.headR * 0.95 * u, cfg.headR * 0.45 * u, faceTone);
          circle(ctx, headX + side * offset * cfg.headR * u + side * 0.3 * u, headY - cfg.headR * 0.95 * u, 0.7 * u, DARK);
        }
      } else {
        circle(ctx, headX + side * cfg.headR * 0.25 * u, headY - cfg.headR * 0.2 * u, 0.65 * u, DARK);
      }
      if (open > 0) ellipse(ctx, snoutX, headY + cfg.headR * 0.7 * u, cfg.snout * 0.35 * u + 0.4 * u, open * 0.9 * u, '#5A2A2A');
      if (cfg.horn === 'nose') polygon(ctx, [[snoutX - side * 0.8 * u, headY - cfg.headR * 0.05 * u], [snoutX + side * 0.5 * u, headY - cfg.headR * 1.7 * u], [snoutX + side * 1.6 * u, headY - cfg.headR * 0.05 * u]], '#EDE4CF');
      if (cfg.horn === 'forehead') polygon(ctx, [[headX + side * cfg.headR * 0.1 * u, headY - cfg.headR * 0.85 * u], [headX + side * cfg.headR * 0.9 * u, headY - cfg.headR * 2.8 * u], [headX + side * cfg.headR * 0.6 * u, headY - cfg.headR * 0.7 * u]], '#F7E7A6');
      if (cfg.trunk) {
        ctx.strokeStyle = shade(color, 1.05);
        ctx.lineWidth = cfg.headR * 0.75 * u;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(headX + side * cfg.headR * 0.7 * u, headY + cfg.headR * 0.1 * u);
        ctx.quadraticCurveTo(headX + side * cfg.headR * 2.2 * u, headY + cfg.headR * 0.9 * u, headX + side * cfg.headR * 1.6 * u, y - 1.2 * u + swing * 0.4 * u);
        ctx.stroke();
      }
      if (cfg.teeth) {
        for (let index = 0; index < 4; index += 1) {
          const tx = headX + side * (cfg.headR * 0.5 + cfg.snout * (0.1 + 0.16 * index)) * u;
          const ty = headY + cfg.headR * 0.62 * u;
          polygon(ctx, [[tx - 0.4 * u, ty], [tx, ty + 1 * u], [tx + 0.4 * u, ty]], '#FFFFFF');
        }
      }
    }
    return finish(ctx, spec, cfg.height, cfg.bodyW * 0.7 + 3, { headX, headY, headR: (spec.image ? 1.35 : 1) * cfg.headR * u });
  }

  // ---------- 其他动物 ----------

  /** 鸟（通用小鸟）：身体、翅膀、尾巴、腿、头和嘴，行走时跳动。 */
  function drawBird(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const side = sideOf(spec);
    const hop = spec.walking ? Math.abs(Math.sin(spec.phase * WALK_SPEED)) * 1.2 * u : 0;
    const flap = spec.walking || spec.speaking ? Math.sin(spec.phase * 12) * 0.5 : 0;
    const bodyY = y - 8 * u - hop;
    const headX = x + side * 4 * u;
    const headY = bodyY - 3.4 * u;
    ellipse(ctx, x, y, 5.5 * u, 1.3 * u, SHADOW);
    for (const dx of [-0.8, 1.2]) line(ctx, x + dx * u, bodyY + 2.5 * u, x + dx * u, y - 0.2 * u, '#D98A2B', 0.7 * u);
    polygon(ctx, [[x - side * 4 * u, bodyY - 1 * u], [x - side * 8.5 * u, bodyY - 2.5 * u], [x - side * 8 * u, bodyY + 1.5 * u]], shade(color, 0.7));
    ellipse(ctx, x, bodyY, 5 * u, 3.8 * u, color);
    ellipse(ctx, x + side * 0.8 * u, bodyY + 1.2 * u, 3 * u, 2 * u, shade(color, 1.4));
    ellipse(ctx, x - side * 0.8 * u, bodyY - 0.4 * u, 3.2 * u, 1.8 * u, shade(color, 0.7), -side * (0.5 + flap));
    if (spec.image) {
      drawAvatar(ctx, spec.image, headX, headY, 3.4 * u, 0.5 * u);
    } else {
      circle(ctx, headX, headY, 2.5 * u, shade(color, 1.1));
      const open = mouthOpen(spec) * 1.1 * u;
      polygon(ctx, [[headX + side * 2.2 * u, headY - 0.6 * u - open * 0.4], [headX + side * 4.8 * u, headY + 0.1 * u], [headX + side * 2.2 * u, headY + 0.7 * u]], '#F2A33A');
      if (open > 0) polygon(ctx, [[headX + side * 2.2 * u, headY + 0.7 * u], [headX + side * 4 * u, headY + 0.5 * u + open], [headX + side * 2.2 * u, headY + 1.4 * u + open]], '#E58F2A');
      circle(ctx, headX + side * 0.7 * u, headY - 0.5 * u, 0.55 * u, DARK);
    }
    return finish(ctx, spec, 14, 7, { headX, headY, headR: (spec.image ? 3.4 : 2.5) * u });
  }

  /** 蝙蝠：张开的翅膀随时间扇动，悬空浮动。 */
  function drawBat(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const flap = Math.sin(spec.phase * (spec.walking ? 11 : 5));
    const cy = y - 13 * u + Math.sin(spec.phase * 3) * 0.8 * u;
    ellipse(ctx, x, y, 5 * u, 1.2 * u, SHADOW);
    for (const side of [-1, 1]) {
      polygon(ctx, [[x + side * 1.3 * u, cy - 1.5 * u], [x + side * 11 * u, cy - (3.5 + 3 * flap) * u], [x + side * 8.6 * u, cy + (0.3 - 0.8 * flap) * u], [x + side * 6.4 * u, cy - 0.4 * u], [x + side * 4.6 * u, cy + 3 * u], [x + side * 1.3 * u, cy + 2 * u]], shade(color, 0.65));
      polygon(ctx, [[x + side * 1.2 * u, cy - 2 * u], [x + side * 2.2 * u, cy - 6.4 * u], [x + side * 3.4 * u, cy - 3 * u]], shade(color, 0.5));
    }
    ellipse(ctx, x, cy, 2.4 * u, 3.6 * u, color);
    const headY = cy - 3.8 * u;
    if (spec.image) {
      drawAvatar(ctx, spec.image, x, headY, 3.4 * u, 0.5 * u);
    } else {
      circle(ctx, x, headY, 2.3 * u, shade(color, 1.1));
      for (const side of [-1, 1]) {
        circle(ctx, x + side * 0.95 * u, headY - 0.2 * u, 0.5 * u, '#FFFFFF');
        circle(ctx, x + side * 0.95 * u, headY - 0.2 * u, 0.25 * u, '#C0262D');
      }
      const open = mouthOpen(spec);
      ellipse(ctx, x, headY + 1.1 * u, 0.9 * u, (0.25 + open * 0.8) * u, '#4A1D1D');
      if (open > 0.3) for (const side of [-1, 1]) polygon(ctx, [[x + side * 0.5 * u, headY + 1 * u], [x + side * 0.9 * u, headY + 2 * u], [x + side * 0.9 * u, headY + 1 * u]], '#FFFFFF');
    }
    return finish(ctx, spec, 20, 12, { headX: x, headY, headR: (spec.image ? 3.4 : 2.3) * u });
  }

  /** 鱼：侧视图，尾鳍摆动，嘴边冒气泡。 */
  function drawFish(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const side = sideOf(spec);
    const cy = y - 9 * u + Math.sin(spec.phase * 3) * 0.8 * u;
    const wag = Math.sin(spec.phase * (spec.walking ? 12 : 5)) * 1.2 * u;
    ellipse(ctx, x, y, 6 * u, 1.2 * u, SHADOW);
    polygon(ctx, [[x - side * 5 * u, cy], [x - side * 9 * u, cy - 3.4 * u + wag], [x - side * 9 * u, cy + 3.4 * u + wag]], shade(color, 0.7));
    ellipse(ctx, x, cy, 6 * u, 3.8 * u, color);
    ellipse(ctx, x, cy + 1.4 * u, 4.4 * u, 1.8 * u, shade(color, 1.4));
    polygon(ctx, [[x - side * 0.5 * u, cy - 3.4 * u], [x - side * 3 * u, cy - 6 * u], [x - side * 3.4 * u, cy - 3 * u]], shade(color, 0.7));
    const headX = x + side * 3.4 * u;
    if (spec.image) {
      drawAvatar(ctx, spec.image, headX, cy, 3.2 * u, 0.5 * u);
    } else {
      circle(ctx, headX + side * 0.4 * u, cy - 0.8 * u, 0.9 * u, '#FFFFFF');
      circle(ctx, headX + side * 0.6 * u, cy - 0.8 * u, 0.45 * u, DARK);
      ellipse(ctx, x + side * 6 * u, cy + 0.7 * u, 0.7 * u, (0.25 + mouthOpen(spec) * 0.8) * u, '#5A2A2A');
    }
    const bubbleY = cy - 6 * u - ((spec.phase * 2) % 1) * 3 * u;
    circle(ctx, headX + side * 2 * u, bubbleY, 0.7 * u, 'rgba(255, 255, 255, 0.6)');
    return finish(ctx, spec, 14, 10, { headX, headY: cy, headR: (spec.image ? 3.2 : 3.8) * u });
  }

  /** 蛇：起伏的身体带花纹，头抬起吐舌头。 */
  function drawSnake(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const side = sideOf(spec);
    const sway = spec.phase * (spec.walking ? 6 : 1.5);
    ellipse(ctx, x, y, 8 * u, 1.2 * u, SHADOW);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 * u;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const steps = 14;
    let headX = x;
    let headY = y;
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      headX = x + side * (-9 + 14 * t) * u;
      headY = y - 2 * u - Math.sin(t * Math.PI * 2.4 + sway) * 1.6 * u - t * t * 6 * u;
      if (index === 0) ctx.moveTo(headX, headY);
      else ctx.lineTo(headX, headY);
    }
    ctx.stroke();
    ctx.strokeStyle = shade(color, 1.4);
    ctx.lineWidth = 1 * u;
    ctx.setLineDash([1.2 * u, 2 * u]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (spec.image) {
      drawAvatar(ctx, spec.image, headX, headY, 3.2 * u, 0.5 * u);
    } else {
      circle(ctx, headX, headY, 2.4 * u, shade(color, 1.1));
      circle(ctx, headX + side * 0.8 * u, headY - 0.7 * u, 0.5 * u, '#FFE24A');
      if (Math.sin(spec.phase * 8) > 0 || spec.speaking) line(ctx, headX + side * 2.2 * u, headY + 0.4 * u, headX + side * 4.4 * u, headY + 0.4 * u, '#D33A4A', 0.5 * u);
    }
    return finish(ctx, spec, 11, 10, { headX, headY, headR: (spec.image ? 3.2 : 2.4) * u });
  }

  /** 昆虫（通用飞虫）：两对翅膀、触角与头，悬空浮动。 */
  function drawInsect(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const cy = y - 10 * u + Math.sin(spec.phase * 4) * 1 * u;
    const flap = 0.3 + 0.7 * Math.abs(Math.sin(spec.phase * (spec.walking ? 14 : 9)));
    ellipse(ctx, x, y, 4 * u, 1 * u, SHADOW);
    for (const side of [-1, 1]) {
      ellipse(ctx, x + side * 3.2 * u * flap, cy - 2.2 * u, 3.4 * u * flap, 3.6 * u, shade(color, 1.25));
      ellipse(ctx, x + side * 2.6 * u * flap, cy + 2.4 * u, 2.4 * u * flap, 2.6 * u, shade(color, 1.5));
      line(ctx, x + side * 0.4 * u, cy - 4.6 * u, x + side * 2 * u, cy - 7 * u, shade(color, 0.5), 0.4 * u);
    }
    ellipse(ctx, x, cy, 0.9 * u, 3 * u, shade(color, 0.45));
    const headY = spec.image ? cy - 4.6 * u : cy - 3.6 * u;
    if (spec.image) drawAvatar(ctx, spec.image, x, headY, 3 * u, 0.5 * u);
    else circle(ctx, x, headY, 1.2 * u, shade(color, 0.45));
    return finish(ctx, spec, 14, 7, { headX: x, headY, headR: (spec.image ? 3 : 1.2) * u });
  }

  // ---------- 奇幻角色（人形） ----------

  /** 奈幻角色用的小人：在默认小人基础上用 overrides 覆盖肤色、发色等参数。 */
  function figure(ctx, spec, overrides) {
    return art.drawFigure(ctx, { ...spec, ...overrides });
  }

  /** 僵尸：绿肤、双臂向前平举、破烂的衣角与伤痕。 */
  function drawZombie(ctx, spec) {
    const { x, y, unit: u } = spec;
    const info = figure(ctx, spec, { skin: '#8DB57B', hair: '#46503A', armsUp: true });
    const hemY = y - 7.5 * u;
    polygon(ctx, [[x - 4 * u, hemY], [x - 2.4 * u, hemY + 1.6 * u], [x - 0.8 * u, hemY], [x + 0.8 * u, hemY + 2 * u], [x + 2.4 * u, hemY], [x + 4 * u, hemY + 1.4 * u], [x + 4 * u, hemY - 1 * u], [x - 4 * u, hemY - 1 * u]], 'rgba(30, 30, 20, 0.45)');
    if (!spec.image && spec.facing !== 'away') {
      line(ctx, info.headX + info.headR * 0.3, info.headY - info.headR * 0.5, info.headX + info.headR * 0.7, info.headY + info.headR * 0.2, '#3C2A2A', 0.35 * u);
      for (const side of [-1, 1]) ellipse(ctx, info.headX + side * info.headR * 0.38, info.headY - info.headR * 0.05, info.headR * 0.22, info.headR * 0.2, 'rgba(60, 40, 70, 0.55)');
    }
    return info;
  }

  /** 神仙：白发、飘动的长袍、头顶光环与身后的光晕，略微悬空。 */
  function drawDeity(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const lift = 2.5 * u;
    const bob = Math.sin(spec.phase * 2) * 0.5 * u;
    const fy = y - lift - bob;
    ellipse(ctx, x, y, 6 * u, 1.4 * u, SHADOW);
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * 0.25;
    circle(ctx, x, fy - 15 * u, 15 * u, '#FFE9A0');
    ctx.globalAlpha = base;
    const info = figure(ctx, { ...spec, y: fy }, { hair: '#EDEAF2', noShadow: true });
    polygon(ctx, [[x - 4.2 * u, fy - 17 * u], [x + 4.2 * u, fy - 17 * u], [x + 7 * u, fy - 1.2 * u], [x - 7 * u, fy - 1.2 * u]], shade(color, 1.3));
    line(ctx, x - 4.2 * u, fy - 11 * u, x + 4.2 * u, fy - 11 * u, '#F0C84A', 0.9 * u);
    ctx.strokeStyle = '#FFD75E';
    ctx.lineWidth = 0.9 * u;
    ctx.beginPath();
    ctx.ellipse(x, info.headY - info.headR - 1.8 * u, 4.8 * u, 1.3 * u, 0, 0, TAU);
    ctx.stroke();
    return finish(ctx, spec, 34, 8, { ...info });
  }

  /** 精灵：略小的小人、尖耳朵、透明的翅膀与闪烁的光点。 */
  function drawElf(ctx, spec) {
    const k = 0.85;
    const { x, y, unit: u, color } = spec;
    const flap = Math.sin(spec.phase * (spec.walking ? 14 : 7));
    for (const side of [-1, 1]) {
      ellipse(ctx, x + side * 6 * u * k, y - 17 * u * k, 6 * u * k, (2.8 + flap * 0.6) * u * k, 'rgba(190, 235, 255, 0.65)', side * 0.7);
      ellipse(ctx, x + side * 5 * u * k, y - 12.5 * u * k, 4 * u * k, (2 + flap * 0.4) * u * k, 'rgba(255, 215, 245, 0.6)', -side * 0.5);
    }
    const info = figure(ctx, spec, { unit: u * k, hair: '#EAD66E', skin: '#F6D8BE' });
    if (!spec.image) {
      for (const side of [-1, 1]) polygon(ctx, [[x + side * info.headR * 0.95, info.headY - info.headR * 0.1], [x + side * info.headR * 1.75, info.headY - info.headR * 0.65], [x + side * info.headR * 0.95, info.headY + info.headR * 0.35]], '#F6D8BE');
    }
    const base = ctx.globalAlpha;
    for (let index = 0; index < 3; index += 1) {
      const alpha = 0.5 + 0.5 * Math.sin(spec.phase * 4 + index * 2);
      ctx.globalAlpha = base * Math.max(0, alpha);
      circle(ctx, x + (index - 1) * 8 * u * k, info.headY - 6 * u * k + index * 3 * u * k, 0.8 * u * k, shade(color, 1.6));
    }
    ctx.globalAlpha = base;
    return { ...info, height: info.height * k };
  }

  /** 怪物：较高大的绿皮小人、独角、红眼与尖牙。 */
  function drawMonster(ctx, spec) {
    const k = 1.3;
    const { x, unit: u } = spec;
    const info = figure(ctx, spec, { unit: u * k, skin: '#79A05F', hair: null });
    const h = info.headR;
    for (const side of [-1, 1]) polygon(ctx, [[x + side * 0.5 * h, info.headY - h * 0.85], [x + side * 0.85 * h, info.headY - h * 1.8], [x + side * 1.1 * h, info.headY - h * 0.6]], '#F0E6C8');
    if (!spec.image && spec.facing !== 'away') {
      for (const side of [-1, 1]) {
        circle(ctx, x + side * h * 0.38, info.headY - h * 0.05, h * 0.2, '#D8322F');
        line(ctx, x + side * h * 0.7, info.headY - h * 0.5, x + side * h * 0.1, info.headY - h * 0.25, '#2A3A20', h * 0.12);
      }
      const open = mouthOpen(spec);
      ellipse(ctx, x, info.headY + h * 0.5, h * 0.6, h * (0.14 + open * 0.3), '#3A1414');
      for (const side of [-1, 1]) polygon(ctx, [[x + side * h * 0.3, info.headY + h * 0.4], [x + side * h * 0.45, info.headY + h * 0.75], [x + side * h * 0.55, info.headY + h * 0.4]], '#FFFFFF');
    }
    return { ...info, height: info.height * k + 2 };
  }

  /** 恶魔：红皮小人、黑色的角、蝙蝠翅膀与尾巴。 */
  function drawDemon(ctx, spec) {
    const { x, y, unit: u } = spec;
    const flap = Math.sin(spec.phase * (spec.walking ? 10 : 4));
    for (const side of [-1, 1]) {
      polygon(ctx, [[x + side * 3 * u, y - 17 * u], [x + side * 13 * u, y - (26 + 2 * flap) * u], [x + side * 11 * u, y - 19 * u], [x + side * 8.5 * u, y - 20.5 * u], [x + side * 6.5 * u, y - 14 * u], [x + side * 3 * u, y - 12 * u]], '#6B1E24');
    }
    ctx.strokeStyle = '#8E2B30';
    ctx.lineWidth = 1.1 * u;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 3 * u, y - 8 * u);
    ctx.quadraticCurveTo(x - 10 * u, y - 5 * u, x - 9 * u, y - 12 * u);
    ctx.stroke();
    polygon(ctx, [[x - 9 * u, y - 12 * u], [x - 10.6 * u, y - 14.4 * u], [x - 7.6 * u, y - 13.4 * u]], '#8E2B30');
    const info = figure(ctx, spec, { skin: '#C8514A', hair: '#2A0F12' });
    for (const side of [-1, 1]) polygon(ctx, [[x + side * info.headR * 0.4, info.headY - info.headR * 0.9], [x + side * info.headR * 0.8, info.headY - info.headR * 1.9], [x + side * info.headR * 1.1, info.headY - info.headR * 0.6]], '#2A0F12');
    if (!spec.image && spec.facing !== 'away') {
      for (const side of [-1, 1]) polygon(ctx, [[x + side * info.headR * 0.2, info.headY + info.headR * 0.55], [x + side * info.headR * 0.4, info.headY + info.headR * 1], [x + side * info.headR * 0.5, info.headY + info.headR * 0.55]], '#FFFFFF');
    }
    return { ...info, height: info.height + 3 };
  }

  /** 机器人：金属色小人，方头带天线，眼睛说话时闪烁。 */
  function drawRobot(ctx, spec) {
    const { x, unit: u } = spec;
    const info = figure(ctx, spec, { skin: '#8C97A3', noHead: true });
    const { headY } = info;
    if (spec.image) {
      drawAvatar(ctx, spec.image, x, headY, info.headR, 0.6 * u);
    } else {
      line(ctx, x, headY - 3.9 * u, x, headY - 6.2 * u, '#6B7580', 0.6 * u);
      circle(ctx, x, headY - 6.6 * u, 0.9 * u, '#E5484D');
      ctx.fillStyle = '#B9C3CD';
      roundedRect(ctx, x - 4.4 * u, headY - 3.9 * u, 8.8 * u, 7.4 * u, 1.4 * u);
      ctx.fill();
      const lit = spec.speaking && Math.sin(spec.phase * MOUTH_SPEED) > 0 ? '#FFFFFF' : '#7CF0FF';
      if (spec.facing !== 'away') {
        ctx.fillStyle = lit;
        for (const side of [-1, 1]) ctx.fillRect(x + side * 1.9 * u - 0.75 * u, headY - 1.2 * u, 1.5 * u, 1.2 * u);
        line(ctx, x - 1.8 * u, headY + 1.9 * u, x + 1.8 * u, headY + 1.9 * u, '#6B7580', 0.5 * u);
      }
    }
    circle(ctx, x, spec.y - 13 * u, 0.9 * u, '#7CF0FF');
    return info;
  }

  /** 邪灵（幽灵）：半透明的布单状身体、下摆波浪，上下浮动。 */
  function drawGhost(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const bob = Math.sin(spec.phase * 2) * 0.9 * u;
    const sway = spec.walking ? Math.sin(spec.phase * 5) * 0.8 * u : 0;
    const gx = x + sway;
    const bottom = y - 4 * u - bob;
    const top = bottom - 21 * u;
    ellipse(ctx, x, y, 5 * u * (1 - bob / (u * 12)), 1.2 * u, SHADOW);
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * 0.82;
    ctx.fillStyle = shade(color, 1.75);
    ctx.beginPath();
    ctx.moveTo(gx - 6.5 * u, bottom);
    ctx.lineTo(gx - 6.5 * u, top + 6.5 * u);
    ctx.arc(gx, top + 6.5 * u, 6.5 * u, Math.PI, 0);
    ctx.lineTo(gx + 6.5 * u, bottom);
    for (let index = 0; index < 4; index += 1) {
      const px = gx + 6.5 * u - (13 * u * (index + 0.5)) / 4;
      ctx.quadraticCurveTo(px + 1.6 * u, bottom + 3 * u * (index % 2 === 0 ? 1 : 0.4), px - 1.6 * u, bottom);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = base;
    const headY = top + 6.5 * u;
    for (const side of [-1, 1]) ellipse(ctx, gx + side * 6.8 * u, headY + 6 * u, 1.4 * u, 2.6 * u, shade(color, 1.75), side * 0.3);
    if (spec.image) {
      drawAvatar(ctx, spec.image, gx, headY, 5 * u, 0.6 * u);
    } else if (spec.facing !== 'away') {
      for (const side of [-1, 1]) ellipse(ctx, gx + side * 2.4 * u, headY, 1.1 * u, 1.7 * u, '#2A2438');
      ellipse(ctx, gx, headY + 3.2 * u, 1.2 * u, (0.8 + mouthOpen(spec) * 1.4) * u, '#2A2438');
    }
    return finish(ctx, spec, 27, 8, { headX: gx, headY, headR: 6.5 * u });
  }

  // ---------- 人（性别与年龄） ----------

  /** 各年龄的体型：整体缩放与头的放大倍数。 */
  const AGE_BUILD = { baby: { scale: 0.38, head: 1.7 }, child: { scale: 0.62, head: 1.3 }, teen: { scale: 0.88, head: 1.08 }, adult: { scale: 1, head: 1 }, elder: { scale: 0.95, head: 1 } };
  const HAIR_COLORS = { elder: '#E6E6EA', female: '#5A3425', male: '#2B2623', baby: '#3A2A22' };

  /**
   * 人：男人短发，女人长发加裙子，儿童更矮、头更大（女孩扎双辫），婴儿更小、更圆、没有头发，老人白发（男的有胡子，女的盘发）并拄拐杖；性别与年龄都认不出时用默认小人。
   */
  function drawHuman(ctx, spec) {
    const gender = spec.gender || 'unknown';
    const age = spec.age || 'adult';
    if (gender === 'unknown' && age === 'adult') return art.drawFigure(ctx, spec);
    const build = AGE_BUILD[age] || AGE_BUILD.adult;
    const { x, y, color } = spec;
    const female = gender === 'female';
    const hair = age === 'elder' ? HAIR_COLORS.elder : age === 'baby' ? HAIR_COLORS.baby : female ? HAIR_COLORS.female : HAIR_COLORS.male;
    const scaled = { ...spec, unit: spec.unit * build.scale, hair: age === 'baby' ? null : hair, headScale: build.head };
    const u = scaled.unit;
    const head = art.headOf(scaled);
    const showFace = !spec.image && spec.facing !== 'away';
    if (female && age !== 'baby' && age !== 'child' && !spec.image) ellipse(ctx, x, head.headY + head.headR * 1.05, head.headR * 1.2, head.headR * 1.9, hair);
    const info = art.drawFigure(ctx, scaled);
    if (female && age !== 'baby') polygon(ctx, [[x - 4 * u, y - 11 * u], [x + 4 * u, y - 11 * u], [x + 7 * u, y - 3.2 * u], [x - 7 * u, y - 3.2 * u]], shade(color, 1.15));
    if (female && age === 'child' && !spec.image) for (const side of [-1, 1]) circle(ctx, x + side * head.headR * 1.05, head.headY + head.headR * 0.35, head.headR * 0.38, hair);
    if (showFace && (age === 'baby' || age === 'child')) for (const side of [-1, 1]) ellipse(ctx, x + side * head.headR * 0.62, head.headY + head.headR * 0.3, head.headR * 0.2, head.headR * 0.14, 'rgba(240, 120, 130, 0.45)');
    if (age === 'baby' && !spec.image) {
      ctx.strokeStyle = HAIR_COLORS.baby;
      ctx.lineWidth = 0.5 * u;
      ctx.beginPath();
      ctx.arc(x, head.headY - head.headR, head.headR * 0.28, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
    if (age === 'elder') {
      if (!spec.image && !female && spec.facing !== 'away') polygon(ctx, [[x - head.headR * 0.7, head.headY + head.headR * 0.45], [x + head.headR * 0.7, head.headY + head.headR * 0.45], [x, head.headY + head.headR * 1.7]], hair);
      if (!spec.image && female) circle(ctx, x, head.headY - head.headR * 1.1, head.headR * 0.4, hair);
      line(ctx, x + 6 * u, y - 10.5 * u, x + 6.6 * u, y - 0.2 * u, '#7A5A3C', 0.8 * u);
      ctx.strokeStyle = '#7A5A3C';
      ctx.lineWidth = 0.8 * u;
      ctx.beginPath();
      ctx.arc(x + 5.2 * u, y - 10.5 * u, 0.8 * u, Math.PI, TAU);
      ctx.stroke();
    }
    return { ...info, height: info.height * build.scale };
  }

  // ---------- 会说话的物品、植物与无法形容的生物 ----------

  /** 物品与植物的圆脸。 */
  function drawThingFace(ctx, cx, cy, r, spec) {
    roundFace(ctx, spec, cx, cy, r, FACE_THING);
  }

  /** 物品或植物当角色：在原来的图形下加两条小短腿，放大后在图形上画脸；绑定了资产图时脸换成头像。 */
  function drawThing(ctx, spec) {
    const { x, y, unit: u } = spec;
    const glyph = art.PROPS[spec.glyph] ? spec.glyph : 'generic';
    const { height, face } = art.PROPS[glyph];
    const scale = Math.min(3.4, Math.max(1, 17 / height));
    const lift = 3 * u;
    const gu = u * scale;
    const swing = spec.walking ? Math.sin(spec.phase * WALK_SPEED) : 0;
    ellipse(ctx, x, y, Math.max(7, height * scale * 0.4) * u, 1.5 * u, SHADOW);
    for (const side of [-1, 1]) {
      const footX = x + side * 1.9 * u + swing * side * 1.6 * u;
      line(ctx, x + side * 1.9 * u, y - lift, footX, y - 0.6 * u, '#5A4A3A', 1.3 * u);
      circle(ctx, footX, y - 0.4 * u, 1.1 * u, '#3A2E26');
    }
    art.drawProp(ctx, glyph, x, y - lift, gu, spec.color, true);
    const look = spec.facing === 'left' ? -1 : spec.facing === 'right' ? 1 : 0;
    const fx = x + look * face.r * gu * 0.15;
    const fy = y - lift - face.cy * gu;
    const fr = face.r * gu;
    if (spec.image) drawAvatar(ctx, spec.image, fx, fy, fr * 1.3, 0.5 * u);
    else drawThingFace(ctx, fx, fy, fr, spec);
    const total = height * scale + 3;
    outlineIfUnplaced(ctx, spec, total, Math.max(8, height * scale * 0.4));
    return { headX: x, headY: fy, headR: fr * 1.3, height: total + 0.5 };
  }

  /** 无法形容的生物：一团有弹性的软体，带脸，行走时弹跳。 */
  function drawBlob(ctx, spec) {
    const { x, y, unit: u, color } = spec;
    const squash = Math.sin(spec.phase * 3) * 0.06;
    const hop = spec.walking ? Math.abs(Math.sin(spec.phase * WALK_SPEED)) * 1.6 * u : 0;
    const cy = y - 4.6 * u - hop;
    ellipse(ctx, x, y, 8 * u * (1 - hop / (u * 12)), 1.5 * u, SHADOW);
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * 0.92;
    ellipse(ctx, x, cy, 9 * u * (1 + squash), 7.6 * u * (1 - squash), color);
    ctx.globalAlpha = base;
    ellipse(ctx, x, cy + 2.4 * u, 8 * u, 4 * u, shade(color, 0.8));
    ellipse(ctx, x - 3.2 * u, cy - 3.6 * u, 2.4 * u, 1.3 * u, 'rgba(255, 255, 255, 0.45)', -0.5);
    const fy = cy - 0.4 * u;
    if (spec.image) drawAvatar(ctx, spec.image, x, fy, 5.4 * u, 0.5 * u);
    else drawThingFace(ctx, x, fy, 4.4 * u, spec);
    return finish(ctx, spec, 13, 10, { headX: x, headY: fy, headR: 5.4 * u });
  }

  const PAINTERS = {
    human: drawHuman,
    thing: drawThing,
    blob: drawBlob,
    zombie: drawZombie,
    deity: drawDeity,
    elf: drawElf,
    monster: drawMonster,
    demon: drawDemon,
    robot: drawRobot,
    ghost: drawGhost,
    bird: drawBird,
    bat: drawBat,
    fish: drawFish,
    snake: drawSnake,
    insect: drawInsect
  };

  /** 全部已知的种类（含扩展登记的）。 */
  const SPECIES = [...Object.keys(PAINTERS), ...Object.keys(QUADRUPEDS)];

  /** 登记扩展的种类（由 stage-storyboard-preview-bestiary.js 调用）：painters 为绘制函数，quadrupeds 为四足动物参数。 */
  function register(painters, quadrupeds) {
    Object.assign(PAINTERS, painters);
    Object.assign(QUADRUPEDS, quadrupeds || {});
    for (const key of [...Object.keys(painters), ...Object.keys(quadrupeds || {})]) if (!SPECIES.includes(key)) SPECIES.push(key);
  }

  /**
   * 画一个角色：按种类选择人形小人、奇幻角色或动物的图形。
   * @param {object} spec 同 aiStoryboardArt.drawFigure，另加 species（种类，缺省为 human）、gender 与 age（人的性别与年龄）、glyph（物品或植物的图形）和 seed（实体标识，用来给没有朝向的动物分配左右）。
   * @returns {{ headX: number, headY: number, headR: number, height: number }} 头的位置（像素）与图形总高度（单位 u）。
   */
  function drawCharacter(ctx, spec) {
    const painter = PAINTERS[spec.species || 'human'];
    if (painter) return painter(ctx, spec);
    if (QUADRUPEDS[spec.species]) return drawQuadruped(ctx, spec, QUADRUPEDS[spec.species]);
    return art.drawFigure(ctx, spec);
  }

  window.aiStoryboardCreatures = { drawCharacter, SPECIES, register, toolkit: { sideOf, mouthOpen, outlineIfUnplaced, finish, cuteFace } };
})();
