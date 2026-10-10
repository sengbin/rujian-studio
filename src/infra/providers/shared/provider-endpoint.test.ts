// ------------------------------------------------------------------------
// 名称：provider-endpoint.test.ts
// 说明：接口地址校验的自动化测试：未配置、无法识别、非 https 的拒绝，https 与本机回环 http 的放行，末尾斜杠的去除。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：无。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../domain/errors';
import { requireSecureEndpoint } from './provider-endpoint';

const MISSING = '尚未配置接口地址。';

test('https 地址放行并去掉末尾斜杠', () => {
  assert.equal(requireSecureEndpoint('https://api.example.com/v1/', MISSING), 'https://api.example.com/v1');
  assert.equal(requireSecureEndpoint('https://api.example.com', MISSING), 'https://api.example.com');
});

test('本机回环地址允许 http，便于接本地假服务', () => {
  assert.equal(requireSecureEndpoint('http://127.0.0.1:8080/', MISSING), 'http://127.0.0.1:8080');
  assert.equal(requireSecureEndpoint('http://localhost:3000', MISSING), 'http://localhost:3000');
});

test('未配置、无法识别、非 https 的地址在发请求前被拒绝', () => {
  for (const [value, message] of [
    [undefined, MISSING],
    ['', MISSING],
    ['api.example.com', /无法识别/],
    ['http://api.example.com', /https/],
    ['ftp://api.example.com', /https/]
  ] as const) {
    assert.throws(
      () => requireSecureEndpoint(value, MISSING),
      (error) => error instanceof ProviderError && error.category === 'invalid_request' && (typeof message === 'string' ? error.message === message : message.test(error.message))
    );
  }
});
