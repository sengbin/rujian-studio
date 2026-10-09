// ------------------------------------------------------------------------
// 名称：beat-sheet-service.test.ts
// 说明：节拍表阶段的自动化测试：生成到确认的完整闭环、编辑节拍后回到待确认、已确认节拍表的读取、短视频与短剧的参数、原稿与小说素材的整理、输出不合规时失败并可重试。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：使用内存数据库、真实的执行器与节拍表工作流，以及脚本化的假文本生成端口。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundError, ValidationError } from '../../domain/errors';
import { normalizeWorkCreation } from '../../domain/rules/work-rules';
import { Responder, standardResponder } from '../stages/testing/scripted-text';
import { createServiceFixture } from './testing/service-fixture';

const BEAT_TITLE = '# 任务：生成节拍表';
const SUMMARY_TITLE = '# 任务：提取原文要点';
const PARAMS = { targetDurationSeconds: '30', idea: '灯塔守夜人的雨夜' };

/** 创建夹具，并在项目内创建一个作品。 */
function createFixture(kind: '单个短视频' | '多集短片' = '单个短视频', responder: Responder = standardResponder) {
  const fixture = createServiceFixture(responder);
  const work = fixture.works.createWork(fixture.project.id, normalizeWorkCreation({ workName: '作品甲', kind }, 'text'));
  return { ...fixture, work };
}

test('生成到确认：程序算出参考预算，模型只分配剧情，确认后下游可读取；编辑后回到待确认', async () => {
  const fixture = createFixture();
  try {
    const { beatSheets, runner, work, text } = fixture;
    assert.equal(beatSheets.findApproved(work.id), undefined);

    const run = await beatSheets.start(work.id, PARAMS);
    await runner.whenIdle();

    const prompt = text.requests[0].user;
    assert.ok(prompt.includes('灯塔守夜人的雨夜') && prompt.includes('1. 钩子（参考约 4.5 秒 / 18 字，占 15%）'));

    let view = beatSheets.getView(work.id);
    assert.equal(view.run.id, run.id);
    assert.equal(view.run.display, 'pending');
    assert.equal(view.templateLabel, '单集短视频（钩子型）');
    assert.deepEqual(view.params, {
      formatType: 'short_video',
      beatTemplateId: 'short_video_single_hook',
      targetDurationSeconds: 30,
      episodeCount: 1,
      wordsPerSecond: 4,
      toleranceRatio: 0.15,
      maxCalibrationRounds: 2,
      idea: '灯塔守夜人的雨夜',
      extra: null
    });
    assert.deepEqual(view.beats.map((beat) => [beat.label, beat.estimatedSeconds, beat.estimatedWords, beat.synopsis]), [
      ['钩子', 4.5, 18, '第1拍的剧情'],
      ['展开', 13.5, 54, '第2拍的剧情'],
      ['转折', 7.5, 30, '第3拍的剧情'],
      ['收尾', 4.5, 18, '第4拍的剧情']
    ]);
    assert.deepEqual(view.actions, { canApprove: true, canCancel: false, canRetry: false, canEdit: true, editNeedsConfirm: false });

    beatSheets.saveBeat(run.id, { seq: 2, synopsis: '守夜人发现异常' });
    assert.equal(beatSheets.getView(work.id).beats[1].synopsis, '守夜人发现异常');

    fixture.stages.approve(run.id);
    assert.equal(beatSheets.getView(work.id).run.display, 'approved');
    assert.equal(beatSheets.findApproved(work.id)?.beats[1].synopsis, '守夜人发现异常');
    assert.equal(fixture.works.listWorks(fixture.project.id)[0].beatSheet.display, 'approved');

    beatSheets.saveBeat(run.id, { seq: 1, synopsis: '新的开场' });
    view = beatSheets.getView(work.id);
    assert.equal(view.run.display, 'pending');
    assert.equal(beatSheets.findApproved(work.id), undefined);
  } finally {
    fixture.database.close();
  }
});

test('编辑校验：剧情必填，节拍必须存在，只能编辑最新版本', async () => {
  const fixture = createFixture();
  try {
    const { beatSheets, runner, work } = fixture;
    const first = await beatSheets.start(work.id, PARAMS);
    await runner.whenIdle();
    assert.throws(() => beatSheets.saveBeat(first.id, { seq: 1, synopsis: ' ' }), ValidationError);
    assert.throws(() => beatSheets.saveBeat(first.id, { seq: 9, synopsis: '剧情' }), NotFoundError);

    await beatSheets.start(work.id, PARAMS);
    await runner.whenIdle();
    assert.throws(() => beatSheets.saveBeat(first.id, { seq: 1, synopsis: '剧情' }), (error) => error instanceof ValidationError && /最新版本/.test(error.message));
    assert.equal(beatSheets.getLastParams(work.id)?.targetDurationSeconds, 30);
  } finally {
    fixture.database.close();
  }
});

