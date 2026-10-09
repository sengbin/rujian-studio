// ------------------------------------------------------------------------
// 名称：timing-calibration-rules.test.ts
// 说明：时长校准规则的自动化测试：容差边界判断与偏差说明。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：纯函数测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeDeviation, evaluateCalibration } from './timing-calibration-rules';

test('容差判断：临界点含边界，超出一点即不通过，不足同理', () => {
  assert.equal(evaluateCalibration(115, 100, 0.15).withinTolerance, true);
  assert.equal(evaluateCalibration(85, 100, 0.15).withinTolerance, true);
  assert.equal(evaluateCalibration(115.1, 100, 0.15).withinTolerance, false);
  assert.equal(evaluateCalibration(84.9, 100, 0.15).withinTolerance, false);
  assert.equal(evaluateCalibration(100, 100, 0.15).withinTolerance, true);
  // 浮点：30 秒的 15% 是 4.5，34.5 与 25.5 恰在边界上。
  assert.equal(evaluateCalibration(34.5, 30, 0.15).withinTolerance, true);
  assert.equal(evaluateCalibration(25.5, 30, 0.15).withinTolerance, true);
});

test('容差判断：偏差比例为 (实测-目标)/目标，目标非正数时报错', () => {
  assert.equal(evaluateCalibration(150, 100, 0.15).deviationRatio, 0.5);
  assert.equal(evaluateCalibration(50, 100, 0.15).deviationRatio, -0.5);
  assert.throws(() => evaluateCalibration(10, 0, 0.15), RangeError);
});

test('偏差说明：写明目标、实测、超出或不足的量与百分比', () => {
  assert.equal(describeDeviation(evaluateCalibration(45, 30, 0.15), '秒'), '目标约 30 秒，实测约 45 秒，超出 15 秒（50%）');
  assert.equal(describeDeviation(evaluateCalibration(20, 40, 0.15), '秒'), '目标约 40 秒，实测约 20 秒，不足 20 秒（50%）');
});
