// ------------------------------------------------------------------------
// 名称：segment-rules.test.ts
// 说明：结构标注规则的自动化测试：校验模型按序号返回的标注、说话人对到已知角色、合并用户修改的标注。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：纯函数测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeneratedOutputError, ValidationError } from '../errors';
import { TextSegment } from '../models/screenplay';
import { KnownCharacter, applySegmentLabelEdits, parseSegmentLabels } from './segment-rules';

const CHARACTERS: KnownCharacter[] = [{ name: '守夜人', aliases: ['老陈'] }];
const PIECES = ['雨下了。\n', '“走吧。”', '老陈说。'];

/** 捕获模型输出错误的问题列表。 */
function captureIssues(action: () => unknown): readonly string[] {
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

test('标注：文字取自程序切分的片段，说话人别名对到角色正式名称，旁白不带说话人', () => {
  const segments = parseSegmentLabels(
    {
      labels: [
        { index: 1, kind: 'narration', speaker: '老陈' },
        { index: 2, kind: 'dialogue', speaker: '老陈' },
        { index: 3, kind: 'narration', uncertain: true }
      ]
    },
    PIECES,
    CHARACTERS
  );
  assert.deepEqual(segments, [
    { text: '雨下了。\n', kind: 'narration', speaker: null, uncertain: false },
    { text: '“走吧。”', kind: 'dialogue', speaker: '守夜人', uncertain: false },
    { text: '老陈说。', kind: 'narration', speaker: null, uncertain: true }
  ]);
});

test('标注：说话人不在角色清单或没填时置为未知并标记待核对，不凭空创造人名', () => {
  const [, dialogue, thought] = parseSegmentLabels(
    {
      labels: [
        { index: 1, kind: 'narration' },
        { index: 2, kind: 'dialogue', speaker: '路人甲' },
        { index: 3, kind: 'thought' }
      ]
    },
    PIECES,
    CHARACTERS
  );
  assert.deepEqual([dialogue.speaker, dialogue.uncertain], [null, true]);
  assert.deepEqual([thought.speaker, thought.uncertain], [null, true]);
});

test('标注：数量、序号、类型不对时逐条说明问题', () => {
  assert.match(captureIssues(() => parseSegmentLabels('x', PIECES, CHARACTERS))[0], /labels 数组/);
  assert.match(captureIssues(() => parseSegmentLabels({ labels: [] }, PIECES, CHARACTERS))[0], /必须与片段数量 3 一致/);
  const issues = captureIssues(() =>
    parseSegmentLabels({ labels: [{ index: 1, kind: 'narration' }, { index: 5, kind: 'narration' }, { index: 3, kind: '旁白' }] }, PIECES, CHARACTERS)
  );
  assert.ok(issues.some((issue) => issue.includes('第 2 项的 index 必须是 2')));
  assert.ok(issues.some((issue) => issue.includes('第 3 项的 kind')));
});

test('标注：问题过多时只列出前几条并说明总数', () => {
  const pieces = Array.from({ length: 30 }, (_, index) => `片段${index}`);
  const issues = captureIssues(() => parseSegmentLabels({ labels: [] }, pieces, CHARACTERS));
  assert.ok(issues.length <= 11);
  assert.match(issues[issues.length - 1], /另有 \d+ 项问题/);
});

const CURRENT: TextSegment[] = [
  { text: '雨下了。\n', kind: 'narration', speaker: null, uncertain: false },
  { text: '“走吧。”', kind: 'dialogue', speaker: null, uncertain: true },
  { text: '老陈说。', kind: 'narration', speaker: null, uncertain: true }
];

test('修改标注：没有提交标注时返回 null；提交后片段原文不变，被改动的片段不再待核对', () => {
  assert.equal(applySegmentLabelEdits({ title: '甲' }, CURRENT), null);
  const edited = applySegmentLabelEdits(
    {
      segments: [
        { kind: 'narration', speaker: '' },
        { kind: 'dialogue', speaker: ' 守夜人 ' },
        { kind: 'narration', speaker: '守夜人' }
      ]
    },
    CURRENT
  );
  assert.deepEqual(edited, [
    { text: '雨下了。\n', kind: 'narration', speaker: null, uncertain: false },
    { text: '“走吧。”', kind: 'dialogue', speaker: '守夜人', uncertain: false },
    { text: '老陈说。', kind: 'narration', speaker: null, uncertain: true }
  ]);
});

test('修改标注：数量不一致、类型不合法时拒绝', () => {
  assert.throws(() => applySegmentLabelEdits({ segments: [{ kind: 'narration' }] }, CURRENT), ValidationError);
  assert.throws(
    () => applySegmentLabelEdits({ segments: [{ kind: 'narration' }, { kind: '对白' }, { kind: 'narration' }] }, CURRENT),
    /类型不合法/
  );
  assert.throws(
    () => applySegmentLabelEdits({ segments: [{ kind: 'narration' }, { kind: 'dialogue', speaker: '长'.repeat(51) }, { kind: 'narration' }] }, CURRENT),
    /不能超过/
  );
});
