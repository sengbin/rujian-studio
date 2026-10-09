// ------------------------------------------------------------------------
// 名称：storyboard-service.test.ts
// 说明：分镜脚本阶段应用服务的自动化测试：生成、视图、多集、编辑保存、新增删除与调整镜头顺序、确认与上游变更、失败后继续。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：使用内存数据库、真实的执行器与三个阶段的工作流，以及脚本化的假文本生成端口。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundError, TextGenerationError, ValidationError } from '../../domain/errors';
import { normalizeWorkCreation } from '../../domain/rules/work-rules';
import { SqliteAssetRepository } from '../../infra/database/sqlite-asset-repository';
import { SqliteBindingRepository } from '../../infra/database/sqlite-binding-repository';
import { describeAspectRatio } from '../stages/storyboard-workflow';
import { Responder, standardResponder } from '../stages/testing/scripted-text';
import { AssetService } from './asset-service';
import { BindingService } from './binding-service';
import { createServiceFixture } from './testing/service-fixture';
import { MemoryAssetFileStore } from '../../domain/ports/testing/memory-asset-file-store';

const CREATIVE_PARAMS = { chapterMinWords: 100, chapterMaxWords: 200, maxChapters: 3 };
const SCREENPLAY_PARAMS = { maxEpisodeDurationSeconds: '60', maxEpisodes: '3' };
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ')]);
const VOICE_FILES = JSON.stringify([{ name: 'v.wav', mimeType: 'audio/wav', size: WAV.length, data: WAV.toString('base64'), durationSeconds: 3 }]);

/** 创建夹具与作品，生成并确认创意；withScreenplay 为 true 时再生成并确认剧本。 */
async function createFixture(kind: '单个短视频' | '多集短片' = '单个短视频', withScreenplay = true, responder: Responder = standardResponder, sceneBatchMaxChars?: number) {
  const fixture = createServiceFixture(responder, sceneBatchMaxChars);
  const work = fixture.works.createWork(fixture.project.id, normalizeWorkCreation({ workName: '作品甲', kind }, 'text'));
  const creative = await fixture.stages.startCreative(work.id, CREATIVE_PARAMS);
  await fixture.runner.whenIdle();
  fixture.stages.approve(creative.id);
  let screenplay;
  if (withScreenplay) {
    screenplay = await fixture.screenplays.start(work.id, SCREENPLAY_PARAMS);
    await fixture.runner.whenIdle();
    fixture.stages.approve(screenplay.id);
  }
  return { ...fixture, work, creative, screenplay };
}

/** 第一个集的标识。 */
function firstEpisodeId(fixture: Awaited<ReturnType<typeof createFixture>>): number {
  return fixture.storyboards.listEpisodeStatuses(fixture.work.id)[0].episodeId;
}

test('生成：剧本未确认时拒绝；确认后为这一集生成镜头、出场实体与声音，待确认', async () => {
  const early = await createFixture('单个短视频', false);
  try {
    assert.throws(() => early.storyboards.assertCanStart(early.work.id), ValidationError);
    await assert.rejects(early.storyboards.start(early.work.id, [1], {}), /请先确认剧本/);
    assert.equal(early.storyboards.getSummary(early.work.id).canStart, false);
  } finally {
    early.database.close();
  }

  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    const [run] = await fixture.storyboards.start(fixture.work.id, [episodeId], { continuity: '由 AI 判断是否接尾帧' });
    await fixture.runner.whenIdle();

    const view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.equal(view.run.id, run.id);
    assert.equal(view.run.display, 'pending');
    assert.deepEqual(view.episode, { id: episodeId, seq: 1, title: '作品甲' });
    assert.equal(view.params?.continuity, 'ai');
    assert.equal(view.shots.length, 2);
    assert.equal(view.totalSeconds, 8);
    assert.equal(view.groupMaxSeconds, 15);
    assert.deepEqual(view.groups.map((group) => [group.seq, group.shotIds.length, group.totalSeconds]), [[1, 2, 8]], '8 秒的两个镜头打包成一组');
    assert.equal(view.stale, false);
    assert.deepEqual(view.actions, { canApprove: true, canCancel: false, canRetry: false, canEdit: true, editNeedsConfirm: false });

    const names = new Map(view.entities.map((entity) => [entity.id, entity.name]));
    assert.deepEqual(view.shots[0].entityIds.map((id) => names.get(id)), ['灯塔']);
    assert.deepEqual(view.shots[1].entityIds.map((id) => names.get(id)), ['守夜人'], '老陈是守夜人的别名');
    assert.deepEqual(view.shots.map((shot) => shot.firstFrameMode), ['none', 'prev_tail']);
    assert.equal(view.shots[1].sounds[0].kind, 'dialogue');
    assert.equal(names.get(view.shots[1].sounds[0].speakerEntityId ?? 0), '守夜人');
    assert.deepEqual(view.shots[0].staging, []);
    assert.deepEqual(
      view.shots[1].staging,
      [{ entityId: view.shots[1].entityIds[0], startX: 'left', startDepth: 'middle', endX: 'center', endDepth: null, facing: 'right', action: '抬头望向海面' }],
      '站位随镜头保存，老陈映射为守夜人'
    );

    // 请求中带有剧本、实体清单与项目风格。
    const request = fixture.text.requests.at(-1);
    assert.ok(request?.user.includes('今晚会下雨') && request.user.includes('角色：守夜人（别名：老陈）'));
    assert.ok(request?.user.includes('没有指定'), '项目没有设置风格');
    assert.equal(fixture.storyboards.getLastParams(fixture.work.id)?.audioMode, 'native');
  } finally {
    fixture.database.close();
  }
});

