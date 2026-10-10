// ------------------------------------------------------------------------
// 名称：storyboard-params-rules.test.ts
// 说明：分镜脚本生成参数规则的自动化测试：默认值、界面文字与 JSON 数组的接受、不合法字段的报错、单组最长时长约束。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯函数测试，不依赖数据库。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationError } from '../errors';
import { normalizeStoryboardParams } from './storyboard-params-rules';

test('参数：空输入取默认值（组间硬切、模型原生声音、全选声音内容）', () => {
  assert.deepEqual(normalizeStoryboardParams({}), {
    visualStyle: null,
    minShotSeconds: null,
    maxShotSeconds: null,
    groupMaxSeconds: 15,
    maxShots: null,
    continuity: 'cut',
    audioMode: 'native',
    audioElements: ['dialogue', 'narration', 'sfx', 'music'],
    extra: null
  });
});

test('参数：接受界面文字与表单提交的 JSON 数组，数字可为文本，无声时清空声音内容', () => {
  const params = normalizeStoryboardParams({
    visualStyle: ' 水彩 ',
    minShotSeconds: '2.5',
    maxShotSeconds: 8,
    groupMaxSeconds: '20',
    maxShots: '30',
    continuity: '尾帧接首帧',
    audioMode: '模型原生生成',
    audioElements: JSON.stringify(['背景音乐', '角色对白']),
    extra: '少用特写'
  });
  assert.deepEqual(params, {
    visualStyle: '水彩',
    minShotSeconds: 2.5,
    maxShotSeconds: 8,
    groupMaxSeconds: 20,
    maxShots: 30,
    continuity: 'prev_tail',
    audioMode: 'native',
    audioElements: ['dialogue', 'music'],
    extra: '少用特写'
  });
  assert.deepEqual(normalizeStoryboardParams({ audioMode: '无声', audioElements: '[]' }).audioElements, []);
});

test('参数：不合法的字段一并报错', () => {
  assert.throws(
    () =>
      normalizeStoryboardParams({
        minShotSeconds: '8',
        maxShotSeconds: '3',
        maxShots: '0',
        continuity: '随便',
        audioElements: '[]'
      }),
    (error) =>
      error instanceof ValidationError &&
      error.fieldErrors.maxShotSeconds !== undefined &&
      error.fieldErrors.maxShots !== undefined &&
      error.fieldErrors.continuity !== undefined &&
      error.fieldErrors.audioElements !== undefined
  );
  assert.throws(() => normalizeStoryboardParams({ minShotSeconds: '1.25' }), ValidationError);
  assert.throws(() => normalizeStoryboardParams({ audioElements: '["口哨"]' }), ValidationError);
});

test('参数：单组最长时长为整数且在范围内，单镜头时长不能超过它', () => {
  assert.equal(normalizeStoryboardParams({ groupMaxSeconds: '30' }).groupMaxSeconds, 30);
  for (const groupMaxSeconds of ['1', '121', '12.5', 'x']) {
    assert.throws(() => normalizeStoryboardParams({ groupMaxSeconds }), (error) => error instanceof ValidationError && error.fieldErrors.groupMaxSeconds !== undefined, groupMaxSeconds);
  }
  assert.throws(
    () => normalizeStoryboardParams({ groupMaxSeconds: '10', maxShotSeconds: '12' }),
    (error) => error instanceof ValidationError && /不能大于单组最长时长/.test(error.fieldErrors.maxShotSeconds ?? '')
  );
  assert.throws(() => normalizeStoryboardParams({ groupMaxSeconds: '10', minShotSeconds: '11' }), (error) => error instanceof ValidationError && error.fieldErrors.minShotSeconds !== undefined);
});
