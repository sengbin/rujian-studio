// ------------------------------------------------------------------------
// 名称：provider-payload.test.ts
// 说明：服务商响应内容解析的自动化测试：任务引用 JSON 解析。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-11
// 备注：纯函数测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseJson } from './provider-payload';

test('任务引用 JSON 解析：合法时返回解析结果，不合法时返回 undefined', () => {
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  assert.equal(parseJson('not json'), undefined);
});