test('视图：带生成时的目标画幅，没有指定时为 null', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    await fixture.storyboards.start(fixture.work.id, [episodeId], {}, '9:16');
    await fixture.runner.whenIdle();
    assert.equal(fixture.storyboards.getView(fixture.work.id, episodeId).aspectRatio, '9:16');

    await fixture.storyboards.start(fixture.work.id, [episodeId], {});
    await fixture.runner.whenIdle();
    assert.equal(fixture.storyboards.getView(fixture.work.id, episodeId).aspectRatio, null, '项目没有默认画幅且没有指定');
  } finally {
    fixture.database.close();
  }
});

test('视图：请求图片时，实体带本集绑定的主形象资产缩略图；没有请求或没有绑定时为 null', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    await fixture.storyboards.start(fixture.work.id, [episodeId], {});
    await fixture.runner.whenIdle();

    const assetRepository = new SqliteAssetRepository(fixture.database, fixture.files);
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const thumbnail = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 9, 9]);
    const files = JSON.stringify([
      { name: 'a.png', mimeType: 'image/png', size: image.length, data: image.toString('base64'), width: 64, height: 64, thumbnail: { mimeType: 'image/jpeg', data: thumbnail.toString('base64') } }
    ]);
    const guard = new AssetService(assetRepository).createAsset('character', { name: '守夜人形象', files }, { fileSource: 'upload' });
    const view = fixture.storyboards.getView(fixture.work.id, episodeId);
    const entity = view.entities.find((item) => item.name === '守夜人');
    assert.ok(entity, '夹具里有守夜人实体');
    new BindingService(new SqliteBindingRepository(fixture.database), assetRepository).bind({ episodeId, entityId: entity.id, assetId: guard.id });

    assert.ok(fixture.storyboards.getView(fixture.work.id, episodeId).entities.every((item) => item.image === null), '默认不带图片');
    const withImages = fixture.storyboards.getView(fixture.work.id, episodeId, undefined, { withImages: true });
    assert.deepEqual(
      withImages.entities.filter((item) => item.image !== null).map((item) => [item.name, item.image]),
      [['守夜人', { mime: 'image/jpeg', data: thumbnail.toString('base64') }]]
    );
  } finally {
    fixture.database.close();
  }
});

test('视图：实体是否已绑定音色参考（主资产）；形象绑定不算，没有绑定为 false', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    await fixture.storyboards.start(fixture.work.id, [episodeId], {});
    await fixture.runner.whenIdle();

    const assetRepository = new SqliteAssetRepository(fixture.database, fixture.files);
    const assets = new AssetService(assetRepository);
    const bindings = new BindingService(new SqliteBindingRepository(fixture.database), assetRepository);
    const entity = fixture.storyboards.getView(fixture.work.id, episodeId).entities.find((item) => item.name === '守夜人');
    assert.ok(entity, '夹具里有守夜人实体');
    assert.ok(fixture.storyboards.getView(fixture.work.id, episodeId).entities.every((item) => !item.hasVoice), '没有绑定时都是 false');

    const voice = assets.createAsset('audio', { name: '低沉嗓音', audioKind: '音色参考', files: VOICE_FILES }, { fileSource: 'upload' });
    bindings.bind({ episodeId, entityId: entity.id, assetId: voice.id, purpose: 'voice' });
    const view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.deepEqual(view.entities.filter((item) => item.hasVoice).map((item) => item.name), ['守夜人']);
  } finally {
    fixture.database.close();
  }
});

test('生成：单组最长时长写入输入快照并决定分组；单镜头最长时长不能超过它', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    await assert.rejects(fixture.storyboards.start(fixture.work.id, [episodeId], { groupMaxSeconds: '6', maxShotSeconds: '8' }), (error) => error instanceof ValidationError && error.fieldErrors.maxShotSeconds !== undefined);
    await fixture.storyboards.start(fixture.work.id, [episodeId], { groupMaxSeconds: '6' });
    await fixture.runner.whenIdle();
    const view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.equal(view.params?.groupMaxSeconds, 6);
    assert.deepEqual(view.groups.map((group) => group.shotIds.length), [1, 1], '两个 4 秒的镜头放不进 6 秒的一组');
    assert.ok(fixture.text.requests.at(-1)?.user.includes('每组总时长不超过 6 秒'), '提示词告诉模型分组上限');
  } finally {
    fixture.database.close();
  }
});

