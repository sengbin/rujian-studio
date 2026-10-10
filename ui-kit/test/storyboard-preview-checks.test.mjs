// ------------------------------------------------------------------------
// 名称：storyboard-preview-checks.test.mjs
// 说明：分镜动画质量检查的单元测试：每个检查编码各有触发与不触发的用例，以及汇总。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：纯逻辑测试；夹具见 storyboard-preview-fixtures.mjs。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDS, loadScript, loadScripts, makeShot, makeSound, makeStaging, makeView, TIMELINE_SCRIPTS } from './storyboard-preview-fixtures.mjs';

const timelineWindow = loadScripts(['shared/page-format.js', ...TIMELINE_SCRIPTS]);
const timeline = timelineWindow.aiStoryboardTimeline;
const checks = loadScript('stage/stage-storyboard-preview-checks.js', timelineWindow).aiStoryboardChecks;

/** 编译并检查一组镜头，返回检查项编码列表。 */
function codesOf(shots) {
  return checks.check(timeline.compile(makeView(shots))).map((entry) => entry.code);
}

/** 一个有角色、站位正常、时长合适的镜头；用作“不触发”的基线。 */
function cleanShot(seq, overrides = {}) {
  return makeShot(seq, {
    entityIds: [IDS.hedgehog],
    staging: [makeStaging(IDS.hedgehog, { startX: 'left', startDepth: 'middle' })],
    ...overrides
  });
}

test('基线：站位正常、时长合适、没有声音的镜头没有任何检查项', () => {
  assert.deepEqual(codesOf([cleanShot(1), cleanShot(2)]), []);
});

test('sound_overflow：声音超出镜头时长时警告并说明超出多少；刚好到结尾不触发', () => {
  const over = checks.check(timeline.compile(makeView([cleanShot(1, { sounds: [makeSound({ kind: 'sfx', startOffsetSeconds: 3, durationSeconds: 2.5 })] })])));
  assert.deepEqual(over.map((entry) => [entry.code, entry.level, entry.text]), [['sound_overflow', 'warning', '第 1 镜：声音超出镜头时长 1.5 秒，视频里会被截断。']]);
  assert.deepEqual(codesOf([cleanShot(1, { sounds: [makeSound({ kind: 'sfx', startOffsetSeconds: 3, durationSeconds: 1 })] })]), []);
});

test('speech_too_dense：持续时长不够说完台词时警告；时长够或没填时长（按估算）不触发', () => {
  const text = '一二三四五六七八九十一二';
  const dense = [cleanShot(1, { entityIds: [IDS.hedgehog], sounds: [makeSound({ speakerEntityId: IDS.hedgehog, text, startOffsetSeconds: 0, durationSeconds: 1 })] })];
  assert.deepEqual(codesOf(dense), ['speech_too_dense']);
  assert.match(checks.check(timeline.compile(makeView(dense)))[0].text, /约需 2 秒，只给了 1 秒/);
  assert.deepEqual(codesOf([cleanShot(1, { sounds: [makeSound({ speakerEntityId: IDS.hedgehog, text, startOffsetSeconds: 0, durationSeconds: 2 })] })]), []);
  assert.deepEqual(codesOf([cleanShot(1, { sounds: [makeSound({ speakerEntityId: IDS.hedgehog, text })] })]), []);
});

test('voice_overlap：两条人声时间重叠时警告一次；首尾相接或音效与人声同时出现不触发', () => {
  const sounds = [
    makeSound({ speakerEntityId: IDS.hedgehog, text: '你好', startOffsetSeconds: 0, durationSeconds: 2 }),
    makeSound({ kind: 'narration', text: '旁白', startOffsetSeconds: 1, durationSeconds: 2 }),
    makeSound({ kind: 'narration', text: '旁白二', startOffsetSeconds: 1.5, durationSeconds: 1 })
  ];
  assert.deepEqual(codesOf([cleanShot(1, { sounds })]), ['voice_overlap']);
  const adjacent = [makeSound({ speakerEntityId: IDS.hedgehog, text: '你好', startOffsetSeconds: 0, durationSeconds: 2 }), makeSound({ kind: 'narration', text: '旁白', startOffsetSeconds: 2, durationSeconds: 1 })];
  assert.deepEqual(codesOf([cleanShot(1, { sounds: adjacent })]), []);
  const withSfx = [makeSound({ speakerEntityId: IDS.hedgehog, text: '你好', startOffsetSeconds: 0, durationSeconds: 2 }), makeSound({ kind: 'sfx', text: '水滴', startOffsetSeconds: 0, durationSeconds: 1 })];
  assert.deepEqual(codesOf([cleanShot(1, { sounds: withSfx })]), []);
});

