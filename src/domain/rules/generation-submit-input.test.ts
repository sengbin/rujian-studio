// ------------------------------------------------------------------------
// 名称：generation-submit-input.test.ts
// 说明：视频生成提交请求读取规则的自动化测试：镜头组去重、可选参数、声音内容与种子、负向清单与提示词改写、不合法输入的报错。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯函数测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationError } from '../errors';
import { readSubmitInput } from './generation-submit-input';

test('读取提交请求：去重镜头组，可选参数为空时取 null', () => {
  const input = readSubmitInput({ workId: 1, episodeId: 2, groupIds: [5, 5, 6], params: { modelId: 3, aspectRatio: '', resolution: '720P' } });
  assert.deepEqual(input, {
    workId: 1,
    episodeId: 2,
    groupIds: [5, 6],
    params: { modelId: 3, aspectRatio: null, resolution: '720P', audioMode: null, audioElements: null, seed: null, negativeList: null, promptExtend: null, durationSeconds: null }
  });
});

test('读取提交请求：声音内容去重并按固定顺序排列，种子取整数；不合法时指出字段', () => {
  const read = (params: Record<string, unknown>) => readSubmitInput({ workId: 1, episodeId: 2, groupIds: [5], params: { modelId: 3, ...params } }).params;
  const parsed = read({ audioElements: ['sfx', 'dialogue', 'sfx'], seed: 0 });
  assert.deepEqual(parsed.audioElements, ['dialogue', 'sfx']);
  assert.equal(parsed.seed, 0);
  const fieldOf = (params: Record<string, unknown>): string[] => {
    try {
      read(params);
    } catch (error) {
      if (error instanceof ValidationError) return Object.keys(error.fieldErrors);
    }
    return [];
  };
  assert.deepEqual(fieldOf({ audioElements: [] }), ['audioElements']);
  assert.deepEqual(fieldOf({ audioElements: ['voice'] }), ['audioElements']);
  assert.deepEqual(fieldOf({ seed: -1 }), ['seed']);
  assert.deepEqual(fieldOf({ seed: 1.5 }), ['seed']);
  assert.deepEqual(fieldOf({ seed: 2147483648 }), ['seed']);
  assert.deepEqual(fieldOf({ seed: '7' }), ['seed']);
});

test('读取提交请求：标识、镜头组数量、声音模式不合法时报错', () => {
  const base = { workId: 1, episodeId: 2, groupIds: [5], params: { modelId: 3 } };
  const rejected = (input: unknown) => assert.throws(() => readSubmitInput(input), ValidationError);
  rejected(null);
  rejected({ ...base, workId: 'x' });
  rejected({ ...base, episodeId: 1.5 });
  rejected({ ...base, groupIds: [] });
  rejected({ ...base, groupIds: ['a'] });
  rejected({ ...base, groupIds: Array.from({ length: 101 }, (_, index) => index) });
  rejected({ ...base, params: {} });
  rejected({ ...base, params: { modelId: 3, audioMode: 'invalid' } });
  rejected({ ...base, params: { modelId: 3, resolution: 'x'.repeat(21) } });
});

test('读取提交请求：负向清单与提示词改写可选，不合法时指出字段', () => {
  const read = (params: Record<string, unknown>) => readSubmitInput({ workId: 1, episodeId: 2, groupIds: [5], params: { modelId: 3, ...params } }).params;
  assert.deepEqual([read({ negativeList: ' 不要字幕 ', promptExtend: false }).negativeList, read({ negativeList: ' 不要字幕 ', promptExtend: false }).promptExtend], ['不要字幕', false]);
  assert.equal(read({ negativeList: '' }).negativeList, '', '空串表示明确不要负向清单');
  const fieldOf = (params: Record<string, unknown>): string[] => {
    try {
      read(params);
    } catch (error) {
      if (error instanceof ValidationError) return Object.keys(error.fieldErrors);
    }
    return [];
  };
  assert.deepEqual(fieldOf({ negativeList: 5 }), ['negativeList']);
  assert.deepEqual(fieldOf({ negativeList: 'x'.repeat(301) }), ['negativeList']);
  assert.deepEqual(fieldOf({ promptExtend: 'yes' }), ['promptExtend']);
});
