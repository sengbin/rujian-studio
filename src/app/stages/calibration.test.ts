// ------------------------------------------------------------------------
// 名称：calibration.test.ts
// 说明：轻量校准执行助手的自动化测试：首稿达标不重写、重写收敛、轮数上限、重写更差时保留更接近目标的一稿、取消与错误向外传递。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：纯逻辑测试，不依赖存储。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runWithCalibration } from './calibration';

/** 按给定序列依次返回实测值的“生成”，记录每次收到的反馈。 */
function scripted(values: number[]) {
  const feedbacks: Array<number | null> = [];
  let call = 0;
  return {
    feedbacks,
    generate: async (feedback: { deviationRatio: number } | null) => {
      feedbacks.push(feedback === null ? null : feedback.deviationRatio);
      return values[call++];
    }
  };
}

const BASE = { measure: (value: number) => value, target: 100, toleranceRatio: 0.15 };

test('首稿落在容差内：不重写', async () => {
  const source = scripted([110]);
  const outcome = await runWithCalibration({ ...BASE, generate: source.generate, maxRounds: 2 });
  assert.deepEqual([outcome.result, outcome.rounds, outcome.calibration.withinTolerance], [110, 0, true]);
  assert.deepEqual(source.feedbacks, [null]);
});

test('超出容差：带上一稿的偏差重写，进入容差后停止', async () => {
  const source = scripted([150, 120, 108, 100]);
  const outcome = await runWithCalibration({ ...BASE, generate: source.generate, maxRounds: 3 });
  assert.deepEqual([outcome.result, outcome.rounds], [108, 2]);
  assert.deepEqual(source.feedbacks, [null, 0.5, 0.2]);
});

test('达到轮数上限仍超出：停止重写，返回最接近目标的一稿并标明偏差', async () => {
  const source = scripted([160, 130, 125]);
  const outcome = await runWithCalibration({ ...BASE, generate: source.generate, maxRounds: 2 });
  assert.deepEqual([outcome.result, outcome.rounds, outcome.calibration.withinTolerance], [125, 2, false]);
  assert.equal(outcome.calibration.deviationRatio, 0.25);
});

test('重写反而更差：保留更接近目标的旧稿', async () => {
  const source = scripted([130, 190]);
  const outcome = await runWithCalibration({ ...BASE, generate: source.generate, maxRounds: 1 });
  assert.equal(outcome.result, 130);
  assert.equal(outcome.rounds, 1);
});

test('已有初稿：不首次生成，直接以初稿为起点校准', async () => {
  const source = scripted([105]);
  const outcome = await runWithCalibration({ ...BASE, generate: source.generate, initial: 160, maxRounds: 2 });
  assert.deepEqual([outcome.result, outcome.rounds], [105, 1]);
  assert.deepEqual(source.feedbacks, [0.6]);
  const within = await runWithCalibration({ ...BASE, generate: source.generate, initial: 100, maxRounds: 2 });
  assert.deepEqual([within.result, within.rounds], [100, 0]);
});

test('最大轮数为 0：只生成一次；生成出错时直接向外抛出', async () => {
  const source = scripted([300]);
  const outcome = await runWithCalibration({ ...BASE, generate: source.generate, maxRounds: 0 });
  assert.deepEqual([outcome.result, outcome.rounds], [300, 0]);
  await assert.rejects(
    runWithCalibration({
      ...BASE,
      maxRounds: 2,
      generate: async () => {
        throw new Error('已取消');
      }
    }),
    /已取消/
  );
});