test('speaker_unplaced：说话人没有站位时警告，每个说话人只报一次；有站位不触发', () => {
  const sounds = [
    makeSound({ speakerEntityId: IDS.bat, text: '你好', startOffsetSeconds: 0, durationSeconds: 1 }),
    makeSound({ speakerEntityId: IDS.bat, text: '再见', startOffsetSeconds: 1, durationSeconds: 1 })
  ];
  const unplaced = makeShot(1, { entityIds: [IDS.hedgehog, IDS.bat], staging: [makeStaging(IDS.hedgehog, { startX: 'left' })], sounds });
  const found = checks.check(timeline.compile(makeView([unplaced])));
  assert.deepEqual(found.map((entry) => entry.code), ['speaker_unplaced']);
  assert.equal(found[0].text, '第 1 镜：说话人“蝙蝠”没有站位，预览里位置是随意排布的。');
  const placed = makeShot(1, { entityIds: [IDS.hedgehog, IDS.bat], staging: [makeStaging(IDS.hedgehog, { startX: 'left' }), makeStaging(IDS.bat, { startX: 'right' })], sounds });
  assert.deepEqual(codesOf([placed]), []);
});

test('actor_offscreen_all：起点终点在画面同一侧外时提示；从画面外进入或穿过画面不触发', () => {
  const shot = (staging) => cleanShot(1, { staging: [makeStaging(IDS.hedgehog, staging)] });
  assert.deepEqual(codesOf([shot({ startX: 'off_left' })]), ['actor_offscreen_all']);
  assert.deepEqual(codesOf([shot({ startX: 'off_right', endX: 'off_right' })]), ['actor_offscreen_all']);
  assert.deepEqual(codesOf([shot({ startX: 'off_left', endX: 'center' })]), []);
  assert.deepEqual(codesOf([shot({ startX: 'off_left', endX: 'off_right' })]), [], '穿过整个画面');
});

test('actor_framed_out：近景对准说话的角色，站位在另一侧的角色被拍到画面外时提示；中景、说话人也在远处、整个镜头本就在画面外的不重复提示', () => {
  const two = (shotSize, speaker = IDS.bat) =>
    makeShot(1, {
      shotSize,
      entityIds: [IDS.bat, IDS.hedgehog],
      staging: [makeStaging(IDS.bat, { startX: 'left', startDepth: 'middle' }), makeStaging(IDS.hedgehog, { startX: 'right', startDepth: 'middle' })],
      sounds: [makeSound({ speakerEntityId: speaker, text: '你好', startOffsetSeconds: 0, durationSeconds: 2 })]
    });
  const found = checks.check(timeline.compile(makeView([two('近景')])));
  assert.deepEqual(found.map((entry) => [entry.code, entry.level]), [['actor_framed_out', 'info']]);
  assert.equal(found[0].text, '第 1 镜：“刺猬”不在近景的取景范围内，画面里看不到；想让他入镜，可以换更大的景别，或把他的站位挪近主体。');
  assert.deepEqual(codesOf([two('近景', IDS.hedgehog)]).length, 1, '换成另一个说话人，被拍到画面外的是另一个角色');
  assert.deepEqual(codesOf([two('中景')]), [], '中景取所有角色的中心，都在画面里');
  assert.deepEqual(codesOf([two('全景')]), []);
  const entering = makeShot(1, {
    shotSize: '近景',
    entityIds: [IDS.bat, IDS.hedgehog],
    staging: [makeStaging(IDS.bat, { startX: 'left' }), makeStaging(IDS.hedgehog, { startX: 'right', endX: 'left' })],
    sounds: [makeSound({ speakerEntityId: IDS.bat, text: '你好', startOffsetSeconds: 0, durationSeconds: 2 })]
  });
  assert.deepEqual(codesOf([entering]), [], '镜头里走进了取景范围，不算看不到');
  const outside = makeShot(1, { shotSize: '近景', entityIds: [IDS.bat, IDS.hedgehog], staging: [makeStaging(IDS.bat, { startX: 'left' }), makeStaging(IDS.hedgehog, { startX: 'off_right', endX: 'off_right' })] });
  assert.deepEqual(codesOf([outside]), ['actor_offscreen_all'], '站位本来就在画面外的只提示一次');
});

