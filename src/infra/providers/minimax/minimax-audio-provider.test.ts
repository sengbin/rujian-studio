// ------------------------------------------------------------------------
// 名称：minimax-audio-provider.test.ts
// 说明：MiniMax 语音适配器的自动化测试：模型声明、请求校验、请求体（音色、语速音量、语言）、音频地址与 hex 数据的处理、任务引用解码、错误码分类。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：注入假的 fetch，不访问网络；请求体与响应字段对照 MiniMax 开放平台“同步语音合成”文档。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../domain/errors';
import { AudioGenerationRequest, ProviderCallContext } from '../../../domain/ports/provider-adapters';
import { FakeResponse, createFakeFetch } from '../shared/testing/fake-fetch';
import { MINIMAX_VOICES } from './minimax-audio-catalog';
import { MinimaxAudioProvider } from './minimax-audio-provider';

const CONTEXT: ProviderCallContext = { apiKey: 'mm-test-key', settings: { endpoint: 'https://mm.test' } };
const MODEL = 'speech-2.8-hd';

function createProvider(responses: FakeResponse[] = []) {
  const { fetchFunction, calls } = createFakeFetch(responses);
  return { calls, provider: new MinimaxAudioProvider(fetchFunction) };
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

function success(audio: string, lengthMs = 1500): FakeResponse {
  return { body: { data: { audio, status: 2 }, extra_info: { audio_length: lengthMs, audio_format: 'mp3' }, base_resp: { status_code: 0, status_msg: 'success' } } };
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

test('适配器声明：六个语音模型，只生成语音，不支持时长与参考音频，音色名称与标识都不重复', () => {
  const { provider } = createProvider();
  assert.deepEqual(provider.listModels().map((model) => model.code), ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo', 'speech-02-hd', 'speech-02-turbo']);
  for (const model of provider.listModels()) {
    assert.deepEqual(model.capability.audioKinds, ['voice']);
    assert.equal(model.capability.referenceAudio, false);
    assert.equal(model.capability.deliveryControl, true);
    assert.deepEqual(model.capability.voices, MINIMAX_VOICES.map((voice) => voice.label));
  }
  assert.equal(new Set(MINIMAX_VOICES.map((voice) => voice.label)).size, MINIMAX_VOICES.length);
  assert.equal(new Set(MINIMAX_VOICES.map((voice) => voice.voiceId)).size, MINIMAX_VOICES.length);
  assert.equal(provider.getCapability('nope'), undefined);
  assert.equal('cancel' in provider, false);
  assert.equal(provider.provider.code, 'minimax');
});

test('校验：合法请求没有问题；音频类型、文字、时长、语言、音色、参考音频不合规时逐条指出', () => {
  const { provider } = createProvider();
  assert.deepEqual(provider.validate(request()), []);
  assert.deepEqual(provider.validate(request({ language: 'en', voice: MINIMAX_VOICES[3].label })), []);

  assert.match(provider.validate(request({ audioKind: 'music' })).join(), /不能生成music类型的音频/);
  assert.match(provider.validate(request({ prompt: ' ' })).join(), /提示词不能为空/);
  assert.match(provider.validate(request({ prompt: '字'.repeat(5001) })).join(), /提示词不能超过 5000 字/);
  assert.match(provider.validate(request({ durationSeconds: 10 })).join(), /不支持指定时长/);
  assert.match(provider.validate(request({ language: 'fr' })).join(), /语言 fr/);
  assert.match(provider.validate(request({ voice: '不存在的音色' })).join(), /不支持预置音色/);
  assert.match(provider.validate(request({ referenceAudio: { mimeType: 'audio/wav', data: new Uint8Array([1]) } })).join(), /不支持参考音频/);
  assert.match(provider.validate(request({ extraParams: { speed: 1 } })).join(), /不支持的模型参数：speed/);
  assert.deepEqual(provider.validate(request({ modelCode: 'x' })), ['MiniMax没有模型 x。']);
});

test('提交：请求发往语音合成接口，默认用第一个音色，语速音量为 1，返回音频地址与时长', async () => {
  const { provider, calls } = createProvider([success('https://cdn.test/a.mp3', 2500)]);
  const ref = await provider.submit(request(), CONTEXT);

  assert.equal(calls[0].url, 'https://mm.test/v1/t2a_v2');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer mm-test-key');
  assert.deepEqual(calls[0].body, {
    model: MODEL,
    text: '你好，欢迎使用。',
    stream: false,
    output_format: 'url',
    voice_setting: { voice_id: MINIMAX_VOICES[0].voiceId, speed: 1, vol: 1 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 }
  });
  assert.equal(ref.modelCode, MODEL);

  const state = await provider.query(ref);
  assert.equal(state.status, 'succeeded');
  assert.deepEqual(state.result, { audioUrl: 'https://cdn.test/a.mp3', durationSeconds: 2.5 });
});

test('提交：音色按显示名称换算成标识，说话方式换算为语速与音量，语言写入 language_boost', async () => {
  const { provider, calls } = createProvider([success('https://cdn.test/a.mp3')]);
  await provider.submit(request({ voice: MINIMAX_VOICES[5].label, language: 'en', delivery: '压低声音的悄悄话，语速偏慢' }), CONTEXT);
  const body = calls[0].body as { voice_setting: { voice_id: string; speed: number; vol: number }; language_boost: string };
  assert.equal(body.voice_setting.voice_id, MINIMAX_VOICES[5].voiceId);
  assert.ok(Math.abs(body.voice_setting.speed - 0.8) < 1e-9);
  assert.ok(Math.abs(body.voice_setting.vol - 0.55) < 1e-9);
  assert.equal(body.language_boost, 'English');

  const zh = createProvider([success('https://cdn.test/a.mp3')]);
  await zh.provider.submit(request({ language: 'zh', delivery: '大喊，语速很快' }), CONTEXT);
  const zhBody = zh.calls[0].body as { voice_setting: { speed: number; vol: number }; language_boost: string };
  assert.ok(Math.abs(zhBody.voice_setting.speed - 1.4) < 1e-9);
  assert.ok(Math.abs(zhBody.voice_setting.vol - 1.6) < 1e-9);
  assert.equal(zhBody.language_boost, 'Chinese');
});

test('提交：平台返回 hex 音频数据时转成 data 地址；没有音频时按服务端错误报告', async () => {
  const hex = createProvider([success('010203')]);
  const ref = await hex.provider.submit(request(), CONTEXT);
  const state = await hex.provider.query(ref);
  assert.deepEqual(state.result, { audioUrl: `data:audio/mpeg;base64,${Buffer.from([1, 2, 3]).toString('base64')}`, durationSeconds: 1.5 });

  const empty = createProvider([{ body: { data: null, base_resp: { status_code: 0 } } }]);
  assert.equal((await rejectedWith(empty.provider.submit(request(), CONTEXT))).category, 'server');
});

test('提交失败：校验不过不发请求；密钥无效、限流、非法字符按分类报告', async () => {
  const invalid = createProvider();
  assert.equal((await rejectedWith(invalid.provider.submit(request({ prompt: '' }), CONTEXT))).category, 'invalid_request');
  assert.equal(invalid.calls.length, 0);

  const badKey = createProvider([{ body: { base_resp: { status_code: 1004, status_msg: 'auth failed' } } }]);
  assert.equal((await rejectedWith(badKey.provider.submit(request(), CONTEXT))).category, 'auth');

  const limited = createProvider([{ body: { base_resp: { status_code: 1039, status_msg: 'TPM limit' } } }]);
  assert.equal((await rejectedWith(limited.provider.submit(request(), CONTEXT))).category, 'rate_limited');

  const illegal = createProvider([{ body: { base_resp: { status_code: 1042, status_msg: 'invisible characters' } } }]);
  const illegalError = await rejectedWith(illegal.provider.submit(request(), CONTEXT));
  assert.equal(illegalError.category, 'invalid_request');
  assert.equal(illegalError.code, '1042');
});

test('任务引用：编号很短，不含音频内容；未知编号（如应用重启后）查询时报参数错误，提示重新生成', async () => {
  const { provider } = createProvider([success('010203')]);
  const ref = await provider.submit(request(), CONTEXT);
  assert.ok(ref.remoteJobId.length < 64);
  assert.ok(!ref.remoteJobId.includes('base64'));

  const restarted = createProvider().provider;
  const error = await rejectedWith(restarted.query(ref));
  assert.equal(error.category, 'invalid_request');
  assert.match(error.message, /重新生成/);
});
