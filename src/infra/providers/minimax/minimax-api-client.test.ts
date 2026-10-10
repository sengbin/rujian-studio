// ------------------------------------------------------------------------
// 名称：minimax-api-client.test.ts
// 说明：MiniMax HTTP 客户端的自动化测试：鉴权与请求方法、接口地址校验、错误码与 HTTP 状态的分类、base_resp 报错、测试连接、流式事件读取。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：注入假的 fetch，不访问网络；超时、取消与网络错误脱敏由共用传输层负责，已在千问AI平台客户端的测试中覆盖。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../domain/errors';
import { ProviderCallContext } from '../../../domain/ports/provider-adapters';
import { createFakeFetch } from '../shared/testing/fake-fetch';
import { MinimaxApiClient, classifyMinimaxErrorCode } from './minimax-api-client';

const CONTEXT: ProviderCallContext = { apiKey: 'mm-test-key', settings: { endpoint: 'https://mm.test' } };

async function rejectedWith(action: Promise<unknown>): Promise<ProviderError> {
  try {
    await action;
  } catch (error) {
    assert.ok(error instanceof ProviderError, '应抛出 ProviderError');
    return error;
  }
  assert.fail('应抛出错误');
}

test('请求：带 Bearer 鉴权，POST 带 JSON 请求体，GET 与 DELETE 不带请求体', async () => {
  const { fetchFunction, calls } = createFakeFetch([{ body: { task_id: 'a' } }, { body: { task: {} } }, { body: { action: 'cancelled' } }]);
  const client = new MinimaxApiClient(fetchFunction);

  assert.deepEqual(await client.postJson(CONTEXT, '/v2/video_generation', { model: 'm' }), { task_id: 'a' });
  await client.getJson(CONTEXT, '/v2/query/video_generation/a');
  await client.deleteJson(CONTEXT, '/v2/video_generation/a');

  assert.deepEqual(calls.map((call) => [call.method, call.url]), [
    ['POST', 'https://mm.test/v2/video_generation'],
    ['GET', 'https://mm.test/v2/query/video_generation/a'],
    ['DELETE', 'https://mm.test/v2/video_generation/a']
  ]);
  assert.equal(calls[0].headers.Authorization, 'Bearer mm-test-key');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(calls[0].body, { model: 'm' });
  assert.equal(calls[1].body, null);
  assert.equal(calls[2].headers.Authorization, 'Bearer mm-test-key');
});

test('接口地址：未配置时在发请求前报参数错误', async () => {
  const { fetchFunction, calls } = createFakeFetch([]);
  const client = new MinimaxApiClient(fetchFunction);
  const missing = await rejectedWith(client.getJson({ ...CONTEXT, settings: {} }, '/x'));
  assert.equal(missing.category, 'invalid_request');
  assert.match(missing.message, /尚未配置MiniMax的接口地址/);
  assert.equal(calls.length, 0);
});

test('错误码分类：限流、鉴权与余额、内容涉敏、参数、服务端各归其类，不认识的返回 null', () => {
  assert.equal(classifyMinimaxErrorCode('1002'), 'rate_limited');
  assert.equal(classifyMinimaxErrorCode('1039'), 'rate_limited');
  assert.equal(classifyMinimaxErrorCode('1004'), 'auth');
  assert.equal(classifyMinimaxErrorCode('1008'), 'auth');
  assert.equal(classifyMinimaxErrorCode('2049'), 'auth');
  assert.equal(classifyMinimaxErrorCode('1026'), 'content_rejected');
  assert.equal(classifyMinimaxErrorCode('1027'), 'content_rejected');
  assert.equal(classifyMinimaxErrorCode('2013'), 'invalid_request');
  assert.equal(classifyMinimaxErrorCode('1042'), 'invalid_request');
  assert.equal(classifyMinimaxErrorCode('1000'), 'server');
  assert.equal(classifyMinimaxErrorCode('9999'), null);
  assert.equal(classifyMinimaxErrorCode(null), null);
});

