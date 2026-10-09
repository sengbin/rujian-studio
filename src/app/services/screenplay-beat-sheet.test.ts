// ------------------------------------------------------------------------
// 名称：screenplay-beat-sheet.test.ts
// 说明：剧本阶段接入节拍表的自动化测试：内容超出目标时长时先给出结构性改编清单、勾选后本地重算、确认后按取舍生成正文并轻量校准；内容已在容差内时不出清单；多集短剧分别校准各集；没有节拍表时保持原有行为。
// 作者：Lion
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

const CREATIVE_PARAMS = { chapterMinWords: 100, chapterMaxWords: 200, maxChapters: 3 };
const SCREENPLAY_PARAMS = { maxEpisodeDurationSeconds: '120', maxEpisodes: '3' };
const TEXT_TITLE = '# 任务：撰写剧本包';
const ADAPTATION_TITLE = '# 任务：分析改编取舍';

/** 创建夹具与作品，生成并确认节拍表与创意。 */
async function createFixture(options: { kind: '单个短视频' | '多集短片'; target: string; episodeCount?: string; responder: Responder }) {
  const fixture = createServiceFixture(options.responder);
  const work = fixture.works.createWork(fixture.project.id, normalizeWorkCreation({ workName: '作品甲', kind: options.kind }, 'text'));
  const beat = await fixture.beatSheets.start(work.id, { targetDurationSeconds: options.target, ...(options.episodeCount === undefined ? {} : { episodeCount: options.episodeCount }) });
  await fixture.runner.whenIdle();
  fixture.stages.approve(beat.id);
  const creative = await fixture.stages.startCreative(work.id, { ...CREATIVE_PARAMS, idea: '灯塔' });
  await fixture.runner.whenIdle();
  fixture.stages.approve(creative.id);
  return { ...fixture, work };
}

/** 某类提示词的全部请求文本。 */
function requestsOf(fixture: { text: { requests: Array<{ user: string }> } }, title: string): string[] {
  return fixture.text.requests.map((request) => request.user).filter((user) => user.includes(title));
}

/** 单集短视频：首稿 300 字（75 秒），带上一稿重写后 130 字（32.5 秒，进入 30 秒的容差）。 */
const singleResponder: Responder = (request) => {
  if (request.user.includes(TEXT_TITLE)) {
    const length = request.user.includes('上一稿全文') ? 130 : 300;
    return { title: '雨夜来客', overview: '梗概', fullText: '灯'.repeat(length) };
  }
  return standardResponder(request);
};

