// ------------------------------------------------------------------------
// 名称：storyboard-preview-player.test.mjs
// 说明：分镜动画播放时钟的单元测试：播放推进与倍速、到结尾停止、末尾再播放从头开始、循环当前镜头、跳转、上一镜与下一镜、单帧步长上限、暂停不推进、替换时间线。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：用假的时间源与帧调度，不需要 DOM。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScript, loadTimelineWindow, makeShot, makeView } from './storyboard-preview-fixtures.mjs';

const timelineWindow = loadTimelineWindow();
const timeline = timelineWindow.aiStoryboardTimeline;
const playerApi = loadScript('stage/stage-storyboard-preview-player.js', timelineWindow).aiStoryboardPlayer;

/** 三个镜头：2 秒、3 秒、4 秒，共 9 秒。 */
function compileThree() {
  return timeline.compile(makeView([makeShot(1, { durationSeconds: 2 }), makeShot(2, { durationSeconds: 3 }), makeShot(3, { durationSeconds: 4 })]));
}

/** 建立带假时钟的播放器；tick(seconds) 让时间流逝并执行已排队的一帧。 */
function setup(compiled = compileThree()) {
  let stamp = 0;
  let pending = null;
  const changes = [];
  const player = playerApi.create({
    timeline: compiled,
    onChange: (state) => changes.push(state),
    now: () => stamp,
    requestFrame: (callback) => {
      pending = callback;
      return 1;
    },
    cancelFrame: () => {
      pending = null;
    }
  });
  const tick = (seconds) => {
    stamp += seconds * 1000;
    const callback = pending;
    pending = null;
    if (callback) callback(stamp);
  };
  return { player, tick, changes, hasPendingFrame: () => pending !== null };
}

test('播放：第一帧只建立时间基准，之后按流逝时间推进；暂停后不再推进也不再排队', () => {
  const { player, tick, hasPendingFrame } = setup();
  player.play();
  assert.equal(player.getState().playing, true);
  tick(0);
  tick(0.05);
  tick(0.05);
  assert.ok(Math.abs(player.getState().time - 0.1) < 1e-9);
  player.pause();
  assert.equal(hasPendingFrame(), false);
  tick(1);
  assert.ok(Math.abs(player.getState().time - 0.1) < 1e-9);
});

test('倍速：按倍速推进；不在可选范围内的倍速被忽略', () => {
  const { player, tick } = setup();
  player.setRate(2);
  player.setRate(3);
  assert.equal(player.getState().rate, 2);
  player.play();
  tick(0);
  tick(0.05);
  assert.ok(Math.abs(player.getState().time - 0.1) < 1e-9);
});

test('单帧步长上限：切走页面后回来，一帧最多推进 0.1 秒', () => {
  const { player, tick } = setup();
  player.play();
  tick(0);
  tick(30);
  assert.ok(Math.abs(player.getState().time - playerApi.MAX_STEP_SECONDS) < 1e-9);
});

test('到结尾：停在末尾并变为暂停；末尾再点播放从头开始', () => {
  const { player, tick } = setup();
  player.seek(8.95);
  player.play();
  tick(0);
  tick(0.1);
  assert.deepEqual([player.getState().time, player.getState().playing], [9, false]);
  player.play();
  assert.equal(player.getState().time, 0);
  assert.equal(player.getState().playing, true);
});

test('循环当前镜头：到本镜头结尾回到本镜头开头，不进入下一镜头', () => {
  const { player, tick } = setup();
  player.seek(4.95);
  player.setLoopShot(true);
  player.play();
  tick(0);
  tick(0.1);
  const { time, playing } = player.getState();
  assert.equal(playing, true);
  assert.ok(time >= 2 && time < 2.2, `回绕到镜头 2 开头附近，实际 ${time}`);
  player.setLoopShot(false);
  player.seek(4.95);
  tick(0.1);
  tick(0.1);
  assert.ok(player.getState().time >= 5, '关闭循环后继续进入下一镜头');
});

test('跳转：夹在 0 到总时长之内；回到开头会停止播放', () => {
  const { player } = setup();
  player.seek(-3);
  assert.equal(player.getState().time, 0);
  player.seek(99);
  assert.equal(player.getState().time, 9);
  player.play();
  player.stop();
  assert.deepEqual([player.getState().time, player.getState().playing], [0, false]);
  player.step(1);
  player.step(1);
  player.step(-1);
  assert.equal(player.getState().time, 1);
});

test('上一镜、下一镜：下一镜到下个镜头开头，最后一镜跳到末尾；上一镜超过 1 秒回本镜头开头，否则回上一镜头', () => {
  const { player } = setup();
  player.nextShot();
  assert.equal(player.getState().time, 2);
  player.nextShot();
  assert.equal(player.getState().time, 5);
  player.nextShot();
  assert.equal(player.getState().time, 9);
  player.seek(6.5);
  player.prevShot();
  assert.equal(player.getState().time, 5, '已播放 1.5 秒，回到本镜头开头');
  player.seek(5.5);
  player.prevShot();
  assert.equal(player.getState().time, 2, '只播放了 0.5 秒，回到上一镜头开头');
  player.seek(0.5);
  player.prevShot();
  assert.equal(player.getState().time, 0, '第一个镜头回到开头');
  player.seekToShot(2);
  assert.equal(player.getState().time, 5);
});

test('替换时间线：保持播放状态，时间按给定值恢复并夹在新范围内；变成没有镜头时停止播放', () => {
  const { player } = setup();
  player.seek(4);
  player.play();
  player.setTimeline(timeline.compile(makeView([makeShot(1, { durationSeconds: 5 })])), 3);
  assert.deepEqual([player.getState().time, player.getState().playing, player.getState().total], [3, true, 5]);
  player.setTimeline(timeline.compile(makeView([makeShot(1, { durationSeconds: 2 })])), 3);
  assert.equal(player.getState().time, 2, '超出新总时长时夹到末尾');
  player.setTimeline(timeline.compile(makeView([])), 0);
  assert.equal(player.getState().playing, false);
});

test('没有镜头时不能播放；销毁后不再排队帧', () => {
  const empty = setup(timeline.compile(makeView([])));
  empty.player.play();
  assert.equal(empty.player.getState().playing, false);
  const { player, hasPendingFrame } = setup();
  player.play();
  player.destroy();
  assert.equal(hasPendingFrame(), false);
});

test('状态变化通知：播放、暂停、跳转、倍速、循环都会通知，快照带总时长', () => {
  const { player, changes } = setup();
  player.play();
  player.pause();
  player.seek(1);
  player.setRate(1.5);
  player.setLoopShot(true);
  assert.equal(changes.length, 5);
  assert.deepEqual(changes.at(-1), { time: 1, playing: false, rate: 1.5, loopShot: true, total: 9 });
});