test('生成：连贯策略与无声参数裁剪输出工具，并写入输入快照', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    await fixture.storyboards.start(fixture.work.id, [episodeId], { continuity: '尾帧接首帧', audioMode: '无声', visualStyle: '水彩' });
    await fixture.runner.whenIdle();
    const schema = JSON.stringify(fixture.text.requests.at(-1)?.tool.inputSchema);
    assert.ok(!schema.includes('"firstFrameMode"') && !schema.includes('"sounds"'));
    assert.ok(fixture.text.requests.at(-1)?.user.includes('水彩'));

    const view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.deepEqual(view.shots.map((shot) => shot.firstFrameMode), ['none', 'prev_tail']);
    assert.deepEqual(view.shots.map((shot) => shot.sounds.length), [0, 0]);
    assert.deepEqual(view.params?.audioElements, []);
  } finally {
    fixture.database.close();
  }
});

test('生成：参数不合法时不创建记录；集必须属于作品；正在生成的集不能重复启动', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    await assert.rejects(fixture.storyboards.start(fixture.work.id, [episodeId], { maxShots: '0' }), ValidationError);
    await assert.rejects(fixture.storyboards.start(fixture.work.id, [9999], {}), /不属于该作品/);
    await assert.rejects(fixture.storyboards.start(fixture.work.id, [], {}), /请选择要生成的集/);
    assert.equal(fixture.runs.listVersions({ workId: fixture.work.id, stage: 'storyboard_script', episodeId }).length, 0);

    await fixture.storyboards.start(fixture.work.id, [episodeId], {});
    await assert.rejects(fixture.storyboards.start(fixture.work.id, [episodeId], {}), /正在生成/);
    await fixture.runner.whenIdle();
  } finally {
    fixture.database.close();
  }
});

test('多集：一次为所选集各生成一份，状态按集汇总，只有未选的集没有记录', async () => {
  const fixture = await createFixture('多集短片');
  try {
    const statuses = fixture.storyboards.listEpisodeStatuses(fixture.work.id);
    assert.equal(statuses.length, 2);
    assert.ok(statuses.every((status) => status.display === 'none'));

    const runs = await fixture.storyboards.start(fixture.work.id, [statuses[0].episodeId], {});
    assert.equal(runs.length, 1);
    await fixture.runner.whenIdle();
    const all = await fixture.storyboards.start(fixture.work.id, statuses.map((status) => status.episodeId), {});
    assert.equal(all.length, 2);
    await fixture.runner.whenIdle();

    const after = fixture.storyboards.listEpisodeStatuses(fixture.work.id);
    assert.deepEqual(after.map((status) => [status.seq, status.version, status.display, status.shotCount]), [
      [1, 2, 'pending', 2],
      [2, 1, 'pending', 2]
    ]);
    fixture.stages.approve(after[0].runId ?? 0);
    assert.deepEqual(fixture.storyboards.getSummary(fixture.work.id), { canStart: true, episodes: 2, approved: 1, started: 2, running: 0, failed: 0, canceled: 0 });
    assert.deepEqual(fixture.screenplays.getView(fixture.work.id).downstreamEpisodes, [1, 2]);

    // 一集的记录不能用另一集的标识操作。
    const second = after[1];
    assert.throws(() => fixture.stages.assertRunBelongs(second.runId ?? 0, fixture.work.id, 'storyboard_script', after[0].episodeId), NotFoundError);
    fixture.stages.assertRunBelongs(second.runId ?? 0, fixture.work.id, 'storyboard_script', second.episodeId);
  } finally {
    fixture.database.close();
  }
});

test('编辑：保存镜头与声音后回到待确认；已确认的版本编辑后需要重新确认；非法内容被拒绝', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    const [run] = await fixture.storyboards.start(fixture.work.id, [episodeId], {});
    await fixture.runner.whenIdle();
    fixture.stages.approve(run.id);

    let view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.equal(view.run.display, 'approved');
    assert.equal(view.actions.editNeedsConfirm, true);
    const [first, second] = view.shots;
    const base = { ref: second.id, prompt: second.prompt, durationSeconds: 5, firstFrameMode: 'none', entityIds: second.entityIds, sounds: [] };

    fixture.storyboards.saveShot(run.id, { ...base, prompt: '守夜人关掉灯', sounds: [{ kind: 'sfx', text: '开关声', durationSeconds: '1' }] });
    view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.equal(view.run.display, 'pending');
    assert.equal(view.shots[1].prompt, '守夜人关掉灯');
    assert.equal(view.shots[1].durationSeconds, 5);
    assert.equal(view.shots[1].firstFrameMode, 'none');
    assert.deepEqual(view.shots[1].sounds.map((sound) => [sound.kind, sound.text, sound.durationSeconds]), [['sfx', '开关声', 1]]);
    assert.equal(view.totalSeconds, 9);
    assert.equal(fixture.runs.findById(run.id)?.revision, 2);

    assert.throws(() => fixture.storyboards.saveShot(run.id, { ...base, ref: first.id, firstFrameMode: 'prev_tail' }), ValidationError);
    assert.throws(() => fixture.storyboards.saveShot(run.id, { ...base, prompt: '' }), ValidationError);
    assert.throws(() => fixture.storyboards.saveShot(run.id, { ...base, ref: 99999 }), NotFoundError);
    assert.equal(fixture.runs.findById(run.id)?.revision, 2, '被拒绝的编辑不改变修订号');

    // 站位随镜头整体替换：没有提交站位时清空，提交时按实体保存。
    assert.deepEqual(view.shots[1].staging, []);
    const guardId = second.entityIds[0];
    fixture.storyboards.saveShot(run.id, { ...base, staging: [{ entityId: guardId, startX: 'right', startDepth: 'back', facing: 'away', action: '背对灯光' }] });
    view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.deepEqual(view.shots[1].staging, [{ entityId: guardId, startX: 'right', startDepth: 'back', endX: null, endDepth: null, facing: 'away', action: '背对灯光' }]);
    assert.throws(() => fixture.storyboards.saveShot(run.id, { ...base, staging: [{ entityId: guardId, startX: '左边' }] }), ValidationError);
  } finally {
    fixture.database.close();
  }
});

