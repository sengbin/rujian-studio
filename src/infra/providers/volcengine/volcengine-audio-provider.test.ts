// ------------------------------------------------------------------------
// 名称：volcengine-audio-provider.test.ts
// 说明：豆包语音音频适配器与语音合成客户端的自动化测试：模型声明、请求校验、请求头与请求体、逐行响应的音频拼接、任务引用解码、错误码分类与响应不完整的处理。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：注入假的 fetch，不访问网络；响应行格式对照火山引擎“HTTP Chunked/SSE 单向流式-V3”文档。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../domain/errors';
import { AudioGenerationRequest, ProviderCallContext } from '../../../domain/ports/provider-adapters';
import { FakeResponse, createFakeFetch } from '../shared/testing/fake-fetch';
import { VOLCENGINE_VOICES } from './volcengine-audio-catalog';
import { VolcengineAudioProvider } from './volcengine-audio-provider';

const CONTEXT: ProviderCallContext = {
  apiKey: 'speech-test-key',
  settings: { endpoint: 'https://speech.test/api/v3/tts/unidirectional' }
};
const MODEL = 'doubao-seed-tts-2.0';

function createProvider(responses: FakeResponse[] = []) {
  const { fetchFunction, calls } = createFakeFetch(responses);
  return { calls, provider: new VolcengineAudioProvider(fetchFunction) };
}

/** 一个最简合法请求，测试按需覆盖字段。 */
function request(overrides: Partial<AudioGenerationRequest> = {}): AudioGenerationRequest {
  return {
    modelCode: MODEL,
    audioKind: 'voice',
    prompt: '你好，欢迎使用。',
    durationSeconds: null,
    language: null,
    voice: null,
    referenceAudio: null,
    extraParams: {},
    ...overrides
  };
}

/** 把若干行 JSON 写成逐行返回的响应文本。 */
function lines(...items: unknown[]): FakeResponse {
  return { body: null, raw: items.map((item) => `${JSON.stringify(item)}\n`).join('') };
}

function chunk(bytes: number[]) {
  return { code: 0, message: '', data: Buffer.from(bytes).toString('base64') };
}

const FINISHED = { code: 20000000, message: 'ok', data: null, usage: { text_words: 8 } };

async function rejectedWith(action: Promise<unknown>): Promise<ProviderError> {
  try {
    await action;
  } catch (error) {
    assert.ok(error instanceof ProviderError, '应抛出 ProviderError');
    return error;
  }
  assert.fail('应抛出错误');
}

test('适配器声明：只生成语音，不支持时长与参考音频，音色按显示名称列出且名称不重复', () => {
  const { provider } = createProvider();
  assert.deepEqual(provider.listModels().map((model) => model.code), [MODEL]);
  const capability = provider.getCapability(MODEL);
  assert.deepEqual(capability?.audioKinds, ['voice']);
  assert.equal(capability?.referenceAudio, false);
  assert.deepEqual(capability?.voices, VOLCENGINE_VOICES.map((voice) => voice.label));
  assert.equal(new Set(capability?.voices).size, capability?.voices.length);
  assert.equal(new Set(VOLCENGINE_VOICES.map((voice) => voice.speaker)).size, VOLCENGINE_VOICES.length);
  assert.equal(provider.getCapability('nope'), undefined);
  assert.equal('cancel' in provider, false);
  assert.equal(provider.provider.code, 'volcengine-speech');
});