test('position_jump：同一场景里相邻镜头位置相差两档以上提示；首帧接上一镜头尾帧时升为警告；不同场景或相差一档不触发', () => {
  const at = (seq, x, extra = {}) => cleanShot(seq, { sceneLabel: '洞穴', staging: [makeStaging(IDS.hedgehog, { startX: x })], ...extra });
  assert.deepEqual(codesOf([at(1, 'left'), at(2, 'right')]), ['position_jump']);
  const tail = checks.check(timeline.compile(makeView([at(1, 'left'), at(2, 'right', { firstFrameMode: 'prev_tail' })])));
  assert.deepEqual(tail.map((entry) => [entry.code, entry.level]), [['position_jump_tail', 'warning']]);
  assert.deepEqual(codesOf([at(1, 'left'), at(2, 'center')]), [], '只差一档');
  assert.deepEqual(codesOf([at(1, 'left'), at(2, 'right', { sceneLabel: '森林' })]), [], '场景不同');
  const depth = (seq, depthName) => cleanShot(seq, { sceneLabel: '洞穴', staging: [makeStaging(IDS.hedgehog, { startX: 'center', startDepth: depthName })] });
  assert.deepEqual(codesOf([depth(1, 'back'), depth(2, 'front')]), ['position_jump'], '纵深相差两档');
  const afterMove = cleanShot(1, { sceneLabel: '洞穴', staging: [makeStaging(IDS.hedgehog, { startX: 'left', endX: 'right' })] });
  assert.deepEqual(codesOf([afterMove, at(2, 'right')]), [], '上一镜头的终点才是衔接位置');
});

test('组间衔接提醒：宿主随视图下发的提醒挂在组首镜头上，以警告显示；没有提醒的镜头不触发', () => {
  const shots = [cleanShot(1), cleanShot(2)];
  const notice = { shotId: shots[1].id, code: 'cut_unchanged', text: '第 2 组开头与上一组最后一个镜头相比，景别和机位都没有变化。' };
  const items = checks.check(timeline.compile(makeView(shots, { cutNotices: [notice] })));
  assert.deepEqual(items.map((entry) => [entry.shotSeq, entry.code, entry.level]), [[2, 'cut_unchanged', 'warning']]);
  assert.match(items[0].text, /^第 2 镜：/);
});

test('no_actor：没有角色也没有人声时提示；有人声或有角色不触发', () => {
  assert.deepEqual(codesOf([makeShot(1)]), ['no_actor']);
  assert.deepEqual(codesOf([makeShot(1, { sounds: [makeSound({ kind: 'narration', text: '旁白', startOffsetSeconds: 0, durationSeconds: 2 })] })]), []);
  assert.deepEqual(codesOf([cleanShot(1)]), []);
});

test('duration_extreme：不足 1 秒或超过 10 秒时提示，边界值不触发', () => {
  assert.deepEqual(codesOf([cleanShot(1, { durationSeconds: 0.5 })]), ['duration_extreme']);
  assert.deepEqual(codesOf([cleanShot(1, { durationSeconds: 10.5 })]), ['duration_extreme']);
  assert.deepEqual(codesOf([cleanShot(1, { durationSeconds: 1 }), cleanShot(2, { durationSeconds: 10 })]), []);
});

test('camera_unsupported：运镜文字无法识别时提示；空文字、固定与可识别的运镜不触发', () => {
  const found = checks.check(timeline.compile(makeView([cleanShot(1, { cameraMovement: '神秘运镜' })])));
  assert.deepEqual(found.map((entry) => [entry.code, entry.text]), [['camera_unsupported', '第 1 镜：运镜“神秘运镜”预览未模拟。']]);
  assert.deepEqual(codesOf([cleanShot(1, { cameraMovement: '' }), cleanShot(2, { cameraMovement: '固定镜头' }), cleanShot(3, { cameraMovement: '推近' })]), []);
});

test('检查项带镜头标识与序号，按镜头顺序排列；汇总统计警告与提示的数量', () => {
  const found = checks.check(
    timeline.compile(makeView([makeShot(1), cleanShot(2, { sounds: [makeSound({ kind: 'sfx', startOffsetSeconds: 3, durationSeconds: 2.5 })] })]))
  );
  assert.deepEqual(found.map((entry) => [entry.shotId, entry.shotIndex, entry.shotSeq, entry.code]), [[101, 0, 1, 'no_actor'], [102, 1, 2, 'sound_overflow']]);
  assert.deepEqual(checks.summarize(found), { warnings: 1, infos: 1 });
  assert.deepEqual(checks.summarize([]), { warnings: 0, infos: 0 });
});
