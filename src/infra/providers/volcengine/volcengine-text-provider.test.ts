// ------------------------------------------------------------------------
// 名称：volcengine-text-provider.test.ts
// 说明：火山引擎文本适配器的自动化测试：模型声明、请求体构造、流式结果拼装、图片输入、截断与错误分类。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：注入假的 fetch，不访问网络；请求体与流式事件字段对照方舟“对话(Chat) API”文档。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../domain/errors';
import { ProviderCallContext } from '../../../domain/ports/provider-adapters';
import { TextGenerationRequest } from '../../../domain/ports/text-generation-port';
import { FakeResponse, createFakeFetch } from '../shared/testing/fake-fetch';
import { VolcengineTextProvider } from './volcengine-text-provider';

const CONTEXT: ProviderCallContext = {
  apiKey: 'ark-test-key',
  settings: { endpoint: 'https://ark.test/api/v3', textEndpoint: 'https://ark.test/api/coding/v3' }
};
const MODEL = 'doubao-seed-2-1-lite-260915';

const REQUEST: TextGenerationRequest = {
  system: '你是编剧。',
  user: '写一个创意。',
  tool: { name: 'submit_creative', description: '提交创意', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } }
};

function createProvider(responses: FakeResponse[]) {
  const { fetchFunction, calls } = createFakeFetch(responses);
  return { calls, provider: new VolcengineTextProvider(fetchFunction) };
}

/** 把若干事件对象写成流式响应文本，以 [DONE] 结束。 */
function stream(...events: unknown[]): FakeResponse {
  const raw = [...events.map((event) => `data: ${JSON.stringify(event)}\n\n`), 'data: [DONE]\n\n'].join('');
  return { body: null, raw };
}

function contentChunk(text: string, finishReason: string | null = null) {
  return { choices: [{ index: 0, delta: { content: text }, finish_reason: finishReason }] };
}

async function rejectedWith(action: Promise<unknown>): Promise<ProviderError> {
  try {
    await action;
  } catch (error) {
    assert.ok(error instanceof ProviderError, '应抛出 ProviderError');
    return error;
  }
  assert.fail('应抛出错误');
}

test('模型声明：都是文本模型，支持图片输入，上下文大于最大输出，服务商为火山引擎', () => {
  const { provider } = createProvider([]);
  const models = provider.listModels();
  assert.ok(models.some((model) => model.code === MODEL));
  for (const model of models) {
    assert.equal(model.kind, 'text');
    assert.equal(model.capability.imageInput, true);
    assert.ok(model.capability.contextTokens > model.capability.maxOutputTokens);
    assert.equal(provider.getCapability(model.code), model.capability);
  }
  assert.equal(provider.getCapability('unknown'), undefined);
  assert.equal(provider.provider.code, 'volcengine');
});

test('生成：请求发往对话接口，用严格 JSON Schema 模式并关闭深度思考，拼装分片的正文', async () => {
  const { provider, calls } = createProvider([
    stream(
      { choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
      contentChunk('{"ti'),
      contentChunk('tle":"灯塔"'),
      contentChunk('}', 'stop'),
      { choices: [], usage: { total_tokens: 10 } }
    )
  ]);
  const result = await provider.generate(MODEL, REQUEST, CONTEXT);
  assert.deepEqual(result, { title: '灯塔' });

  assert.equal(calls[0].url, 'https://ark.test/api/coding/v3/chat/completions');
  assert.equal(calls[0].headers.Authorization, 'Bearer ark-test-key');
  const body = calls[0].body as Record<string, unknown>;
  assert.equal(body.model, MODEL);
  assert.equal(body.stream, true);
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.max_tokens, provider.getCapability(MODEL)?.maxOutputTokens);
  assert.equal('tools' in body, false);
  assert.equal('tool_choice' in body, false);
  const messages = body.messages as Array<{ role: string; content: string }>;
  assert.ok(messages[0].content.startsWith('你是编剧。'));
  assert.match(messages[0].content, /不要输出其他文字/);
  assert.deepEqual(messages[1], { role: 'user', content: '写一个创意。' });
  assert.deepEqual(body.response_format, {
    type: 'json_schema',
    json_schema: {
      name: 'submit_creative',
      description: '提交创意',
      strict: true,
      schema: { type: 'object', properties: { title: { type: ['string', 'null'] } }, required: ['title'], additionalProperties: false }
    }
  });
});

test('严格模式：可选字段返回的 null 视为未填', async () => {
  const nulls = createProvider([stream(contentChunk('{"title":null,"list":[{"a":1,"b":null}]}', 'stop'))]);
  assert.deepEqual(await nulls.provider.generate(MODEL, REQUEST, CONTEXT), { list: [{ a: 1 }] });
});

