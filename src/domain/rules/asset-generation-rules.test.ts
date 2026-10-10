// ------------------------------------------------------------------------
// 名称：asset-generation-rules.test.ts
// 说明：资产生成规则的自动化测试：修订号的计算、参考文件的比较、“需更新”“有改动未生成”的推算、能否生成的判断、使用集数的统计与图像、音频生成参数的范围校验。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：纯函数测试，不依赖数据库。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssetContent, AssetGenerationSummary, AssetRecord } from '../models/asset';
import {
  checkGenerationAvailability,
  computePromptRevision,
  computeRevisionUpdate,
  contentFieldsChanged,
  countUsedEpisodes,
  hasUngeneratedChanges,
  isPromptOutdated,
  languageCodeOf,
  modelKindOfAsset,
  readAudioRunParams,
  readImageRunParams
} from './asset-generation-rules';
import { FAKE_ASSET_IMAGE_CAPABILITY, FAKE_AUDIO_CAPABILITY } from '../ports/testing/fake-model-providers';

function asset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: 1, kind: 'character', name: '林夏', sourceEntityId: null, categoryId: null, attributes: { appearance: '短发' }, composition: '半身像', style: null,
    background: '', referenceAspectRatio: '1:1', extraRequirements: '', prompt: '提示', contentRevision: 2, promptRevision: 3,
    promptContentRevision: 2, promptStatus: 'succeeded', promptError: null, adoptedVersionId: null, fileSource: 'generated', createdAt: 't', updatedAt: 't', ...overrides
  };
}

function content(base: AssetRecord, overrides: Partial<AssetContent> = {}): AssetContent {
  return {
    name: base.name, attributes: base.attributes, composition: base.composition, style: base.style, background: base.background,
    referenceAspectRatio: base.referenceAspectRatio, extraRequirements: base.extraRequirements, prompt: base.prompt, ...overrides
  };
}

const EMPTY_SUMMARY: AssetGenerationSummary = { versionCount: 0, latest: null, latestSucceeded: null, adoptedVersion: null };

function summary(contentRevision: number, promptRevision: number, status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' = 'succeeded'): AssetGenerationSummary {
  return { versionCount: 1, latest: { id: 1, version: 1, status, contentRevision, promptRevision, errorMessage: null }, latestSucceeded: 1, adoptedVersion: null };
}

test('影响生成的字段：名称、提示词不算；描述、构图、风格、背景、画幅、补充要求算；描述字段键的顺序不影响比较', () => {
  const base = asset({ attributes: { appearance: '短发', clothing: '风衣' } });
  assert.equal(contentFieldsChanged(base, content(base, { name: '改名', prompt: '改过' })), false);
  assert.equal(contentFieldsChanged(base, content(base, { attributes: { clothing: '风衣', appearance: '短发' } })), false);
  for (const patch of [
    { attributes: { appearance: '长发', clothing: '风衣' } },
    { composition: '全身像' },
    { style: '水彩' },
    { background: '纯色' },
    { referenceAspectRatio: '16:9' },
    { extraRequirements: '微笑' }
  ] satisfies Partial<AssetContent>[]) {
    assert.equal(contentFieldsChanged(base, content(base, patch)), true, JSON.stringify(patch));
  }
});

test('修订号：改表单加内容修订号，提示词修订号不变', () => {
  const base = asset();
  assert.deepEqual(computeRevisionUpdate(base, content(base)), { contentRevision: 2, promptRevision: 3, promptContentRevision: 2 });
  assert.deepEqual(computeRevisionUpdate(base, content(base, { composition: '全身像' })), { contentRevision: 3, promptRevision: 3, promptContentRevision: 2 });
});

