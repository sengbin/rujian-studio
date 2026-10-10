// ------------------------------------------------------------------------
// 名称：beat-sheet-rules.test.ts
// 说明：节拍表规则的自动化测试：预算分配（总和精确）、分镜默认参数、生成参数校验、模型节拍内容校验、编辑校验，以及制作方案注册表。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：纯函数测试，不依赖存储。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeneratedOutputError, ValidationError } from '../errors';
import { BeatSheetParams } from '../models/beat-sheet';
import {
  allocateBeatBudget,
  composeBeats,
  estimateShotDefaults,
  normalizeBeatEdit,
  normalizeBeatSheetParams,
  parseBeatSheet,
  TARGET_DURATION_MAX_SECONDS,
  TARGET_DURATION_MIN_SECONDS
} from './beat-sheet-rules';
import { BEAT_TEMPLATES, getBeatTemplate, getProductionProfile, listBeatTemplates, listSupportedFormats } from './production-profile-rules';

const SHORT_VIDEO = getBeatTemplate('short_video_single_hook');

/** 捕获校验错误的字段错误记录。 */
function fieldErrorsOf(action: () => unknown): Readonly<Record<string, string>> {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationError) {
      return error.fieldErrors;
    }
    throw error;
  }
  assert.fail('应当抛出校验错误');
}

/** 捕获模型输出错误的问题列表。 */
function issuesOf(action: () => unknown): readonly string[] {
  try {
    action();
  } catch (error) {
    if (error instanceof GeneratedOutputError) {
      return error.issues;
    }
    throw error;
  }
  assert.fail('应当抛出输出错误');
}