test('图片输入：图片以 Base64 内联在文本之前，仍用 JSON Schema 模式', async () => {
  const { provider, calls } = createProvider([stream(contentChunk('{}', 'stop'))]);
  await provider.generate(MODEL, { ...REQUEST, images: [{ mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) }] }, CONTEXT);
  const body = calls[0].body as { messages: Array<{ content: unknown }>; response_format: { type: string } };
  assert.deepEqual(body.messages[1].content, [
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
    { type: 'text', text: '写一个创意。' }
  ]);
  assert.equal(body.response_format.type, 'json_schema');
});

test('输出被截断、没有内容、内容不是 JSON 对象：都按参数错误报告', async () => {
  const truncated = createProvider([stream(contentChunk('{"title":"灯', 'length'))]);
  assert.match((await rejectedWith(truncated.provider.generate(MODEL, REQUEST, CONTEXT))).message, /超出最大长度被截断/);

  const empty = createProvider([stream(contentChunk('', 'stop'))]);
  const emptyError = await rejectedWith(empty.provider.generate(MODEL, REQUEST, CONTEXT));
  assert.equal(emptyError.category, 'invalid_request');
  assert.match(emptyError.message, /没有返回内容/);

  const badJson = createProvider([stream(contentChunk('{"title"', 'stop'))]);
  assert.match((await rejectedWith(badJson.provider.generate(MODEL, REQUEST, CONTEXT))).message, /内容不是合法的 JSON/);

  const notObject = createProvider([stream(contentChunk('[1]', 'stop'))]);
  assert.match((await rejectedWith(notObject.provider.generate(MODEL, REQUEST, CONTEXT))).message, /内容不是 JSON 对象/);
});

test('错误：未知模型、不在流中的 HTTP 错误、流事件里的错误分别按分类报告，并带平台错误码', async () => {
  const unknown = createProvider([]);
  const unknownError = await rejectedWith(unknown.provider.generate('nope', REQUEST, CONTEXT));
  assert.equal(unknownError.category, 'invalid_request');
  assert.match(unknownError.message, /火山引擎没有文本模型 nope/);

  const unauthorized = createProvider([{ status: 401, body: { error: { code: 'AuthenticationError', message: 'bad key' } } }]);
  assert.equal((await rejectedWith(unauthorized.provider.generate(MODEL, REQUEST, CONTEXT))).category, 'auth');

  const limited = createProvider([{ status: 429, body: { error: { code: 'ModelAccountTpmRateLimitExceeded', message: 'tpm' } } }]);
  assert.equal((await rejectedWith(limited.provider.generate(MODEL, REQUEST, CONTEXT))).category, 'rate_limited');

  const inStream = createProvider([stream({ error: { code: 'OutputTextSensitiveContentDetected', message: 'blocked' } })]);
  const inStreamError = await rejectedWith(inStream.provider.generate(MODEL, REQUEST, CONTEXT));
  assert.equal(inStreamError.category, 'content_rejected');
  assert.equal(inStreamError.code, 'OutputTextSensitiveContentDetected');
  assert.match(inStreamError.message, /火山引擎返回错误（OutputTextSensitiveContentDetected）：blocked/);
});

test('测试连接：向文本接口地址提交空请求体，带错误码的参数错误说明可用，鉴权失败和没有错误码的响应按失败处理', async () => {
  const reachable = createProvider([{ status: 400, body: { error: { code: 'MissingParameter', message: 'model is required' } } }]);
  await reachable.provider.checkConnection(CONTEXT);
  assert.deepEqual([reachable.calls[0].method, reachable.calls[0].url, reachable.calls[0].body], ['POST', 'https://ark.test/api/coding/v3/chat/completions', {}]);
  assert.equal(reachable.calls[0].headers.Authorization, 'Bearer ark-test-key');

  const badKey = createProvider([{ status: 401, body: { error: { code: 'AuthenticationError', message: 'bad' } } }]);
  assert.equal((await rejectedWith(badKey.provider.checkConnection(CONTEXT))).category, 'auth');

  const wrongPath = createProvider([{ status: 404, body: { error: { code: 'PathNotFound', message: 'no path' } } }]);
  assert.match((await rejectedWith(wrongPath.provider.checkConnection(CONTEXT))).message, /请检查接口地址是否正确/);

  const noEndpoint = createProvider([]);
  assert.match((await rejectedWith(noEndpoint.provider.checkConnection({ apiKey: 'k', settings: { endpoint: 'https://ark.test/api/v3' } }))).message, /文本接口地址/);
  assert.equal(noEndpoint.calls.length, 0);
});
