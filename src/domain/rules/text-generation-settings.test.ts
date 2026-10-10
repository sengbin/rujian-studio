// ------------------------------------------------------------------------
// 名称：text-generation-settings.test.ts
// 说明：文本生成设置规范化的自动化测试：默认值、非法值回退、字数上限夹取。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：纯函数测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationError } from '../errors';
import {
  DEFAULT_SEGMENT_CHARS,
  SEGMENT_CHARS_MAX,
  SEGMENT_CHARS_MIN,
  normalizeTextGenerationSettings,
  normalizeTextGenerationSettingsPatch
} from './text-generation-settings';

test('缺少设置时使用默认值：没有默认文本模型、按章节分段、每段 20000 字', () => {
  assert.deepEqual(normalizeTextGenerationSettings({}), {
    defaultModel: '',
    novelSplit: { mode: 'chapter', maxSegmentChars: DEFAULT_SEGMENT_CHARS }
  });
});

test('合法设置原样使用，默认模型去除首尾空白', () => {
  assert.deepEqual(normalizeTextGenerationSettings({ defaultModel: ' model:qianwen/qwen3.8-max ', splitMode: 'length', maxSegmentChars: 30000 }), {
    defaultModel: 'model:qianwen/qwen3.8-max',
    novelSplit: { mode: 'length', maxSegmentChars: 30000 }
  });
});

test('非法设置回退为默认值', () => {
  const settings = normalizeTextGenerationSettings({ defaultModel: 5, splitMode: 'paragraph', maxSegmentChars: '20000' });
  assert.equal(settings.defaultModel, '');
  assert.equal(settings.novelSplit.mode, 'chapter');
  assert.equal(settings.novelSplit.maxSegmentChars, DEFAULT_SEGMENT_CHARS);
  assert.equal(normalizeTextGenerationSettings({ maxSegmentChars: Number.NaN }).novelSplit.maxSegmentChars, DEFAULT_SEGMENT_CHARS);
});

test('默认模型无法解析（键的格式不对）时回退为空', () => {
  assert.equal(normalizeTextGenerationSettings({ defaultModel: 'gpt-4o' }).defaultModel, '');
  assert.equal(normalizeTextGenerationSettings({ defaultModel: 'other:gpt-5' }).defaultModel, '');
});

test('每段字数上限夹到允许范围内并取整', () => {
  assert.equal(normalizeTextGenerationSettings({ maxSegmentChars: 100 }).novelSplit.maxSegmentChars, SEGMENT_CHARS_MIN);
  assert.equal(normalizeTextGenerationSettings({ maxSegmentChars: 10_000_000 }).novelSplit.maxSegmentChars, SEGMENT_CHARS_MAX);
  assert.equal(normalizeTextGenerationSettings({ maxSegmentChars: 5000.9 }).novelSplit.maxSegmentChars, 5000);
});

test('保存校验：默认模型必须是合法的键，没有任何项时被拒绝', () => {
  assert.deepEqual(normalizeTextGenerationSettingsPatch({ defaultModel: ' model:qianwen/qwen3.8-max ' }), { defaultModel: 'model:qianwen/qwen3.8-max' });
  for (const bad of [{ defaultModel: 'gpt-4o' }, { defaultModel: 5 }, { defaultModel: 'model:qianwen' }, { defaultModel: 'other:gpt-4o' }, { defaultModel: 'model:a/' + 'x'.repeat(200) }, {}]) {
    assert.throws(() => normalizeTextGenerationSettingsPatch(bad), ValidationError);
  }
});
