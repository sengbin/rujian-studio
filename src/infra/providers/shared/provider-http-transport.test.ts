// ------------------------------------------------------------------------
// 名称：provider-http-transport.test.ts
// 说明：服务商传输层的自动化测试：非 2xx 响应的错误说明里回显的密钥片段被隐藏，其余原文保留。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：使用假 fetch，不依赖网络。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../domain/errors';
import { ProviderHttpTransport } from './provider-http-transport';
import { createFakeFetch } from './testing/fake-fetch';

function createTransport(message: string) {
  const { fetchFunction } = createFakeFetch([{ status: 401, body: { message } }]);
  return new ProviderHttpTransport(fetchFunction, {
    providerName: '假服务商',
    timeouts: { requestMs: 1000, streamIdleMs: 1000 },
    buildHttpError: (_status, payload) => new ProviderError('auth', String(payload.message), { code: 'E1' })
  });
}

test('平台错误说明里回显的密钥片段被隐藏，错误分类与错误码不变', async () => {
  const transport = createTransport('Incorrect API key provided: sk-abcdef123456. Bearer abc.def used. See https://docs.example.com/keys');
  await assert.rejects(
    () => transport.requestJson('https://api.example.com/x', { method: 'GET', headers: {} }),
    (error) =>
      error instanceof ProviderError &&
      error.category === 'auth' &&
      error.code === 'E1' &&
      !error.message.includes('sk-abcdef123456') &&
      !error.message.includes('abc.def') &&
      error.message.includes('https://docs.example.com/keys')
  );
});

test('没有密钥片段的错误说明原样保留', async () => {
  const transport = createTransport('Input data may contain inappropriate content.');
  await assert.rejects(
    () => transport.requestJson('https://api.example.com/x', { method: 'GET', headers: {} }),
    (error) => error instanceof ProviderError && error.message === 'Input data may contain inappropriate content.'
  );
});
