// ------------------------------------------------------------------------
// 名称：original-manuscript.test.ts
// 说明：原创文稿全流程的自动化测试：原稿导入为已确认的章节、剧本正文取自原稿且不调用模型改写、按段落序号划分集、结构标注、标注的编辑与清除、失败后继续、重新标注、分镜使用带说话人标记的正文。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：使用内存数据库、真实的执行器与工作流，以及脚本化的假文本生成端口。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationError } from '../../domain/errors';
import { normalizeWorkCreation } from '../../domain/rules/work-rules';
import { Responder, standardResponder } from '../stages/testing/scripted-text';
import { createServiceFixture } from './testing/service-fixture';

const TEXT = '夜里下起了雨。\n“今晚会下雨。”老陈说。\n灯塔亮了。';
const SCREENPLAY_PARAMS = { maxEpisodeDurationSeconds: '60', maxEpisodes: '3' };
const EXTRACT_TITLE = '# 任务：从原稿中划分集并抽取实体';
const ANNOTATE_TITLE = '# 任务：标注片段的类型和说话人';
const REWRITE_TITLE = '# 任务：撰写剧本包';

/** 按提示词里的编号片段给出标注：以引号开头的是老陈说的对白，其余是旁白。 */
function labelPieces(user: string): unknown {
  const pieces = [...user.matchAll(/^\[(\d+)\] (.*)$/gm)];
  return {
    labels: pieces.map((piece) =>
      piece[2].startsWith('“') ? { index: Number(piece[1]), kind: 'dialogue', speaker: '老陈' } : { index: Number(piece[1]), kind: 'narration' }
    )
  };
}

/** 原创文稿的响应：多集分成前两段与最后一段；标注和集的划分可以被覆盖。 */
function createResponder(overrides: { episodes?: unknown[]; labels?: (user: string) => unknown } = {}): Responder {
  return (request) => {
    if (request.user.includes(EXTRACT_TITLE)) {
      const series = JSON.stringify(request.tool.inputSchema).includes('"startParagraph"');
      return {
        episodes:
          overrides.episodes ??
          (series
            ? [
                { title: '第一集', synopsis: '开端', startParagraph: 1, endParagraph: 2, targetDurationSeconds: 30 },
                { title: '第二集', synopsis: '结局', startParagraph: 3, endParagraph: 3 }
              ]
            : [{ synopsis: '守夜人的雨夜', targetDurationSeconds: 30 }]),
        entities: [
          { kind: 'character', name: '守夜人', aliases: ['老陈'], description: '灯塔守夜人' },
          { kind: 'scene', name: '灯塔', description: '海边灯塔' }
        ]
      };
    }
    if (request.user.includes(ANNOTATE_TITLE)) {
      return (overrides.labels ?? labelPieces)(request.user);
    }
    return standardResponder(request);
  };
}

/** 创建夹具与原创文稿作品，并导入原稿。 */
function createFixture(kind: '单个短视频' | '多集短片', responder: Responder = createResponder()) {
  const fixture = createServiceFixture(responder);
  const work = fixture.works.createWork(
    fixture.project.id,
    normalizeWorkCreation({ workName: '作品甲', kind, manuscriptText: TEXT }, 'original')
  );
  const creative = fixture.stages.importOriginal(work.id);
  return { ...fixture, work, creative };
}

/** 开始生成剧本并等待结束。 */
async function generate(fixture: ReturnType<typeof createFixture>) {
  const run = await fixture.screenplays.start(fixture.work.id, SCREENPLAY_PARAMS);
  await fixture.runner.whenIdle();
  return run;
}

/** 某类提示词被请求的次数。 */
function countRequests(fixture: ReturnType<typeof createFixture>, title: string): number {
  return fixture.text.requests.filter((request) => request.user.includes(title)).length;
}

