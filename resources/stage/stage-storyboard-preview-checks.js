// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-checks.js
// 说明：分镜动画的质量检查（纯逻辑）：根据编译后的时间线找出声音超出镜头时长、台词过长、人声重叠、说话人没有站位、位置衔接不上等问题，供预览层的检查列表与时间线标记使用。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：依赖 stage-storyboard-preview-timeline.js（位置顺序、EPSILON）与 shared/page-format.js（秒数显示），通过 window.aiStoryboardChecks 暴露；检查项与阈值见 private-docs/rujian-studio/开发文档-vscode/storyboard-animation-design.md 第 8 节。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const timelineApi = window.aiStoryboardTimeline;

  const LEVEL_WARNING = 'warning';
  const LEVEL_INFO = 'info';
  /** 人声语速上限：每秒汉字数，持续时长内说不完时判为过快。 */
  const SPEECH_MAX_CHARS_PER_SECOND = 6;
  /** 两条人声的重叠时间超过它才算重叠（秒）。 */
  const OVERLAP_TOLERANCE = 0.05;
  /** 相邻镜头位置相差达到这个档数判为衔接不上。 */
  const JUMP_STEPS = 2;
  /** 镜头时长过短、过长的界线（秒）。 */
  const SHORT_SHOT_SECONDS = 1;
  const LONG_SHOT_SECONDS = 10;

  /** 整数不带小数点的秒数显示由页面共用的 pageFormat 提供。 */
  const { formatSeconds } = window.pageFormat;
  const { EPSILON } = timelineApi;

  /** 横向、纵深位置名称在顺序中的下标。 */
  function xIndex(name) {
    return timelineApi.X_ORDER.indexOf(name);
  }

  function depthIndex(name) {
    return timelineApi.DEPTH_ORDER.indexOf(name);
  }

  /** 构造一个检查项。 */
  function item(shot, level, code, text) {
    return { shotId: shot.id, shotIndex: shot.index, shotSeq: shot.seq, level, code, text: `第 ${shot.seq} 镜：${text}` };
  }

  /** 声音超出镜头时长、台词语速过快。 */
  function checkSounds(shot, items) {
    for (const sound of shot.sounds) {
      if (sound.clipped) {
        items.push(item(shot, LEVEL_WARNING, 'sound_overflow', `声音超出镜头时长 ${formatSeconds(sound.rawEnd - shot.duration)}，视频里会被截断。`));
      }
      if (timelineApi.isVoice(sound.kind) && sound.charCount > 0) {
        const given = sound.rawEnd - sound.start;
        const needed = sound.charCount / SPEECH_MAX_CHARS_PER_SECOND;
        if (given < needed - EPSILON) {
          items.push(item(shot, LEVEL_WARNING, 'speech_too_dense', `这句台词约需 ${formatSeconds(needed)}，只给了 ${formatSeconds(given)}，语速会过快。`));
        }
      }
    }
  }

  /** 同一镜头里两条人声时间重叠；每个镜头只报一次。 */
  function checkOverlap(shot, items) {
    const voices = shot.sounds.filter((sound) => timelineApi.isVoice(sound.kind));
    for (let first = 0; first < voices.length; first += 1) {
      for (let second = first + 1; second < voices.length; second += 1) {
        const overlap = Math.min(voices[first].end, voices[second].end) - Math.max(voices[first].start, voices[second].start);
        if (overlap > OVERLAP_TOLERANCE) {
          items.push(item(shot, LEVEL_WARNING, 'voice_overlap', '两条人声同时出现。'));
          return;
        }
      }
    }
  }

  /** 对白说话人没有站位（预览里位置是随意排布的）。 */
  function checkSpeakers(shot, items) {
    const reported = new Set();
    for (const sound of shot.sounds) {
      if (sound.kind !== 'dialogue' || sound.speakerEntityId === null || reported.has(sound.speakerEntityId)) continue;
      const actor = shot.actors.find((candidate) => candidate.entityId === sound.speakerEntityId);
      if (actor && actor.isPlaced) continue;
      reported.add(sound.speakerEntityId);
      items.push(item(shot, LEVEL_WARNING, 'speaker_unplaced', `说话人“${sound.speakerName}”没有站位，预览里位置是随意排布的。`));
    }
  }

  /** 角色整个镜头都停留在画面同一侧的外面。 */
  function checkOffscreen(shot, items) {
    for (const actor of shot.actors) {
      if (actor.kind !== 'character' || !actor.isPlaced) continue;
      const { fromX, toX } = actor.slot;
      if (fromX === toX && (fromX === 'off_left' || fromX === 'off_right')) {
        items.push(item(shot, LEVEL_INFO, 'actor_offscreen_all', `“${actor.name}”整个镜头都在画面外。`));
      }
    }
  }

  /** 景别放大并对准别的角色，使有的角色整个镜头都在取景范围之外（画面里看不到）。 */
  function checkFramedOut(timeline, shot, items) {
    const hidden = timelineApi.framedOut(timeline, shot.index);
    for (const actor of shot.actors) {
      if (!hidden.has(actor.entityId)) continue;
      items.push(item(shot, LEVEL_INFO, 'actor_framed_out', `“${actor.name}”不在${shot.shotSize || '当前景别'}的取景范围内，画面里看不到；想让他入镜，可以换更大的景别，或把他的站位挪近主体。`));
    }
  }

  /** 同一场景里，上一镜头的终点与本镜头的起点相差太远。 */
  function checkPositionJump(shot, previous, items) {
    if (!previous || previous.scene.name !== shot.scene.name) return;
    for (const actor of shot.actors) {
      if (!actor.isPlaced) continue;
      const before = previous.actors.find((candidate) => candidate.entityId === actor.entityId && candidate.isPlaced);
      if (!before) continue;
      const farX = Math.abs(xIndex(before.slot.toX) - xIndex(actor.slot.fromX)) >= JUMP_STEPS;
      const farDepth = Math.abs(depthIndex(before.slot.toDepth) - depthIndex(actor.slot.fromDepth)) >= JUMP_STEPS;
      if (!farX && !farDepth) continue;
      if (shot.firstFrameMode === 'prev_tail') {
        items.push(item(shot, LEVEL_WARNING, 'position_jump_tail', `以上一镜头尾帧为首帧，但“${actor.name}”的起点与上一镜头终点不一致。`));
      } else {
        items.push(item(shot, LEVEL_INFO, 'position_jump', `“${actor.name}”与上一镜头的位置衔接不上。`));
      }
    }
  }

  /** 组与组之间的衔接提醒（由宿主按规则算好随视图下发）：硬切处画面没变化、接尾帧会丢参考素材。 */
  function checkGroupNotices(shot, items) {
    for (const notice of shot.cutNotices || []) items.push(item(shot, LEVEL_WARNING, notice.code, notice.text));
  }

  /** 没有出场角色、时长异常、运镜无法模拟。 */
  function checkShotBasics(shot, items) {
    const hasCharacter = shot.actors.some((actor) => actor.kind === 'character');
    const hasVoice = shot.sounds.some((sound) => timelineApi.isVoice(sound.kind));
    if (!hasCharacter && !hasVoice) items.push(item(shot, LEVEL_INFO, 'no_actor', '没有出场角色。'));
    if (shot.duration < SHORT_SHOT_SECONDS - EPSILON || shot.duration > LONG_SHOT_SECONDS + EPSILON) {
      items.push(item(shot, LEVEL_INFO, 'duration_extreme', `时长 ${formatSeconds(shot.duration)}，请确认是否合适。`));
    }
    if (!shot.camera.supported) items.push(item(shot, LEVEL_INFO, 'camera_unsupported', `运镜“${shot.camera.label}”预览未模拟。`));
  }

  /**
   * 对整集时间线做质量检查。
   * @param {object} timeline aiStoryboardTimeline.compile 的结果。
   * @returns {Array<{ shotId: number, shotIndex: number, shotSeq: number, level: 'warning'|'info', code: string, text: string }>} 按镜头顺序排列的检查项。
   */
  function check(timeline) {
    const items = [];
    for (const shot of timeline.shots) {
      checkSounds(shot, items);
      checkOverlap(shot, items);
      checkSpeakers(shot, items);
      checkOffscreen(shot, items);
      checkFramedOut(timeline, shot, items);
      checkPositionJump(shot, timeline.shots[shot.index - 1], items);
      checkGroupNotices(shot, items);
      checkShotBasics(shot, items);
    }
    return items;
  }

  /** 汇总检查项的数量：警告与提示各多少项。 */
  function summarize(items) {
    const warnings = items.filter((entry) => entry.level === LEVEL_WARNING).length;
    return { warnings, infos: items.length - warnings };
  }

  window.aiStoryboardChecks = { check, summarize, LEVEL_WARNING, LEVEL_INFO };
})();
