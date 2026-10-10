// ------------------------------------------------------------------------
// 名称：adaptation-checklist-rules.test.ts
// 说明：结构性改编清单规则的自动化测试：是否需要改编、取舍项校验、勾选后的本地重算、勾选提交校验、确认内容的提示词描述。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：纯函数测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeneratedOutputError, ValidationError } from '../errors';
import { AdaptationChecklist } from '../models/adaptation-checklist';
import {
  computeEstimatedTotal,
  describeConfirmedOptions,
  needsAdaptation,
  normalizeSelection,
  parseAdaptationOptions
} from './adaptation-checklist-rules';

const RAW = {
  options: [
    { kind: 'subplot', label: '配角感情线', reason: '与主线无关', affectedRefs: ['第3章'], estimatedWordsSaved: 200, recommended: true },
    { kind: 'character_merge', label: '合并两位邻居', reason: '功能重复', estimatedWordsSaved: 100.4, recommended: false },
    { kind: 'scene_skip', label: '宴会场', reason: '只做铺垫', estimatedWordsSaved: 300, recommended: true }
  ]
};

/** 构造清单：基线 1000 字、4 字/秒（250 秒），目标 150 秒，容差 15%。 */
function createChecklist(selected: readonly boolean[]): AdaptationChecklist {
  const options = parseAdaptationOptions(RAW, 4).map((option, index) => ({ ...option, selected: selected[index] }));
  return {
    runId: 1,
    baselineWords: 1000,
    baselineSeconds: 250,
    targetSeconds: 150,
    wordsPerSecond: 4,
    toleranceRatio: 0.15,
    options,
    confirmedAt: null,
    updatedAt: 't'
  };
}

test('是否需要改编：只有超出容差上限才需要；容差内或内容不足时跳过', () => {
  assert.equal(needsAdaptation(250, 150, 0.15), true);
  assert.equal(needsAdaptation(172.5, 150, 0.15), false);
  assert.equal(needsAdaptation(172.6, 150, 0.15), true);
  assert.equal(needsAdaptation(60, 150, 0.15), false);
});

test('取舍项：分配标识、换算秒数、初始勾选等于模型建议；空数组合法', () => {
  const options = parseAdaptationOptions(RAW, 4);
  assert.deepEqual(options.map((option) => [option.id, option.kind, option.estimatedWordsSaved, option.estimatedSecondsSaved, option.selected]), [
    ['option-1', 'subplot', 200, 50, true],
    ['option-2', 'character_merge', 100, 25, false],
    ['option-3', 'scene_skip', 300, 75, true]
  ]);
  assert.deepEqual(options[0].affectedRefs, ['第3章']);
  assert.deepEqual(options[1].affectedRefs, []);
  assert.deepEqual(parseAdaptationOptions({ options: [] }, 4), []);
  assert.throws(() => parseAdaptationOptions([], 4), GeneratedOutputError, '直接的数组不接受');
});

test('取舍项：类型、文字、节省字数不合法时逐项报出问题', () => {
  const bad = { options: [{ kind: 'x', label: '', reason: '', estimatedWordsSaved: -1 }] };
  try {
    parseAdaptationOptions(bad, 4);
    assert.fail('应当抛出输出错误');
  } catch (error) {
    assert.ok(error instanceof GeneratedOutputError);
    assert.equal(error.issues.length, 4);
  }
  assert.throws(() => parseAdaptationOptions('x', 4), GeneratedOutputError);
});

test('本地重算：勾选变化立即得到预计总字数与总时长，并判断是否进入容差', () => {
  assert.deepEqual(computeEstimatedTotal(createChecklist([false, false, false])), { estimatedWords: 1000, estimatedSeconds: 250, withinTolerance: false });
  assert.deepEqual(computeEstimatedTotal(createChecklist([true, false, true])), { estimatedWords: 500, estimatedSeconds: 125, withinTolerance: false });
  assert.deepEqual(computeEstimatedTotal(createChecklist([true, true, true])), { estimatedWords: 400, estimatedSeconds: 100, withinTolerance: false });
  // 只勾选前两项：700 字、175 秒，仍超出 172.5 秒的容差上限。
  assert.equal(computeEstimatedTotal(createChecklist([true, true, false])).withinTolerance, false);
  // 目标改为 125 秒后，勾选第 1、3 项恰好落在目标上。
  const checklist = { ...createChecklist([true, false, true]), targetSeconds: 125 };
  assert.equal(computeEstimatedTotal(checklist).withinTolerance, true);
});

test('勾选提交：必须是清单内存在的标识数组', () => {
  const checklist = createChecklist([false, false, false]);
  assert.deepEqual([...normalizeSelection({ selected: ['option-1', 'option-3'] }, checklist)], ['option-1', 'option-3']);
  assert.deepEqual([...normalizeSelection({ selected: [] }, checklist)], []);
  assert.throws(() => normalizeSelection({ selected: ['option-9'] }, checklist), ValidationError);
  assert.throws(() => normalizeSelection({ selected: 'option-1' }, checklist), ValidationError);
});

test('确认内容描述：只列被勾选的取舍项；没有清单或没有勾选时为空', () => {
  assert.equal(describeConfirmedOptions(undefined), '');
  assert.equal(describeConfirmedOptions(createChecklist([false, false, false])), '');
  assert.equal(describeConfirmedOptions(createChecklist([true, false, true])), '- 支线：配角感情线（与主线无关）\n- 场次跳过：宴会场（只做铺垫）');
});
