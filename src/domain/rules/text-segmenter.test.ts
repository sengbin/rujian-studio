// ------------------------------------------------------------------------
// 名称：text-segmenter.test.ts
// 说明：原稿文字切分与呈现的自动化测试：段落与片段按顺序拼接等于原文，引号内外分开，编号与说话人标记的呈现。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：纯函数测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderAnnotatedText, renderNumbered, splitParagraphs, splitSegments } from './text-segmenter';

const SAMPLE = '夜里下起了雨。\n“今晚会下雨。”老陈说。\n\n\n灯塔亮了，他想：「快到了。」\n';

test('段落：一个非空行加上后面的空行；拼接等于原文；开头的空行并入第一个段落', () => {
  assert.deepEqual(splitParagraphs('甲\n乙\n\n\n丙'), ['甲\n', '乙\n\n\n', '丙']);
  assert.deepEqual(splitParagraphs('\n\n甲\n乙'), ['\n\n甲\n', '乙']);
  assert.equal(splitParagraphs(SAMPLE).join(''), SAMPLE);
  assert.deepEqual(splitParagraphs(''), []);
});

test('片段：引号内外分开，各种引号都识别，拼接等于原文', () => {
  const segments = splitSegments(SAMPLE);
  assert.equal(segments.join(''), SAMPLE);
  assert.deepEqual(segments, ['夜里下起了雨。\n', '“今晚会下雨。”', '老陈说。\n\n\n', '灯塔亮了，他想：', '「快到了。」\n']);
});

test('片段：直引号、未闭合的引号和只有空白的片段都不丢字', () => {
  assert.deepEqual(splitSegments('他说："好。"然后走了'), ['他说：', '"好。"', '然后走了']);
  assert.deepEqual(splitSegments('他说：“没说完\n下一段'), ['他说：', '“没说完\n', '下一段']);
  for (const text of ['  “甲”  “乙”', '“甲”\n\n  \n“乙”\n', '没有引号的一整段']) {
    const segments = splitSegments(text);
    assert.equal(segments.join(''), text);
    assert.ok(segments.every((segment) => segment.trim().length > 0), `每个片段都有可见文字：${JSON.stringify(segments)}`);
  }
});

test('编号：序号从 1 开始，片段末尾的空白不显示', () => {
  assert.equal(renderNumbered(['甲\n', '乙\n\n']), '[1] 甲\n[2] 乙');
});

test('带说话人标记的正文：对白、心声加标记，旁白保持原样，说话人未知时说明未知', () => {
  const text = renderAnnotatedText([
    { text: '雨下了。', kind: 'narration', speaker: null, uncertain: false },
    { text: '“走吧。”', kind: 'dialogue', speaker: '老陈', uncertain: false },
    { text: '「冷。」', kind: 'thought', speaker: '小周', uncertain: false },
    { text: '“谁？”', kind: 'dialogue', speaker: null, uncertain: true },
    { text: '「怎么办。」', kind: 'thought', speaker: null, uncertain: true }
  ]);
  assert.equal(text, '雨下了。〔老陈说〕“走吧。”〔小周心想〕「冷。」〔说话人未知〕“谁？”〔心声，说话人未知〕「怎么办。」');
});
