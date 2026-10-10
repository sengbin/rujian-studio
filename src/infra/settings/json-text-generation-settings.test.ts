// ------------------------------------------------------------------------
// 名称：json-text-generation-settings.test.ts
// 说明：JSON 文本生成设置的自动化测试：默认值、写入后读取、只写出现的项、文件损坏时回退默认值。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：文件写到临时目录。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { DEFAULT_SEGMENT_CHARS, DEFAULT_SPLIT_MODE } from '../../domain/rules/text-generation-settings';
import { JsonTextGenerationSettings } from './json-text-generation-settings';

const directory = mkdtempSync(path.join(os.tmpdir(), 'rujian-settings-'));
after(() => rmSync(directory, { recursive: true, force: true }));

let counter = 0;
/** 每个用例使用独立的文件。 */
function newFile(): string {
  counter += 1;
  return path.join(directory, `settings-${counter}.json`);
}

test('文件不存在时读到默认设置', () => {
  const settings = new JsonTextGenerationSettings(newFile()).read();
  assert.equal(settings.defaultModel, '');
  assert.deepEqual(settings.novelSplit, { mode: DEFAULT_SPLIT_MODE, maxSegmentChars: DEFAULT_SEGMENT_CHARS });
});

test('写入后立即读到新值，只改出现的项，其余保持', async () => {
  const store = new JsonTextGenerationSettings(newFile());
  await store.write({ splitMode: 'length', maxSegmentChars: 30000 });
  assert.deepEqual(store.getSplitSettings(), { mode: 'length', maxSegmentChars: 30000 });

  await store.write({ maxSegmentChars: 40000 });
  assert.deepEqual(store.getSplitSettings(), { mode: 'length', maxSegmentChars: 40000 });
});

test('每次读取都取文件最新内容', async () => {
  const file = newFile();
  const store = new JsonTextGenerationSettings(file);
  await store.write({ splitMode: 'length' });
  writeFileSync(file, JSON.stringify({ 'novel.splitMode': 'chapter' }), 'utf8');
  assert.equal(store.read().novelSplit.mode, 'chapter');
});

test('文件损坏时回退默认值', () => {
  const file = newFile();
  writeFileSync(file, '不是 JSON', 'utf8');
  assert.equal(new JsonTextGenerationSettings(file).read().novelSplit.maxSegmentChars, DEFAULT_SEGMENT_CHARS);
});
