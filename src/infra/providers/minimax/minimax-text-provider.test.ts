// ------------------------------------------------------------------------
// 名称：minimax-text-provider.test.ts
// 说明：MiniMax 文本适配器的自动化测试：模型声明、请求体构造（工具调用、思考控制）、流式结果拼装、图片输入、截断与错误分类。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：注入假的 fetch，不访问网络；请求体与流式事件字段对照 MiniMax 开放平台“OpenAI SDK”“工具使用 & 交错思维链”文档。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../domain/errors';
import { ProviderCallContext } from '../../../domain/ports/provider-adapters';
import { TextGenerationRequest } from '../../../domain/ports/text-generation-port';
import { FakeResponse, createFakeFetch } from '../shared/testing/fake-fetch';
import { MinimaxTextProvider } from './minimax-text-provider';

const CONTEXT: ProviderCallContext = { apiKey: 'mm-test-key', settings: { endpoint: 'https://mm.test' } };
const M3 = 'MiniMax-M3';
const M31 = 'MiniMax-M3.1-Flash-Preview';
const M27 = 'MiniMax-M2.7';

const REQUEST: TextGenerationRequest = {
  system: '你是编剧。',
  user: '写一个创意。',
  tool: { name: 'submit_creative', description: '提交创意', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } }
};

function createProvider(responses: FakeResponse[]) {
  const { fetchFunction, calls } = createFakeFetch(responses);
  return { calls, provider: new MinimaxTextProvider(fetchFunction) };
}

/** 把若干事件对象写成流式响应文本，以 [DONE] 结束。 */
function stream(...events: unknown[]): FakeResponse {
  const raw = [...events.map((event) => `data: ${JSON.stringify(event)}\n\n`), 'data: [DONE]\n\n'].join('');
  return { body: null, raw };
}

function toolChunk(delta: { name?: string; argumentsText?: string }, finishReason: string | null = null) {
  const fn = { ...(delta.name === undefined ? {} : { name: delta.name }), arguments: delta.argumentsText ?? '' };
  return { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, type: 'function', function: fn }] }, finish_reason: finishReason }] };
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