test('编辑：首帧来源可以指定图片资产；视图只列出带参考图的图片资产；资产被删除后不再有首帧图片', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    const [run] = await fixture.storyboards.start(fixture.work.id, [episodeId], {});
    await fixture.runner.whenIdle();

    const assetRepository = new SqliteAssetRepository(fixture.database, new MemoryAssetFileStore());
    const assets = new AssetService(assetRepository);
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const scene = assets.createAsset('scene', {
      name: '灯塔远景',
      files: JSON.stringify([{ name: 'a.png', mimeType: 'image/png', size: image.length, data: image.toString('base64'), width: 64, height: 64 }])
    }, { fileSource: 'upload' });
    assets.createAsset('character', { name: '没有参考图的角色' });

    let view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.deepEqual(view.firstFrameAssets, [{ id: scene.id, kindLabel: '场景', name: '灯塔远景' }]);
    const [first] = view.shots;
    const base = { ref: first.id, prompt: first.prompt, durationSeconds: 5, entityIds: first.entityIds, sounds: [] };

    fixture.storyboards.saveShot(run.id, { ...base, firstFrameMode: 'asset', firstFrameAssetId: scene.id });
    view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.deepEqual([view.shots[0].firstFrameMode, view.shots[0].firstFrameAssetId], ['asset', scene.id]);

    assert.throws(() => fixture.storyboards.saveShot(run.id, { ...base, firstFrameMode: 'asset', firstFrameAssetId: 99999 }), ValidationError);
    assert.throws(() => fixture.storyboards.saveShot(run.id, { ...base, firstFrameMode: 'asset' }), ValidationError);

    fixture.storyboards.saveShot(run.id, { ...base, firstFrameMode: 'none', firstFrameAssetId: scene.id });
    assert.deepEqual(
      [fixture.storyboards.getView(fixture.work.id, episodeId).shots[0].firstFrameMode, fixture.storyboards.getView(fixture.work.id, episodeId).shots[0].firstFrameAssetId],
      ['none', null],
      '改回其他来源时清掉资产'
    );

    fixture.storyboards.saveShot(run.id, { ...base, firstFrameMode: 'asset', firstFrameAssetId: scene.id });
    assetRepository.remove(scene.id);
    view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.deepEqual([view.shots[0].firstFrameMode, view.shots[0].firstFrameAssetId, view.firstFrameAssets], ['asset', null, []]);
  } finally {
    fixture.database.close();
  }
});

test('调整镜头顺序：与相邻镜头互换序号和所在的组，各组镜头数不变；新的第 1 个镜头不再接上一镜头尾帧；版本回到待确认', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    const [run] = await fixture.storyboards.start(fixture.work.id, [episodeId], { groupMaxSeconds: '4', continuity: '由 AI 判断是否接尾帧' });
    await fixture.runner.whenIdle();
    fixture.stages.approve(run.id);
    const before = fixture.storyboards.getView(fixture.work.id, episodeId);
    const [first, second] = before.shots;
    assert.deepEqual(before.groups.map((group) => group.shotIds), [[first.id], [second.id]]);
    assert.equal(second.firstFrameMode, 'prev_tail');

    const revision = fixture.runs.findById(run.id)!.revision;
    fixture.storyboards.moveShot(run.id, { ref: second.id, direction: 'up' });
    const after = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.deepEqual(after.shots.map((shot) => [shot.id, shot.seq]), [[second.id, 1], [first.id, 2]]);
    assert.deepEqual(after.groups.map((group) => group.shotIds), [[second.id], [first.id]], '序号和所在的组一起互换');
    assert.equal(after.shots[0].firstFrameMode, 'none', '新的第 1 个镜头不接上一镜头尾帧');
    assert.equal(after.run.display, 'pending');
    assert.equal(fixture.runs.findById(run.id)!.revision, revision + 1);

    fixture.storyboards.moveShot(run.id, { ref: second.id, direction: 'down' });
    assert.deepEqual(fixture.storyboards.getView(fixture.work.id, episodeId).shots.map((shot) => shot.id), [first.id, second.id]);

    assert.throws(() => fixture.storyboards.moveShot(run.id, { ref: first.id, direction: 'up' }), /已经是第一个镜头/);
    assert.throws(() => fixture.storyboards.moveShot(run.id, { ref: second.id, direction: 'down' }), /已经是最后一个镜头/);
    assert.throws(() => fixture.storyboards.moveShot(run.id, { ref: first.id, direction: 'left' }), ValidationError);
    assert.throws(() => fixture.storyboards.moveShot(run.id, { ref: 99999, direction: 'up' }), NotFoundError);
  } finally {
    fixture.database.close();
  }
});

