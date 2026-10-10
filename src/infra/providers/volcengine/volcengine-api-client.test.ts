// ------------------------------------------------------------------------
// 名称：volcengine-api-client.test.ts
// 说明：火山方舟 HTTP 客户端的自动化测试：鉴权与请求方法、接口地址校验、错误码与 HTTP 状态的分类、测试连接、流式事件读取、自定义总超时。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：注入假的 fetch，不访问网络；超时、取消与网络错误脱敏由共用传输层负责，已在千问AI平台客户端的测试中覆盖。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../domain/errors';
import { ProviderCallContext } from '../../../domain/ports/provider-adapters';
import { createFakeFetch } from '../shared/testing/fake-fetch';
import { VolcengineApiClient, classifyArkErrorCode } from './volcengine-api-client';

const CONTEXT: ProviderCallContext = {
  apiKey: 'ark-test-key',
  settings: { endpoint: 'https://ark.test/api/v3', textEndpoint: 'https://ark.test/api/coding/v3' }
};

async function rejectedWith(action: Promise<unknown>): Promise<ProviderError> {
  try {
    await action;
  } catch (error) {
    assert.ok(error instanceof ProviderError, '应抛出 ProviderError');
    return error;
  }
  assert.fail('应抛出错误');
}

async function collect(events: AsyncIterable<string>): Promise<string[]> {
  const items: string[] = [];
  for await (const item of events) items.push(item);
  return items;
}

test('请求：带 Bearer 鉴权，POST 带 JSON 请求体，GET 与 DELETE 不带请求体', async () => {
  const { fetchFunction, calls } = createFakeFetch([{ body: { id: 'a' } }, { body: { status: 'queued' } }, { body: {} }]);
  const client = new VolcengineApiClient(fetchFunction);

  assert.deepEqual(await client.postJson(CONTEXT, '/contents/generations/tasks', { model: 'm' }), { id: 'a' });
  await client.getJson(CONTEXT, '/contents/generations/tasks/a');
  await client.deleteJson(CONTEXT, '/contents/generations/tasks/a');

  assert.deepEqual(calls.map((call) => [call.method, call.url]), [
    ['POST', 'https://ark.test/api/v3/contents/generations/tasks'],
    ['GET', 'https://ark.test/api/v3/contents/generations/tasks/a'],
    ['DELETE', 'https://ark.test/api/v3/contents/generations/tasks/a']
  ]);
  assert.equal(calls[0].headers.Authorization, 'Bearer ark-test-key');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(calls[0].body, { model: 'm' });
  assert.equal(calls[1].body, null);
  assert.equal(calls[2].headers.Authorization, 'Bearer ark-test-key');
});

test('接口地址：未配置时在发请求前报参数错误，文本与图片、视频各用各的地址', async () => {
  const { fetchFunction, calls } = createFakeFetch([]);
  const client = new VolcengineApiClient(fetchFunction);
  const missing = await rejectedWith(client.getJson({ ...CONTEXT, settings: {} }, '/x'));
  assert.equal(missing.category, 'invalid_request');
  assert.match(missing.message, /尚未配置火山引擎的接口地址（图片、视频）/);
  const missingText = await rejectedWith(collect(client.postEventStream({ ...CONTEXT, settings: { endpoint: 'https://ark.test/api/v3' } }, '/chat/completions', {})));
  assert.equal(missingText.category, 'invalid_request');
  assert.match(missingText.message, /尚未配置火山引擎的文本接口地址/);
  assert.equal(calls.length, 0);
});

test('错误码分类：内容审核、账号与额度、限流、参数各归其类，不认识的返回 null', () => {
  assert.equal(classifyArkErrorCode('InputTextSensitiveContentDetected'), 'content_rejected');
  assert.equal(classifyArkErrorCode('OutputVideoSensitiveContentDetected.PolicyViolation'), 'content_rejected');
  assert.equal(classifyArkErrorCode('InputImageRiskDetection'), 'content_rejected');
  assert.equal(classifyArkErrorCode('AuthenticationError'), 'auth');
  assert.equal(classifyArkErrorCode('AuthN_MissOrInvalidAuthorizationHeader'), 'auth');
  assert.equal(classifyArkErrorCode('ModelNotOpen'), 'auth');
  assert.equal(classifyArkErrorCode('InvalidEndpointOrModel.NotFound'), 'auth');
  assert.equal(classifyArkErrorCode('QuotaExceeded.AgentPlanQuotaExceeded'), 'auth');
  assert.equal(classifyArkErrorCode('AccountOverdueError'), 'auth');
  assert.equal(classifyArkErrorCode('ModelAccountRpmRateLimitExceeded'), 'rate_limited');
  assert.equal(classifyArkErrorCode('RateLimitExceeded.EndpointRPMExceeded'), 'rate_limited');
  assert.equal(classifyArkErrorCode('ServerOverloaded'), 'rate_limited');
  assert.equal(classifyArkErrorCode('InvalidParameter.UnsupportedParameter'), 'invalid_request');
  assert.equal(classifyArkErrorCode('MissingParameter'), 'invalid_request');
  assert.equal(classifyArkErrorCode('InternalServiceError'), null);
  assert.equal(classifyArkErrorCode(null), null);
});

