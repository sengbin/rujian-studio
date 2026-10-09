// ------------------------------------------------------------------------
// 名称：screenplay-verbatim-rules.test.ts
// 说明：原稿保真模式抽取校验的自动化测试：多集按段落序号截取原文、序号必须连续覆盖全文，单个短视频整篇作为一集。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：纯函数测试，不依赖存储与 VS Code。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeneratedOutputError } from '../errors';
import { ScreenplayContext, parseVerbatimStructure } from './screenplay-rules';
import { splitParagraphs } from './text-segmenter';

const PARAMS = { maxEpisodeDurationSeconds: 60, maxEpisodes: 3, extra: null };
const SERIES: ScreenplayContext = { formatType: 'short_drama', workName: '作品甲', params: PARAMS };
const SINGLE: ScreenplayContext = { formatType: 'short_video', workName: '作品甲', params: { ...PARAMS, maxEpisodes: 1 } };
const TEXT = '第一段。\n第二段。\n\n第三段。';
const PARAGRAPHS = splitParagraphs(TEXT);
const ENTITIES = [{ kind: 'character', name: '守夜人', description: '守灯塔' }];

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

test('多集：集正文由程序按段落序号从原文截取，与原稿逐字一致', () => {
  const structure = parseVerbatimStructure(
    {
      episodes: [
        { title: '第一集', synopsis: '开端', startParagraph: 1, endParagraph: 2, targetDurationSeconds: 30, screenplayText: '模型擅自改写的文字' },
        { title: '第二集', synopsis: '结局', startParagraph: 3, endParagraph: 3 }
      ],
      entities: ENTITIES
    },
    SERIES,
    PARAGRAPHS
  );
  assert.deepEqual(
    structure.episodes.map((episode) => [episode.seq, episode.title, episode.screenplayText]),
    [
      [1, '第一集', '第一段。\n第二段。'],
      [2, '第二集', '第三段。']
    ]
  );
  assert.equal(structure.episodes[0].targetDurationSeconds, 30);
  assert.equal(structure.entities.length, 1);
});

test('多集：序号必须从 1 开始、连续、不重叠，并覆盖到最后一段', () => {
  const run = (episodes: unknown[]) => captureIssues(() => parseVerbatimStructure({ episodes, entities: [] }, SERIES, PARAGRAPHS));
  const episode = (start: number, end: number) => ({ title: '集', synopsis: '梗概', startParagraph: start, endParagraph: end });

  assert.match(run([episode(2, 3)])[0], /第 1 集必须从第 1 段开始/);
  assert.match(run([episode(1, 1), episode(3, 3)])[0], /第 2 集必须从第 2 段开始/);
  assert.match(run([episode(1, 2)])[0], /最后一集必须结束在第 3 段，现在只覆盖到第 2 段/);
  assert.match(run([episode(1, 9)])[0], /endParagraph 必须在 1 到 3 之间/);
  assert.match(run([{ title: '集', synopsis: '梗概' }])[0], /必须是整数/);
});

test('单个短视频：整篇作为一集，不需要段落序号', () => {
  const structure = parseVerbatimStructure({ episodes: [{ synopsis: '守夜人的雨夜' }], entities: [] }, SINGLE, PARAGRAPHS);
  assert.deepEqual(
    structure.episodes.map((episode) => [episode.title, episode.screenplayText]),
    [['作品甲', TEXT]]
  );
});

test('格式不对时交给通用抽取校验报错', () => {
  assert.match(captureIssues(() => parseVerbatimStructure('x', SERIES, PARAGRAPHS))[0], /episodes 数组/);
});
