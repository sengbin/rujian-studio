// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-renderer.js
// 说明：分镜动画的舞台绘制：把一帧采样数据画到 Canvas 2D 上，包括背景、站位网格、走位轨迹与朝向、角色、道具、特效、动作气泡、镜头信息卡、画面描述条、字幕、音效与音乐标签、取景框、转场叠加和空状态。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：只接收画布上下文与采样结果，不读取视图、不依赖页面；尺寸都按画面高度的比例计算；舞台颜色固定，不随主题变化；插画在 stage-storyboard-preview-art.js，有资产缩略图时由页面通过 options.images 传入；通过 window.aiStoryboardRenderer 暴露，规则见 docs/storyboard-animation-design.md 第 7 节。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const FONT_FAMILY = '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

  /** 默认的显示选项：站位网格默认关闭。 */
  const DEFAULT_DISPLAY = { names: true, actions: true, trail: true, grid: false, captions: true, camera: true, description: true, frame: true };

  /** 尺寸（占画面高度的比例）与文字字数上限。 */
  const NAME_FONT = 0.03;
  const ACTION_FONT = 0.024;
  const DESCRIPTION_FONT = 0.026;
  const EFFECT_RADIUS = 0.07;
  const EFFECT_ALPHA = 0.85;
  const CAPTION_FONT = 0.04;
  const CAPTION_BOTTOM = 0.05;
  const CAPTION_MAX_WIDTH = 0.9;
  const TAG_FONT = 0.026;
  const SCENE_FONT = 0.028;
  const MARGIN = 0.02;
  const ROW_GAP = 0.012;
  const MIN_NAME_FONT = 11;
  const MIN_ACTION_FONT = 10;
  const MIN_CAPTION_FONT = 12;
  const NAME_MAX_CHARS = 8;
  const ACTION_MAX_CHARS = 12;
  const TAG_MAX_CHARS = 20;
  const SPEAKING_PERIOD = 0.8;
  const EFFECT_PERIOD = 1;
  /** 有人说话时：说话人放大的比例，其他角色变淡的透明度。 */
  const SPEAKER_BOOST = 1.06;
  const DIM_ALPHA = 0.72;
  /** 朝向扇形：半径（占画面高度）、半角与压扁比例（地面透视）。 */
  const FAN_RADIUS = 0.1;
  const FAN_HALF_ANGLE = Math.PI / 5;
  const FAN_FLATTEN = 0.45;
  const FAN_STEPS = 8;
  const FAN_ALPHA = 0.22;
  const FACING_ANGLES = { right: 0, left: Math.PI, camera: Math.PI / 2, away: -Math.PI / 2 };
  /** 取景框：边距、角线长度（占画面高度）。 */
  const FRAME_INSET = 0.04;
  const FRAME_CORNER = 0.05;

  const COLOR_OUTLINE = 'rgba(0, 0, 0, 0.75)';
  const COLOR_TEXT = '#FFFFFF';
  const COLOR_DESCRIPTION = '#E6E8EC';
  const COLOR_NARRATION = '#B8C4D6';
  const COLOR_BAR = 'rgba(0, 0, 0, 0.6)';
  const COLOR_GRID = 'rgba(255, 255, 255, 0.28)';
  const COLOR_BUBBLE = 'rgba(255, 255, 255, 0.92)';
  const COLOR_BUBBLE_TEXT = '#1B1D22';
  const COLOR_EMPTY_BACKGROUND = '#1B1D22';
  const COLOR_EMPTY_TEXT = '#9AA0AA';

  /** 站位网格的标注：纵向线对应的位置名称与文字。 */
  const GRID_COLUMNS = [['left', '左'], ['center', '中'], ['right', '右']];
  const GRID_ROWS = [['back', '背景'], ['middle', '中景'], ['front', '前景']];
  /** 横向线的文字距画面左边的比例：留出运镜放大时被裁掉的边缘。 */
  const GRID_LABEL_INSET = 0.075;

  const timelineApi = window.aiStoryboardTimeline;
  const art = window.aiStoryboardArt;
  const creatures = window.aiStoryboardCreatures;

  function setFont(ctx, pixels, bold) {
    ctx.font = `${bold ? 'bold ' : ''}${Math.round(pixels)}px ${FONT_FAMILY}`;
  }

  /** 画带深色描边的文字，保证在任何底色上可读。 */
  function outlineText(ctx, text, x, y, fill) {
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLOR_OUTLINE;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  /** 超过字数时截断并加省略号。 */
  function truncate(text, maxChars) {
    const chars = [...text];
    return chars.length > maxChars ? `${chars.slice(0, maxChars).join('')}…` : text;
  }

  /** 超过宽度时从末尾去掉文字并加省略号。 */
  function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    const chars = [...text];
    while (chars.length > 0 && ctx.measureText(`${chars.join('')}…`).width > maxWidth) chars.pop();
    return `${chars.join('')}…`;
  }

  /** 按宽度换行，最多 maxLines 行，放不下的部分以省略号结尾。 */
  function wrapLines(ctx, text, maxWidth, maxLines) {
    const lines = [];
    const chars = [...text];
    let current = '';
    for (let index = 0; index < chars.length; index += 1) {
      const next = current + chars[index];
      if (current !== '' && ctx.measureText(next).width > maxWidth) {
        if (lines.length === maxLines - 1) {
          lines.push(fitText(ctx, current + chars.slice(index).join(''), maxWidth));
          return lines;
        }
        lines.push(current);
        current = chars[index];
      } else {
        current = next;
      }
    }
    lines.push(current);
    return lines;
  }

  /** 一个带半透明底的文字标签，返回标签的高度。 */
  function drawPill(ctx, text, x, y, fontPixels, color, alpha) {
    setFont(ctx, fontPixels, false);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const padding = fontPixels * 0.5;
    const pillWidth = ctx.measureText(text).width + padding * 2;
    const pillHeight = fontPixels * 1.6;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COLOR_BAR;
    art.roundedRect(ctx, x, y, pillWidth, pillHeight, pillHeight / 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, x + padding, y + pillHeight / 2);
    ctx.restore();
    return pillHeight;
  }

  /** 场景背景：有场景资产图时按填满方式铺图并压暗，否则画矢量插画。 */
  function drawBackground(ctx, scene, env) {
    const { width, height } = env;
    const image = env.images && scene.entityId !== null ? env.images.get(scene.entityId) : undefined;
    if (!image) {
      art.drawBackdrop(ctx, scene, width, height);
      return;
    }
    ctx.fillStyle = scene.wall;
    ctx.fillRect(-width, -height, width * 3, height * 3);
    art.drawCover(ctx, image, -width * 0.06, -height * 0.06, width * 1.12, height * 1.12);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(-width, -height, width * 3, height * 3);
  }

  /** 站位网格：三条纵向线（左、中、右）和三条横向线（背景、中景、前景），带文字标注。 */
  function drawGrid(ctx, width, height) {
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    setFont(ctx, Math.max(MIN_ACTION_FONT, height * ACTION_FONT), false);
    ctx.fillStyle = COLOR_GRID;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    for (const [name, label] of GRID_COLUMNS) {
      const x = timelineApi.X_FRACTION[name] * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillText(label, x, height * MARGIN * 3);
    }
    ctx.textAlign = 'left';
    for (const [name, label] of GRID_ROWS) {
      const y = timelineApi.DEPTH_STAGE[name].y * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillText(label, width * GRID_LABEL_INSET, y + 2);
    }
    ctx.restore();
  }

  /** 朝向扇形：脚下一块压扁的扇形，指向角色面对的方向。 */
  function drawFacingFan(ctx, actor, width, height) {
    const center = FACING_ANGLES[actor.facing];
    if (center === undefined) return;
    const x = actor.x * width;
    const y = actor.y * height;
    const radius = height * FAN_RADIUS * actor.scale;
    ctx.save();
    ctx.globalAlpha = FAN_ALPHA;
    ctx.fillStyle = actor.color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let step = 0; step <= FAN_STEPS; step += 1) {
      const angle = center - FAN_HALF_ANGLE + (2 * FAN_HALF_ANGLE * step) / FAN_STEPS;
      ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * FAN_FLATTEN);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 走位轨迹：从起点到终点的虚线，起点画空心圆，终点画箭头。 */
  function drawTrail(ctx, actor, width, height) {
    const { fromX, fromY, toX, toY } = actor.path;
    const startX = fromX * width;
    const startY = fromY * height;
    const endX = toX * width;
    const endY = toY * height;
    const size = height * 0.016;
    const angle = Math.atan2(endY - startY, endX - startX);
    ctx.save();
    ctx.strokeStyle = actor.color;
    ctx.fillStyle = actor.color;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX - Math.cos(angle) * size, endY - Math.sin(angle) * size);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(startX, startY, size * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - Math.cos(angle - 0.45) * size, endY - Math.sin(angle - 0.45) * size);
    ctx.lineTo(endX - Math.cos(angle + 0.45) * size, endY - Math.sin(angle + 0.45) * size);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 说话光环：脉动的圆环；减少动态效果时为静止的圆环。 */
  function drawSpeakingRing(ctx, cx, cy, radius, env) {
    const phase = env.reducedMotion ? 0.3 : (env.time % SPEAKING_PERIOD) / SPEAKING_PERIOD;
    ctx.save();
    ctx.globalAlpha = env.reducedMotion ? 0.8 : 1 - phase;
    ctx.strokeStyle = COLOR_TEXT;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (1 + 0.35 * phase), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** 角色：小人（或资产头像）、名字，说话时放大并有光环，他人说话时变淡；返回动作气泡所需的位置。 */
  function drawCharacter(ctx, actor, frame, env) {
    const { width, height, display } = env;
    const unit = height * 0.01 * actor.scale * (actor.isSpeaking ? SPEAKER_BOOST : 1);
    const x = actor.x * width;
    const y = actor.y * height;
    const image = env.images ? env.images.get(actor.entityId) : undefined;
    ctx.save();
    if (frame.hasSpeaker && !actor.isSpeaking) ctx.globalAlpha = DIM_ALPHA;
    const info = creatures.drawCharacter(ctx, {
      x,
      y,
      unit,
      color: actor.color,
      facing: actor.facing,
      walking: actor.isWalking && !env.reducedMotion,
      speaking: actor.isSpeaking,
      placed: actor.isPlaced,
      phase: env.reducedMotion ? 0.3 : env.time,
      image: image || null,
      species: actor.species,
      gender: actor.gender,
      age: actor.age,
      glyph: actor.glyph,
      seed: actor.entityId
    });
    if (actor.isSpeaking) drawSpeakingRing(ctx, info.headX, info.headY, info.headR * 1.5, env);
    if (display.names) {
      setFont(ctx, Math.max(MIN_NAME_FONT, height * NAME_FONT), actor.isSpeaking);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const label = `${truncate(actor.name, NAME_MAX_CHARS)}${actor.isPlaced ? '' : '（未设站位）'}`;
      outlineText(ctx, label, info.headX, y - info.height * unit - height * 0.008, COLOR_TEXT);
    }
    ctx.restore();
    return display.actions && actor.actionText ? { text: truncate(actor.actionText, ACTION_MAX_CHARS), x: info.headX, headY: info.headY, headR: info.headR } : null;
  }

  function rectsOverlap(a, b) {
    return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
  }

  /** 动作气泡：角色头部旁边的白色气泡，尖角指向头部；靠左的角色气泡在右侧，靠右的在左侧，与已画的气泡重叠时换边或上移。 */
  function drawActionBubble(ctx, bubble, width, height, placed) {
    const fontPixels = Math.max(MIN_ACTION_FONT, height * ACTION_FONT);
    setFont(ctx, fontPixels, false);
    const padding = fontPixels * 0.6;
    const bubbleWidth = ctx.measureText(bubble.text).width + padding * 2;
    const bubbleHeight = fontPixels * 1.7;
    const preferred = bubble.x < width * 0.55 ? 1 : -1;
    let chosen = null;
    for (const lift of [0, 1, 2, 3]) {
      for (const side of [preferred, -preferred]) {
        const near = bubble.x + side * bubble.headR * 1.95;
        const rect = { side, near, left: side > 0 ? near : near - bubbleWidth, top: bubble.headY - bubbleHeight / 2 - lift * bubbleHeight * 1.15, width: bubbleWidth, height: bubbleHeight };
        chosen = rect;
        if (!placed.some((other) => rectsOverlap(rect, other))) break;
        chosen = null;
      }
      if (chosen) break;
    }
    if (!chosen) {
      const near = bubble.x + preferred * bubble.headR * 1.95;
      chosen = { side: preferred, near, left: preferred > 0 ? near : near - bubbleWidth, top: bubble.headY - bubbleHeight / 2, width: bubbleWidth, height: bubbleHeight };
    }
    placed.push(chosen);
    const { side, near, left, top } = chosen;
    ctx.save();
    ctx.fillStyle = COLOR_BUBBLE;
    art.roundedRect(ctx, left, top, bubbleWidth, bubbleHeight, bubbleHeight * 0.4);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(near, top + bubbleHeight * 0.3);
    ctx.lineTo(near, top + bubbleHeight * 0.7);
    ctx.lineTo(bubble.x + side * bubble.headR * 1.2, bubble.headY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLOR_BUBBLE_TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(bubble.text, left + bubbleWidth / 2, top + bubbleHeight / 2);
    ctx.restore();
  }

  /** 道具：有资产图时画图片方块，否则按类别画矢量图形，名称在下方。 */
  function drawProp(ctx, actor, env) {
    const { width, height, display } = env;
    const unit = height * 0.01 * actor.scale;
    const x = actor.x * width;
    const y = actor.y * height;
    const image = env.images ? env.images.get(actor.entityId) : undefined;
    if (image) art.drawImageTile(ctx, image, x, y, unit);
    else art.drawProp(ctx, actor.glyph, x, y, unit, actor.color);
    if (!display.names) return;
    setFont(ctx, Math.max(MIN_ACTION_FONT, height * ACTION_FONT * Math.sqrt(actor.scale)), false);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    outlineText(ctx, truncate(actor.name, NAME_MAX_CHARS), x, y + height * 0.006, COLOR_TEXT);
  }

  /** 特效前进的方向（弧度，0 朝右）：有走位时取起点到终点的方向（发射、射箭等沿它飞行），否则按朝向，缺省朝右。 */
  function effectAngle(actor, width, height) {
    if (actor.path) {
      const dx = (actor.path.toX - actor.path.fromX) * width;
      const dy = (actor.path.toY - actor.path.fromY) * height;
      if (Math.abs(dx) + Math.abs(dy) > 1) return Math.atan2(dy, dx);
    }
    return actor.facing === 'left' ? Math.PI : 0;
  }

  /** 特效：按类别画火焰、烟、雨、雪、光芒、爆炸、发射等，认不出的画火花，名称在下方。 */
  function drawEffect(ctx, actor, env) {
    const { width, height, display } = env;
    const radius = height * EFFECT_RADIUS * actor.scale;
    const x = actor.x * width;
    const y = actor.y * height;
    ctx.save();
    ctx.globalAlpha = EFFECT_ALPHA;
    art.drawEffect(ctx, actor.glyph, x, y, radius, actor.color, env.time / EFFECT_PERIOD, env.reducedMotion, { angle: effectAngle(actor, width, height) });
    ctx.restore();
    if (display.names) {
      setFont(ctx, Math.max(MIN_ACTION_FONT, height * ACTION_FONT), false);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      outlineText(ctx, truncate(actor.name, NAME_MAX_CHARS), x, y + height * 0.006, COLOR_TEXT);
    }
  }

  /** 舞台层：背景、网格、走位轨迹与朝向、全部实体和动作气泡，由远到近绘制；受景别与运镜变换影响。 */
  function drawStageLayer(ctx, frame, env) {
    const { width, height, display } = env;
    ctx.save();
    if (display.camera) {
      const { zoom, offsetX, offsetY } = frame.camera;
      const centerX = frame.camera.centerX === undefined ? 0.5 : frame.camera.centerX;
      const centerY = frame.camera.centerY === undefined ? 0.5 : frame.camera.centerY;
      ctx.translate(width / 2 + offsetX * width, height / 2 + offsetY * height);
      ctx.scale(zoom, zoom);
      ctx.translate(-centerX * width, -centerY * height);
    }
    drawBackground(ctx, frame.scene, env);
    if (display.grid) drawGrid(ctx, width, height);
    if (display.trail) {
      for (const actor of frame.actors) {
        if (actor.kind !== 'character') continue;
        if (actor.path) drawTrail(ctx, actor, width, height);
        if (actor.isPlaced) drawFacingFan(ctx, actor, width, height);
      }
    }
    const bubbles = [];
    for (const actor of [...frame.actors].sort((a, b) => a.y - b.y)) {
      if (actor.kind === 'prop') drawProp(ctx, actor, env);
      else if (actor.kind === 'effect') drawEffect(ctx, actor, env);
      else {
        const bubble = drawCharacter(ctx, actor, frame, env);
        if (bubble) bubbles.push(bubble);
      }
    }
    const placedBubbles = [];
    for (const bubble of bubbles) drawActionBubble(ctx, bubble, width, height, placedBubbles);
    ctx.restore();
  }

  /** 左上的镜头信息：场景名、镜头序号与景别等要点，其后是背景音乐；右上是音效。 */
  function drawTags(ctx, frame, env) {
    const { width, height } = env;
    const fontPixels = Math.max(MIN_NAME_FONT, height * SCENE_FONT);
    const margin = height * MARGIN;
    const gap = height * ROW_GAP;
    const tagFont = Math.max(MIN_ACTION_FONT, height * TAG_FONT);
    let top = margin + drawPill(ctx, frame.scene.name, margin, margin, fontPixels, COLOR_TEXT, 1) + gap;
    const { shot } = frame;
    if (shot) {
      const parts = [`第 ${shot.seq} / ${shot.count} 镜`, shot.shotSize, shot.cameraAngle, shot.cameraMovement, `${Number(shot.duration.toFixed(1))} 秒`].filter(Boolean);
      top += drawPill(ctx, parts.join(' · '), margin, top, tagFont, COLOR_TEXT, 1) + gap;
    }
    let row = 0;
    for (const tag of frame.tags) {
      const text = `${tag.kind === 'music' ? '背景音乐' : '音效'}：${truncate(tag.text, TAG_MAX_CHARS)}`;
      if (tag.kind === 'music') {
        drawPill(ctx, text, margin, top, tagFont, COLOR_NARRATION, tag.opacity);
      } else {
        setFont(ctx, tagFont, false);
        const pillWidth = ctx.measureText(text).width + tagFont;
        drawPill(ctx, text, width - margin - pillWidth, margin + row * (tagFont * 1.6 + margin), tagFont, COLOR_TEXT, tag.opacity);
        row += 1;
      }
    }
  }

  /** 底部画面描述条：最多两行；返回占用的高度（含底边距），没有描述或关闭时为 0。 */
  function drawDescription(ctx, frame, env) {
    const { width, height, display } = env;
    const prompt = frame.shot ? frame.shot.prompt : '';
    if (!display.description || !prompt) return 0;
    const fontPixels = Math.max(MIN_ACTION_FONT, height * DESCRIPTION_FONT);
    setFont(ctx, fontPixels, false);
    const barWidth = width * 0.94;
    const lines = wrapLines(ctx, `画面：${prompt}`, barWidth - fontPixels * 1.4, 2);
    const lineHeight = fontPixels * 1.35;
    const barHeight = lines.length * lineHeight + fontPixels * 0.6;
    const bottom = height * ROW_GAP;
    const top = height - bottom - barHeight;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    art.roundedRect(ctx, (width - barWidth) / 2, top, barWidth, barHeight, fontPixels * 0.4);
    ctx.fill();
    ctx.fillStyle = COLOR_DESCRIPTION;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, index) => ctx.fillText(line, (width - barWidth) / 2 + fontPixels * 0.7, top + fontPixels * 0.3 + index * lineHeight + (lineHeight - fontPixels) / 2));
    return bottom + barHeight;
  }

  /** 底部字幕：对白“角色名：台词”，旁白“旁白：内容”；同时显示两条时每条一行，否则最多两行；让出描述条的位置。 */
  function drawCaptions(ctx, frame, env, reserved) {
    if (frame.captions.length === 0) return;
    const { width, height } = env;
    const fontPixels = Math.max(MIN_CAPTION_FONT, height * CAPTION_FONT);
    setFont(ctx, fontPixels, false);
    const maxWidth = width * CAPTION_MAX_WIDTH;
    const maxLines = frame.captions.length > 1 ? 1 : 2;
    const lineHeight = fontPixels * 1.35;
    const entries = frame.captions.map((caption) => {
      const prefix = caption.kind === 'narration' ? '旁白：' : caption.speakerName ? `${caption.speakerName}：` : '';
      return { lines: wrapLines(ctx, `${prefix}${caption.text}`, maxWidth - fontPixels, maxLines), color: caption.kind === 'narration' ? COLOR_NARRATION : COLOR_TEXT };
    });
    const totalLines = entries.reduce((sum, entry) => sum + entry.lines.length, 0);
    let top = height - Math.max(height * CAPTION_BOTTOM, reserved + height * ROW_GAP) - totalLines * lineHeight;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const entry of entries) {
      const blockHeight = entry.lines.length * lineHeight;
      const textWidth = Math.max(...entry.lines.map((line) => ctx.measureText(line).width));
      ctx.fillStyle = COLOR_BAR;
      art.roundedRect(ctx, (width - textWidth) / 2 - fontPixels / 2, top, textWidth + fontPixels, blockHeight, fontPixels * 0.3);
      ctx.fill();
      ctx.fillStyle = entry.color;
      entry.lines.forEach((line, index) => ctx.fillText(line, width / 2, top + index * lineHeight + (lineHeight - fontPixels) / 2));
      top += blockHeight;
    }
  }

  /** 取景框：四个角的折线与中心十字，表示摄影机的取景范围。 */
  function drawViewfinder(ctx, width, height) {
    const inset = height * FRAME_INSET;
    const length = height * FRAME_CORNER;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 2;
    for (const [cx, cy, dx, dy] of [[inset, inset, 1, 1], [width - inset, inset, -1, 1], [inset, height - inset, 1, -1], [width - inset, height - inset, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * length, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * length);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    const arm = height * 0.012;
    ctx.beginPath();
    ctx.moveTo(width / 2 - arm, height / 2);
    ctx.lineTo(width / 2 + arm, height / 2);
    ctx.moveTo(width / 2, height / 2 - arm);
    ctx.lineTo(width / 2, height / 2 + arm);
    ctx.stroke();
    ctx.restore();
  }

  /** 转场叠加：变黑与闪白。 */
  function drawOverlay(ctx, overlay, width, height) {
    if (overlay.fadeToBlack > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${overlay.fadeToBlack})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (overlay.flashWhite > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${overlay.flashWhite})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  /**
   * 绘制一帧。
   * @param {CanvasRenderingContext2D} ctx 画布上下文，已按设备像素比缩放，坐标单位为 CSS 像素。
   * @param {object} frame aiStoryboardTimeline.sampleFrame 的结果。
   * @param {{ width: number, height: number, display?: object, time?: number, reducedMotion?: boolean,
   *   images?: Map<number, { element: CanvasImageSource, width: number, height: number }>, hud?: boolean }} options
   *   width、height 为画布的 CSS 尺寸；display 为显示选项（缺省见 DEFAULT_DISPLAY）；time 为播放时间（秒），用来驱动光环、嘴型、行走与特效；
   *   reducedMotion 为 true 时动画改为静止；images 为实体标识到已加载资产图的表；hud 为 false 时不画信息卡、描述、字幕、标签和取景框（镜头对照用）。
   */
  function draw(ctx, frame, options) {
    const { width, height } = options;
    const display = { ...DEFAULT_DISPLAY, ...(options.display || {}) };
    const env = {
      width,
      height,
      display,
      time: options.time || 0,
      reducedMotion: Boolean(options.reducedMotion),
      images: options.images || null
    };
    const hud = options.hud !== false;
    ctx.save();
    ctx.fillStyle = frame.scene.wall;
    ctx.fillRect(0, 0, width, height);
    drawStageLayer(ctx, frame, env);
    // 叠化：上一镜头结尾帧叠在当前帧上并逐渐淡出。
    if (frame.overlay.dissolve) {
      ctx.save();
      ctx.globalAlpha = frame.overlay.dissolve.alpha;
      drawStageLayer(ctx, frame.overlay.dissolve.fromFrame, env);
      ctx.restore();
    }
    if (hud) {
      drawTags(ctx, frame, env);
      const reserved = drawDescription(ctx, frame, env);
      if (display.captions) drawCaptions(ctx, frame, env, reserved);
      if (display.frame) drawViewfinder(ctx, width, height);
    }
    drawOverlay(ctx, frame.overlay, width, height);
    ctx.restore();
  }

  /** 绘制空状态：深色底与居中的提示文字。 */
  function drawEmpty(ctx, width, height, message) {
    ctx.save();
    ctx.fillStyle = COLOR_EMPTY_BACKGROUND;
    ctx.fillRect(0, 0, width, height);
    setFont(ctx, Math.max(MIN_CAPTION_FONT, height * 0.04), false);
    ctx.fillStyle = COLOR_EMPTY_TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, width / 2, height / 2);
    ctx.restore();
  }

  window.aiStoryboardRenderer = {
    draw,
    drawEmpty,
    wrapLines,
    drawPill,
    outlineText,
    setFont,
    truncate,
    DEFAULT_DISPLAY,
    MIN_NAME_FONT,
    MIN_ACTION_FONT
  };
})();
