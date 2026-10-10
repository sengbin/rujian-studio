// ------------------------------------------------------------------------
// 名称：audio-request-validation.test.ts
// 说明：音频适配器共用校验与音色查找的测试：逐项超出模型能力时给出问题，音色按显示名称查找。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-11
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../domain/errors';
import { AudioCapability } from '../../../domain/models/model-capability';
import { AudioGenerationRequest } from '../../../domain/ports/provider-adapters';
import { findVoiceByLabel, validateAudioContent } from './audio-request-validation';

const CAPABILITY: AudioCapability = {
  audioKinds: ['voice'],
  duration: {},
  promptMaxLength: 10,
  languages: ['zh'],
  voices: ['甲'],
  referenceAudio: false
};

/** 构造一个合法请求，可覆盖部分字段。 */
function request(overrides: Partial<AudioGenerationRequest> = {}): AudioGenerationRequest {
  return { modelCode: 'm', audioKind: 'voice', prompt: '你好', durationSeconds: null, language: null, voice: null, referenceAudio: null, extraParams: {}, ...overrides };
}

test('音频内容校验：合法请求没有问题', () => {
  assert.deepEqual(validateAudioContent(request({ language: 'zh', voice: '甲' }), CAPABILITY), []);
});

test('音频内容校验：类型、提示词、时长、语言、音色、参考音频超出能力时逐条指出', () => {
  const issues = validateAudioContent(
    request({
      audioKind: 'music',
      prompt: ' ',
      durationSeconds: 5,
      language: 'fr',
      voice: '乙',
      referenceAudio: { mimeType: 'audio/wav', data: new Uint8Array([1]) }
    }),
    CAPABILITY
  );
  assert.equal(issues.length, 6, '空提示词只触发“不能为空”，不触发超长');
  assert.match(issues.join('\n'), /不能生成music类型的音频，支持：voice/);
  assert.match(issues.join('\n'), /提示词不能为空/);
  assert.match(issues.join('\n'), /不支持指定时长/);
  assert.match(issues.join('\n'), /语言 fr 不在模型支持的范围内：zh/);
  assert.match(issues.join('\n'), /不支持预置音色 乙/);
  assert.match(issues.join('\n'), /不支持参考音频/);
  assert.match(validateAudioContent(request({ prompt: '字'.repeat(11) }), CAPABILITY).join(), /提示词不能超过 10 字（当前 11 字）/);
});

test('音频内容校验：模型支持参考音频时不再报“不支持”，由适配器自行检查素材', () => {
  const supported: AudioCapability = { ...CAPABILITY, referenceAudio: true };
  assert.deepEqual(validateAudioContent(request({ referenceAudio: { mimeType: 'audio/wav', data: new Uint8Array([1]) } }), supported), []);
});

test('音色查找：未指定用默认音色，按显示名称查找，找不到抛出参数错误', () => {
  const voices = [{ label: '甲', id: 1 }, { label: '乙', id: 2 }];
  assert.equal(findVoiceByLabel(voices, voices[0], null), voices[0]);
  assert.equal(findVoiceByLabel(voices, voices[0], '乙'), voices[1]);
  assert.throws(
    () => findVoiceByLabel(voices, voices[0], '丙'),
    (error) => error instanceof ProviderError && error.category === 'invalid_request' && /不支持预置音色 丙/.test(error.message)
  );
});