test('新增与删除镜头：新增接在末尾，删除后序号重排；新的第 1 个镜头不再接上一镜头尾帧；至少保留 1 个镜头', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    const [run] = await fixture.storyboards.start(fixture.work.id, [episodeId], { continuity: '由 AI 判断是否接尾帧' });
    await fixture.runner.whenIdle();
    fixture.stages.approve(run.id);
    const [first, second] = fixture.storyboards.getView(fixture.work.id, episodeId).shots;
    assert.equal(second.firstFrameMode, 'prev_tail');

    const revision = fixture.runs.findById(run.id)!.revision;
    const added = fixture.storyboards.addShot(run.id, {
      durationSeconds: '4',
      firstFrameMode: 'prev_tail',
      entityIds: [second.entityIds[0]],
      sounds: [{ kind: 'sfx', text: '脚步声' }],
      prompt: '守夜人走出灯塔'
    });
    let view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.equal(view.run.display, 'pending');
    assert.equal(fixture.runs.findById(run.id)!.revision, revision + 1);
    assert.deepEqual(view.shots.map((shot) => [shot.id, shot.seq]), [[first.id, 1], [second.id, 2], [added, 3]]);
    const shot = view.shots[2];
    assert.deepEqual([shot.prompt, shot.durationSeconds, shot.firstFrameMode, shot.entityIds], ['守夜人走出灯塔', 4, 'prev_tail', [second.entityIds[0]]]);
    assert.deepEqual(shot.sounds.map((sound) => [sound.kind, sound.text]), [['sfx', '脚步声']]);
    assert.equal(view.totalSeconds, 12);

    // 非法内容与不存在的镜头被拒绝，不改变修订号。
    assert.throws(() => fixture.storyboards.addShot(run.id, { prompt: '', durationSeconds: 3 }), (error) => {
      return error instanceof ValidationError && error.fieldErrors.prompt !== undefined;
    });
    assert.throws(() => fixture.storyboards.deleteShot(run.id, { ref: 99999 }), NotFoundError);
    assert.equal(fixture.runs.findById(run.id)!.revision, revision + 1);

    // 删除第 1 个镜头：原第 2 个镜头成为第 1 个，且不再接上一镜头尾帧。
    fixture.storyboards.deleteShot(run.id, { ref: first.id });
    view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.deepEqual(view.shots.map((item) => [item.id, item.seq, item.firstFrameMode]), [[second.id, 1, 'none'], [added, 2, 'prev_tail']]);
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS n FROM shot_sounds WHERE shot_id = ?').get(first.id)?.n, 0);

    fixture.storyboards.deleteShot(run.id, { ref: second.id });
    assert.throws(() => fixture.storyboards.deleteShot(run.id, { ref: added }), /至少保留 1 个镜头/);
    view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.deepEqual(view.shots.map((item) => [item.id, item.seq, item.firstFrameMode]), [[added, 1, 'none']]);
    assert.equal(fixture.runs.findById(run.id)!.reviewStatus, 'pending');
  } finally {
    fixture.database.close();
  }
});

test('上游变更：剧本被修改或重新生成后，分镜脚本显示“上游已变更”', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    const [run] = await fixture.storyboards.start(fixture.work.id, [episodeId], {});
    await fixture.runner.whenIdle();
    fixture.stages.approve(run.id);
    assert.equal(fixture.storyboards.getView(fixture.work.id, episodeId).stale, false);

    const screenplayView = fixture.screenplays.getView(fixture.work.id);
    fixture.screenplays.saveText(screenplayView.run.id, { fullText: '改过的剧本' });
    assert.equal(fixture.storyboards.getView(fixture.work.id, episodeId).stale, true);
    assert.equal(fixture.storyboards.listEpisodeStatuses(fixture.work.id)[0].stale, true);
  } finally {
    fixture.database.close();
  }
});

