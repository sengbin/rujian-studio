// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-timeline.js
// 说明：分镜动画的时间线编译（纯逻辑）：把分镜脚本阶段视图编译为带镜头时间、站位坐标、声音时间、景别、运镜与转场的时间线，并提供定位、位置恢复、调度描述与采样要用的基础函数。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：不依赖 DOM，通过 window.aiStoryboardTimeline 暴露，依赖 stage-storyboard-preview-rules.js（关键词归类，归类函数由这里原样导出）；采样（sampleFrame、buildTopView、comparePanels、framedOut）在 stage-storyboard-preview-timeline-sample.js，它把这些函数加到同一个对象上；规则见 private-docs/rujian-studio/开发文档-vscode/storyboard-animation-design.md 第 6 节；渲染在 stage-storyboard-preview-art*.js 与 stage-storyboard-preview-renderer.js，对照视图在 stage-storyboard-preview-modes.js，检查在 stage-storyboard-preview-checks.js。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const { parseCamera, parseTransition, parseShotSize, classifyScene, classifyProp, classifyEffect, classifyCharacterDetail, classifyHuman } = window.aiStoryboardRules;

  /** 横向位置的顺序与占画面宽度的比例（以观众看到的画面为准）。 */
  const X_ORDER = ['off_left', 'left', 'center', 'right', 'off_right'];
  const X_FRACTION = { off_left: -0.12, left: 0.22, center: 0.5, right: 0.78, off_right: 1.12 };
  /** 纵深位置的顺序，角色脚下位置占画面高度的比例与缩放。 */
  const DEPTH_ORDER = ['back', 'middle', 'front'];
  const DEPTH_STAGE = { back: { y: 0.56, scale: 0.7 }, middle: { y: 0.72, scale: 1 }, front: { y: 0.88, scale: 1.35 } };
  const DEFAULT_X = 'center';
  const DEFAULT_DEPTH = 'middle';

  /** 界面文字：位置与朝向的名称，与 domain/models/storyboard.ts 的标签一致。 */
  const LABELS = {
    x: { off_left: '画面左外', left: '画面左侧', center: '画面中央', right: '画面右侧', off_right: '画面右外' },
    depth: { back: '背景', middle: '中景', front: '前景' },
    facing: { camera: '面向镜头', away: '背对镜头', left: '面朝画面左侧', right: '面朝画面右侧' }
  };

  /** 画幅解析：宽高比的合理范围与缺省值。 */
  const DEFAULT_ASPECT = { width: 16, height: 9 };
  const MIN_RATIO = 9 / 21;
  const MAX_RATIO = 21 / 9;
  const ASPECT_PATTERN = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;

  /** 颜色：角色、道具、特效与场景（墙面、地面）。角色第一个为红色。 */
  const CHARACTER_COLORS = ['#E5484D', '#F5A524', '#30A46C', '#3E63DD', '#8E4EC6', '#E93D82', '#12A594', '#D6B100'];
  const PROP_COLORS = ['#8B6B4A', '#7A8793', '#3F8F83', '#8A7A9B', '#8C8C4A', '#A86F5A'];
  const EFFECT_COLOR = '#F5D90A';
  const SCENE_COLORS = [
    { wall: '#2B3A55', floor: '#3A4A66' },
    { wall: '#3B2F3F', floor: '#4D3F52' },
    { wall: '#2F4A3E', floor: '#3F5E50' },
    { wall: '#4A3B2B', floor: '#5E4C3A' },
    { wall: '#2B4A4D', floor: '#3A5F63' },
    { wall: '#4A2F35', floor: '#5F3F47' }
  ];

  /** 声音时间：人声按每秒汉字数估算时长，最短时长；音效的默认时长。 */
  const SPEECH_CHARS_PER_SECOND = 4;
  const SPEECH_MIN_SECONDS = 1;
  const SFX_DEFAULT_SECONDS = 1.5;
  /** 浮点比较的容差（秒或占比），预览各模块共用。 */
  const EPSILON = 1e-6;

  /** 把数值限制在 min 到 max 之间。 */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /** 线性插值；ratio 为 0 或 1 时精确等于端点。 */
  function lerp(from, to, ratio) {
    return from * (1 - ratio) + to * ratio;
  }

  /** 平滑步进曲线：进度 0 到 1 之间先慢后快再慢。 */
  function smoothstep(ratio) {
    return ratio * ratio * (3 - 2 * ratio);
  }

  /** 文字的简单哈希（非负整数），用来给没有场景实体的场次稳定取色。 */
  function hashText(text) {
    let hash = 5381;
    for (const char of text) hash = ((hash << 5) + hash + char.codePointAt(0)) >>> 0;
    return hash;
  }

  /**
   * 解析画幅文字（如 16:9）。
   * @param {string|null|undefined} text 画幅；为空或无法解析时按 16:9。
   * @returns {{ width: number, height: number, ratio: number, assumed: boolean }} 宽高、宽高比与是否为缺省值；宽高比限制在 9:21 到 21:9 之间。
   */
  function parseAspectRatio(text) {
    const matched = typeof text === 'string' ? ASPECT_PATTERN.exec(text.trim()) : null;
    const width = matched ? Number(matched[1]) : 0;
    const height = matched ? Number(matched[2]) : 0;
    if (!(width > 0 && height > 0)) {
      return { ...DEFAULT_ASPECT, ratio: DEFAULT_ASPECT.width / DEFAULT_ASPECT.height, assumed: true };
    }
    return { width, height, ratio: clamp(width / height, MIN_RATIO, MAX_RATIO), assumed: false };
  }

  /** 纵深坐标（占画面高度的比例）折算成 0（背景）到 1（前景）的行位置。 */
  function toRow(y) {
    return Math.round(((y - DEPTH_STAGE.back.y) / (DEPTH_STAGE.front.y - DEPTH_STAGE.back.y)) * 1e6) / 1e6;
  }

  /** 位置名称换算成画面比例坐标与缩放。 */
  function toCoordinates(xName, depthName) {
    const depth = DEPTH_STAGE[depthName];
    return { x: X_FRACTION[xName], y: depth.y, scale: depth.scale };
  }

  /** 站位是否填写了任何位置（只填朝向或动作不算已摆放）。 */
  function hasPosition(staging) {
    return Boolean(staging) && [staging.startX, staging.startDepth, staging.endX, staging.endDepth].some((value) => value !== null && value !== undefined);
  }

  /** 按补全规则求出起点与终点的位置名称。 */
  function resolveEndpoints(staging) {
    const fromX = staging.startX || DEFAULT_X;
    const fromDepth = staging.startDepth || DEFAULT_DEPTH;
    const hasEnd = Boolean(staging.endX) || Boolean(staging.endDepth);
    return {
      fromX,
      fromDepth,
      toX: hasEnd ? staging.endX || fromX : fromX,
      toDepth: hasEnd ? staging.endDepth || fromDepth : fromDepth
    };
  }

  /** 朝向缺省时：移动时朝向移动方向，不移动时面向镜头。 */
  function resolveFacing(staging, fromX, toX) {
    if (staging && staging.facing) return staging.facing;
    const delta = X_FRACTION[toX] - X_FRACTION[fromX];
    if (delta > EPSILON) return 'right';
    if (delta < -EPSILON) return 'left';
    return 'camera';
  }

  /** 人声（对白、旁白）。 */
  function isVoice(kind) {
    return kind === 'dialogue' || kind === 'narration';
  }

  /** 文字里的非空白字符数。 */
  function countChars(text) {
    return (text || '').replace(/\s+/g, '').length;
  }

  /**
   * 计算一个镜头里已启用声音的起止时间（相对镜头开头）。
   * @param {object[]} sounds 镜头的声音条目。
   * @param {number} duration 镜头时长（秒）。
   * @param {(id: number|null) => string} nameOf 取说话人名称。
   */
  function compileSounds(sounds, duration, nameOf) {
    const result = [];
    let voiceCursor = 0;
    for (const sound of sounds || []) {
      if (!sound.isEnabled) continue;
      const voice = isVoice(sound.kind);
      const hasStart = sound.startOffsetSeconds !== null && sound.startOffsetSeconds !== undefined;
      const hasDuration = sound.durationSeconds !== null && sound.durationSeconds !== undefined;
      const start = hasStart ? sound.startOffsetSeconds : voice ? voiceCursor : 0;
      let length;
      if (hasDuration) length = sound.durationSeconds;
      else if (voice) length = Math.max(SPEECH_MIN_SECONDS, countChars(sound.text) / SPEECH_CHARS_PER_SECOND);
      else if (sound.kind === 'music') length = Math.max(0, duration - start);
      else length = SFX_DEFAULT_SECONDS;
      const rawEnd = start + length;
      if (voice) voiceCursor = rawEnd;
      result.push({
        id: sound.id === undefined ? null : sound.id,
        kind: sound.kind,
        speakerEntityId: sound.speakerEntityId === undefined ? null : sound.speakerEntityId,
        speakerName: sound.kind === 'dialogue' ? nameOf(sound.speakerEntityId) : '',
        text: sound.text,
        delivery: sound.delivery || '',
        charCount: countChars(sound.text),
        start: Math.min(start, duration),
        end: Math.min(rawEnd, duration),
        rawEnd,
        // 开始时间或持续时长缺失，按规则估算得到。
        estimated: !hasStart || (!hasDuration && sound.kind !== 'music'),
        clipped: rawEnd > duration + EPSILON
      });
    }
    return result;
  }

  /** 把一个镜头的出场实体与站位编译为角色、道具、特效的运动描述，以及不绘制的实体。 */
  function compileActors(shot, entities, colorIndex) {
    const stagingById = new Map((shot.staging || []).map((item) => [item.entityId, item]));
    const actors = [];
    const unplaced = [];
    for (const entityId of shot.entityIds || []) {
      const entity = entities.get(entityId);
      if (!entity || entity.kind === 'scene') continue;
      const staging = stagingById.get(entityId);
      const placed = hasPosition(staging);
      if (!placed && entity.kind !== 'character') {
        unplaced.push({ entityId, name: entity.name, kind: entity.kind });
        continue;
      }
      const index = colorIndex.get(entityId) || 0;
      let color = EFFECT_COLOR;
      if (entity.kind === 'character') color = CHARACTER_COLORS[index % CHARACTER_COLORS.length];
      else if (entity.kind === 'prop') color = PROP_COLORS[index % PROP_COLORS.length];
      const detail = entity.kind === 'character' ? classifyCharacterDetail(entity.name, entity.hint) : null;
      const human = detail && detail.species === 'human' ? classifyHuman(entity.name, entity.hint) : null;
      const actor = {
        entityId,
        name: entity.name,
        kind: entity.kind,
        color,
        isPlaced: placed,
        action: staging ? staging.action || '' : '',
        glyph: detail ? detail.glyph : entity.kind === 'prop' ? classifyProp(entity.name) : entity.kind === 'effect' ? classifyEffect(entity.name) : '',
        species: detail ? detail.species : '',
        gender: human ? human.gender : '',
        age: human ? human.age : '',
        slot: null,
        from: null,
        to: null,
        facing: 'camera',
        isMoving: false
      };
      if (placed) {
        const points = resolveEndpoints(staging);
        actor.slot = { fromX: points.fromX, fromDepth: points.fromDepth, toX: points.toX, toDepth: points.toDepth };
        actor.from = toCoordinates(points.fromX, points.fromDepth);
        actor.to = toCoordinates(points.toX, points.toDepth);
        actor.facing = resolveFacing(staging, points.fromX, points.toX);
        actor.isMoving = points.fromX !== points.toX || points.fromDepth !== points.toDepth;
      } else {
        actor.facing = staging && staging.facing ? staging.facing : 'camera';
      }
      actors.push(actor);
    }
    // 没有摆放的角色在画面中部等距排开。
    const waiting = actors.filter((actor) => !actor.isPlaced);
    waiting.forEach((actor, position) => {
      const x = waiting.length === 1 ? 0.5 : lerp(0.3, 0.7, position / (waiting.length - 1));
      const point = { x, y: DEPTH_STAGE[DEFAULT_DEPTH].y, scale: DEPTH_STAGE[DEFAULT_DEPTH].scale };
      actor.from = point;
      actor.to = point;
    });
    return { actors, unplaced };
  }

  /** 镜头的场景：取第一个场景实体，没有则按场次文字取色；同时按场景名与场次文字归类地点和时间。 */
  function compileScene(shot, entities, colorIndex) {
    const entityId = (shot.entityIds || []).find((id) => entities.get(id) && entities.get(id).kind === 'scene');
    const label = (shot.sceneLabel || '').trim();
    if (entityId !== undefined) {
      const colors = SCENE_COLORS[(colorIndex.get(entityId) || 0) % SCENE_COLORS.length];
      const name = entities.get(entityId).name;
      return { entityId, name, ...colors, ...classifyScene(`${name} ${label}`), seed: hashText(name) };
    }
    const colors = SCENE_COLORS[hashText(label) % SCENE_COLORS.length];
    return { entityId: null, name: label || '未命名场景', ...colors, ...classifyScene(label), seed: hashText(label) };
  }

  /**
   * 把分镜脚本阶段视图编译为时间线。
   * @param {object} view 分镜脚本阶段视图（shots、groups、entities、aspectRatio）。
   * @returns {object} 时间线：{ aspect, totalSeconds, shots, groups }，镜头带起止时间、场景、角色运动、声音、运镜与转场。
   */
  function compile(view) {
    const entities = new Map((view.entities || []).map((entity) => [entity.id, entity]));
    // 同一类型实体按列表顺序编号，用来稳定分配颜色。
    const colorIndex = new Map();
    const counters = {};
    for (const entity of view.entities || []) {
      counters[entity.kind] = counters[entity.kind] || 0;
      colorIndex.set(entity.id, counters[entity.kind]);
      counters[entity.kind] += 1;
    }
    const groupOf = new Map();
    for (const group of view.groups || []) for (const shotId of group.shotIds) groupOf.set(shotId, group.seq);
    const nameOf = (id) => (entities.has(id) ? entities.get(id).name : '');
    const noticesByShot = new Map();
    for (const notice of view.cutNotices || []) noticesByShot.set(notice.shotId, [...(noticesByShot.get(notice.shotId) || []), notice]);

    let cursor = 0;
    const shots = [...(view.shots || [])]
      .sort((a, b) => a.seq - b.seq)
      .map((shot, index) => {
        const start = cursor;
        cursor += shot.durationSeconds;
        const { actors, unplaced } = compileActors(shot, entities, colorIndex);
        return {
          id: shot.id,
          seq: shot.seq,
          index,
          start,
          end: cursor,
          duration: shot.durationSeconds,
          groupSeq: groupOf.has(shot.id) ? groupOf.get(shot.id) : null,
          sceneLabel: shot.sceneLabel || '',
          shotSize: shot.shotSize || '',
          cameraAngle: shot.cameraAngle || '',
          cameraMovement: shot.cameraMovement || '',
          transition: shot.transition || '',
          firstFrameMode: shot.firstFrameMode || 'none',
          cutNotices: noticesByShot.get(shot.id) || [],
          prompt: shot.prompt || '',
          scene: compileScene(shot, entities, colorIndex),
          actors,
          unplaced,
          sounds: compileSounds(shot.sounds, shot.durationSeconds, nameOf),
          camera: parseCamera(shot.cameraMovement),
          shotSizeInfo: parseShotSize(shot.shotSize),
          transitionOut: parseTransition(shot.transition)
        };
      });

    const groups = [];
    for (const shot of shots) {
      const last = groups[groups.length - 1];
      if (last && shot.groupSeq !== null && last.seq === shot.groupSeq) {
        last.lastIndex = shot.index;
        last.end = shot.end;
      } else {
        groups.push({ seq: shot.groupSeq, firstIndex: shot.index, lastIndex: shot.index, start: shot.start, end: shot.end });
      }
    }
    return { aspect: parseAspectRatio(view.aspectRatio), totalSeconds: Math.round(cursor * 1000) / 1000, shots, groups };
  }

  /**
   * 求某一时刻所在的镜头序位。
   * @returns {number} 镜头在时间线中的下标；没有镜头时为 -1；时间在末尾或之后落在最后一个镜头。
   */
  function locate(timeline, time) {
    const { shots } = timeline;
    if (shots.length === 0) return -1;
    if (time <= 0) return 0;
    const found = shots.findIndex((shot) => time >= shot.start - EPSILON && time < shot.end - EPSILON);
    return found === -1 ? shots.length - 1 : found;
  }

  /** 当前播放位置：所在镜头标识与镜头内偏移，用于时间线重建后恢复位置。 */
  function position(timeline, time) {
    const index = locate(timeline, time);
    if (index === -1) return null;
    const shot = timeline.shots[index];
    return { shotId: shot.id, offset: clamp(time - shot.start, 0, shot.duration) };
  }

  /**
   * 按镜头标识与镜头内偏移求时间；镜头已不存在时返回 null。
   * @returns {number|null} 时间（秒）。
   */
  function restore(timeline, saved) {
    if (!saved) return null;
    const shot = timeline.shots.find((item) => item.id === saved.shotId);
    return shot ? shot.start + clamp(saved.offset, 0, shot.duration) : null;
  }

  /** 位置与朝向的一句话描述，用于无障碍摘要与信息栏。 */
  function describeActor(actor) {
    if (!actor.isPlaced) return `${actor.name}（没有站位）`;
    const { fromX, fromDepth, toX, toDepth } = actor.slot;
    const facing = LABELS.facing[actor.facing];
    const origin = `${LABELS.x[fromX]}${LABELS.depth[fromDepth]}`;
    if (!actor.isMoving) return `${actor.name}在${origin}，${facing}`;
    return `${actor.name}从${origin}走到${LABELS.x[toX]}${LABELS.depth[toDepth]}，${facing}`;
  }

  /** 一个镜头的摘要：序号、场景与角色调度，用作画布的无障碍文字。 */
  function summarizeShot(shot) {
    const parts = [`第 ${shot.seq} 镜`, shot.scene.name];
    for (const actor of shot.actors) if (actor.kind === 'character') parts.push(describeActor(actor));
    return parts.join('，');
  }

  window.aiStoryboardTimeline = {
    LABELS,
    X_ORDER,
    DEPTH_ORDER,
    X_FRACTION,
    DEPTH_STAGE,
    EPSILON,
    clamp,
    lerp,
    smoothstep,
    toRow,
    compile,
    locate,
    position,
    restore,
    parseAspectRatio,
    parseCamera,
    parseTransition,
    parseShotSize,
    classifyScene,
    classifyProp,
    classifyEffect,
    classifyCharacterDetail,
    classifyHuman,
    describeActor,
    summarizeShot,
    isVoice
  };
})();
