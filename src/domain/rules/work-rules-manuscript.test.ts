// ------------------------------------------------------------------------
// 名称：work-rules-manuscript.test.ts
// 说明：原创文稿创建规则的自动化测试：上传文件与粘贴文字二选一，换行符统一，编码、大小与空内容的校验。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：纯函数测试；文件以表单传输格式（JSON 文本，Base64 内容）构造。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationError } from '../errors';
import {
  MANUSCRIPT_FILE_FIELD_KEY,
  MANUSCRIPT_TEXT_FIELD_KEY,
  MANUSCRIPT_TEXT_MAX_LENGTH,
  normalizeWorkCreation
} from './work-rules';

const BASE = { workName: '雨夜来客', kind: '单个短视频' };

/** 构造表单传输格式的文件列表文本。 */
function files(name: string, bytes: Uint8Array | number[]): string {
  const buffer = Buffer.from(bytes);
  return JSON.stringify([{ name, mimeType: 'text/plain', size: buffer.length, data: buffer.toString('base64') }]);
}

/** 捕获校验错误的字段错误表。 */
function fieldErrorsOf(action: () => unknown): Record<string, string> {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    return { ...error.fieldErrors };
  }
  assert.fail('应当抛出校验错误');
}

test('原创文稿：上传文本文件，素材按小说文本保存，来源为原创文稿', () => {
  const result = normalizeWorkCreation({ ...BASE, [MANUSCRIPT_FILE_FIELD_KEY]: files('原稿.md', Buffer.from('夜里下起了雨。')) }, 'original');
  assert.equal(result.input.sourceType, 'original');
  assert.equal(result.sources.length, 1);
  assert.deepEqual([result.sources[0].kind, result.sources[0].fileName, result.sources[0].mime], ['novel_text', '原稿.md', 'text/markdown']);
  assert.equal(Buffer.from(result.sources[0].content).toString('utf8'), '夜里下起了雨。');
});

test('原创文稿：粘贴文字保存为“原稿.txt”，Windows 换行统一为 \\n，文字不改动', () => {
  const result = normalizeWorkCreation({ ...BASE, [MANUSCRIPT_TEXT_FIELD_KEY]: '  第一行\r\n第二行\r第三行  ' }, 'original');
  assert.deepEqual([result.sources[0].kind, result.sources[0].fileName, result.sources[0].mime], ['novel_text', '原稿.txt', 'text/plain']);
  assert.equal(Buffer.from(result.sources[0].content).toString('utf8'), '  第一行\n第二行\n第三行  ');
});

test('原创文稿：上传文件和粘贴文字只能选一种，两者都没有也拒绝', () => {
  const both = fieldErrorsOf(() =>
    normalizeWorkCreation({ ...BASE, [MANUSCRIPT_FILE_FIELD_KEY]: files('a.txt', Buffer.from('文字')), [MANUSCRIPT_TEXT_FIELD_KEY]: '另一份' }, 'original')
  );
  assert.match(both[MANUSCRIPT_TEXT_FIELD_KEY], /只能选一种/);

  assert.match(fieldErrorsOf(() => normalizeWorkCreation(BASE, 'original'))[MANUSCRIPT_FILE_FIELD_KEY], /上传原稿文件，或在下方粘贴/);
  assert.match(fieldErrorsOf(() => normalizeWorkCreation({ ...BASE, [MANUSCRIPT_TEXT_FIELD_KEY]: '  \n ' }, 'original'))[MANUSCRIPT_FILE_FIELD_KEY], /上传原稿文件/);
});

test('原创文稿：文件必须是 UTF-8 的 TXT 或 Markdown，粘贴文字不能过长或不是文本', () => {
  assert.match(
    fieldErrorsOf(() => normalizeWorkCreation({ ...BASE, [MANUSCRIPT_FILE_FIELD_KEY]: files('a.docx', Buffer.from('文字')) }, 'original'))[MANUSCRIPT_FILE_FIELD_KEY],
    /原稿文件只支持/
  );
  assert.match(
    fieldErrorsOf(() => normalizeWorkCreation({ ...BASE, [MANUSCRIPT_FILE_FIELD_KEY]: files('a.txt', [0xff, 0xfe, 0x00, 0x41]) }, 'original'))[MANUSCRIPT_FILE_FIELD_KEY],
    /UTF-8/
  );
  assert.match(
    fieldErrorsOf(() => normalizeWorkCreation({ ...BASE, [MANUSCRIPT_TEXT_FIELD_KEY]: '长'.repeat(MANUSCRIPT_TEXT_MAX_LENGTH + 1) }, 'original'))[MANUSCRIPT_TEXT_FIELD_KEY],
    /不能超过/
  );
  assert.match(fieldErrorsOf(() => normalizeWorkCreation({ ...BASE, [MANUSCRIPT_TEXT_FIELD_KEY]: 123 }, 'original'))[MANUSCRIPT_TEXT_FIELD_KEY], /必须是文本/);
});