test('失败后继续：输出不合规时记录失败并保留原始输出，重试成功后写入镜头', async () => {
  let calls = 0;
  const responder: Responder = (request) => {
    if (request.user.includes('# 任务：生成分镜脚本') && ++calls === 1) {
      return { shots: [{ durationSeconds: 3, entities: [{ kind: 'character', name: '路人' }] }] };
    }
    return standardResponder(request);
  };
  const fixture = await createFixture('单个短视频', true, responder);
  try {
    const episodeId = firstEpisodeId(fixture);
    const [run] = await fixture.storyboards.start(fixture.work.id, [episodeId], {});
    await fixture.runner.whenIdle();

    let view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.equal(view.run.display, 'failed');
    assert.match(view.run.errorMessage ?? '', /不存在的角色“路人”/);
    assert.equal(view.run.hasRawOutput, true);
    assert.deepEqual(view.shots, []);
    assert.equal(view.actions.canEdit, false);

    await fixture.stages.retry(run.id);
    await fixture.runner.whenIdle();
    view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.equal(view.run.display, 'pending');
    assert.equal(view.shots.length, 2);
  } finally {
    fixture.database.close();
  }
});

test('取消与删除：删除作品前取消各集正在进行的生成；没有可用模型时启动失败且不留记录', async () => {
  const hang: Responder = (request) =>
    request.user.includes('# 任务：生成分镜脚本') ? new Promise(() => undefined) : standardResponder(request);
  const fixture = await createFixture('多集短片', true, hang);
  try {
    const episodeIds = fixture.storyboards.listEpisodeStatuses(fixture.work.id).map((status) => status.episodeId);
    const runs = await fixture.storyboards.start(fixture.work.id, episodeIds, {});
    assert.equal(runs.length, 2);
    await fixture.stages.cancelRunningForWork(fixture.work.id);
    await fixture.runner.whenIdle();
    assert.deepEqual(fixture.storyboards.listEpisodeStatuses(fixture.work.id).map((status) => status.display), ['canceled', 'canceled']);

    fixture.text.unavailable = true;
    await assert.rejects(fixture.storyboards.start(fixture.work.id, episodeIds, {}), TextGenerationError);
    assert.deepEqual(fixture.storyboards.listEpisodeStatuses(fixture.work.id).map((status) => status.version), [1, 1]);
  } finally {
    fixture.database.close();
  }
});

test('生成：目标画幅写入提示词，横屏、竖屏给出不同的构图提示；没有传入时取项目默认画幅，都没有则说明未指定', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    const lastUser = () => fixture.text.requests.at(-1)?.user ?? '';

    await fixture.storyboards.start(fixture.work.id, [episodeId], {});
    await fixture.runner.whenIdle();
    assert.ok(lastUser().includes('## 画幅') && lastUser().includes('没有指定，按常见视频的横屏构图处理'));

    await fixture.storyboards.start(fixture.work.id, [episodeId], {}, '9:16');
    await fixture.runner.whenIdle();
    assert.ok(lastUser().includes('目标视频画幅为 9:16') && lastUser().includes('竖屏'));

    await fixture.storyboards.start(fixture.work.id, [episodeId], {}, '16:9');
    await fixture.runner.whenIdle();
    assert.ok(lastUser().includes('目标视频画幅为 16:9') && lastUser().includes('横屏'));

    fixture.projects.updateProject(fixture.project.id, { name: '项目甲', defaultAspectRatio: '1:1' });
    await fixture.storyboards.start(fixture.work.id, [episodeId], {});
    await fixture.runner.whenIdle();
    assert.ok(lastUser().includes('目标视频画幅为 1:1') && lastUser().includes('方形'), '没有传入画幅时取项目默认画幅');
  } finally {
    fixture.database.close();
  }
});

test('画幅提示：解析不了宽高比时只说明画幅，没有指定时说明未指定', () => {
  assert.match(describeAspectRatio('宽屏'), /目标视频画幅为 宽屏。按这个画幅安排构图/);
  assert.match(describeAspectRatio('21:9'), /横屏/);
  assert.match(describeAspectRatio(null), /没有指定/);
});

/** 三个场次的剧本正文，每个场次约 40 个字。 */
const THREE_SCENE_TEXT = [1, 2, 3].map((number) => `第${number}场 地点${number}｜内景｜夜\n${'浪'.repeat(30)}`).join('\n');

/** 把单个短视频这一集的剧本正文换成多场次的正文（直接写库，模拟剧本里已有“第N场”标题）。 */
function useSceneText(fixture: Awaited<ReturnType<typeof createFixture>>): void {
  fixture.database.prepare('UPDATE episodes SET screenplay_text = ? WHERE work_id = ?').run(THREE_SCENE_TEXT, fixture.work.id);
}