test('手动保存提示词：文本变化加提示词修订号，保存即确认基于当前表单内容（文本没变也一样），清空没有依据', () => {
  const base = asset({ contentRevision: 4, promptContentRevision: 2 });
  assert.deepEqual(computePromptRevision(base, { prompt: '新提示' }), { promptRevision: 4, promptContentRevision: 4 });
  assert.deepEqual(computePromptRevision(base, { prompt: '提示' }), { promptRevision: 3, promptContentRevision: 4 });
  assert.deepEqual(computePromptRevision(base, { prompt: '' }), { promptRevision: 4, promptContentRevision: 0 });
});

test('提示词需更新：有提示词且依据的内容修订号落后；没有提示词不算', () => {
  assert.equal(isPromptOutdated(asset({ promptContentRevision: 1 })), true);
  assert.equal(isPromptOutdated(asset({ promptContentRevision: 2 })), false);
  assert.equal(isPromptOutdated(asset({ promptContentRevision: 0, prompt: '' })), false);
});

test('有改动未生成：没有版本不算；最新版本的任一修订号落后才算', () => {
  const current = asset();
  assert.equal(hasUngeneratedChanges(current, EMPTY_SUMMARY), false);
  assert.equal(hasUngeneratedChanges(current, summary(2, 3)), false);
  assert.equal(hasUngeneratedChanges(current, summary(1, 3)), true);
  assert.equal(hasUngeneratedChanges(current, summary(2, 2)), true);
});


test('能否生成：使用上传文件、提示词生成中、没有可用的提示词、已有进行中的版本、没有可用模型依次给出原因', () => {
  const ok = checkGenerationAvailability(asset(), EMPTY_SUMMARY, true);
  assert.deepEqual(ok, { available: true, reason: null });
  assert.match(checkGenerationAvailability(asset({ fileSource: 'upload' }), EMPTY_SUMMARY, true).reason ?? '', /改用生成/);
  assert.match(checkGenerationAvailability(asset({ promptStatus: 'running' }), EMPTY_SUMMARY, true).reason ?? '', /提示词生成中/);
  assert.equal(checkGenerationAvailability(asset({ prompt: '' }), EMPTY_SUMMARY, true).available, true, '没有保存提示词但设定足够时按模板拼');
  assert.match(checkGenerationAvailability(asset({ prompt: '', attributes: {}, composition: '' }), EMPTY_SUMMARY, true).reason ?? '', /补充设定描述/);
  assert.equal(checkGenerationAvailability(asset({ prompt: '手写', attributes: {}, composition: '' }), EMPTY_SUMMARY, true).available, true, '有保存的提示词就能生成');
  assert.match(checkGenerationAvailability(asset(), summary(2, 3, 'running'), true).reason ?? '', /正在生成/);
  assert.equal(checkGenerationAvailability(asset(), summary(2, 3, 'failed'), true).available, true, '失败的版本不阻止再次生成');
  assert.match(checkGenerationAvailability(asset(), EMPTY_SUMMARY, false).reason ?? '', /启用图像模型/);
  assert.match(checkGenerationAvailability(asset({ kind: 'audio' }), EMPTY_SUMMARY, false).reason ?? '', /启用音频模型/);
});

test('资产类型对应的模型类型：音频用音频模型，其余用图像模型', () => {
  assert.deepEqual((['character', 'scene', 'prop', 'effect', 'audio'] as const).map(modelKindOfAsset), ['image', 'image', 'image', 'image', 'audio']);
});

test('使用集数：绑定所在的集加镜头声音指定的集，同一集只算一次；没有使用为 0', () => {
  const binding = (episodeSeq: number, entityName: string) => ({ workName: '作品甲', episodeSeq, episodeTitle: `第${episodeSeq}集`, entityName });
  const sound = (episodeSeq: number, workName = '作品甲') => ({ workName, episodeSeq, episodeTitle: `第${episodeSeq}集`, soundCount: 1 });
  assert.equal(countUsedEpisodes({ bindings: [], soundEpisodes: [] }), 0);
  assert.equal(countUsedEpisodes({ bindings: [binding(1, '林夏'), binding(1, '周远'), binding(2, '林夏')], soundEpisodes: [] }), 2);
  assert.equal(countUsedEpisodes({ bindings: [], soundEpisodes: [sound(3)] }), 1);
  assert.equal(countUsedEpisodes({ bindings: [binding(1, '林夏')], soundEpisodes: [sound(1), sound(2), sound(1, '作品乙')] }), 3);
});

