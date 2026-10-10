// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-timeline-sample.js
// 说明：分镜动画时间线的采样（纯逻辑）：按任意时刻采样出一帧的绘制数据（角色位置与走位、字幕与说话状态、运镜与景别取景、转场叠加），并给出调度俯视图、镜头对照与取景之外的角色所需的数据。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：不依赖 DOM，依赖 stage-storyboard-preview-timeline.js（编译与基础函数），把 sampleFrame、buildTopView、comparePanels、framedOut 加到 window.aiStoryboardTimeline 上；规则见 private-docs/rujian-studio/开发文档-vscode/storyboard-animation-design.md 第 6 节；渲染在 stage-storyboard-preview-renderer.js，对照视图在 stage-storyboard-preview-modes.js。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const timelineApi = window.aiStoryboardTimeline;
  const { EPSILON, clamp, lerp, smoothstep, toRow, isVoice, locate } = timelineApi;

  /** 移动曲线：开头与结尾各停留镜头时长的这一比例，中间平滑移动。 */
  const MOVE_HOLD_RATIO = 0.1;
  /** 移动中角色上下起伏的幅度（占画面高度）与频率（Hz）。 */
  const BOB_AMPLITUDE = 0.0068;
  const BOB_FREQUENCY = 3;

  /** 标签（音效、音乐）淡入淡出的时长。 */
  const TAG_FADE_SECONDS = 0.2;
  /** 同时显示的字幕条数上限。 */
  const MAX_CAPTIONS = 2;

  /** 转场处理的最长时长与占较短镜头时长的比例。 */
  const TRANSITION_MAX_SECONDS = 0.5;
  const TRANSITION_RATIO = 0.25;

  /** 放大倍数不小于这个值时只取景在一个角色上，否则取景在所有角色的中心。 */
  const SINGLE_SUBJECT_ZOOM = 1.6;
  /** 取景中心相对角色脚下的高度（占画面高度，纵深缩放为 1 时）：特写对着头部，近景对着上半身，其余对着胸口。 */
  const FOCUS_HEAD_RISE = 0.22;
  const FOCUS_UPPER_RISE = 0.17;
  const FOCUS_CHEST_RISE = 0.11;
  const FOCUS_HEAD_ZOOM = 2.2;
  const FOCUS_UPPER_ZOOM = 1.6;

  /** 镜头对照取镜头结尾前一点点（秒）的画面，避免取到下一镜头的第一帧。 */
  const COMPARE_END_GAP = 0.02;

  /** 判断角色是否在取景范围之外：在镜头内这几个时刻取样，屏幕位置超出画面边缘这么多（占画面宽度的比例）才算。 */
  const FRAME_SAMPLE_RATIOS = [0, 0.25, 0.5, 0.75, 1];
  const FRAME_MARGIN = 0.03;

  /** 运镜在镜头进度 progress 时的画面变换：缩放（不小于 1）与平移（占画面宽高的比例）。 */
  function sampleCamera(camera, progress, localTime, followX, reducedMotion) {
    const { amount } = camera;
    switch (camera.type) {
      case 'zoomIn':
        return { zoom: 1 + 0.15 * amount * progress, offsetX: 0, offsetY: 0 };
      case 'zoomOut':
        return { zoom: 1 + 0.15 * amount * (1 - progress), offsetX: 0, offsetY: 0 };
      case 'panLeft':
        return { zoom: 1.06, offsetX: 0.06 * amount * (progress - 0.5), offsetY: 0 };
      case 'panRight':
        return { zoom: 1.06, offsetX: -0.06 * amount * (progress - 0.5), offsetY: 0 };
      case 'tiltUp':
        return { zoom: 1.06, offsetX: 0, offsetY: 0.06 * amount * (progress - 0.5) };
      case 'tiltDown':
        return { zoom: 1.06, offsetX: 0, offsetY: -0.06 * amount * (progress - 0.5) };
      case 'orbit':
        return { zoom: 1 + 0.06 * amount * progress, offsetX: 0.05 * amount * Math.sin(Math.PI * progress), offsetY: 0 };
      case 'follow':
        return { zoom: 1.08, offsetX: followX === null ? 0 : clamp((0.5 - followX) * 0.3, -0.06, 0.06), offsetY: 0 };
      case 'handheld':
        if (reducedMotion) return { zoom: 1.02, offsetX: 0, offsetY: 0 };
        return {
          zoom: 1.02,
          offsetX: 0.004 * amount * (Math.sin(localTime * 7.3) + 0.5 * Math.sin(localTime * 11.1)),
          offsetY: 0.004 * amount * (Math.sin(localTime * 8.7) + 0.5 * Math.sin(localTime * 13.3))
        };
      default:
        return { zoom: 1, offsetX: 0, offsetY: 0 };
    }
  }

  /** 角色、道具、特效在镜头内某一时刻的位置、缩放、朝向与行走状态。 */
  function sampleActors(shot, localTime, activeSpeakers, reducedMotion) {
    const ratio = clamp((localTime - shot.duration * MOVE_HOLD_RATIO) / (shot.duration * (1 - 2 * MOVE_HOLD_RATIO)), 0, 1);
    const eased = smoothstep(ratio);
    return shot.actors.map((actor) => {
      const walking = actor.isMoving && ratio > 0 && ratio < 1;
      const bob = walking && !reducedMotion ? Math.sin(localTime * BOB_FREQUENCY * 2 * Math.PI) * BOB_AMPLITUDE : 0;
      return {
        entityId: actor.entityId,
        name: actor.name,
        kind: actor.kind,
        glyph: actor.glyph,
        species: actor.species,
        gender: actor.gender,
        age: actor.age,
        color: actor.color,
        x: lerp(actor.from.x, actor.to.x, eased),
        y: lerp(actor.from.y, actor.to.y, eased) - bob * lerp(actor.from.scale, actor.to.scale, eased),
        scale: lerp(actor.from.scale, actor.to.scale, eased),
        facing: actor.facing,
        actionText: actor.action,
        isPlaced: actor.isPlaced,
        isSpeaking: activeSpeakers.has(actor.entityId),
        isWalking: walking,
        // 角色在整个镜头里的走位（起点到终点），用来画轨迹；不移动时为 null。
        path: actor.isMoving ? { fromX: actor.from.x, fromY: actor.from.y, toX: actor.to.x, toY: actor.to.y, fromScale: actor.from.scale, toScale: actor.to.scale } : null
      };
    });
  }

  /** 一个镜头内某一时刻的字幕、标签与正在说话的角色。 */
  function sampleSounds(shot, localTime) {
    const captions = [];
    const tags = [];
    const speakers = new Set();
    for (const sound of shot.sounds) {
      if (localTime < sound.start - EPSILON || localTime >= sound.end - EPSILON) continue;
      if (isVoice(sound.kind)) {
        captions.push({ kind: sound.kind, speakerName: sound.speakerName, text: sound.text, start: sound.start });
        if (sound.kind === 'dialogue' && sound.speakerEntityId !== null) speakers.add(sound.speakerEntityId);
      } else {
        const opacity = Math.min(1, (localTime - sound.start) / TAG_FADE_SECONDS, (sound.end - localTime) / TAG_FADE_SECONDS);
        tags.push({ kind: sound.kind, text: sound.text, opacity: clamp(opacity, 0, 1) });
      }
    }
    captions.sort((a, b) => a.start - b.start);
    return { captions: captions.slice(0, MAX_CAPTIONS), tags, speakers };
  }

  /** 镜头开头、结尾处转场处理的时长。 */
  function transitionSeconds(shot, neighbor) {
    return Math.min(TRANSITION_MAX_SECONDS, TRANSITION_RATIO * Math.min(shot.duration, neighbor ? neighbor.duration : shot.duration));
  }

  /** 取景中心（占画面宽高的比例）：景别放大时对准主体，不放大或没有角色时在画面中央。 */
  function frameCenter(shot, actors, sizeZoom) {
    const characters = actors.filter((actor) => actor.kind === 'character');
    if (sizeZoom <= 1 || characters.length === 0) return { centerX: 0.5, centerY: 0.5 };
    let subjects = characters;
    if (sizeZoom >= SINGLE_SUBJECT_ZOOM) {
      // 主体：本镜头第一个说话的角色，没有则第一个角色；不随说话人切换，避免画面跳动。
      const speaker = shot.sounds.find((sound) => sound.kind === 'dialogue' && characters.some((actor) => actor.entityId === sound.speakerEntityId));
      subjects = [speaker ? characters.find((actor) => actor.entityId === speaker.speakerEntityId) : characters[0]];
    }
    const rise = sizeZoom >= FOCUS_HEAD_ZOOM ? FOCUS_HEAD_RISE : sizeZoom >= FOCUS_UPPER_ZOOM ? FOCUS_UPPER_RISE : FOCUS_CHEST_RISE;
    const x = subjects.reduce((sum, actor) => sum + actor.x, 0) / subjects.length;
    const y = subjects.reduce((sum, actor) => sum + actor.y - rise * actor.scale, 0) / subjects.length;
    const half = 0.5 / sizeZoom;
    return { centerX: clamp(x, half, 1 - half), centerY: clamp(y, half, 1 - half) };
  }

  /** 一个镜头在镜头内某一时刻的画面（不含转场叠加）。 */
  function buildFrame(timeline, shotIndex, localTime, options) {
    const shot = timeline.shots[shotIndex];
    const reducedMotion = Boolean(options && options.reducedMotion);
    const { captions, tags, speakers } = sampleSounds(shot, localTime);
    const actors = sampleActors(shot, localTime, speakers, reducedMotion);
    // 跟拍跟随第一个正在移动的角色。
    const moverSource = shot.actors.find((actor) => actor.kind === 'character' && actor.isMoving);
    const mover = moverSource ? actors.find((actor) => actor.entityId === moverSource.entityId) : undefined;
    const progress = shot.duration > 0 ? clamp(localTime / shot.duration, 0, 1) : 0;
    const movement = sampleCamera(shot.camera, progress, localTime, mover ? mover.x : null, reducedMotion);
    const sizeZoom = shot.shotSizeInfo.zoom;
    return {
      shotId: shot.id,
      shotIndex,
      shotLocalTime: localTime,
      shotProgress: progress,
      scene: shot.scene,
      // 景别决定取景放大与中心，运镜在它之上继续缩放和平移。
      camera: { ...movement, zoom: movement.zoom * sizeZoom, ...frameCenter(shot, actors, sizeZoom) },
      shot: {
        seq: shot.seq,
        count: timeline.shots.length,
        sceneLabel: shot.sceneLabel,
        shotSize: shot.shotSize,
        cameraAngle: shot.cameraAngle,
        cameraMovement: shot.cameraMovement,
        duration: shot.duration,
        prompt: shot.prompt
      },
      actors,
      hasSpeaker: speakers.size > 0,
      captions,
      tags,
      overlay: { fadeToBlack: 0, flashWhite: 0, dissolve: null }
    };
  }

  /** 转场叠加：叠化、淡入淡出、闪白（减少动态效果时闪白改为叠化）。 */
  function buildOverlay(timeline, shotIndex, localTime, options) {
    const shot = timeline.shots[shotIndex];
    const previous = timeline.shots[shotIndex - 1];
    const next = timeline.shots[shotIndex + 1];
    const reducedMotion = Boolean(options && options.reducedMotion);
    const overlay = { fadeToBlack: 0, flashWhite: 0, dissolve: null };

    if (previous) {
      const seconds = transitionSeconds(shot, previous);
      let type = previous.transitionOut;
      if (type === 'flash' && reducedMotion) type = 'dissolve';
      if (type === 'dissolve' && localTime < seconds) {
        overlay.dissolve = { fromFrame: buildFrame(timeline, previous.index, previous.duration, options), alpha: 1 - localTime / seconds };
      } else if (type === 'fadeIn' && localTime < seconds) {
        overlay.fadeToBlack = 1 - localTime / seconds;
      } else if (type === 'flash' && localTime < seconds / 2) {
        overlay.flashWhite = 1 - localTime / (seconds / 2);
      }
    }

    const outSeconds = transitionSeconds(shot, next);
    const remaining = shot.duration - localTime;
    if (shot.transitionOut === 'fadeOut' && remaining < outSeconds) {
      overlay.fadeToBlack = Math.max(overlay.fadeToBlack, 1 - remaining / outSeconds);
    } else if (shot.transitionOut === 'flash' && next && !reducedMotion && remaining < outSeconds / 2) {
      overlay.flashWhite = Math.max(overlay.flashWhite, 1 - remaining / (outSeconds / 2));
    }
    return overlay;
  }

  /**
   * 采样某一时刻的一帧。
   * @param {object} timeline compile 的结果。
   * @param {number} time 时间（秒），超出范围时取端点。
   * @param {{ reducedMotion?: boolean }} [options] reducedMotion 为 true 时关闭起伏、晃动与闪白。
   * @returns {object|null} 一帧绘制数据；没有镜头时为 null。
   */
  function sampleFrame(timeline, time, options) {
    const index = locate(timeline, time);
    if (index === -1) return null;
    const shot = timeline.shots[index];
    const localTime = clamp(time - shot.start, 0, shot.duration);
    const frame = buildFrame(timeline, index, localTime, options);
    frame.overlay = buildOverlay(timeline, index, localTime, options);
    return frame;
  }

  /**
   * 调度俯视图的数据：当前镜头每个实体的起点、终点、此刻位置与上一镜头的终点。
   * 位置用 { x: 横向比例（-0.12 到 1.12）, row: 纵深行位置（0 背景，0.5 中景，1 前景） }。
   * @returns {object|null} 没有这个镜头时为 null。
   */
  function buildTopView(timeline, shotIndex, time) {
    const shot = timeline.shots[shotIndex];
    if (!shot) return null;
    const previous = timeline.shots[shotIndex - 1];
    const localTime = clamp(time - shot.start, 0, shot.duration);
    const ratio = clamp((localTime - shot.duration * MOVE_HOLD_RATIO) / (shot.duration * (1 - 2 * MOVE_HOLD_RATIO)), 0, 1);
    const eased = smoothstep(ratio);
    const point = (coordinates) => ({ x: coordinates.x, row: toRow(coordinates.y) });
    const previousEnds = new Map();
    if (previous) for (const actor of previous.actors) if (actor.isPlaced) previousEnds.set(actor.entityId, point(actor.to));
    const actors = shot.actors.map((actor) => {
      const from = point(actor.from);
      const to = point(actor.to);
      const ghost = actor.isPlaced && previousEnds.has(actor.entityId) ? previousEnds.get(actor.entityId) : null;
      return {
        entityId: actor.entityId,
        name: actor.name,
        kind: actor.kind,
        glyph: actor.glyph,
        species: actor.species,
        color: actor.color,
        isPlaced: actor.isPlaced,
        isMoving: actor.isMoving,
        facing: actor.facing,
        from,
        to,
        current: { x: lerp(from.x, to.x, eased), row: lerp(from.row, to.row, eased) },
        // 与上一镜头终点不在同一格时才画出，用来发现位置跳变。
        ghost: ghost && (Math.abs(ghost.x - from.x) > EPSILON || Math.abs(ghost.row - from.row) > EPSILON) ? ghost : null
      };
    });
    return { shotId: shot.id, seq: shot.seq, sceneName: shot.scene.name, hasPrevious: Boolean(previous), actors };
  }

  /**
   * 镜头对照的三个画面时刻：上一镜结尾、本镜开头、本镜结尾；没有上一镜时第一项的时间为 null。
   * @returns {Array<{ key: string, label: string, time: number|null }>}
   */
  function comparePanels(timeline, shotIndex) {
    const shot = timeline.shots[shotIndex];
    if (!shot) return [];
    const previous = timeline.shots[shotIndex - 1];
    return [
      { key: 'previousEnd', label: '上一镜结尾', time: previous ? Math.max(previous.start, previous.end - COMPARE_END_GAP) : null },
      { key: 'start', label: '本镜开头', time: shot.start },
      { key: 'end', label: '本镜结尾', time: Math.max(shot.start, shot.end - COMPARE_END_GAP) }
    ];
  }

  /**
   * 整个镜头都在取景范围之外的角色：景别放大并对准别的角色时，站位在远处的角色会被拍到画面外。
   * 站位本身整个镜头都在画面外的不算（检查另行提示）。
   * @returns {Set<number>} 实体标识集合；景别不放大时为空。
   */
  function framedOut(timeline, shotIndex) {
    const shot = timeline.shots[shotIndex];
    const hidden = new Set();
    if (!shot || shot.shotSizeInfo.zoom <= 1) return hidden;
    const frames = FRAME_SAMPLE_RATIOS.map((ratio) => buildFrame(timeline, shotIndex, shot.duration * ratio, { reducedMotion: true }));
    for (const actor of shot.actors) {
      if (actor.kind !== 'character' || !actor.isPlaced) continue;
      const { fromX, toX } = actor.slot;
      if (fromX === toX && (fromX === 'off_left' || fromX === 'off_right')) continue;
      const outside = frames.every((frame) => {
        const sampled = frame.actors.find((item) => item.entityId === actor.entityId);
        if (!sampled) return false;
        const { zoom, offsetX, centerX } = frame.camera;
        const screenX = 0.5 + offsetX + (sampled.x - centerX) * zoom;
        return screenX < -FRAME_MARGIN || screenX > 1 + FRAME_MARGIN;
      });
      if (outside) hidden.add(actor.entityId);
    }
    return hidden;
  }

  Object.assign(window.aiStoryboardTimeline, { sampleFrame, buildTopView, comparePanels, framedOut });
})();
