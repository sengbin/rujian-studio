// ------------------------------------------------------------------------
// 名称：storyboard-beat-sheet.test.ts
// 说明：分镜脚本阶段接入节拍表的自动化测试：镜头组总时长以节拍表目标为校准对象，超出容差带偏差重写、达到轮数上限后保留最接近目标的一版并标明偏差；镜头参数建议；没有节拍表时保持原有的上限规则。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：使用内存数据库、真实的执行器与工作流，以及脚本化的假文本生成端口。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeWorkCreation } from '../../domain/rules/work-rules';
import { Responder, standardResponder } from '../stages/testing/scripted-text';
import { createServiceFixture } from './testing/service-fixture';

const CREATIVE_PARAMS = { chapterMinWords: 100, chapterMaxWords: 200, maxChapters: 3 };
const SCREENPLAY_PARAMS = { maxEpisodeDurationSeconds: '60', maxEpisodes: '3' };
const STORYBOARD_TITLE = '# 任务：生成分镜脚本';

/** 返回 count 个 4 秒镜头的响应：以标准响应的第 2 个镜头为模板复制。 */
function withShotCount(request: Parameters<Responder>[0], count: number): unknown {
  const base = standardResponder(request) as { shots: unknown[] };
  return { shots: Array.from({ length: count }, (_, index) => base.shots[Math.min(index, 1)]) };
}

/** 创建夹具、作品，生成并确认创意与剧本（此时还没有节拍表），再生成并确认一份目标 20 秒的节拍表。 */
async function createFixture(responder: Responder) {
  const fixture = createServiceFixture(responder);
  const work = fixture.works.createWork(fixture.project.id, normalizeWorkCreation({ workName: '作品甲', kind: '单个短视频' }, 'text'));
  const creative = await fixture.stages.startCreative(work.id, CREATIVE_PARAMS);
  await fixture.runner.whenIdle();
  fixture.stages.approve(creative.id);
  const screenplay = await fixture.screenplays.start(work.id, SCREENPLAY_PARAMS);
  await fixture.runner.whenIdle();
  fixture.stages.approve(screenplay.id);
  const beat = await fixture.beatSheets.start(work.id, { targetDurationSeconds: '20' });
  await fixture.runner.whenIdle();
  fixture.stages.approve(beat.id);
  const episodeId = fixture.storyboards.listEpisodeStatuses(work.id)[0].episodeId;
  return { ...fixture, work, episodeId };
}

/** 分镜脚本请求的提示词。 */
function storyboardPrompts(fixture: { text: { requests: Array<{ user: string }> } }): string[] {
  return fixture.text.requests.map((request) => request.user).filter((user) => user.includes(STORYBOARD_TITLE));
}

test('镜头组总时长超出容差：带上一版偏差重写，进入容差后停止；视图给出参考目标与偏差', async () => {
  // 首版 2 个镜头共 8 秒（目标 20 秒，不足 60%），带反馈重写后 5 个镜头共 20 秒。
  const fixture = await createFixture((request) =>
    request.user.includes(STORYBOARD_TITLE) ? withShotCount(request, request.user.includes('上一版镜头组的偏差') ? 5 : 2) : standardResponder(request)
  );
  try {
    await fixture.storyboards.start(fixture.work.id, [fixture.episodeId], {});
    await fixture.runner.whenIdle();

    const prompts = storyboardPrompts(fixture);
    assert.equal(prompts.length, 2);
    assert.ok(prompts[0].includes('本集目标时长为 20 秒') && prompts[0].includes('±15%'));
    assert.ok(!prompts[0].includes('这是上限而不是必须达到的目标'), '有节拍表时总时长是可校准的目标，不是上限');
    assert.ok(!prompts[0].includes('上一版镜头组的偏差'));
    assert.ok(prompts[1].includes('上一版共 2 个镜头') && prompts[1].includes('不足') && prompts[1].includes('不得添加剧本没有的情节'));

    const view = fixture.storyboards.getView(fixture.work.id, fixture.episodeId);
    assert.equal(view.run.display, 'pending');
    assert.equal(view.shots.length, 5);
    assert.equal(view.totalSeconds, 20);
    assert.deepEqual(view.reference, { targetSeconds: 20, actualSeconds: 20, deviationRatio: 0, withinTolerance: true, toleranceRatio: 0.15, maxCalibrationRounds: 2 });
  } finally {
    fixture.database.close();
  }
});

test('达到重写轮数上限仍超出容差：停止重写，写入待确认并标明偏差，不使阶段失败', async () => {
  const fixture = await createFixture((request) => (request.user.includes(STORYBOARD_TITLE) ? withShotCount(request, 2) : standardResponder(request)));
  try {
    await fixture.storyboards.start(fixture.work.id, [fixture.episodeId], {});
    await fixture.runner.whenIdle();
    assert.equal(storyboardPrompts(fixture).length, 3, '首版加 2 轮重写');
    const view = fixture.storyboards.getView(fixture.work.id, fixture.episodeId);
    assert.equal(view.run.display, 'pending');
    assert.deepEqual([view.reference?.withinTolerance, view.reference?.actualSeconds], [false, 8]);
    assert.equal(view.actions.canApprove, true);
  } finally {
    fixture.database.close();
  }
});

test('镜头参数建议：按目标时长与建议单镜头时长推导；没有已确认的节拍表时为空', async () => {
  const fixture = await createFixture(standardResponder);
  try {
    assert.deepEqual(fixture.storyboards.suggestShotDefaults(fixture.work.id), { minShotSeconds: 3, maxShotSeconds: 6, maxShots: 4 });
  } finally {
    fixture.database.close();
  }

  const plain = createServiceFixture(standardResponder);
  try {
    const work = plain.works.createWork(plain.project.id, normalizeWorkCreation({ workName: '作品乙', kind: '单个短视频' }, 'text'));
    assert.equal(plain.storyboards.suggestShotDefaults(work.id), undefined);
  } finally {
    plain.database.close();
  }
});
