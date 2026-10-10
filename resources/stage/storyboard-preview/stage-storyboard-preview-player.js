// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-player.js
// 说明：分镜动画的播放时钟：维护当前时间、播放状态、倍速与循环当前镜头，驱动逐帧推进，提供跳转、上一镜、下一镜等操作。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：不依赖 DOM，时间源与帧调度可注入以便测试，通过 window.aiStoryboardPlayer 暴露；时间线由 stage-storyboard-preview-timeline.js 编译，随数据刷新可用 setTimeline 替换。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const timelineApi = window.aiStoryboardTimeline;
  const { EPSILON } = timelineApi;

  /** 可选的倍速。 */
  const RATES = [0.5, 1, 1.5, 2];
  /** 单帧推进的时间上限（秒）：页面被切走后回来时避免位置突然跳很远。 */
  const MAX_STEP_SECONDS = 0.1;
  /** 播放已超过镜头开头这么多秒时，“上一镜”回到本镜头开头，否则回到上一镜头。 */
  const RESTART_THRESHOLD_SECONDS = 1;
  /** 键盘前进、后退的步长（秒）。 */
  const SEEK_STEP_SECONDS = 1;

  /**
   * 创建播放器。
   * @param {{ timeline: object, onChange: (state: object) => void, now?: () => number, requestFrame?: (callback: (time: number) => void) => number, cancelFrame?: (id: number) => void }} options
   *   timeline 为编译后的时间线；onChange 在时间、播放状态、倍速或循环变化时调用，参数为状态快照；
   *   now、requestFrame、cancelFrame 缺省使用页面的 performance.now 与 requestAnimationFrame。
   * @returns 播放器对象。
   */
  function create(options) {
    const now = options.now || (() => window.performance.now());
    const requestFrame = options.requestFrame || ((callback) => window.requestAnimationFrame(callback));
    const cancelFrame = options.cancelFrame || ((id) => window.cancelAnimationFrame(id));
    let timeline = options.timeline;
    let time = 0;
    let playing = false;
    let rate = 1;
    let loopShot = false;
    let frameId = null;
    let lastStamp = null;

    function snapshot() {
      return { time, playing, rate, loopShot, total: timeline.totalSeconds };
    }

    function notify() {
      options.onChange(snapshot());
    }

    function clampTime(value) {
      return Math.min(timeline.totalSeconds, Math.max(0, value));
    }

    function cancelLoop() {
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
      lastStamp = null;
    }

    /** 当前所在镜头；没有镜头时为 undefined。 */
    function currentShot() {
      return timeline.shots[timelineApi.locate(timeline, time)];
    }

    function schedule() {
      frameId = requestFrame(onFrame);
    }

    /** 动画帧回调：按流逝的时间推进播放进度，并安排下一帧。 */
    function onFrame() {
      frameId = null;
      if (!playing) return;
      const stamp = now();
      const step = lastStamp === null ? 0 : Math.min(MAX_STEP_SECONDS, Math.max(0, (stamp - lastStamp) / 1000));
      lastStamp = stamp;
      // 回调抛错也要继续下一帧，否则 playing 仍为真而帧循环已停，播放器僵死。
      try {
        advance(step * rate);
      } finally {
        if (playing) schedule();
      }
    }

    /** 推进 seconds 秒：循环当前镜头时在镜头内回绕，否则播到末尾停止。 */
    function advance(seconds) {
      const shot = currentShot();
      if (shot === undefined) {
        pause();
        return;
      }
      let next = time + seconds;
      if (loopShot) {
        if (next >= shot.end - EPSILON) next = shot.start + ((next - shot.start) % shot.duration);
        time = next;
      } else if (next >= timeline.totalSeconds - EPSILON) {
        time = timeline.totalSeconds;
        playing = false;
        cancelLoop();
      } else {
        time = next;
      }
      notify();
    }

    /** 开始播放；没有镜头或已在播放时忽略，在末尾再点播放从头开始。 */
    function play() {
      if (playing || timeline.shots.length === 0) return;
      // 在末尾再点播放，从头开始。
      if (time >= timeline.totalSeconds - EPSILON) time = 0;
      playing = true;
      lastStamp = null;
      schedule();
      notify();
    }

    /** 暂停播放，保留当前时间；没在播放时忽略。 */
    function pause() {
      if (!playing) return;
      playing = false;
      cancelLoop();
      notify();
    }

    /** 播放与暂停切换。 */
    function toggle() {
      if (playing) pause();
      else play();
    }

    /** 停止并回到开头。 */
    function stop() {
      playing = false;
      cancelLoop();
      time = 0;
      notify();
    }

    /** 跳到某个时间（秒），超出范围时夹到 0 到总时长之间，播放状态不变。 */
    function seek(target) {
      time = clampTime(target);
      lastStamp = null;
      notify();
    }

    /** 前进（正数）或后退（负数）一个步长。 */
    function step(direction) {
      seek(time + direction * SEEK_STEP_SECONDS);
    }

    /** 下一镜：跳到下一个镜头开头；已在最后一个镜头时跳到末尾。 */
    function nextShot() {
      const index = timelineApi.locate(timeline, time);
      if (index === -1) return;
      const next = timeline.shots[index + 1];
      seek(next ? next.start : timeline.totalSeconds);
    }

    /** 上一镜：本镜头已播放超过 1 秒时回到本镜头开头，否则回到上一个镜头开头。 */
    function prevShot() {
      const index = timelineApi.locate(timeline, time);
      if (index === -1) return;
      const shot = timeline.shots[index];
      if (time - shot.start > RESTART_THRESHOLD_SECONDS || index === 0) seek(shot.start);
      else seek(timeline.shots[index - 1].start);
    }

    /** 跳到第 index 个镜头（从 0 起）的开头；没有这个镜头时忽略。 */
    function seekToShot(index) {
      const shot = timeline.shots[index];
      if (shot) seek(shot.start);
    }

    /** 设置倍速；不在 RATES 里的值忽略。 */
    function setRate(value) {
      if (!RATES.includes(value)) return;
      rate = value;
      notify();
    }

    /** 设置是否循环播放当前镜头。 */
    function setLoopShot(value) {
      loopShot = Boolean(value);
      notify();
    }

    /** 替换时间线（数据刷新后）；时间由调用方先用 timelineApi.restore 求出，不在范围内时夹到范围内；播放状态保持。 */
    function setTimeline(next, nextTime) {
      timeline = next;
      time = clampTime(nextTime === undefined || nextTime === null ? time : nextTime);
      if (timeline.shots.length === 0 && playing) {
        playing = false;
        cancelLoop();
      }
      notify();
    }

    /** 释放帧调度；预览层关闭时调用。 */
    function destroy() {
      playing = false;
      cancelLoop();
    }

    return { play, pause, toggle, stop, seek, step, nextShot, prevShot, seekToShot, setRate, setLoopShot, setTimeline, destroy, getState: snapshot };
  }

  window.aiStoryboardPlayer = { create, RATES, MAX_STEP_SECONDS };
})();