test('校验：合法请求没有问题；音频类型、文字、时长、语言、音色、参考音频不合规时逐条指出', () => {
  const { provider } = createProvider();
  assert.deepEqual(provider.validate(request()), []);
  assert.deepEqual(provider.validate(request({ language: 'en', voice: VOLCENGINE_VOICES[3].label })), []);

  assert.match(provider.validate(request({ audioKind: 'music' })).join(), /不能生成music类型的音频/);
  assert.match(provider.validate(request({ prompt: ' ' })).join(), /提示词不能为空/);
  assert.match(provider.validate(request({ prompt: '字'.repeat(501) })).join(), /提示词不能超过 500 字/);
  assert.match(provider.validate(request({ durationSeconds: 10 })).join(), /不支持指定时长/);
  assert.match(provider.validate(request({ language: 'fr' })).join(), /语言 fr/);
  assert.match(provider.validate(request({ voice: '不存在的音色' })).join(), /不支持预置音色/);
  assert.match(provider.validate(request({ referenceAudio: { mimeType: 'audio/wav', data: new Uint8Array([1]) } })).join(), /不支持参考音频/);
  assert.match(provider.validate(request({ extraParams: { speed: 1 } })).join(), /不支持的模型参数：speed/);
  assert.deepEqual(provider.validate(request({ modelCode: 'x' })), ['豆包语音没有模型 x。']);
});

test('提交：请求发往语音合成接口地址，带密钥与资源标识请求头，请求体用音色标识，音频拼接为 data 地址', async () => {
  const { provider, calls } = createProvider([lines(chunk([1, 2]), chunk([3, 4, 5]), FINISHED)]);
  const ref = await provider.submit(request({ voice: VOLCENGINE_VOICES[2].label }), CONTEXT);

  assert.equal(calls[0].url, 'https://speech.test/api/v3/tts/unidirectional');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers['X-Api-Key'], 'speech-test-key');
  assert.equal(calls[0].headers['X-Api-Resource-Id'], 'seed-tts-2.0');
  assert.match(calls[0].headers['X-Api-Request-Id'], /^[0-9a-f-]{36}$/);
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.deepEqual(calls[0].body, {
    req_params: { text: '你好，欢迎使用。', speaker: VOLCENGINE_VOICES[2].speaker, audio_params: { format: 'mp3', sample_rate: 24000 } }
  });
  assert.equal(ref.modelCode, MODEL);

  const state = await provider.query(ref);
  assert.equal(state.status, 'succeeded');
  assert.deepEqual(state.result, { audioUrl: `data:audio/mpeg;base64,${Buffer.from([1, 2, 3, 4, 5]).toString('base64')}`, durationSeconds: null });
});

test('测试连接：向语音合成接口发一次极短文字的合成请求；密钥无效等错误按分类抛出', async () => {
  const ok = createProvider([lines(chunk([1]), FINISHED)]);
  await ok.provider.checkConnection(CONTEXT);
  assert.equal(ok.calls[0].url, 'https://speech.test/api/v3/tts/unidirectional');
  assert.equal(ok.calls[0].headers['X-Api-Key'], 'speech-test-key');
  assert.equal(((ok.calls[0].body as { req_params: { text: string } }).req_params).text, '你好');

  const badKey = createProvider([{ status: 401, body: { header: { code: 45000010, message: 'Invalid X-Api-Key' } } }]);
  const error = await rejectedWith(badKey.provider.checkConnection(CONTEXT));
  assert.equal(error.category, 'auth');
  assert.match(error.message, /Invalid X-Api-Key/);

  const noEndpoint = createProvider();
  assert.match((await rejectedWith(noEndpoint.provider.checkConnection({ apiKey: 'k', settings: {} }))).message, /接口地址/);
});

test('提交：没有指定音色时使用第一个音色', async () => {
  const { provider, calls } = createProvider([lines(chunk([1]), FINISHED)]);
  await provider.submit(request(), CONTEXT);
  assert.equal(((calls[0].body as { req_params: { speaker: string } }).req_params).speaker, VOLCENGINE_VOICES[0].speaker);
});