test('导入：原稿分段写成已确认的创意章节，文字原样保留，不调用模型，不能再生成创意', async () => {
  const fixture = createFixture('单个短视频');
  try {
    assert.deepEqual([fixture.creative.status, fixture.creative.reviewStatus, fixture.creative.isCurrent], ['succeeded', 'approved', true]);
    assert.deepEqual(fixture.creative.input, { sourceType: 'original' });
    const view = fixture.stages.getCreativeView(fixture.work.id);
    assert.deepEqual(view.chapters.map((chapter) => [chapter.seq, chapter.title, chapter.content]), [[1, '第 1 段', TEXT]]);
    assert.equal(view.params, null);
    assert.equal(view.actions.canApprove, false);
    assert.equal(fixture.works.listWorks(fixture.project.id)[0].canStartScreenplay, true);
    assert.equal(fixture.text.requests.length, 0);

    await assert.rejects(fixture.stages.startCreative(fixture.work.id, {}), /原创文稿不生成创意/);
    const other = fixture.works.createWork(fixture.project.id, normalizeWorkCreation({ workName: '作品乙', kind: '单个短视频' }, 'text'));
    assert.throws(() => fixture.stages.importOriginal(other.id), ValidationError);
  } finally {
    fixture.database.close();
  }
});

test('导入：原稿分段数超过章节上限时拒绝并说明原因', () => {
  const fixture = createServiceFixture();
  try {
    const long = Array.from({ length: 101 }, (_, index) => `第${index + 1}章\n${'字'.repeat(600)}`).join('\n');
    const work = fixture.works.createWork(fixture.project.id, normalizeWorkCreation({ workName: '长篇', kind: '多集短片', manuscriptText: long }, 'original'));
    assert.throws(() => fixture.stages.importOriginal(work.id), /超过上限 100 段/);
    assert.equal(fixture.runs.listVersions({ workId: work.id, stage: 'creative', episodeId: null }).length, 0);
  } finally {
    fixture.database.close();
  }
});

test('单个短视频：剧本正文就是原稿，不让模型改写；整篇作为一集，并按引号切片段标注，说话人对到角色正式名称', async () => {
  const fixture = createFixture('单个短视频');
  try {
    await generate(fixture);
    const view = fixture.screenplays.getView(fixture.work.id);
    assert.equal(view.run.display, 'pending');
    assert.equal(view.fidelity, 'verbatim');
    assert.equal(view.screenplay?.fullText, TEXT);
    assert.equal(view.screenplay?.title, '作品甲');
    assert.equal(countRequests(fixture, REWRITE_TITLE), 0, '正文不经过模型改写');
    assert.equal(countRequests(fixture, EXTRACT_TITLE), 1);
    assert.equal(countRequests(fixture, ANNOTATE_TITLE), 1);

    const [episode] = view.episodes;
    assert.equal(episode.screenplayText, TEXT);
    const segments = episode.segments ?? [];
    assert.equal(segments.map((segment) => segment.text).join(''), TEXT, '片段拼接等于原文');
    assert.deepEqual(
      segments.map((segment) => [segment.kind, segment.speaker, segment.uncertain]),
      [
        ['narration', null, false],
        ['dialogue', '守夜人', false],
        ['narration', null, false],
        ['narration', null, false]
      ]
    );
    assert.equal(view.actions.canReannotate, true);
  } finally {
    fixture.database.close();
  }
});