const IMAGE_KEYS = { count: 'runCount', aspectRatio: 'ratio', resolution: 'runResolution' };
const AUDIO_KEYS = { language: 'language', voice: 'runVoice' };

test('图像生成参数：缺省数量为 1，空串的画幅与分辨率表示不指定', () => {
  const errors: Record<string, string> = {};
  assert.deepEqual(readImageRunParams({}, FAKE_ASSET_IMAGE_CAPABILITY, IMAGE_KEYS, errors), { count: 1, aspectRatio: null, resolution: null });
  assert.deepEqual(readImageRunParams({ count: 4, aspectRatio: '16:9', resolution: '2K' }, FAKE_ASSET_IMAGE_CAPABILITY, IMAGE_KEYS, errors), { count: 4, aspectRatio: '16:9', resolution: '2K' });
  assert.deepEqual(readImageRunParams({ aspectRatio: '', resolution: '' }, FAKE_ASSET_IMAGE_CAPABILITY, IMAGE_KEYS, errors), { count: 1, aspectRatio: null, resolution: null });
  assert.deepEqual(errors, {});
});

test('图像生成参数：数量必须是 1 到单次上限的整数，画幅与分辨率必须在模型支持的取值中，错误按传入的键记录', () => {
  const errors: Record<string, string> = {};
  for (const count of [0, 5, 1.5, '2', Number.NaN]) {
    const fresh: Record<string, string> = {};
    readImageRunParams({ count }, FAKE_ASSET_IMAGE_CAPABILITY, IMAGE_KEYS, fresh);
    assert.match(fresh.runCount ?? '', /1 到 4 之间的整数/, String(count));
  }
  readImageRunParams({ aspectRatio: '2:3', resolution: '8K' }, FAKE_ASSET_IMAGE_CAPABILITY, IMAGE_KEYS, errors);
  assert.match(errors.ratio, /不支持画幅 2:3（支持：1:1、16:9）/);
  assert.match(errors.runResolution, /分辨率不在/);

  const noRatios: Record<string, string> = {};
  readImageRunParams({ aspectRatio: '1:1' }, { ...FAKE_ASSET_IMAGE_CAPABILITY, aspectRatios: [] }, IMAGE_KEYS, noRatios);
  assert.match(noRatios.ratio, /不支持指定画幅/);
});

test('音频生成参数：语言与预置音色必须在模型支持的取值中，空串表示不指定', () => {
  const errors: Record<string, string> = {};
  assert.deepEqual(readAudioRunParams({ language: 'zh', voice: '小红' }, FAKE_AUDIO_CAPABILITY, AUDIO_KEYS, errors), { language: 'zh', voice: '小红' });
  assert.deepEqual(readAudioRunParams({ language: '', voice: '' }, FAKE_AUDIO_CAPABILITY, AUDIO_KEYS, errors), { language: null, voice: null });
  assert.deepEqual(errors, {});
  readAudioRunParams({ language: 'fr', voice: '小蓝' }, FAKE_AUDIO_CAPABILITY, AUDIO_KEYS, errors);
  assert.match(errors.language, /语言不在/);
  assert.match(errors.runVoice, /预置音色不在/);
});

test('语言代码：中文、英文有对应代码，其他或未设置没有', () => {
  assert.equal(languageCodeOf('中文'), 'zh');
  assert.equal(languageCodeOf('英文'), 'en');
  assert.equal(languageCodeOf('其他'), undefined);
  assert.equal(languageCodeOf(undefined), undefined);
  assert.equal(languageCodeOf('toString'), undefined);
});