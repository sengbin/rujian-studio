// ------------------------------------------------------------------------
// 名称：asset-prompt-rules.test.ts
// 说明：资产提示词规则的自动化测试：已保存资产转草稿、草稿整理（图像与音频）、模板拼提示词、生效提示词与提示词校验。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：纯函数测试，不依赖数据库。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeneratedOutputError } from '../errors';
import { AssetRecord } from '../models/asset';
import { assetToDraftValues, compileAssetPrompt, describeAssetDraft, parseAssetPrompts, promptFocus, promptKindLabel, readAudioKind, resolveGenerationPrompt } from './asset-prompt-rules';

test('整理草稿：名称在前，空字段不列出，没有风格时不添加画面风格', () => {
  const draft = describeAssetDraft('character', { name: ' 林夏 ', appearance: '短发', clothing: '  ', composition: '半身像' });
  assert.equal(draft.name, '林夏');
  assert.deepEqual(draft.lines, ['角色名称：林夏', '视角与构图：半身像', '角色外观：短发']);
  assert.equal(draft.detailCount, 2);

  const own = describeAssetDraft('prop', { name: '钥匙', style: '水彩', state: '生锈' });
  assert.deepEqual(own.lines, ['道具名称：钥匙', '画面风格：水彩', '当前状态：生锈']);
  assert.equal(own.detailCount, 2);

  const empty = describeAssetDraft('scene', { appearance: 5 });
  assert.deepEqual([empty.name, empty.lines, empty.detailCount], ['', [], 0]);
});

test('整理音频草稿：带音频类型，描述、语言、补充要求计入细节', () => {
  const draft = describeAssetDraft('audio', { name: '守夜人', audioKind: '音色参考', description: '低沉沙哑', language: '中文' });
  assert.deepEqual(draft.lines, ['音频名称：守夜人', '音频类型：音色参考', '描述：低沉沙哑', '语言：中文']);
  assert.equal(draft.detailCount, 2);
  assert.deepEqual(describeAssetDraft('audio', { name: '雨声' }).lines, ['音频名称：雨声', '音频类型：音色参考']);
});

function record(overrides: Partial<AssetRecord>): AssetRecord {
  return {
    id: 1, kind: 'character', name: '林夏', sourceEntityId: null, categoryId: null, attributes: {}, composition: '', style: null,
    background: '', referenceAspectRatio: null, extraRequirements: '', prompt: '', contentRevision: 1, promptRevision: 0,
    promptContentRevision: 0, promptStatus: 'none', promptError: null, adoptedVersionId: null, fileSource: 'generated', createdAt: 't', updatedAt: 't', ...overrides
  };
}

test('已保存的资产转草稿：图像类用表单键，音频用界面文字；类型名称与重点随音频类型变化', () => {
  const character = record({ attributes: { appearance: '短发', clothing: '风衣' }, style: '水彩', extraRequirements: '微笑' });
  assert.deepEqual(assetToDraftValues(character), {
    name: '林夏', extra: '微笑', composition: '', style: '水彩', background: '', referenceAspectRatio: '',
    characterType: '', appearance: '短发', clothing: '风衣', expressionPose: '', voiceDescription: ''
  });
  assert.equal(promptKindLabel(character), '角色');
  assert.match(promptFocus(character), /单个角色/);

  const music = record({ kind: 'audio', attributes: { audio_kind: 'music', description: '紧张', language: '中文' } });
  assert.deepEqual(assetToDraftValues(music), { name: '林夏', extra: '', audioKind: '背景音乐', description: '紧张', language: '中文' });
  assert.equal(promptKindLabel(music), '背景音乐');
  assert.match(promptFocus(music), /背景音乐/);
  assert.throws(() => promptKindLabel(record({ kind: 'audio', attributes: {} })), /audio_kind/);
  assert.throws(() => readAudioKind({ audio_kind: 'toString' }), /audio_kind/);
  assert.equal(readAudioKind({ audio_kind: 'sfx' }), 'sfx');
});

test('模板拼提示词（图像）：名称、描述字段、构图、背景、风格、补充要求、画幅按固定顺序，不含音色描述，末尾固定约束', () => {
  const character = record({
    attributes: { character_type: '人类', appearance: '黑色短发。', clothing: '深色外套', voice_description: '低沉沙哑' },
    composition: '正面全身像',
    background: '纯白背景',
    style: '写实摄影',
    referenceAspectRatio: '2:3',
    extraRequirements: '神情冷静'
  });
  assert.equal(
    compileAssetPrompt(character),
    '角色参考图：林夏；角色类型：人类；角色外观：黑色短发；装束：深色外套；视角与构图：正面全身像；背景：纯白背景；画面风格：写实摄影；补充要求：神情冷静；画幅比例：2:3。画面中不出现文字、标识、水印和边框。'
  );
  assert.equal(compileAssetPrompt(record({ kind: 'prop', name: '钥匙', attributes: { state: '生锈' } })), '道具参考图：钥匙；当前状态：生锈。画面中不出现文字、标识、水印和边框。');
});

test('模板拼提示词：没有名称、没有视觉描述（只有音色描述或画幅）时为空串', () => {
  assert.equal(compileAssetPrompt(record({ name: ' ', attributes: { appearance: '短发' } })), '');
  assert.equal(compileAssetPrompt(record({ attributes: { voice_description: '低沉沙哑' }, referenceAspectRatio: '1:1' })), '');
  assert.equal(compileAssetPrompt(record({})), '');
});

test('模板拼提示词（音频）：描述加补充要求，没有描述时为空串，名称不写入', () => {
  assert.equal(compileAssetPrompt(record({ kind: 'audio', attributes: { audio_kind: 'sfx', description: '细雨敲窗。' }, extraRequirements: '循环' })), '细雨敲窗。循环');
  assert.equal(compileAssetPrompt(record({ kind: 'audio', attributes: { audio_kind: 'sfx', description: '细雨敲窗' } })), '细雨敲窗');
  assert.equal(compileAssetPrompt(record({ kind: 'audio', attributes: { audio_kind: 'sfx' }, extraRequirements: '循环' })), '');
});

test('生效提示词：保存的提示词优先，没有时取模板，两者都没有为空串', () => {
  const base = record({ attributes: { appearance: '短发' } });
  assert.equal(resolveGenerationPrompt({ ...base, prompt: '手写提示词' }), '手写提示词');
  assert.match(resolveGenerationPrompt(base), /^角色参考图：林夏；角色外观：短发。/);
  assert.equal(resolveGenerationPrompt(record({})), '');
});

test('校验提示词：去除首尾空白；缺失、为空、过长时抛出输出错误', () => {
  assert.deepEqual(parseAssetPrompts({ prompt: ' 中文 ' }), { prompt: '中文' });

  const issuesOf = (raw: unknown): readonly string[] => {
    try {
      parseAssetPrompts(raw);
    } catch (error) {
      if (error instanceof GeneratedOutputError) {
        return error.issues;
      }
    }
    return [];
  };
  assert.equal(issuesOf(null).length, 1);
  assert.deepEqual(issuesOf({ prompt: 5 }), ['提示词不能为空。']);
  assert.match(issuesOf({ prompt: 'x'.repeat(2001) })[0], /超过上限 2000 字/);
});