test('模型声明：九个文本模型，只有 M3.1 与 M3 支持图片输入，上下文大于最大输出，服务商为 minimax', () => {
  const { provider } = createProvider([]);
  const models = provider.listModels();
  assert.deepEqual(models.map((model) => model.code), [M31, M3, M27, `${M27}-highspeed`, 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.1', 'MiniMax-M2.1-highspeed', 'MiniMax-M2']);
  for (const model of models) {
    assert.equal(model.kind, 'text');
    assert.ok(model.capability.contextTokens > model.capability.maxOutputTokens);
    assert.equal(model.capability.imageInput, model.code === M3 || model.code === M31);
    assert.equal(provider.getCapability(model.code), model.capability);
  }
  assert.equal(provider.getCapability('unknown'), undefined);
  assert.equal(provider.provider.code, 'minimax');
});

test('生成：请求发往对话接口，提供输出工具、思考内容单独返回，拼装分片的工具参数', async () => {
  const { provider, calls } = createProvider([
    stream(
      { choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
      toolChunk({ name: 'submit_creative', argumentsText: '{"ti' }),
      toolChunk({ argumentsText: 'tle":"灯塔"}' }, 'tool_calls'),
      { choices: [], usage: { total_tokens: 10 } }
    )
  ]);
  assert.deepEqual(await provider.generate(M27, REQUEST, CONTEXT), { title: '灯塔' });

  assert.equal(calls[0].url, 'https://mm.test/v1/chat/completions');
  assert.equal(calls[0].headers.Authorization, 'Bearer mm-test-key');
  const body = calls[0].body as Record<string, unknown>;
  assert.equal(body.model, M27);
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, provider.getCapability(M27)?.maxOutputTokens);
  assert.equal(body.reasoning_split, true);
  assert.equal('response_format' in body, false);
  assert.equal('thinking' in body, false, 'M2.x 的思考无法关闭，不传参数');
  assert.equal('reasoning_effort' in body, false);
  assert.deepEqual(body.tools, [
    { type: 'function', function: { name: 'submit_creative', description: '提交创意', parameters: REQUEST.tool.inputSchema } }
  ]);
  const messages = body.messages as Array<{ role: string; content: string }>;
  assert.ok(messages[0].content.startsWith('你是编剧。'));
  assert.match(messages[0].content, /请调用工具 submit_creative 提交结果/);
  assert.deepEqual(messages[1], { role: 'user', content: '写一个创意。' });
});

test('思考控制：M3 关闭思考，M3.1 把思考深度调到最低', async () => {
  const reply = () => stream(toolChunk({ name: 'submit_creative', argumentsText: '{}' }, 'tool_calls'));
  const m3 = createProvider([reply()]);
  await m3.provider.generate(M3, REQUEST, CONTEXT);
  const m3Body = m3.calls[0].body as Record<string, unknown>;
  assert.deepEqual(m3Body.thinking, { type: 'disabled' });
  assert.equal('reasoning_effort' in m3Body, false);

  const m31 = createProvider([reply()]);
  await m31.provider.generate(M31, REQUEST, CONTEXT);
  const m31Body = m31.calls[0].body as Record<string, unknown>;
  assert.equal(m31Body.reasoning_effort, 'low');
  assert.equal('thinking' in m31Body, false);
});

test('图片输入：支持图片的模型把图片以 Base64 内联在文本之前，不支持的模型直接拒绝', async () => {
  const image = { mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) };
  const { provider, calls } = createProvider([stream(toolChunk({ name: 'submit_creative', argumentsText: '{}' }, 'tool_calls'))]);
  await provider.generate(M3, { ...REQUEST, images: [image] }, CONTEXT);
  const body = calls[0].body as { messages: Array<{ content: unknown }> };
  assert.deepEqual(body.messages[1].content, [
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
    { type: 'text', text: '写一个创意。' }
  ]);

  const unsupported = createProvider([]);
  const error = await rejectedWith(unsupported.provider.generate(M27, { ...REQUEST, images: [image] }, CONTEXT));
  assert.equal(error.category, 'invalid_request');
  assert.match(error.message, /不支持图片输入/);
  assert.equal(unsupported.calls.length, 0);
});

test('没有调用工具、输出被截断、参数不是合法 JSON：都按参数错误报告', async () => {
  const noTool = createProvider([stream({ choices: [{ index: 0, delta: { content: '好的，标题是灯塔' }, finish_reason: 'stop' }] })]);
  const noToolError = await rejectedWith(noTool.provider.generate(M3, REQUEST, CONTEXT));
  assert.equal(noToolError.category, 'invalid_request');
  assert.match(noToolError.message, /没有通过工具返回结果：好的，标题是灯塔/);

  const truncated = createProvider([stream(toolChunk({ name: 'submit_creative', argumentsText: '{"title":"灯' }, 'length'))]);
  assert.match((await rejectedWith(truncated.provider.generate(M3, REQUEST, CONTEXT))).message, /超出最大长度被截断/);

  const badJson = createProvider([stream(toolChunk({ name: 'submit_creative', argumentsText: '{"title"' }, 'tool_calls'))]);
  assert.match((await rejectedWith(badJson.provider.generate(M3, REQUEST, CONTEXT))).message, /工具参数不是合法的 JSON/);
});

test('模型调用了其他工具、流事件不是合法的 JSON 对象：报错，不取第一个调用也不忽略', async () => {
  const wrongTool = createProvider([stream(toolChunk({ name: 'other_tool', argumentsText: '{}' }, 'tool_calls'))]);
  const wrongToolError = await rejectedWith(wrongTool.provider.generate(M3, REQUEST, CONTEXT));
  assert.equal(wrongToolError.category, 'invalid_request');
  assert.match(wrongToolError.message, /非预期的工具“other_tool”/);

  const garbage = createProvider([{ body: null, raw: `data: {oops\n\ndata: ${JSON.stringify(toolChunk({ name: 'submit_creative', argumentsText: '{}' }, 'tool_calls'))}\n\ndata: [DONE]\n\n` }]);
  const garbageError = await rejectedWith(garbage.provider.generate(M3, REQUEST, CONTEXT));
  assert.equal(garbageError.category, 'server');
  assert.match(garbageError.message, /流式事件不是合法的 JSON/);

  const notObject = createProvider([{ body: null, raw: 'data: 42\n\ndata: [DONE]\n\n' }]);
  assert.match((await rejectedWith(notObject.provider.generate(M3, REQUEST, CONTEXT))).message, /流式事件不是 JSON 对象/);

  const keepAlive = createProvider([{ body: null, raw: `: keep-alive\n\n\ndata: ${JSON.stringify(toolChunk({ name: 'submit_creative', argumentsText: '{}' }, 'tool_calls'))}\n\ndata: [DONE]\n\n` }]);
  assert.deepEqual(await keepAlive.provider.generate(M3, REQUEST, CONTEXT), {});
});

test('错误：未知模型、HTTP 错误、流事件里的 base_resp 错误分别按分类报告，并带平台错误码', async () => {
  const unknown = createProvider([]);
  const unknownError = await rejectedWith(unknown.provider.generate('nope', REQUEST, CONTEXT));
  assert.equal(unknownError.category, 'invalid_request');
  assert.match(unknownError.message, /MiniMax没有文本模型 nope/);

  const unauthorized = createProvider([{ status: 401, body: { type: 'error', error: { type: 'authorized_error', message: 'login fail (1004)' } } }]);
  assert.equal((await rejectedWith(unauthorized.provider.generate(M3, REQUEST, CONTEXT))).category, 'auth');

  const inStream = createProvider([stream({ base_resp: { status_code: 1026, status_msg: 'sensitive' } })]);
  const inStreamError = await rejectedWith(inStream.provider.generate(M3, REQUEST, CONTEXT));
  assert.equal(inStreamError.category, 'content_rejected');
  assert.equal(inStreamError.code, '1026');
  assert.match(inStreamError.message, /MiniMax返回错误（1026）：sensitive/);

  const okStatus = createProvider([stream({ base_resp: { status_code: 0, status_msg: '' }, choices: [] }, toolChunk({ name: 'submit_creative', argumentsText: '{"title":"a"}' }, 'tool_calls'))]);
  assert.deepEqual(await okStatus.provider.generate(M3, REQUEST, CONTEXT), { title: 'a' });
});
