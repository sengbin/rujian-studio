// ------------------------------------------------------------------------
// 名称：group-duration-rules.test.ts
// 说明：镜头组生成时长与参数规则的自动化测试：组时长对齐、模型单次最长时长、镜头组生成参数与模型能力的检查。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯函数测试，使用假视频模型的能力。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GenerationParams } from '../models/generation';
import { FAKE_VIDEO_CAPABILITY } from '../ports/testing/fake-model-providers';
import { fitGroupDuration, maxGroupSeconds, validateGroupParams } from './group-duration-rules';

const PARAMS: GenerationParams = { modelId: 1, aspectRatio: '16:9', resolution: '720P', audioMode: null, audioElements: null, seed: null, durationSeconds: null, negativeList: null, promptExtend: null };

test('检查镜头组参数：模型不支持种子、指定时长小于镜头总时长或不在模型取值内时给出阻断问题', () => {
  const withParams = (overrides: Partial<GenerationParams>): GenerationParams => ({ ...PARAMS, ...overrides });
  assert.deepEqual(validateGroupParams(FAKE_VIDEO_CAPABILITY, withParams({ seed: 7, durationSeconds: 8 }), 6), []);
  assert.deepEqual(validateGroupParams(FAKE_VIDEO_CAPABILITY, withParams({}), 6), []);
  const noSeed = { ...FAKE_VIDEO_CAPABILITY, seed: false };
  assert.match(validateGroupParams(noSeed, withParams({ seed: 7 }), 6).join(), /不支持随机种子/);
  assert.match(validateGroupParams(FAKE_VIDEO_CAPABILITY, withParams({ durationSeconds: 5 }), 6).join(), /小于这一组镜头的总时长 6 秒/);
  assert.match(validateGroupParams(FAKE_VIDEO_CAPABILITY, withParams({ durationSeconds: 11 }), 6).join(), /不在模型支持的取值内（2–10 秒/);
  assert.match(validateGroupParams(FAKE_VIDEO_CAPABILITY, withParams({ durationSeconds: 7.5 }), 6).join(), /不在模型支持的取值内/);
});

test('组时长对齐：只向上取整（不截断镜头），不足最短时长时补到最短，超过最长时长时标记并返回最长值', () => {
  assert.deepEqual(fitGroupDuration({ min: 2, max: 10, step: 1 }, 3.4), { seconds: 4, adjusted: true, exceedsMax: false });
  assert.deepEqual(fitGroupDuration({ min: 2, max: 10, step: 1 }, 4), { seconds: 4, adjusted: false, exceedsMax: false });
  assert.deepEqual(fitGroupDuration({ min: 2, max: 10, step: 1 }, 1), { seconds: 2, adjusted: true, exceedsMax: false });
  assert.deepEqual(fitGroupDuration({ min: 2, max: 10, step: 1 }, 40), { seconds: 10, adjusted: true, exceedsMax: true });
  assert.deepEqual(fitGroupDuration({ options: [10, 5] }, 7.4), { seconds: 10, adjusted: true, exceedsMax: false });
  assert.deepEqual(fitGroupDuration({ options: [5, 10] }, 12), { seconds: 10, adjusted: true, exceedsMax: true });
  assert.deepEqual(fitGroupDuration({ max: 8 }, 8.2), { seconds: 8, adjusted: true, exceedsMax: true });
  assert.deepEqual(fitGroupDuration({ min: 2, max: 30, step: 1 }, 14.1 + 0.9), { seconds: 15, adjusted: false, exceedsMax: false }, '小数误差不会多加一秒');
});

test('模型单次最长时长：取可选值的最大值或范围上限，没有信息时为 null', () => {
  assert.equal(maxGroupSeconds({ min: 2, max: 30, step: 1 }), 30);
  assert.equal(maxGroupSeconds({ options: [5, 15, 10] }), 15);
  assert.equal(maxGroupSeconds({ min: 2 }), null);
});