test('提交：平台返回的错误码按分类报告，带错误码；没有音频或响应不完整按故障处理', async () => {
  const cases: Array<[unknown, string, RegExp]> = [
    [{ code: 45000000, message: 'speaker permission denied: get resource id: access denied' }, 'auth', /音色鉴权失败|speaker permission denied/],
    [{ code: 45000000, message: 'quota exceeded for types: concurrency' }, 'rate_limited', /quota exceeded/],
    [{ code: 40402003, message: 'TTSExceededTextLimit:exceed max limit' }, 'invalid_request', /TTSExceededTextLimit/],
    [{ code: 55000000, message: 'server error' }, 'server', /server error/]
  ];
  for (const [line, category, message] of cases) {
    const { provider } = createProvider([lines(chunk([1]), line)]);
    const error = await rejectedWith(provider.submit(request(), CONTEXT));
    assert.equal(error.category, category);
    assert.equal(error.code, String((line as { code: number }).code));
    assert.match(error.message, message);
  }

  const noAudio = createProvider([lines(FINISHED)]);
  assert.equal((await rejectedWith(noAudio.provider.submit(request(), CONTEXT))).category, 'server');

  const incomplete = createProvider([lines(chunk([1, 2]))]);
  const incompleteError = await rejectedWith(incomplete.provider.submit(request(), CONTEXT));
  assert.equal(incompleteError.category, 'network');
  assert.match(incompleteError.message, /响应不完整/);

  const garbage = createProvider([{ body: null, raw: 'not json\n' }]);
  assert.match((await rejectedWith(garbage.provider.submit(request(), CONTEXT))).message, /无法解析的内容/);
});

test('提交：HTTP 错误按状态分类；校验不通过不发请求；接口地址不合法时报参数错误', async () => {
  const cases: Array<[number, unknown, string]> = [
    [401, { code: 45000010, message: 'invalid api key' }, 'auth'],
    [429, { message: 'too many requests' }, 'rate_limited'],
    [400, { header: { code: 40000001, message: 'bad request' } }, 'invalid_request'],
    [502, {}, 'server']
  ];
  for (const [status, body, category] of cases) {
    const { provider } = createProvider([{ status, body }]);
    assert.equal((await rejectedWith(provider.submit(request(), CONTEXT))).category, category, `${status}`);
  }

  const invalid = createProvider();
  assert.equal((await rejectedWith(invalid.provider.submit(request({ prompt: '' }), CONTEXT))).category, 'invalid_request');
  assert.equal(invalid.calls.length, 0);

  const missingEndpoint = createProvider();
  assert.match((await rejectedWith(missingEndpoint.provider.submit(request(), { ...CONTEXT, settings: {} }))).message, /尚未配置豆包语音的接口地址/);
});

test('任务引用：损坏的引用报参数错误', async () => {
  const { provider } = createProvider();
  await assert.rejects(provider.query({ modelCode: MODEL, remoteJobId: 'not json' }), /任务引用已损坏/);
  await assert.rejects(provider.query({ modelCode: MODEL, remoteJobId: '{}' }), /任务引用已损坏/);
});

test('提交：说话方式换成语音指令与语速、音量数值写进请求体；没有说话方式时不带这些字段', async () => {
  const { provider, calls } = createProvider([lines(chunk([1]), FINISHED), lines(chunk([1]), FINISHED)]);
  await provider.submit(request({ delivery: '压低声音的悄悄话、语速偏慢、带着紧张' }), CONTEXT);
  const params = (calls[0].body as { req_params: { audio_params: Record<string, unknown>; additions: string } }).req_params;
  assert.deepEqual(params.audio_params, { format: 'mp3', sample_rate: 24000, speech_rate: -20, loudness_rate: -45 });
  assert.deepEqual(JSON.parse(params.additions), { context_texts: ['你可以用压低声音的悄悄话、语速偏慢、带着紧张的方式说话吗？'] });

  await provider.submit(request({ delivery: '  ' }), CONTEXT);
  const plain = (calls[1].body as { req_params: Record<string, unknown> }).req_params;
  assert.equal('additions' in plain, false);
  assert.deepEqual(plain.audio_params, { format: 'mp3', sample_rate: 24000 });
  assert.equal(provider.getCapability(MODEL)?.deliveryControl, true);
});