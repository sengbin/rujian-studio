// ------------------------------------------------------------------------
// 名称：base-provider-api-client.test.ts
// 说明：服务商接口客户端基类的自动化测试：HTTP 状态分类。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-11
// 备注：纯函数测试，不访问网络；基类的请求行为由三家客户端的测试覆盖。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyHttpStatus } from './base-provider-api-client';

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