test('多集：集的正文由段落序号从原稿截取；确认后集和标注合并到作品；合并后改标注保留原文，改正文清除标注', async () => {
  const fixture = createFixture('多集短片');
  try {
    const run = await generate(fixture);
    const before = fixture.screenplays.getView(fixture.work.id);
    assert.deepEqual(
      before.episodes.map((episode) => [episode.title, episode.screenplayText]),
      [
        ['第一集', '夜里下起了雨。\n“今晚会下雨。”老陈说。'],
        ['第二集', '灯塔亮了。']
      ]
    );
    assert.equal(countRequests(fixture, ANNOTATE_TITLE), 2, '每集标注一次');

    fixture.stages.approve(run.id);
    const rows = fixture.database.prepare('SELECT seq, segments_json AS segments FROM episodes WHERE work_id = ? ORDER BY seq').all(fixture.work.id);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => typeof row.segments === 'string'), '标注随集合并到作品');

    const merged = fixture.screenplays.getView(fixture.work.id);
    const first = merged.episodes[0];
    const edit = { ref: first.ref, title: first.title, synopsis: first.synopsis, screenplayText: first.screenplayText, targetDurationSeconds: '' };
    assert.equal(first.segments?.length, 3);

    // 只改标注：把最后一个片段改成对白，片段原文不变，被改动的片段不再待核对。
    fixture.screenplays.saveEpisode(run.id, {
      ...edit,
      segments: [
        { kind: 'narration', speaker: '' },
        { kind: 'dialogue', speaker: '守夜人' },
        { kind: 'dialogue', speaker: '守夜人' }
      ]
    });
    const relabeled = fixture.screenplays.getView(fixture.work.id).episodes[0];
    assert.deepEqual(
      relabeled.segments?.map((segment) => [segment.text, segment.kind, segment.speaker]),
      [
        ['夜里下起了雨。\n', 'narration', null],
        ['“今晚会下雨。”', 'dialogue', '守夜人'],
        ['老陈说。', 'dialogue', '守夜人']
      ]
    );
    assert.equal(fixture.screenplays.getView(fixture.work.id).run.display, 'pending', '编辑后回到待确认');

    // 标注数量与正文不一致时拒绝。
    assert.throws(() => fixture.screenplays.saveEpisode(run.id, { ...edit, segments: [{ kind: 'narration' }] }), ValidationError);

    // 改了正文：标注失效并清除。
    fixture.screenplays.saveEpisode(run.id, { ...edit, screenplayText: '夜里下起了大雨。', segments: [{ kind: 'narration' }] });
    const cleared = fixture.screenplays.getView(fixture.work.id).episodes[0];
    assert.equal(cleared.screenplayText, '夜里下起了大雨。');
    assert.equal(cleared.segments, undefined);
    assert.equal(fixture.database.prepare('SELECT segments_json AS segments FROM episodes WHERE id = ?').get(first.ref)?.segments, null);
  } finally {
    fixture.database.close();
  }
});

test('合并前的编辑：改标注写入抽取结果，改正文清除该集的标注，其他集不受影响', async () => {
  const fixture = createFixture('多集短片');
  try {
    const run = await generate(fixture);
    const [first, second] = fixture.screenplays.getView(fixture.work.id).episodes;
    fixture.screenplays.saveEpisode(run.id, {
      ref: first.ref,
      title: first.title,
      synopsis: first.synopsis,
      screenplayText: first.screenplayText,
      targetDurationSeconds: '',
      segments: [
        { kind: 'narration' },
        { kind: 'thought', speaker: '守夜人' },
        { kind: 'narration' }
      ]
    });
    assert.equal(fixture.screenplays.getView(fixture.work.id).episodes[0].segments?.[1].kind, 'thought');

    fixture.screenplays.saveEpisode(run.id, {
      ref: second.ref,
      title: second.title,
      synopsis: second.synopsis,
      screenplayText: '灯塔熄灭了。',
      targetDurationSeconds: ''
    });
    const after = fixture.screenplays.getView(fixture.work.id).episodes;
    assert.equal(after[1].segments, undefined);
    assert.equal(after[0].segments?.length, 3);
  } finally {
    fixture.database.close();
  }
});

