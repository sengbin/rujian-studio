// ------------------------------------------------------------------------
// 名称：voice-preview-rules.test.ts
// 说明：台词试听纯规则的自动化测试：试听请求的读取与校验、语音提示词的书写、预置音色的固定挑选、语言代码换算。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：纯函数测试，不依赖数据库。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationError } from '../errors';
import {
  NARRATOR_SPEAKER_KEY,
  buildDraftPrompt,
  buildVoicePrompt,
  guessLanguageCode,
  pickPresetVoice,
  readVoiceAdoptInput,
  readVoiceDraftInput,
  readVoicePreviewInput,
  readVoiceSpeakerInput,
  toLanguageCode,
  toLanguageLabel,
  toSpeakerKey
} from './voice-preview-rules';

test('读取试听请求：标识必须是正整数，版本可缺省', () => {
  assert.deepEqual(readVoicePreviewInput({ episodeId: 7, soundId: 3, modelId: 5 }), { episodeId: 7, runId: undefined, soundId: 3, modelId: 5, regenerate: false });
  assert.equal(readVoicePreviewInput({ episodeId: 7, soundId: 3, modelId: 5, regenerate: true }).regenerate, true);
  assert.equal(readVoicePreviewInput({ episodeId: 7, soundId: 3, modelId: 5, regenerate: 'yes' }).regenerate, false);
  assert.deepEqual(readVoicePreviewInput({ episodeId: 7, runId: 2, soundId: 3, modelId: 5 }).runId, 2);
  assert.equal(readVoicePreviewInput({ episodeId: 7, runId: null, soundId: 3, modelId: 5 }).runId, undefined);
  for (const bad of [null, [], 'x', {}, { episodeId: 7, soundId: 3 }, { episodeId: 0, soundId: 3, modelId: 5 }, { episodeId: 7, soundId: 1.5, modelId: 5 }, { episodeId: 7, runId: -1, soundId: 3, modelId: 5 }, { episodeId: '7', soundId: 3, modelId: 5 }]) {
    assert.throws(() => readVoicePreviewInput(bad), ValidationError, JSON.stringify(bad));
  }
});

test('语音提示词：用参考标记时按“标记 + 说话方式 + 说：“台词””书写；不用参考音频时只有台词', () => {
  assert.equal(buildVoicePrompt(' 今晚会下雨 ', '低声、急促', '@voice1'), '@voice1，低声、急促，说：“今晚会下雨”');
  assert.equal(buildVoicePrompt('今晚会下雨', '  ', '@voice1'), '@voice1，说：“今晚会下雨”');
  assert.equal(buildVoicePrompt(' 今晚会下雨 ', '低声', null), '今晚会下雨');
});

test('预置音色：同一说话人始终得到同一个，不同说话人依次错开；没有预置音色时为 null', () => {
  const voices = ['甲', '乙', '丙'];
  assert.equal(pickPresetVoice(voices, 11), pickPresetVoice(voices, 11));
  assert.deepEqual([3, 4, 5].map((id) => pickPresetVoice(voices, id)), ['甲', '乙', '丙']);
  assert.equal(pickPresetVoice([], 3), null);
});

test('语言代码：中文、英文换成代码，其他、没有设置或模型不支持时为 null', () => {
  assert.equal(toLanguageCode('中文', ['zh', 'en']), 'zh');
  assert.equal(toLanguageCode('英文', ['zh', 'en']), 'en');
  assert.equal(toLanguageCode('英文', ['zh']), null);
  assert.equal(toLanguageCode('其他', ['zh', 'en']), null);
  assert.equal(toLanguageCode(undefined, ['zh', 'en']), null);
});

test('读取生成音色的请求：说话人可以是旁白，台词必填并限制长度，预置音色空串视为没有，换一个只认 true', () => {
  const draft = readVoiceDraftInput({ episodeId: 7, entityId: 11, modelId: 5, sampleText: ' 今晚会下雨 ', delivery: ' 低声 ', description: '沙哑', presetVoice: '', regenerate: true });
  assert.deepEqual(draft, { episodeId: 7, entityId: 11, modelId: 5, sampleText: '今晚会下雨', delivery: '低声', description: '沙哑', presetVoice: null, regenerate: true });
  const narrator = readVoiceDraftInput({ episodeId: 7, modelId: 5, sampleText: '夜幕降临', presetVoice: '小红', regenerate: 'yes' });
  assert.deepEqual([narrator.entityId, narrator.presetVoice, narrator.regenerate, narrator.description], [null, '小红', false, '']);
  for (const bad of [{ episodeId: 7, modelId: 5 }, { episodeId: 7, modelId: 5, sampleText: '字'.repeat(121) }, { episodeId: 7, entityId: 0, modelId: 5, sampleText: 'a' }, { episodeId: 7, modelId: 0, sampleText: 'a' }, { episodeId: 7, modelId: 5, sampleText: 'a', description: 'x'.repeat(501) }]) {
    assert.throws(() => readVoiceDraftInput(bad), ValidationError, JSON.stringify(bad));
  }
});

test('读取采用音色与说话人的请求：名称必填，其他集只认 true', () => {
  assert.deepEqual(readVoiceAdoptInput({ episodeId: 7, entityId: 11, name: ' 守夜人·音色 ', applyToOtherEpisodes: true }), { episodeId: 7, entityId: 11, name: '守夜人·音色', applyToOtherEpisodes: true });
  assert.deepEqual(readVoiceAdoptInput({ episodeId: 7, name: '旁白' }), { episodeId: 7, entityId: null, name: '旁白', applyToOtherEpisodes: false });
  assert.throws(() => readVoiceAdoptInput({ episodeId: 7, name: ' ' }), ValidationError);
  assert.throws(() => readVoiceAdoptInput({ episodeId: 7, name: '字'.repeat(51) }), ValidationError);
  assert.deepEqual(readVoiceSpeakerInput({ episodeId: 7, entityId: null }), { episodeId: 7, entityId: null });
  assert.throws(() => readVoiceSpeakerInput({ entityId: 3 }), ValidationError);
});

test('生成音色的提示词与语言：描述、说话方式依次在前，最后是“说：“台词””；按文字猜语言代码', () => {
  assert.equal(buildDraftPrompt(' 沙哑的老年男声 ', ' 低声 ', ' 今晚会下雨 '), '说话人（沙哑的老年男声，低声）说：“今晚会下雨”');
  assert.equal(buildDraftPrompt('', '', '今晚会下雨'), '说：“今晚会下雨”');
  assert.deepEqual([guessLanguageCode('今晚会下雨'), guessLanguageCode('Rain tonight'), guessLanguageCode('Rain 今晚'), guessLanguageCode('123 ...')], ['zh', 'en', 'zh', null]);
  assert.deepEqual([toLanguageLabel('zh'), toLanguageLabel('en'), toLanguageLabel(null), toLanguageLabel('fr')], ['中文', '英文', null, null]);
  assert.deepEqual([toSpeakerKey(11), toSpeakerKey(null)], ['entity:11', NARRATOR_SPEAKER_KEY]);
});