test('HTTP 错误：错误码取自 error.message 末尾的括号，没有时按 HTTP 状态分类，并带平台错误码', async () => {
  const unauthorized = createFakeFetch([{ status: 401, body: { type: 'error', error: { type: 'authorized_error', message: 'login fail (1004)', http_code: '401' } } }]);
  const authError = await rejectedWith(new MinimaxApiClient(unauthorized.fetchFunction).getJson(CONTEXT, '/x'));
  assert.equal(authError.category, 'auth');
  assert.equal(authError.code, '1004');
  assert.match(authError.message, /MiniMax返回错误（1004）：login fail/);

  const sensitive = createFakeFetch([{ status: 422, body: { type: 'error', error: { type: 'unprocessable_entity_error', message: 'sensitive content (1026)' } } }]);
  assert.equal((await rejectedWith(new MinimaxApiClient(sensitive.fetchFunction).postJson(CONTEXT, '/x', {}))).category, 'content_rejected');

  const limited = createFakeFetch([{ status: 429, body: { error: { type: 'rate_limit_error', message: 'slow down' } } }]);
  const limitedError = await rejectedWith(new MinimaxApiClient(limited.fetchFunction).postJson(CONTEXT, '/x', {}));
  assert.equal(limitedError.category, 'rate_limited');
  assert.equal(limitedError.code, 'rate_limit_error');

  const broken = createFakeFetch([{ status: 502, body: {} }]);
  const brokenError = await rejectedWith(new MinimaxApiClient(broken.fetchFunction).postJson(CONTEXT, '/x', {}));
  assert.equal(brokenError.category, 'server');
  assert.equal(brokenError.code, null);
});

test('base_resp：HTTP 200 但状态码不为 0 时按错误抛出，为 0 时正常返回', async () => {
  const failed = createFakeFetch([{ body: { base_resp: { status_code: 1008, status_msg: 'insufficient balance' } } }]);
  const error = await rejectedWith(new MinimaxApiClient(failed.fetchFunction).postJson(CONTEXT, '/v1/image_generation', {}));
  assert.equal(error.category, 'auth');
  assert.equal(error.code, '1008');
  assert.match(error.message, /insufficient balance/);

  const ok = createFakeFetch([{ body: { data: {}, base_resp: { status_code: 0, status_msg: 'success' } } }]);
  assert.deepEqual(await new MinimaxApiClient(ok.fetchFunction).postJson(CONTEXT, '/v1/image_generation', {}), { data: {}, base_resp: { status_code: 0, status_msg: 'success' } });
});

test('测试连接：任务不存在的业务错误说明已通过鉴权；鉴权失败、地址错误分别报错', async () => {
  const probe = '/v2/query/video_generation/0';
  const reachable = createFakeFetch([{ status: 400, body: { type: 'error', error: { type: 'bad_request_error', message: 'invalid task_id (2013)' } } }]);
  await new MinimaxApiClient(reachable.fetchFunction).checkConnection(CONTEXT, probe);
  assert.equal(reachable.calls[0].url, 'https://mm.test/v2/query/video_generation/0');

  const notFound = createFakeFetch([{ status: 500, body: { type: 'error', error: { type: 'server_error', message: 'record not found (1000)', http_code: '500' } } }]);
  await new MinimaxApiClient(notFound.fetchFunction).checkConnection(CONTEXT, probe);

  const serverDown = createFakeFetch([{ status: 500, body: { type: 'error', error: { type: 'server_error', message: 'internal error (1000)' } } }]);
  assert.equal((await rejectedWith(new MinimaxApiClient(serverDown.fetchFunction).checkConnection(CONTEXT, probe))).category, 'server');

  const badKey = createFakeFetch([{ status: 401, body: { error: { type: 'authorized_error', message: 'login fail (1004)' } } }]);
  assert.equal((await rejectedWith(new MinimaxApiClient(badKey.fetchFunction).checkConnection(CONTEXT, probe))).category, 'auth');

  const wrongAddress = createFakeFetch([{ status: 404, body: {} }]);
  const addressError = await rejectedWith(new MinimaxApiClient(wrongAddress.fetchFunction).checkConnection(CONTEXT, probe));
  assert.equal(addressError.category, 'invalid_request');
  assert.match(addressError.message, /请检查接口地址是否正确/);
});

test('流式请求：带 Bearer 鉴权与事件流 Accept 头，逐条产出事件内容并忽略结束标记', async () => {
  const { fetchFunction, calls } = createFakeFetch([{ body: null, raw: 'data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n' }]);
  const items: string[] = [];
  for await (const item of new MinimaxApiClient(fetchFunction).postEventStream(CONTEXT, '/v1/chat/completions', { stream: true })) items.push(item);
  assert.deepEqual(items, ['{"a":1}', '{"b":2}']);
  assert.equal(calls[0].url, 'https://mm.test/v1/chat/completions');
  assert.equal(calls[0].headers.Authorization, 'Bearer mm-test-key');
  assert.equal(calls[0].headers.Accept, 'text/event-stream');
});