test('注册表：每个模板的节拍比例之和为 1、序号从 1 连续；占位体量没有模板且不可选', () => {
  for (const template of BEAT_TEMPLATES) {
    const sum = template.items.reduce((total, item) => total + item.targetRatio, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${template.id} 比例之和为 ${sum}`);
    assert.deepEqual(template.items.map((item) => item.seq), template.items.map((_, index) => index + 1));
  }
  assert.deepEqual(listSupportedFormats().map((profile) => profile.formatType), ['short_video', 'short_drama']);
  assert.equal(getProductionProfile('series').beatTemplateId, null);
  assert.equal(getProductionProfile('feature_film').supported, false);
  assert.deepEqual(listSupportedFormats().map((profile) => profile.multiEpisode), [false, true]);
});

test('注册表：模板标识与名称不重复，默认时长在推荐范围内，每个已实现的形态都有模板且第一个是默认模板', () => {
  assert.equal(new Set(BEAT_TEMPLATES.map((template) => template.id)).size, BEAT_TEMPLATES.length);
  assert.equal(new Set(BEAT_TEMPLATES.map((template) => template.label)).size, BEAT_TEMPLATES.length);
  for (const template of BEAT_TEMPLATES) {
    assert.ok(template.minSeconds <= template.defaultSeconds && template.defaultSeconds <= template.maxSeconds, `${template.id} 默认时长不在范围内`);
    assert.ok(template.minSeconds >= TARGET_DURATION_MIN_SECONDS && template.maxSeconds <= TARGET_DURATION_MAX_SECONDS, `${template.id} 超出目标时长范围`);
    assert.ok(template.summary.trim() !== '' && template.items.length >= 3, `${template.id} 缺少说明或节拍太少`);
  }
  for (const profile of listSupportedFormats()) {
    assert.equal(listBeatTemplates(profile.formatType)[0].id, profile.beatTemplateId);
  }
});

test('预算分配：设计文档示例（30 秒、4 字/秒）精确得到 4.5/13.5/7.5/4.5 秒与 18/54/30/18 字', () => {
  const budgets = allocateBeatBudget(30, 4, SHORT_VIDEO.items);
  assert.deepEqual(budgets.map((budget) => budget.estimatedSeconds), [4.5, 13.5, 7.5, 4.5]);
  assert.deepEqual(budgets.map((budget) => budget.estimatedWords), [18, 54, 30, 18]);
});

test('预算分配：任意目标时长下各拍时长与字数之和都精确等于总预算，没有累计误差', () => {
  for (const template of BEAT_TEMPLATES) {
    for (let seconds = 5; seconds <= 600; seconds += 1) {
      for (const wordsPerSecond of [3, 4, 4.5, 7]) {
        const budgets = allocateBeatBudget(seconds, wordsPerSecond, template.items);
        const totalSeconds = Math.round(budgets.reduce((sum, budget) => sum + budget.estimatedSeconds, 0) * 10);
        const totalWords = budgets.reduce((sum, budget) => sum + budget.estimatedWords, 0);
        assert.equal(totalSeconds, seconds * 10, `${template.id} ${seconds} 秒`);
        assert.equal(totalWords, Math.round(seconds * wordsPerSecond), `${template.id} ${seconds} 秒 ${wordsPerSecond} 字/秒`);
      }
    }
  }
});

test('分镜默认参数：单镜头时长与镜头数按建议单镜头时长推导', () => {
  assert.deepEqual(estimateShotDefaults(30, 5), { minShotSeconds: 3, maxShotSeconds: 6, maxShots: 6 });
  assert.deepEqual(estimateShotDefaults(60, 3), { minShotSeconds: 2, maxShotSeconds: 4, maxShots: 20 });
  assert.equal(estimateShotDefaults(2, 5).maxShots, 1);
});

test('生成参数：短视频集数固定为 1，缺省语速、容差与重写轮数取制作方案默认值，模板可用标识或名称', () => {
  const byId = normalizeBeatSheetParams({ beatTemplateId: 'short_video_single_hook', targetDurationSeconds: '30', episodeCount: 9, extra: ' 悬疑 ' }, 'short_video');
  assert.deepEqual(byId, {
    formatType: 'short_video',
    beatTemplateId: 'short_video_single_hook',
    targetDurationSeconds: 30,
    episodeCount: 1,
    wordsPerSecond: 4,
    toleranceRatio: 0.15,
    maxCalibrationRounds: 2,
    idea: null,
    extra: '悬疑'
  });
  const byLabel = normalizeBeatSheetParams({ beatTemplateId: SHORT_VIDEO.label, targetDurationSeconds: 30, wordsPerSecond: '3.5' }, 'short_video');
  assert.equal(byLabel.beatTemplateId, SHORT_VIDEO.id);
  assert.equal(byLabel.wordsPerSecond, 3.5);
  assert.equal(normalizeBeatSheetParams({ targetDurationSeconds: 90, episodeCount: 12 }, 'short_drama').episodeCount, 12);
});

test('生成参数：时长、集数、语速越界或模板与体量不匹配时报字段错误；占位体量不能生成', () => {
  assert.ok(fieldErrorsOf(() => normalizeBeatSheetParams({ targetDurationSeconds: 1 }, 'short_video')).targetDurationSeconds);
  assert.ok(fieldErrorsOf(() => normalizeBeatSheetParams({ targetDurationSeconds: 90 }, 'short_drama')).episodeCount);
  assert.ok(fieldErrorsOf(() => normalizeBeatSheetParams({ targetDurationSeconds: 30, wordsPerSecond: 99 }, 'short_video')).wordsPerSecond);
  assert.ok(fieldErrorsOf(() => normalizeBeatSheetParams({ targetDurationSeconds: 30, beatTemplateId: 'short_drama_episode' }, 'short_video')).beatTemplateId);
  assert.ok(fieldErrorsOf(() => normalizeBeatSheetParams({ targetDurationSeconds: 30 }, 'series')).beatTemplateId);
});

test('节拍内容：数量与顺序必须和模板一致，不能增减；小说来源的依据序号必须在分段范围内', () => {
  const beats = [1, 2, 3, 4].map((seq) => ({ seq, synopsis: ` 第${seq}拍 `, sourceRefs: [2, 1, 2] }));
  assert.deepEqual(parseBeatSheet({ beats }, 4, 3).map((item) => [item.seq, item.synopsis, item.sourceRefs]), [
    [1, '第1拍', [1, 2]],
    [2, '第2拍', [1, 2]],
    [3, '第3拍', [1, 2]],
    [4, '第4拍', [1, 2]]
  ]);
  assert.deepEqual(parseBeatSheet({ beats }, 4, 0)[0].sourceRefs, [], '非小说素材忽略依据序号');
  assert.equal(issuesOf(() => parseBeatSheet(beats, 4, 0)).length, 1, '直接的数组不接受');

  assert.ok(issuesOf(() => parseBeatSheet({ beats: beats.slice(0, 3) }, 4))[0].includes('恰好给出 4 个'));
  assert.ok(issuesOf(() => parseBeatSheet({ beats: [...beats, beats[0]] }, 4)).length > 0);
  assert.ok(issuesOf(() => parseBeatSheet({ beats: [beats[1], beats[0], beats[2], beats[3]] }, 4)).some((issue) => issue.includes('顺序')));
  assert.ok(issuesOf(() => parseBeatSheet({ beats: beats.map((item) => ({ ...item, synopsis: '' })) }, 4)).length === 4);
  assert.ok(issuesOf(() => parseBeatSheet({ beats: beats.map((item) => ({ ...item, sourceRefs: [9] })) }, 4, 3)).length === 4);
  assert.equal(issuesOf(() => parseBeatSheet('x', 4)).length, 1);
});

test('合成节拍：参考预算由程序计算，剧情内容取自模型', () => {
  const params: BeatSheetParams = normalizeBeatSheetParams({ targetDurationSeconds: 30 }, 'short_video');
  const assignments = [1, 2, 3, 4].map((seq) => ({ seq, synopsis: `剧情${seq}`, sourceRefs: [] }));
  const composed = composeBeats(SHORT_VIDEO, params, assignments);
  assert.deepEqual(composed.map((beat) => [beat.label, beat.estimatedSeconds, beat.estimatedWords, beat.synopsis]), [
    ['钩子', 4.5, 18, '剧情1'],
    ['展开', 13.5, 54, '剧情2'],
    ['转折', 7.5, 30, '剧情3'],
    ['收尾', 4.5, 18, '剧情4']
  ]);
});

test('编辑节拍：只校验序号与剧情内容', () => {
  assert.deepEqual(normalizeBeatEdit({ seq: '2', synopsis: ' 新的剧情 ' }), { seq: 2, synopsis: '新的剧情' });
  assert.ok(fieldErrorsOf(() => normalizeBeatEdit({ seq: 1, synopsis: '' })).synopsis);
  assert.ok(fieldErrorsOf(() => normalizeBeatEdit({ seq: 0, synopsis: 'x' })).seq);
});