test('生成参数：目标时长必填且在范围内；短剧需要集数，短视频的集数固定为 1', async () => {
  const drama = createFixture('多集短片');
  try {
    await assert.rejects(drama.beatSheets.start(drama.work.id, { targetDurationSeconds: '90' }), (error) => error instanceof ValidationError && 'episodeCount' in error.fieldErrors);
    await assert.rejects(drama.beatSheets.start(drama.work.id, { targetDurationSeconds: '1', episodeCount: '5' }), (error) => error instanceof ValidationError && 'targetDurationSeconds' in error.fieldErrors);
    await drama.beatSheets.start(drama.work.id, { targetDurationSeconds: '90', episodeCount: '5', extra: '悬疑' });
    await drama.runner.whenIdle();
    const view = drama.beatSheets.getView(drama.work.id);
    assert.equal(view.templateLabel, '短剧单集（连载型）');
    assert.equal(view.params?.episodeCount, 5);
    assert.deepEqual(view.beats.map((beat) => beat.estimatedSeconds), [9, 36, 27, 18]);
    assert.ok(drama.text.requests[0].user.includes('参考集数约 5 集') && drama.text.requests[0].user.includes('悬疑'));
  } finally {
    drama.database.close();
  }

  const single = createFixture();
  try {
    await single.beatSheets.start(single.work.id, { targetDurationSeconds: '30', episodeCount: '9' });
    await single.runner.whenIdle();
    assert.equal(single.beatSheets.getView(single.work.id).params?.episodeCount, 1);
  } finally {
    single.database.close();
  }
});

test('原稿与小说素材：先逐段整理要点再分配节拍，节拍记录依据的原文分段', async () => {
  const fixture = createServiceFixture();
  try {
    const text = Array.from({ length: 3 }, (_, index) => `第${index + 1}章\n${'故事'.repeat(100)}`).join('\n');
    const work = fixture.works.createWork(fixture.project.id, normalizeWorkCreation({ workName: '长篇', kind: '单个短视频', manuscriptText: text }, 'original'));
    await fixture.beatSheets.start(work.id, { targetDurationSeconds: '30' });
    await fixture.runner.whenIdle();

    const summaries = fixture.text.requests.filter((request) => request.user.includes(SUMMARY_TITLE));
    assert.equal(summaries.length, 3);
    const beatPrompt = fixture.text.requests.find((request) => request.user.includes(BEAT_TITLE))?.user ?? '';
    assert.ok(beatPrompt.includes('要点1') && beatPrompt.includes('sourceRefs'));
    assert.deepEqual(fixture.beatSheets.getView(work.id).beats.map((beat) => beat.sourceRefs), [[1], [1], [1], [1]]);
  } finally {
    fixture.database.close();
  }
});

test('输出不合规（节拍数量不对）：阶段失败并保留原始输出，重试时不重复整理素材', async () => {
  let beatCalls = 0;
  const responder: Responder = (request) => {
    if (request.user.includes(BEAT_TITLE)) {
      beatCalls += 1;
      return beatCalls === 1 ? { beats: [{ seq: 1, synopsis: '只有一拍' }] } : standardResponder(request);
    }
    return standardResponder(request);
  };
  const fixture = createServiceFixture(responder);
  try {
    const text = Array.from({ length: 2 }, (_, index) => `第${index + 1}章\n${'故事'.repeat(100)}`).join('\n');
    const work = fixture.works.createWork(fixture.project.id, normalizeWorkCreation({ workName: '长篇', kind: '单个短视频', manuscriptText: text }, 'original'));
    const run = await fixture.beatSheets.start(work.id, { targetDurationSeconds: '30' });
    await fixture.runner.whenIdle();

    let view = fixture.beatSheets.getView(work.id);
    assert.equal(view.run.display, 'failed');
    assert.ok(view.run.hasRawOutput && /恰好给出 4 个/.test(view.run.errorMessage ?? ''));
    assert.deepEqual(view.actions, { canApprove: false, canCancel: false, canRetry: true, canEdit: false, editNeedsConfirm: false });
    const summaryCount = fixture.text.requests.filter((request) => request.user.includes(SUMMARY_TITLE)).length;
    assert.equal(summaryCount, 2);

    await fixture.stages.retry(run.id);
    await fixture.runner.whenIdle();
    view = fixture.beatSheets.getView(work.id);
    assert.equal(view.run.display, 'pending');
    assert.equal(view.beats.length, 4);
    assert.equal(fixture.text.requests.filter((request) => request.user.includes(SUMMARY_TITLE)).length, summaryCount, '要点已保存，重试不再重复整理');
  } finally {
    fixture.database.close();
  }
});

test('没有生成记录时读取视图报不存在；删除作品前取消正在生成的节拍表', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = createFixture('单个短视频', async (request) => {
    await gate;
    return standardResponder(request);
  });
  try {
    assert.throws(() => fixture.beatSheets.getView(fixture.work.id), NotFoundError);
    const run = await fixture.beatSheets.start(fixture.work.id, PARAMS);
    fixture.stages.cancelRunningForWork(fixture.work.id);
    release();
    await fixture.runner.whenIdle();
    assert.equal(fixture.beatSheets.getView(fixture.work.id).run.display, 'canceled');
    assert.equal(fixture.stages.requireRun(run.id).status, 'canceled');
  } finally {
    fixture.database.close();
  }
});