test('分批：正文超过单批上限且有多个场次时按场次逐批生成，镜头序号连续，预算按正文占比分配，后一批带上前一批的最后一个镜头', async () => {
  const fixture = await createFixture('单个短视频', true, standardResponder, 50);
  try {
    useSceneText(fixture);
    const episodeId = firstEpisodeId(fixture);
    await fixture.storyboards.start(fixture.work.id, [episodeId], { maxShots: '6' });
    await fixture.runner.whenIdle();

    const requests = fixture.text.requests.filter((request) => request.user.includes('# 任务：生成分镜脚本'));
    assert.equal(requests.length, 3, '三个场次各一批');
    assert.ok(requests[0].user.includes('第 1 批') && requests[0].user.includes('第1场 地点1') && !requests[0].user.includes('第2场 地点2'));
    assert.ok(!requests[0].user.includes('最后一个镜头属于'), '第一批没有前面的镜头');
    assert.ok(requests[1].user.includes('第 2 批') && requests[1].user.includes('最后一个镜头属于“第01场”') && !requests[1].user.includes('第1场 地点1'));
    assert.ok(requests.every((request) => request.user.includes('本批镜头总数不超过 2 个') && request.user.includes('本批的时长预算为')));
    assert.ok(requests[2].user.includes('第 3 批') && requests[2].user.includes('第3场 地点3'));

    const view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.equal(view.run.display, 'pending');
    assert.deepEqual(view.shots.map((shot) => shot.seq), [1, 2, 3, 4, 5, 6]);
    assert.equal(view.totalSeconds, 24);
  } finally {
    fixture.database.close();
  }
});

test('分批：镜头总数上限太小，每批至少 1 个镜头都放不下时失败并给出提示；不分批的短正文仍是一次调用', async () => {
  const fixture = await createFixture('单个短视频', true, standardResponder, 50);
  try {
    useSceneText(fixture);
    const episodeId = firstEpisodeId(fixture);
    await fixture.storyboards.start(fixture.work.id, [episodeId], { maxShots: '2' });
    await fixture.runner.whenIdle();
    const view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.equal(view.run.display, 'failed');
    assert.match(view.run.errorMessage ?? '', /镜头总数上限太小.*3 批/);
  } finally {
    fixture.database.close();
  }

  const short = await createFixture('单个短视频', true, standardResponder, 5000);
  try {
    useSceneText(short);
    await short.storyboards.start(short.work.id, [firstEpisodeId(short)], {});
    await short.runner.whenIdle();
    const requests = short.text.requests.filter((request) => request.user.includes('# 任务：生成分镜脚本'));
    assert.equal(requests.length, 1);
    assert.ok(!requests[0].user.includes('分 3 批') && requests[0].user.includes('本集目标时长为'));
  } finally {
    short.database.close();
  }
});

/** 只含签名与 IHDR 的 PNG 文件头，宽高写在固定位置；extra 追加几个字节以区分不同的图片。 */
function pngHeader(width: number, height: number, extra = 0): Buffer {
  const content = Buffer.alloc(33 + extra, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(content);
  content.writeUInt32BE(13, 8);
  content.write('IHDR', 12);
  content.writeUInt32BE(width, 16);
  content.writeUInt32BE(height, 20);
  return content;
}

/** 界面提交的首帧图片：文件名、类型、大小与 Base64 内容。 */
function firstFrameFile(content: Buffer, name = 'tail.png') {
  return { name, mimeType: 'image/png', size: content.length, data: content.toString('base64') };
}

test('首帧图片：指定的本地图片保存为本地文件，可预览、保留、更换、移除，删除镜头后文件一并清理', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    const [run] = await fixture.storyboards.start(fixture.work.id, [episodeId], {});
    await fixture.runner.whenIdle();
    const second = fixture.storyboards.getView(fixture.work.id, episodeId).shots[1];
    const base = { ref: second.id, prompt: second.prompt, durationSeconds: 5, entityIds: second.entityIds, sounds: [] };
    const shotOf = () => fixture.storyboards.getView(fixture.work.id, episodeId).shots[1];
    assert.equal(shotOf().firstFrameImage, null);

    // 指定：内容落盘，库里只有说明信息，宽高由服务端读取。
    const png = pngHeader(1280, 720);
    fixture.storyboards.saveShot(run.id, { ...base, firstFrameMode: 'image', firstFrameImage: firstFrameFile(png) });
    const saved = shotOf();
    assert.equal(saved.firstFrameMode, 'image');
    assert.deepEqual(
      [saved.firstFrameImage?.fileName, saved.firstFrameImage?.mime, saved.firstFrameImage?.width, saved.firstFrameImage?.height, saved.firstFrameImage?.sizeBytes],
      ['tail.png', 'image/png', 1280, 720, png.length]
    );
    assert.equal(fixture.files.files.size, 1);
    const preview = fixture.storyboards.readFirstFrameImage(run.id, { ref: second.id });
    assert.deepEqual(
      [preview.name, preview.mimeType, preview.size, preview.width, preview.height, Buffer.from(preview.data, 'base64').equals(png)],
      ['tail.png', 'image/png', png.length, 1280, 720, true]
    );

    // 保留：不带图片字段时沿用已保存的图片，图片标识不变。
    fixture.storyboards.saveShot(run.id, { ...base, prompt: '改了画面描述', firstFrameMode: 'image' });
    assert.equal(shotOf().firstFrameImage?.id, saved.firstFrameImage?.id);
    assert.equal(fixture.files.files.size, 1);

    // 更换：新图片落盘，旧文件被删除。
    const replacement = pngHeader(640, 360, 5);
    fixture.storyboards.saveShot(run.id, { ...base, firstFrameMode: 'image', firstFrameImage: firstFrameFile(replacement, 'new.png') });
    assert.notEqual(shotOf().firstFrameImage?.id, saved.firstFrameImage?.id);
    assert.deepEqual([shotOf().firstFrameImage?.fileName, shotOf().firstFrameImage?.width], ['new.png', 640]);
    assert.equal(fixture.files.files.size, 1, '旧图片文件被删除');
    assert.ok(Buffer.from(fixture.storyboards.readFirstFrameImage(run.id, { ref: second.id }).data, 'base64').equals(replacement));

    // 被拒绝的保存不改变已保存的图片：移除（传空）、不是图片、没带图片的新镜头。
    assert.throws(() => fixture.storyboards.saveShot(run.id, { ...base, firstFrameMode: 'image', firstFrameImage: null }), ValidationError);
    assert.throws(() => fixture.storyboards.saveShot(run.id, { ...base, firstFrameMode: 'image', firstFrameImage: firstFrameFile(Buffer.from('text')) }), ValidationError);
    assert.equal(shotOf().firstFrameImage?.fileName, 'new.png');
    assert.equal(fixture.files.files.size, 1);

    // 换成其他首帧来源：图片记录和文件都被删除。
    fixture.storyboards.saveShot(run.id, { ...base, firstFrameMode: 'none' });
    assert.equal(shotOf().firstFrameImage, null);
    assert.equal(fixture.files.files.size, 0);
    assert.throws(() => fixture.storyboards.readFirstFrameImage(run.id, { ref: second.id }), NotFoundError);
    assert.throws(() => fixture.storyboards.saveShot(run.id, { ...base, firstFrameMode: 'image' }), ValidationError, '没有保存的图片也没选新图片');

    // 删除镜头：它的首帧图片文件一并清理。
    fixture.storyboards.saveShot(run.id, { ...base, firstFrameMode: 'image', firstFrameImage: firstFrameFile(png) });
    assert.equal(fixture.files.files.size, 1);
    fixture.storyboards.deleteShot(run.id, { ref: second.id });
    assert.equal(fixture.files.files.size, 0);
  } finally {
    fixture.database.close();
  }
});

