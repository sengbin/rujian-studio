// ------------------------------------------------------------------------
// 名称：tail-frame-rules.test.ts
// 说明：尾帧图片规则的自动化测试：上传尾帧的类型、宽高、内容大小校验，截取失败上报的读取。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯函数测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationError } from '../errors';
import { readTailFrameFailure, readTailFrameInput } from './tail-frame-rules';

test('读取尾帧上传：类型、宽高、内容大小不合法时报错', () => {
  const base = { resultId: 4, mimeType: 'image/jpeg', width: 640, height: 360, data: 'AAAA' };
  assert.deepEqual(readTailFrameInput(base), { resultId: 4, mimeType: 'image/jpeg', width: 640, height: 360, dataBase64: 'AAAA' });
  const rejected = (input: unknown) => assert.throws(() => readTailFrameInput(input), ValidationError);
  rejected(null);
  rejected({ ...base, resultId: 'x' });
  rejected({ ...base, mimeType: 'image/gif' });
  rejected({ ...base, width: 0 });
  rejected({ ...base, height: 1.5 });
  rejected({ ...base, width: 20000 });
  rejected({ ...base, data: '' });
  rejected({ ...base, data: 5 });
  rejected({ ...base, data: 'A'.repeat(14 * 1024 * 1024) });
});

test('读取尾帧失败上报：原因去掉首尾空格并截断，缺省为空串', () => {
  assert.deepEqual(readTailFrameFailure({ resultId: 2, reason: '  无法解码  ' }), { resultId: 2, reason: '无法解码' });
  assert.equal(readTailFrameFailure({ resultId: 2 }).reason, '');
  assert.equal(readTailFrameFailure({ resultId: 2, reason: 'x'.repeat(500) }).reason.length, 200);
  assert.throws(() => readTailFrameFailure({ reason: 'x' }), ValidationError);
});