test('失败：集的段落序号不连续时报错且不保存；标注失败后重试只重做没有标注的集', async () => {
  const overlapped = createFixture('多集短片', createResponder({ episodes: [{ title: '第一集', synopsis: '开端', startParagraph: 1, endParagraph: 1 }, { title: '第二集', synopsis: '结局', startParagraph: 3, endParagraph: 3 }] }));
  try {
    await generate(overlapped);
    const view = overlapped.screenplays.getView(overlapped.work.id);
    assert.equal(view.run.display, 'failed');
    assert.match(view.run.errorMessage ?? '', /第 2 集必须从第 2 段开始/);
    assert.equal(view.episodes.length, 0);
  } finally {
    overlapped.database.close();
  }

  let breakSecondEpisode = true;
  const fixture = createFixture(
    '多集短片',
    createResponder({
      labels: (user) => {
        // 第二集只有一个片段；故意少给一项，直到允许为止。
        if (user.includes('第 2 集') && breakSecondEpisode) {
          return { labels: [] };
        }
        return labelPieces(user);
      }
    })
  );
  try {
    const run = await generate(fixture);
    const failed = fixture.screenplays.getView(fixture.work.id);
    assert.equal(failed.run.display, 'failed');
    assert.match(failed.run.errorMessage ?? '', /labels 有 0 项/);
    assert.deepEqual(failed.episodes.map((episode) => episode.segments !== undefined), [true, false], '第一集的标注已保留');

    breakSecondEpisode = false;
    const extractBefore = countRequests(fixture, EXTRACT_TITLE);
    await fixture.stages.retry(run.id);
    await fixture.runner.whenIdle();
    const view = fixture.screenplays.getView(fixture.work.id);
    assert.equal(view.run.display, 'pending');
    assert.ok(view.episodes.every((episode) => episode.segments !== undefined));
    assert.equal(countRequests(fixture, EXTRACT_TITLE), extractBefore, '重试不重新抽取');
  } finally {
    fixture.database.close();
  }
});

test('重新标注：保留已抽取的集，重做所有集的标注；合并后、非原创文稿不能重新标注', async () => {
  const fixture = createFixture('多集短片');
  try {
    const run = await generate(fixture);
    await fixture.screenplays.reannotate(run.id);
    await fixture.runner.whenIdle();
    const view = fixture.screenplays.getView(fixture.work.id);
    assert.equal(view.run.display, 'pending');
    assert.equal(countRequests(fixture, EXTRACT_TITLE), 1, '不重新抽取');
    assert.equal(countRequests(fixture, ANNOTATE_TITLE), 4, '两集各重新标注一次');
    assert.ok(view.episodes.every((episode) => episode.segments !== undefined));

    fixture.stages.approve(run.id);
    await assert.rejects(fixture.screenplays.reannotate(run.id), /已经合并到作品/);
  } finally {
    fixture.database.close();
  }

  const adapted = createServiceFixture();
  try {
    const work = adapted.works.createWork(adapted.project.id, normalizeWorkCreation({ workName: '作品丙', kind: '单个短视频' }, 'text'));
    const creative = await adapted.stages.startCreative(work.id, { chapterMinWords: 100, chapterMaxWords: 200, maxChapters: 3 });
    await adapted.runner.whenIdle();
    adapted.stages.approve(creative.id);
    const run = await adapted.screenplays.start(work.id, { maxEpisodeDurationSeconds: '60' });
    await adapted.runner.whenIdle();
    assert.equal(adapted.screenplays.getView(work.id).fidelity, 'adapted');
    assert.equal(adapted.screenplays.getView(work.id).actions.canReannotate, false);
    await assert.rejects(adapted.screenplays.reannotate(run.id), /只有原创文稿/);
  } finally {
    adapted.database.close();
  }
});

test('分镜：集有结构标注时，提示词里的正文带说话人标记并附说明', async () => {
  const fixture = createFixture('单个短视频');
  try {
    const run = await generate(fixture);
    fixture.stages.approve(run.id);
    const [status] = fixture.storyboards.listEpisodeStatuses(fixture.work.id);
    await fixture.storyboards.start(fixture.work.id, [status.episodeId], {});
    await fixture.runner.whenIdle();
    const request = fixture.text.requests.find((candidate) => candidate.user.includes('# 任务：生成分镜脚本'));
    assert.ok(request);
    assert.ok(request.user.includes('〔守夜人说〕“今晚会下雨。”'));
    assert.ok(request.user.includes('这些标记不是剧本原文'));
  } finally {
    fixture.database.close();
  }
});