test('首帧图片：新增镜头时可以直接指定；图片文件丢失时读取提示重新选择', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    const [run] = await fixture.storyboards.start(fixture.work.id, [episodeId], {});
    await fixture.runner.whenIdle();

    const added = fixture.storyboards.addShot(run.id, { prompt: '新镜头', durationSeconds: 3, entityIds: [], sounds: [], firstFrameMode: 'image', firstFrameImage: firstFrameFile(pngHeader(100, 50)) });
    const shot = fixture.storyboards.getView(fixture.work.id, episodeId).shots.find((item) => item.id === added);
    assert.deepEqual([shot?.firstFrameMode, shot?.firstFrameImage?.width, shot?.firstFrameImage?.height], ['image', 100, 50]);
    assert.throws(
      () => fixture.storyboards.addShot(run.id, { prompt: '没有图片', durationSeconds: 3, entityIds: [], sounds: [], firstFrameMode: 'image' }),
      (error) => error instanceof ValidationError && error.fieldErrors.firstFrameImage !== undefined
    );
    assert.equal(fixture.files.files.size, 1);

    for (const path of fixture.files.list()) fixture.files.remove(path);
    assert.throws(() => fixture.storyboards.readFirstFrameImage(run.id, { ref: added }), /重新选择/);
  } finally {
    fixture.database.close();
  }
});

test('视图：组间硬切处景别和机位都没变时给出衔接提醒，镜头改了景别后提醒消失', async () => {
  const fixture = await createFixture();
  try {
    const episodeId = firstEpisodeId(fixture);
    const [run] = await fixture.storyboards.start(fixture.work.id, [episodeId], { groupMaxSeconds: '4' });
    await fixture.runner.whenIdle();
    let view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.deepEqual(view.groups.map((group) => group.shotIds.length), [1, 1]);
    assert.deepEqual(view.cutNotices, [], '远景切特写是有效的硬切');

    const second = view.shots[1];
    const base = { ref: second.id, sceneLabel: '第01场', cameraAngle: '平视', prompt: second.prompt, durationSeconds: 4, firstFrameMode: 'none', entityIds: second.entityIds, sounds: [] };
    fixture.storyboards.saveShot(run.id, { ...base, shotSize: '远景' });
    view = fixture.storyboards.getView(fixture.work.id, episodeId);
    assert.deepEqual(view.cutNotices.map((notice) => [notice.shotId, notice.code]), [[second.id, 'cut_unchanged']]);

    fixture.storyboards.saveShot(run.id, { ...base, shotSize: '近景' });
    assert.deepEqual(fixture.storyboards.getView(fixture.work.id, episodeId).cutNotices, []);
  } finally {
    fixture.database.close();
  }
});