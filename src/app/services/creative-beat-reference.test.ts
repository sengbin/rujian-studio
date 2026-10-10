// ------------------------------------------------------------------------
// 名称：creative-beat-reference.test.ts
// 说明：创意阶段“参考节拍表”模式的自动化测试：需要已确认的节拍表、章节数与参考字数来自节拍、字数超出容差时带偏差重写并在轮数上限后停止、视图给出参考目标与偏差；自由创作不读取节拍表。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：使用内存数据库、真实的执行器与工作流，以及脚本化的假文本生成端口。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationError } from '../../domain/errors';
import { normalizeWorkCreation } from '../../domain/rules/work-rules';
import { Responder, standardResponder } from '../stages/testing/scripted-text';
import { createServiceFixture } from './testing/service-fixture';

const OUTLINE_TITLE = '# 任务：规划章节大纲';
const CREATIVE_PARAMS = { chapterMinWords: 100, chapterMaxWords: 200, maxChapters: 3 };

/** 参考模式的响应：大纲恰好 4 章；第 2 章首稿过长、重写后进入容差，其他章始终过长。 */
const responder: Responder = (request) => {
  const user = request.user;
  if (user.includes(OUTLINE_TITLE)) {
    return { chapters: [1, 2, 3, 4].map((seq) => ({ title: `章${seq}`, summary: `梗概${seq}` })) };
  }
  const chapter = /# 任务：撰写第 (\d+) 章/.exec(user);
  if (chapter !== null) {
    const seq = Number(chapter[1]);
    // 第 2 章（参考 54 字，容差范围 46 到 62）：重写后 55 字。
    const length = seq === 2 && user.includes('上一稿全文') ? 55 : 100;
    return { title: `第${seq}章`, content: '灯'.repeat(length) };
  }
  return standardResponder(request);
};

/** 创建夹具、作品，并生成、确认一份 30 秒的节拍表。 */
async function createFixture(approveBeatSheet = true) {
  const fixture = createServiceFixture(responder);
  const work = fixture.works.createWork(fixture.project.id, normalizeWorkCreation({ workName: '作品甲', kind: '单个短视频' }, 'text'));
  if (approveBeatSheet) {
    const run = await fixture.beatSheets.start(work.id, { targetDurationSeconds: '30' });
    await fixture.runner.whenIdle();
    fixture.stages.approve(run.id);
  }
  return { ...fixture, work };
}

test('参考节拍表需要先确认节拍表；自由创作不需要，也不把节拍表写进输入快照', async () => {
  const fixture = await createFixture(false);
  try {
    await assert.rejects(
      fixture.stages.startCreative(fixture.work.id, { ...CREATIVE_PARAMS, beatReferenceMode: '参考节拍表' }),
      (error) => error instanceof ValidationError && 'beatReferenceMode' in error.fieldErrors
    );
    const run = await fixture.stages.startCreative(fixture.work.id, { ...CREATIVE_PARAMS, idea: '灯塔', beatReferenceMode: '自由创作' });
    await fixture.runner.whenIdle();
    assert.equal('beatSheet' in run.input, false);
    const view = fixture.stages.getCreativeView(fixture.work.id);
    assert.equal(view.toleranceRatio, null);
    assert.ok(view.chapters.every((chapter) => chapter.reference === null));
  } finally {
    fixture.database.close();
  }
});

test('参考模式：一个节拍一章，每章以节拍参考字数为目标校准，超出容差带偏差重写，达到上限后停止并标注偏差', async () => {
  const fixture = await createFixture();
  try {
    const run = await fixture.stages.startCreative(fixture.work.id, { ...CREATIVE_PARAMS, idea: '灯塔', beatReferenceMode: 'reference' });
    await fixture.runner.whenIdle();

    const requests = fixture.text.requests.map((request) => request.user);
    const outlinePrompt = requests.find((user) => user.includes(OUTLINE_TITLE)) ?? '';
    assert.ok(outlinePrompt.includes('恰好 4 章') && outlinePrompt.includes('1. 钩子（参考约 18 字）'));

    const view = fixture.stages.getCreativeView(fixture.work.id);
    assert.equal(view.run.display, 'pending');
    assert.equal(view.toleranceRatio, 0.15);
    assert.deepEqual(view.chapters.map((chapter) => chapter.wordCount), [100, 55, 100, 100]);
    assert.deepEqual(view.chapters.map((chapter) => chapter.reference?.targetWords), [18, 54, 30, 18]);
    assert.deepEqual(view.chapters.map((chapter) => chapter.reference?.withinTolerance), [false, true, false, false]);
    assert.deepEqual(view.chapters.map((chapter) => chapter.wordHint), ['long', null, 'long', 'long']);

    // 第 2 章：首稿 + 1 次重写（进入容差后停止）；第 1、3、4 章：首稿 + 2 轮重写后停止。
    const chapterRequests = (seq: number) => requests.filter((user) => user.includes(`# 任务：撰写第 ${seq} 章`));
    assert.deepEqual([1, 2, 3, 4].map((seq) => chapterRequests(seq).length), [3, 2, 3, 3]);
    const rewrite = chapterRequests(2)[1];
    assert.ok(rewrite.includes('超出') && rewrite.includes('保留所有已有的台词和关键情节') && rewrite.includes('46') && rewrite.includes('62'));
    assert.ok(!chapterRequests(2)[0].includes('上一稿全文'));
    assert.equal((run.input.beatSheet as { beats: unknown[] }).beats.length, 4);
  } finally {
    fixture.database.close();
  }
});

test('参考模式：大纲章数与节拍数不一致时失败并说明原因', async () => {
  const fixture = createServiceFixture((request) => (request.user.includes(OUTLINE_TITLE) ? { chapters: [{ title: '独章', summary: '梗概' }] } : responder(request, 0)));
  try {
    const work = fixture.works.createWork(fixture.project.id, normalizeWorkCreation({ workName: '作品乙', kind: '单个短视频' }, 'text'));
    const beat = await fixture.beatSheets.start(work.id, { targetDurationSeconds: '30' });
    await fixture.runner.whenIdle();
    fixture.stages.approve(beat.id);

    await fixture.stages.startCreative(work.id, { ...CREATIVE_PARAMS, beatReferenceMode: 'reference' });
    await fixture.runner.whenIdle();
    const view = fixture.stages.getCreativeView(work.id);
    assert.equal(view.run.display, 'failed');
    assert.match(view.run.errorMessage ?? '', /恰好有 4 章/);
  } finally {
    fixture.database.close();
  }
});
