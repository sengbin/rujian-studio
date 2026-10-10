// ------------------------------------------------------------------------
// 名称：provider-shared-utils.test.ts
// 说明：服务商共用小工具的自动化测试：HTTP 状态分类、按代码查找模型、画幅换算像素尺寸、任务引用 JSON 解析。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯函数测试，不访问网络；基类 BaseProviderApiClient 的行为由三家客户端的测试覆盖。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyHttpStatus } from './base-provider-api-client';
import { toPixelSize } from './image-pixel-size';
import { findDescribedModelByCode, findModelByCode } from './provider-model-lookup';
import { parseJson } from './provider-payload';

test('HTTP 状态分类：鉴权、限流、其余 4xx 为参数、其他为服务端；服务商特有状态优先', () => {
  assert.equal(classifyHttpStatus(401), 'auth');
  assert.equal(classifyHttpStatus(403), 'auth');
  assert.equal(classifyHttpStatus(429), 'rate_limited');
  assert.equal(classifyHttpStatus(400), 'invalid_request');
  assert.equal(classifyHttpStatus(404), 'invalid_request');
  assert.equal(classifyHttpStatus(422), 'invalid_request');
  assert.equal(classifyHttpStatus(500), 'server');
  assert.equal(classifyHttpStatus(502), 'server');
  assert.equal(classifyHttpStatus(402, { 402: 'auth', 422: 'content_rejected' }), 'auth');
  assert.equal(classifyHttpStatus(422, { 402: 'auth', 422: 'content_rejected' }), 'content_rejected');
  assert.equal(classifyHttpStatus(404, { 402: 'auth' }), 'invalid_request');
});

test('按代码查找模型：直接带 code 的目录与包在 descriptor 里的目录，找不到返回 undefined', () => {
  const plain = [{ code: 'a' }, { code: 'b' }];
  assert.equal(findModelByCode(plain, 'b'), plain[1]);
  assert.equal(findModelByCode(plain, 'x'), undefined);
  const wrapped = [{ descriptor: { code: 'a' }, extra: 1 }, { descriptor: { code: 'b' }, extra: 2 }];
  assert.equal(findDescribedModelByCode(wrapped, 'b'), wrapped[1]);
  assert.equal(findDescribedModelByCode(wrapped, 'x'), undefined);
});

test('画幅换算像素尺寸：宽高是步长的整数倍，总像素不超过上限', () => {
  assert.deepEqual(toPixelSize('1:1', 1_048_576, 16), { width: 1024, height: 1024 });
  const wide = toPixelSize('16:9', 2_073_600, 16);
  assert.equal(wide.width % 16, 0);
  assert.equal(wide.height % 16, 0);
  assert.ok(wide.width * wide.height <= 2_073_600);
  assert.ok(wide.width > wide.height);
});

test('任务引用 JSON 解析：合法时返回解析结果，不合法时返回 undefined', () => {
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  assert.equal(parseJson('not json'), undefined);
});