test('内容超出目标时长：先给出改编清单并暂停，勾选后本地重算，确认后按取舍生成并校准', async () => {
  const fixture = await createFixture({ kind: '单个短视频', target: '30', responder: singleResponder });
  try {
    const { screenplays, stages, runner, work } = fixture;
    const run = await screenplays.start(work.id, SCREENPLAY_PARAMS);
    await runner.whenIdle();

    // 创意 3 章共 360 字，按 4 字/秒为 90 秒，超出 30 秒的容差上限：只产出清单，没有正文。
    let view = screenplays.getView(work.id);
    assert.equal(view.run.display, 'pending');
    assert.equal(view.screenplay, null);
    assert.equal(requestsOf(fixture, TEXT_TITLE).length, 0);
    assert.deepEqual(
      [view.adaptation?.baselineWords, view.adaptation?.baselineSeconds, view.adaptation?.targetSeconds, view.adaptation?.confirmed],
      [360, 90, 30, false]
    );
    assert.deepEqual(view.adaptation?.options.map((option) => [option.id, option.selected]), [['option-1', true], ['option-2', false]]);
    assert.deepEqual(view.adaptation?.estimate, { estimatedWords: 260, estimatedSeconds: 65, withinTolerance: false });
    assert.equal(view.actions.canApprove, false);
    assert.equal(view.actions.canEdit, false);
    assert.equal(view.actions.canConfirmAdaptation, true);
    assert.throws(() => stages.approve(run.id), (error) => error instanceof ValidationError && /改编取舍/.test(error.message));

    // 勾选变化保存后，视图里的预计总量随之重算（页面在本地用同一公式即时重算）。
    screenplays.saveAdaptationSelection(run.id, { selected: ['option-1', 'option-2'] });
    view = screenplays.getView(work.id);
    assert.deepEqual(view.adaptation?.estimate, { estimatedWords: 160, estimatedSeconds: 40, withinTolerance: false });
    assert.throws(() => screenplays.saveAdaptationSelection(run.id, { selected: ['option-9'] }), ValidationError);

    // 确认取舍后重新启动同一阶段记录，按取舍生成正文并校准。
    await screenplays.confirmAdaptation(run.id, { selected: ['option-1'] });
    await runner.whenIdle();
    view = screenplays.getView(work.id);
    assert.equal(view.run.id, run.id);
    assert.equal(view.run.display, 'pending');
    assert.equal(view.adaptation?.confirmed, true);
    assert.deepEqual(view.adaptation?.options.map((option) => option.selected), [true, false]);
    assert.equal(view.screenplay?.fullText.length, 130, '首稿超出容差，带偏差重写后进入容差');
    assert.equal(view.actions.canApprove, true);
    assert.equal(view.actions.canConfirmAdaptation, false);
    const reference = view.episodes[0].reference;
    assert.deepEqual([reference?.targetSeconds, reference?.actualSeconds, reference?.withinTolerance], [30, 32.5, true]);
    assert.ok(Math.abs((reference?.deviationRatio ?? 0) - 2.5 / 30) < 1e-9);

    const texts = requestsOf(fixture, TEXT_TITLE);
    assert.equal(texts.length, 2);
    assert.ok(texts[0].includes('时长参考：全片目标约 30 秒') && texts[0].includes('- 支线：配角感情线（与主线无关）'));
    assert.ok(!texts[0].includes('宴会场'), '没有勾选的取舍项不写进提示词');
    assert.ok(!texts[0].includes('上一稿的偏差'));
    assert.ok(texts[1].includes('上一稿的偏差') && texts[1].includes('超出') && texts[1].includes('保留所有已有台词和关键情节'));
    assert.equal(requestsOf(fixture, ADAPTATION_TITLE).length, 1, '确认后不会再次分析取舍');

    stages.approve(run.id);
    assert.equal(screenplays.getView(work.id).run.display, 'approved');
  } finally {
    fixture.database.close();
  }
});

test('确认改编取舍：清单已确认后不能再修改或再次确认', async () => {
  const fixture = await createFixture({ kind: '单个短视频', target: '30', responder: singleResponder });
  try {
    const { screenplays, runner, work } = fixture;
    const run = await screenplays.start(work.id, SCREENPLAY_PARAMS);
    await runner.whenIdle();
    await screenplays.confirmAdaptation(run.id, { selected: [] });
    await runner.whenIdle();
    assert.throws(() => screenplays.saveAdaptationSelection(run.id, { selected: ['option-1'] }), /已经确认/);
    await assert.rejects(screenplays.confirmAdaptation(run.id, { selected: [] }), /已经确认/);
    assert.ok(!requestsOf(fixture, TEXT_TITLE)[0].includes('已确认排除或合并的内容'), '没有勾选任何取舍项时不写排除清单');
  } finally {
    fixture.database.close();
  }
});

test('内容已在目标时长的容差内：不出改编清单，直接生成正文', async () => {
  // 创意 360 字（90 秒）相对 90 秒的目标正好在容差内。
  const fixture = await createFixture({ kind: '单个短视频', target: '90', responder: (request) => (request.user.includes(TEXT_TITLE) ? { title: '雨夜来客', overview: '梗概', fullText: '灯'.repeat(360) } : standardResponder(request)) });
  try {
    await fixture.screenplays.start(fixture.work.id, SCREENPLAY_PARAMS);
    await fixture.runner.whenIdle();
    const view = fixture.screenplays.getView(fixture.work.id);
    assert.equal(view.adaptation, null);
    assert.equal(view.screenplay?.fullText.length, 360);
    assert.equal(requestsOf(fixture, ADAPTATION_TITLE).length, 0);
    assert.equal(requestsOf(fixture, TEXT_TITLE).length, 1, '首稿已在容差内，不重写');
    assert.equal(view.episodes[0].reference?.withinTolerance, true);
  } finally {
    fixture.database.close();
  }
});