test('HTTP 错误：错误码优先决定分类，没有错误码时按状态分类，消息带错误码与平台原文', async () => {
  const cases: Array<[number, unknown, string, RegExp]> = [
    [401, { error: { code: 'AuthenticationError', message: 'key invalid' } }, 'auth', /（AuthenticationError）：key invalid/],
    [400, { error: { code: 'InputTextSensitiveContentDetected', message: 'sensitive' } }, 'content_rejected', /sensitive/],
    [429, { error: { code: 'ModelAccountRpmRateLimitExceeded', message: 'too fast' } }, 'rate_limited', /too fast/],
    [400, { error: { code: 'InvalidParameter', message: 'bad ratio' } }, 'invalid_request', /bad ratio/],
    [500, { error: { code: 'InternalServiceError', message: 'oops' } }, 'server', /oops/],
    [503, {}, 'server', /HTTP 503/],
    [403, {}, 'auth', /HTTP 403/],
    [404, { error: { code: 'ResourceNotFound', message: 'no task' } }, 'invalid_request', /no task/]
  ];
  for (const [status, body, category, message] of cases) {
    const client = new VolcengineApiClient(createFakeFetch([{ status, body }]).fetchFunction);
    const error = await rejectedWith(client.getJson(CONTEXT, '/x'));
    assert.equal(error.category, category, `${status} ${JSON.stringify(body)}`);
    assert.match(error.message, message);
  }
  const withCode = new VolcengineApiClient(createFakeFetch([{ status: 404, body: { error: { code: 'ResourceNotFound', message: 'm' } } }]).fetchFunction);
  assert.equal((await rejectedWith(withCode.getJson(CONTEXT, '/x'))).code, 'ResourceNotFound');
});

test('测试连接：带错误码的业务错误说明可用；鉴权失败、路径不存在、没有错误码的响应按失败处理', async () => {
  const probe = '/contents/generations/tasks/cgt-0';
  await new VolcengineApiClient(createFakeFetch([{ status: 404, body: { error: { code: 'ResourceNotFound', message: 'm' } } }]).fetchFunction).checkConnection(CONTEXT, probe);
  await new VolcengineApiClient(createFakeFetch([{ body: {} }]).fetchFunction).checkConnection(CONTEXT, probe);

  const badKey = new VolcengineApiClient(createFakeFetch([{ status: 401, body: { error: { code: 'AuthenticationError', message: 'bad' } } }]).fetchFunction);
  assert.equal((await rejectedWith(badKey.checkConnection(CONTEXT, probe))).category, 'auth');

  const wrongPath = new VolcengineApiClient(createFakeFetch([{ status: 404, body: { error: { code: 'PathNotFound', message: 'no path' } } }]).fetchFunction);
  assert.match((await rejectedWith(wrongPath.checkConnection(CONTEXT, probe))).message, /请检查接口地址是否正确/);

  const noCode = new VolcengineApiClient(createFakeFetch([{ status: 404, body: {} }]).fetchFunction);
  assert.match((await rejectedWith(noCode.checkConnection(CONTEXT, probe))).message, /请检查接口地址是否正确/);

  const down = new VolcengineApiClient(createFakeFetch([{ status: 502, body: {} }]).fetchFunction);
  assert.equal((await rejectedWith(down.checkConnection(CONTEXT, probe))).category, 'server');
});

test('流式：请求带 SSE 头，逐条产出 data 内容，遇到 [DONE] 结束，错误状态转为 ProviderError', async () => {
  const { fetchFunction, calls } = createFakeFetch([{ body: null, raw: 'data: {"n":1}\n\ndata: {"n":2}\n\ndata: [DONE]\n\ndata: {"n":3}\n\n' }]);
  const client = new VolcengineApiClient(fetchFunction);
  assert.deepEqual(await collect(client.postEventStream(CONTEXT, '/chat/completions', { stream: true })), ['{"n":1}', '{"n":2}']);
  assert.equal(calls[0].url, 'https://ark.test/api/coding/v3/chat/completions');
  assert.equal(calls[0].headers.Accept, 'text/event-stream');
  assert.equal(calls[0].headers.Authorization, 'Bearer ark-test-key');

  const failing = new VolcengineApiClient(createFakeFetch([{ status: 401, body: { error: { code: 'AuthenticationError', message: 'bad' } } }]).fetchFunction);
  assert.equal((await rejectedWith(collect(failing.postEventStream(CONTEXT, '/chat/completions', {})))).category, 'auth');
});

test('自定义总超时：传入的超时覆盖默认值，到时按超时报网络错误', async () => {
  const hanging = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })) as unknown as typeof fetch;
  const client = new VolcengineApiClient(hanging, { requestMs: 5_000, streamIdleMs: 5_000 });
  // AbortSignal.timeout 的定时器不阻止进程退出，需要一个保活定时器让事件循环等到它触发。
  const keepAlive = setTimeout(() => undefined, 2_000);
  try {
    const error = await rejectedWith(client.postJson(CONTEXT, '/images/generations', {}, 30));
    assert.equal(error.category, 'network');
    assert.match(error.message, /请求超时：火山引擎/);
  } finally {
    clearTimeout(keepAlive);
  }
});
