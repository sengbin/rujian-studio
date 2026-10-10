// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-timeline-view.js
// 说明：分镜动画预览的时间线视图：镜头分段、镜头组标记、声音泳道、播放头，以及点击和拖动进度条跳转。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 stage-storyboard-preview.js 拆出，通过 window.aiStoryboardPreviewTimelineView.create(ctx) 创建；时间线数据与检查结果读自页面状态，跳转通过播放器完成；依赖 stage-storyboard-preview-checks.js、shared/page-format.js 与 aiUi 组件库，样式在 stage-storyboard-preview.css。
// ------------------------------------------------------------------------

'use strict';

(function () {
  /** 时间线上分段宽度不小于这个像素才显示镜头序号。 */
  const SEGMENT_LABEL_MIN_WIDTH = 28;
  const FALLBACK_TIMELINE_WIDTH = 800;
  const LANES = [
    ['dialogue', '对白'],
    ['narration', '旁白'],
    ['sfx', '音效'],
    ['music', '音乐']
  ];

  const checksApi = window.aiStoryboardChecks;
  const { formatSeconds } = window.pageFormat;

  /**
   * 创建时间线视图。
   * @param {{ state: object, player: object }} ctx
   *   state 为预览层的页面状态（读 timeline、checks、shotIndex，读写 highlightedIndex、dragging、resumeAfterDrag）；player 为播放器。
   * @returns {{ element: HTMLElement, tracks: HTMLElement, render: () => void, updatePlayhead: (playerState: object) => void }}
   *   element 为时间线根元素；tracks 为可拖动的轨道区域（尺寸变化时需要观察它）；
   *   render 按当前时间线重建分段与泳道；updatePlayhead 更新播放头、当前镜头高亮与滑块无障碍值。
   */
  function create(ctx) {
    const { state, player } = ctx;

    // ---------- 元素 ----------
    const groupRow = aiUi.h('div', { class: 'sbp-tl-row sbp-tl-row--groups' });
    const segmentRow = aiUi.h('div', { class: 'sbp-tl-row' });
    const laneRows = aiUi.h('div', { class: 'sbp-tl-lanes' });
    const laneLabels = aiUi.h('div', { class: 'sbp-tl-labels' });
    const playhead = aiUi.h('div', { class: 'sbp-playhead', attrs: { 'aria-hidden': 'true' } });
    const tracks = aiUi.h(
      'div',
      { class: 'sbp-tl-tracks', attrs: { role: 'slider', tabindex: '0', 'aria-label': '播放进度', 'aria-valuemin': '0', 'aria-valuemax': '0', 'aria-valuenow': '0' } },
      groupRow,
      segmentRow,
      laneRows,
      playhead
    );
    const timelineElement = aiUi.h('div', { class: 'sbp-timeline' }, laneLabels, tracks);

    // ---------- 时间线 ----------
    /** 时间线总宽度对应的像素（没有排版信息时用缺省值）。 */
    function timelineWidth() {
      return tracks.clientWidth || FALLBACK_TIMELINE_WIDTH;
    }

    function percent(seconds) {
      const total = state.timeline.totalSeconds;
      return total > 0 ? (seconds / total) * 100 : 0;
    }

    function placeBar(element, start, end) {
      element.style.left = `${percent(start)}%`;
      element.style.width = `${percent(end - start)}%`;
    }

    /** 有警告级检查项的镜头标识集合。 */
    function warningShotIds() {
      return new Set(state.checks.filter((entry) => entry.level === checksApi.LEVEL_WARNING).map((entry) => entry.shotId));
    }

    /** 重建时间线：镜头分段、镜头组标记与声音泳道。 */
    function renderTimeline() {
      groupRow.textContent = '';
      segmentRow.textContent = '';
      laneRows.textContent = '';
      laneLabels.textContent = '';
      state.highlightedIndex = -2;
      const { timeline } = state;
      const total = timeline.totalSeconds;
      tracks.setAttribute('aria-valuemax', String(total));
      timelineElement.classList.toggle('sbp-timeline--empty', timeline.shots.length === 0);
      if (timeline.shots.length === 0) return;

      const warned = warningShotIds();
      const width = timelineWidth();
      const groupFirst = new Set(timeline.groups.map((group) => group.firstIndex));
      for (const group of timeline.groups) {
        if (group.seq === null) continue;
        const mark = aiUi.h('span', { class: 'sbp-group-mark', text: `组 ${group.seq}` });
        placeBar(mark, group.start, group.end);
        groupRow.append(mark);
      }
      for (const shot of timeline.shots) {
        const wide = (shot.duration / total) * width >= SEGMENT_LABEL_MIN_WIDTH;
        const classes = ['sbp-seg'];
        if (shot.groupSeq !== null && shot.groupSeq % 2 === 0) classes.push('sbp-seg--even');
        if (groupFirst.has(shot.index)) classes.push('sbp-seg--group-start');
        if (warned.has(shot.id)) classes.push('sbp-seg--warn');
        const segment = aiUi.h('span', {
          class: classes.join(' '),
          text: wide ? String(shot.seq) : '',
          attrs: { title: `第 ${shot.seq} 镜 · ${shot.sceneLabel || shot.scene.name} · ${formatSeconds(shot.duration)}${warned.has(shot.id) ? ' · 有警告' : ''}`, 'data-index': shot.index }
        });
        placeBar(segment, shot.start, shot.end);
        segmentRow.append(segment);
      }
      for (const [kind, label] of LANES) {
        const sounds = timeline.shots.flatMap((shot) => shot.sounds.filter((sound) => sound.kind === kind).map((sound) => ({ shot, sound })));
        if (sounds.length === 0) continue;
        laneLabels.append(aiUi.h('span', { class: 'sbp-tl-label', text: label }));
        const lane = aiUi.h('div', { class: 'sbp-tl-row sbp-tl-row--lane' });
        for (const { shot, sound } of sounds) {
          const bar = aiUi.h('span', { class: `sbp-sound sbp-sound--${kind}`, attrs: { title: `${label}：${sound.text}` } });
          placeBar(bar, shot.start + sound.start, shot.start + Math.max(sound.end, sound.start + 0.05));
          lane.append(bar);
        }
        laneRows.append(lane);
      }
      updatePlayhead(player.getState());
    }

    /** 播放头位置、当前镜头高亮与滑块无障碍值。 */
    function updatePlayhead(playerState) {
      playhead.style.left = `${percent(playerState.time)}%`;
      if (state.highlightedIndex !== state.shotIndex) {
        state.highlightedIndex = state.shotIndex;
        for (const segment of segmentRow.children) {
          segment.classList.toggle('sbp-seg--current', Number(segment.getAttribute('data-index')) === state.shotIndex);
        }
      }
      tracks.setAttribute('aria-valuenow', String(Number(playerState.time.toFixed(1))));
      const shot = state.timeline.shots[state.shotIndex];
      tracks.setAttribute('aria-valuetext', shot ? `第 ${shot.seq} 镜，${formatSeconds(playerState.time)}，共 ${formatSeconds(playerState.total)}` : '没有可播放的镜头');
    }

    /** 按指针位置跳转到对应时间。 */
    function seekFromPointer(event) {
      const rect = tracks.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      player.seek(ratio * state.timeline.totalSeconds);
    }

    tracks.addEventListener('pointerdown', (event) => {
      if (state.timeline.shots.length === 0) return;
      state.dragging = true;
      state.resumeAfterDrag = player.getState().playing;
      if (state.resumeAfterDrag) player.pause();
      if (tracks.setPointerCapture && event.pointerId !== undefined) tracks.setPointerCapture(event.pointerId);
      seekFromPointer(event);
      tracks.focus();
    });
    tracks.addEventListener('pointermove', (event) => {
      if (state.dragging) seekFromPointer(event);
    });
    const endDrag = () => {
      if (!state.dragging) return;
      state.dragging = false;
      const current = player.getState();
      if (state.resumeAfterDrag && current.time < current.total) player.play();
    };
    tracks.addEventListener('pointerup', endDrag);
    tracks.addEventListener('pointercancel', endDrag);

    return { element: timelineElement, tracks, render: renderTimeline, updatePlayhead };
  }

  window.aiStoryboardPreviewTimelineView = { create };
})();