test('没有已确认的节拍表：保持原有行为，没有清单、没有校准，生成表单的建议值为空', async () => {
  const fixture = createServiceFixture(singleResponder);
  try {
    const work = fixture.works.createWork(fixture.project.id, normalizeWorkCreation({ workName: '作品乙', kind: '单个短视频' }, 'text'));
    const creative = await fixture.stages.startCreative(work.id, { ...CREATIVE_PARAMS, idea: '灯塔' });
    await fixture.runner.whenIdle();
    fixture.stages.approve(creative.id);
    assert.equal(fixture.screenplays.suggestParams(work.id), undefined);

    const run = await fixture.screenplays.start(work.id, SCREENPLAY_PARAMS);
    assert.equal('beatSheet' in run.input, false);
    await fixture.runner.whenIdle();
    const view = fixture.screenplays.getView(work.id);
    assert.equal(view.adaptation, null);
    assert.equal(view.toleranceRatio, null);
    assert.equal(view.screenplay?.fullText.length, 300, '没有校准，首稿直接采用');
    assert.equal(view.episodes[0].reference, undefined);
  } finally {
    fixture.database.close();
  }
});

test('生成参数建议：单集最大时长取目标时长加容差，集数上限取节拍表的参考集数', async () => {
  const fixture = await createFixture({ kind: '多集短片', target: '60', episodeCount: '5', responder: singleResponder });
  try {
    assert.deepEqual(fixture.screenplays.suggestParams(fixture.work.id), { maxEpisodeDurationSeconds: 69, maxEpisodes: 5 });
  } finally {
    fixture.database.close();
  }
});

/** 多集短剧：抽取出两集，第一集重写一次即达标，第二集重写后仍不达标。 */
const dramaResponder: Responder = (request) => {
  const user = request.user;
  if (user.includes('# 任务：从剧本中抽取集和实体')) {
    return {
      episodes: [
        { title: '第一集', synopsis: '开端', screenplayText: '第一集正文', targetDurationSeconds: 60 },
        { title: '第二集', synopsis: '转折', screenplayText: '第二集正文', targetDurationSeconds: 60 }
      ],
      entities: [{ kind: 'character', name: '守夜人', description: '灯塔守夜人' }]
    };
  }
  if (user.includes(TEXT_TITLE) && user.includes('这是对已有第 1 集剧本')) {
    return { title: '第一集', overview: '梗概', fullText: '灯'.repeat(240) };
  }
  if (user.includes(TEXT_TITLE) && user.includes('这是对已有第 2 集剧本')) {
    return { title: '第二集', overview: '梗概', fullText: '灯'.repeat(10) };
  }
  return standardResponder(request);
};

test('多集短剧：正文抽取出各集后分别校准，达标的集不再重写，达到轮数上限仍不达标的标明偏差', async () => {
  const fixture = await createFixture({ kind: '多集短片', target: '60', episodeCount: '2', responder: dramaResponder });
  try {
    await fixture.screenplays.start(fixture.work.id, { maxEpisodeDurationSeconds: '120', maxEpisodes: '2' });
    await fixture.runner.whenIdle();

    // 创意 90 秒相对全剧 120 秒的目标偏短，没有可取舍的内容，不出清单。
    const view = fixture.screenplays.getView(fixture.work.id);
    assert.equal(view.adaptation, null);
    assert.equal(view.run.display, 'pending');
    assert.deepEqual(view.episodes.map((episode) => episode.screenplayText.length), [240, 10], '第二集重写后更接近目标，保留重写稿');
    assert.deepEqual(view.episodes.map((episode) => episode.reference?.withinTolerance), [true, false]);

    const rewrites = (episode: number) => requestsOf(fixture, `这是对已有第 ${episode} 集剧本`);
    assert.equal(rewrites(1).length, 1);
    assert.equal(rewrites(2).length, 2, '第二集重写到轮数上限（2 轮）后停止');
    assert.ok(rewrites(2)[1].includes('上一稿的偏差') && rewrites(2)[1].includes('不足'));
  } finally {
    fixture.database.close();
  }
});
