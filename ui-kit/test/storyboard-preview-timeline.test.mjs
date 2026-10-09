// ------------------------------------------------------------------------
// 名称：storyboard-preview-timeline.test.mjs
// 说明：分镜动画时间线编译与采样的单元测试：镜头时间、站位补全、没有站位的实体、声音时间、运镜与转场解析、移动曲线、字幕与说话状态、转场叠加、位置恢复。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：纯逻辑测试，不需要 DOM；夹具见 storyboard-preview-fixtures.mjs。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDS, loadTimeline, makeShot, makeSound, makeStaging, makeView } from './storyboard-preview-fixtures.mjs';

const timeline = loadTimeline();

/** 一个角色从画面左侧走到右侧的镜头。 */
function walkingShot(seq, overrides = {}) {
  return makeShot(seq, {
    entityIds: [IDS.hedgehog],
    staging: [makeStaging(IDS.hedgehog, { startX: 'left', startDepth: 'middle', endX: 'right' })],
    ...overrides
  });
}

test('镜头时间：起点是前面镜头时长之和，总时长是全部时长之和；按镜头序号排序', () => {
  const compiled = timeline.compile(makeView([makeShot(2, { durationSeconds: 3 }), makeShot(1, { durationSeconds: 2.5 }), makeShot(3, { durationSeconds: 4 })]));
  assert.deepEqual(compiled.shots.map((shot) => [shot.seq, shot.start, shot.end]), [[1, 0, 2.5], [2, 2.5, 5.5], [3, 5.5, 9.5]]);
  assert.equal(compiled.totalSeconds, 9.5);
});

test('镜头组：按视图的组划分并带起止时间；没有分组的镜头各成一段', () => {
  const view = makeView([makeShot(1), makeShot(2), makeShot(3)]);
  view.groups = [{ id: 1, seq: 1, shotIds: [101, 102], totalSeconds: 8 }];
  const compiled = timeline.compile(view);
  assert.deepEqual(compiled.shots.map((shot) => shot.groupSeq), [1, 1, null]);
  assert.deepEqual(compiled.groups.map((group) => [group.seq, group.firstIndex, group.lastIndex, group.start, group.end]), [[1, 0, 1, 0, 8], [null, 2, 2, 8, 12]]);
});

test('画幅：解析宽高比；缺失或无法解析按 16:9 并标明是缺省值；极端比例被限制', () => {
  assert.deepEqual(timeline.parseAspectRatio('9:16'), { width: 9, height: 16, ratio: 9 / 16, assumed: false });
  assert.equal(timeline.parseAspectRatio(null).assumed, true);
  assert.equal(timeline.parseAspectRatio('abc').ratio, 16 / 9);
  assert.equal(timeline.parseAspectRatio('0:5').assumed, true);
  assert.equal(timeline.parseAspectRatio('100:1').ratio, 21 / 9);
  assert.equal(timeline.compile(makeView([makeShot(1)], { aspectRatio: null })).aspect.assumed, true);
});

test('站位补全：缺起点用中央中景；只有一项终点时另一项沿用起点；没有终点则不移动', () => {
  const view = makeView([
    makeShot(1, {
      entityIds: [IDS.hedgehog, IDS.bat, IDS.table],
      staging: [
        makeStaging(IDS.hedgehog, { endX: 'right' }),
        makeStaging(IDS.bat, { startX: 'left', startDepth: 'front' }),
        makeStaging(IDS.table, { startX: 'center', startDepth: 'back', endDepth: 'front' })
      ]
    })
  ]);
  const [hedgehog, bat, table] = timeline.compile(view).shots[0].actors;
  assert.deepEqual(hedgehog.slot, { fromX: 'center', fromDepth: 'middle', toX: 'right', toDepth: 'middle' });
  assert.equal(hedgehog.isMoving, true);
  assert.deepEqual(bat.slot, { fromX: 'left', fromDepth: 'front', toX: 'left', toDepth: 'front' });
  assert.equal(bat.isMoving, false);
  assert.deepEqual(table.slot, { fromX: 'center', fromDepth: 'back', toX: 'center', toDepth: 'front' });
});

test('朝向：写了用写的；没写时移动朝向移动方向，不移动面向镜头', () => {
  const view = makeView([
    makeShot(1, {
      entityIds: [IDS.hedgehog, IDS.bat],
      staging: [makeStaging(IDS.hedgehog, { startX: 'right', endX: 'left' }), makeStaging(IDS.bat, { startX: 'center', facing: 'away' })]
    })
  ]);
  const [hedgehog, bat] = timeline.compile(view).shots[0].actors;
  assert.equal(hedgehog.facing, 'left');
  assert.equal(bat.facing, 'away');
  const still = timeline.compile(makeView([makeShot(1, { entityIds: [IDS.hedgehog], staging: [makeStaging(IDS.hedgehog, { startX: 'center' })] })]));
  assert.equal(still.shots[0].actors[0].facing, 'camera');
});

test('没有站位的实体：角色在中部等距排开并标记未摆放；道具、特效不绘制并单独列出；只填朝向不算摆放', () => {
  const view = makeView([
    makeShot(1, {
      entityIds: [IDS.hedgehog, IDS.bat, IDS.table, IDS.spark],
      staging: [makeStaging(IDS.bat, { facing: 'left', action: '观察' })]
    })
  ]);
  const shot = timeline.compile(view).shots[0];
  assert.deepEqual(shot.actors.map((actor) => [actor.name, actor.isPlaced]), [['刺猬', false], ['蝙蝠', false]]);
  assert.deepEqual([shot.actors[0].from.x, shot.actors[1].from.x], [0.3, 0.7]);
  assert.equal(shot.actors[1].facing, 'left');
  assert.equal(shot.actors[1].action, '观察');
  assert.deepEqual(shot.unplaced.map((item) => item.name), ['桌子', '火花']);
  const single = timeline.compile(makeView([makeShot(1, { entityIds: [IDS.hedgehog] })])).shots[0];
  assert.equal(single.actors[0].from.x, 0.5);
});

test('场景：取出场实体里的第一个场景，同一场景颜色一致；没有场景实体时按场次文字取色', () => {
  const view = makeView([
    makeShot(1, { entityIds: [IDS.cave, IDS.forest] }),
    makeShot(2, { entityIds: [IDS.cave] }),
    makeShot(3, { sceneLabel: '海边', entityIds: [] }),
    makeShot(4, { sceneLabel: '', entityIds: [] })
  ]);
  const shots = timeline.compile(view).shots;
  assert.equal(shots[0].scene.name, '岩石洞穴');
  assert.equal(shots[1].scene.wall, shots[0].scene.wall);
  assert.equal(shots[2].scene.name, '海边');
  assert.equal(shots[2].scene.entityId, null);
  assert.equal(shots[3].scene.name, '未命名场景');
  const first = timeline.compile(makeView([makeShot(1, { entityIds: [IDS.forest] })])).shots[0].scene;
  assert.notEqual(first.wall, shots[0].scene.wall, '不同场景实体颜色不同');
});

test('颜色：第一个角色是红色，同一角色在各镜头里颜色一致', () => {
  const view = makeView([walkingShot(1), walkingShot(2), makeShot(3, { entityIds: [IDS.bat] })]);
  const shots = timeline.compile(view).shots;
  assert.equal(shots[0].actors[0].color, '#E5484D');
  assert.equal(shots[1].actors[0].color, shots[0].actors[0].color);
  assert.notEqual(shots[2].actors[0].color, shots[0].actors[0].color);
});

test('声音时间：有开始无时长、无开始的人声依次接续、停用条目忽略、超出镜头被裁剪并标记', () => {
  const view = makeView([
    makeShot(1, {
      durationSeconds: 6,
      entityIds: [IDS.hedgehog],
      sounds: [
        makeSound({ speakerEntityId: IDS.hedgehog, text: '一二三四五六七八', durationSeconds: 1.5 }),
        makeSound({ speakerEntityId: IDS.hedgehog, text: '你好', startOffsetSeconds: null }),
        makeSound({ kind: 'sfx', text: '啪嗒', startOffsetSeconds: 2 }),
        makeSound({ kind: 'music', text: '轻柔', startOffsetSeconds: 1 }),
        makeSound({ kind: 'narration', text: '被停用', isEnabled: false }),
        makeSound({ kind: 'narration', text: '很长的旁白', startOffsetSeconds: 5, durationSeconds: 3 })
      ]
    })
  ]);
  const sounds = timeline.compile(view).shots[0].sounds;
  assert.equal(sounds.length, 5);
  assert.deepEqual([sounds[0].start, sounds[0].end, sounds[0].estimated], [0, 1.5, true], '没有开始时间，从 0 开始');
  assert.deepEqual([sounds[1].start, sounds[1].end], [1.5, 2.5], '接在上一条人声之后，估算时长不少于 1 秒');
  assert.deepEqual([sounds[2].start, sounds[2].end], [2, 3.5], '音效默认 1.5 秒');
  assert.deepEqual([sounds[3].start, sounds[3].end], [1, 6], '背景音乐延续到镜头结尾');
  assert.deepEqual([sounds[4].start, sounds[4].end, sounds[4].rawEnd, sounds[4].clipped, sounds[4].estimated], [5, 6, 8, true, false]);
  assert.equal(sounds[0].speakerName, '刺猬');
});

test('运镜解析：关键词、幅度修饰、固定、空与无法识别', () => {
  assert.deepEqual(timeline.parseCamera('固定镜头，摄影机静止'), { type: 'static', amount: 1, label: '固定镜头，摄影机静止', supported: true });
  assert.equal(timeline.parseCamera('推近').type, 'zoomIn');
  assert.equal(timeline.parseCamera('缓慢拉远').type, 'zoomOut');
  assert.equal(timeline.parseCamera('缓慢拉远').amount, 0.6);
  assert.equal(timeline.parseCamera('快速右摇').type, 'panRight');
  assert.equal(timeline.parseCamera('快速右摇').amount, 1.4);
  assert.equal(timeline.parseCamera('轻微上摇').type, 'tiltUp');
  assert.equal(timeline.parseCamera('环绕').type, 'orbit');
  assert.equal(timeline.parseCamera('手持跟拍').type, 'follow', '跟拍先于手持匹配');
  assert.equal(timeline.parseCamera('手持').type, 'handheld');
  assert.deepEqual(timeline.parseCamera(''), { type: 'none', amount: 1, label: '', supported: true });
  assert.deepEqual(timeline.parseCamera('神秘运镜'), { type: 'none', amount: 1, label: '神秘运镜', supported: false });
});

test('转场解析：叠化、淡出、淡入、闪白，其余按切', () => {
  assert.deepEqual(['叠化', '淡出', '淡入', '闪白', '切', '', '随便'].map(timeline.parseTransition), ['dissolve', 'fadeOut', 'fadeIn', 'flash', 'cut', 'cut', 'cut']);
});

test('定位与恢复：时间落在哪个镜头；末尾落在最后一个；镜头内偏移可恢复，镜头删除后返回 null', () => {
  const compiled = timeline.compile(makeView([makeShot(1, { durationSeconds: 2 }), makeShot(2, { durationSeconds: 3 })]));
  assert.deepEqual([0, 1.9, 2, 4.9, 5, 99].map((time) => timeline.locate(compiled, time)), [0, 0, 1, 1, 1, 1]);
  assert.equal(timeline.locate(timeline.compile(makeView([])), 1), -1);
  const saved = timeline.position(compiled, 3.5);
  assert.deepEqual(saved, { shotId: 102, offset: 1.5 });
  const rebuilt = timeline.compile(makeView([makeShot(1, { durationSeconds: 5 }), makeShot(2, { durationSeconds: 3 })]));
  assert.equal(timeline.restore(rebuilt, saved), 6.5);
  assert.equal(timeline.restore(timeline.compile(makeView([makeShot(1)])), saved), null);
  assert.equal(timeline.restore(rebuilt, { shotId: 102, offset: 99 }), 8, '偏移超出新时长时取镜头末尾');
});

test('移动曲线：开头与结尾各停留 10%，中点在两个位置之间；纵深变化时位置与缩放同步', () => {
  const view = makeView([walkingShot(1)]);
  const compiled = timeline.compile(view);
  const at = (time) => timeline.sampleFrame(compiled, time).actors[0];
  assert.equal(at(0).x, 0.22);
  assert.equal(at(0.4).x, 0.22, '停留结束时还在起点');
  assert.ok(Math.abs(at(2).x - 0.5) < 1e-9, '中点在两个位置正中');
  assert.equal(at(3.6).x, 0.78);
  assert.equal(at(4).x, 0.78, '镜头结束时停在终点');

  const deep = timeline.compile(makeView([makeShot(1, { entityIds: [IDS.hedgehog], staging: [makeStaging(IDS.hedgehog, { startX: 'center', startDepth: 'back', endDepth: 'front' })] })]));
  const start = timeline.sampleFrame(deep, 0).actors[0];
  const end = timeline.sampleFrame(deep, 4).actors[0];
  assert.deepEqual([start.y, start.scale, end.y, end.scale], [0.56, 0.7, 0.88, 1.35]);
});

test('移动起伏：移动中有上下起伏，减少动态效果时关闭，不移动时没有', () => {
  const compiled = timeline.compile(makeView([walkingShot(1)]));
  const flat = timeline.sampleFrame(compiled, 1.04, { reducedMotion: true }).actors[0];
  const bobbing = timeline.sampleFrame(compiled, 1.04).actors[0];
  assert.notEqual(bobbing.y, flat.y);
  const still = timeline.compile(makeView([makeShot(1, { entityIds: [IDS.hedgehog], staging: [makeStaging(IDS.hedgehog, { startX: 'center' })] })]));
  assert.equal(timeline.sampleFrame(still, 1.04).actors[0].y, timeline.sampleFrame(still, 2.04).actors[0].y);
});

test('字幕与说话：时间区间内显示，说话角色标记说话；同时最多两条；标签带淡入淡出透明度', () => {
  const view = makeView([
    makeShot(1, {
      durationSeconds: 6,
      entityIds: [IDS.hedgehog, IDS.bat],
      staging: [makeStaging(IDS.hedgehog, { startX: 'left' }), makeStaging(IDS.bat, { startX: 'right' })],
      sounds: [
        makeSound({ speakerEntityId: IDS.hedgehog, text: '你是来找朋友的吗？', startOffsetSeconds: 1, durationSeconds: 2 }),
        makeSound({ kind: 'narration', text: '洞穴深处传来回声。', startOffsetSeconds: 1.5, durationSeconds: 3 }),
        makeSound({ speakerEntityId: IDS.bat, text: '第三条', startOffsetSeconds: 1.8, durationSeconds: 1 }),
        makeSound({ kind: 'sfx', text: '水滴声', startOffsetSeconds: 2, durationSeconds: 1 })
      ]
    })
  ]);
  const compiled = timeline.compile(view);
  assert.deepEqual(timeline.sampleFrame(compiled, 0.5).captions, []);
  const early = timeline.sampleFrame(compiled, 1.2);
  assert.deepEqual(early.captions.map((caption) => [caption.kind, caption.speakerName, caption.text]), [['dialogue', '刺猬', '你是来找朋友的吗？']]);
  assert.deepEqual(early.actors.map((actor) => actor.isSpeaking), [true, false]);
  const crowded = timeline.sampleFrame(compiled, 2.1);
  assert.equal(crowded.captions.length, 2, '同时最多两条字幕');
  assert.deepEqual(crowded.captions.map((caption) => caption.text), ['你是来找朋友的吗？', '洞穴深处传来回声。']);
  assert.deepEqual(crowded.tags.map((tag) => [tag.kind, tag.text]), [['sfx', '水滴声']]);
  assert.ok(crowded.tags[0].opacity > 0 && crowded.tags[0].opacity < 1, '标签刚出现时半透明');
  assert.equal(timeline.sampleFrame(compiled, 2.5).tags[0].opacity, 1);
  assert.deepEqual(timeline.sampleFrame(compiled, 5.5).captions, [], '声音结束后字幕消失');
});

test('运镜采样：推近缩放增大、拉远缩放减小、固定不变；缩放不小于 1；跟拍向移动角色靠拢；手持在减少动态效果时不晃动', () => {
  const frameOf = (cameraMovement, time, options) => {
    const compiled = timeline.compile(makeView([walkingShot(1, { cameraMovement, shotSize: '全景' })]));
    return timeline.sampleFrame(compiled, time, options).camera;
  };
  assert.equal(frameOf('推近', 0).zoom, 1);
  assert.ok(Math.abs(frameOf('推近', 4).zoom - 1.15) < 1e-9);
  assert.ok(Math.abs(frameOf('拉远', 0).zoom - 1.15) < 1e-9);
  assert.equal(frameOf('拉远', 4).zoom, 1);
  assert.deepEqual(frameOf('固定镜头', 2), { zoom: 1, offsetX: 0, offsetY: 0, centerX: 0.5, centerY: 0.5 });
  assert.deepEqual(frameOf('神秘运镜', 2), { zoom: 1, offsetX: 0, offsetY: 0, centerX: 0.5, centerY: 0.5 });
  assert.ok(frameOf('左摇', 4).offsetX > 0 && frameOf('右摇', 4).offsetX < 0);
  assert.ok(frameOf('上摇', 4).offsetY > 0 && frameOf('下摇', 4).offsetY < 0);
  assert.ok(frameOf('缓慢推近', 4).zoom < frameOf('推近', 4).zoom);
  const early = frameOf('跟拍', 0.4);
  assert.ok(early.offsetX > 0, '角色在画面左侧时画面向右移动，让角色靠近中心');
  assert.deepEqual(frameOf('手持', 1.3, { reducedMotion: true }), { zoom: 1.02, offsetX: 0, offsetY: 0, centerX: 0.5, centerY: 0.5 });
  assert.notEqual(frameOf('手持', 1.3).offsetX, 0);
});

test('转场叠加：叠化在下一镜头开头带上一镜头结尾帧并淡出；淡出在镜头结尾变黑；淡入在下一镜头开头从黑出现；闪白在边界；切没有叠加', () => {
  const build = (transition) => timeline.compile(makeView([walkingShot(1, { transition }), makeShot(2)]));

  const dissolve = build('叠化');
  const mid = timeline.sampleFrame(dissolve, 4.25);
  assert.equal(mid.shotIndex, 1);
  assert.ok(mid.overlay.dissolve && mid.overlay.dissolve.alpha > 0 && mid.overlay.dissolve.alpha < 1);
  assert.equal(mid.overlay.dissolve.fromFrame.shotIndex, 0);
  assert.equal(mid.overlay.dissolve.fromFrame.actors[0].x, 0.78, '上一镜头的结尾帧');
  assert.equal(timeline.sampleFrame(dissolve, 5).overlay.dissolve, null, '叠化时长之后结束');

  const fadeOut = build('淡出');
  assert.equal(timeline.sampleFrame(fadeOut, 2).overlay.fadeToBlack, 0);
  assert.ok(timeline.sampleFrame(fadeOut, 3.98).overlay.fadeToBlack > 0.9);

  const fadeIn = build('淡入');
  assert.ok(timeline.sampleFrame(fadeIn, 4.01).overlay.fadeToBlack > 0.9);
  assert.equal(timeline.sampleFrame(fadeIn, 6).overlay.fadeToBlack, 0);

  const flash = build('闪白');
  assert.ok(timeline.sampleFrame(flash, 3.99).overlay.flashWhite > 0.9);
  assert.ok(timeline.sampleFrame(flash, 4.01).overlay.flashWhite > 0.9);
  assert.equal(timeline.sampleFrame(flash, 2).overlay.flashWhite, 0);
  const reduced = timeline.sampleFrame(flash, 4.05, { reducedMotion: true });
  assert.equal(reduced.overlay.flashWhite, 0, '减少动态效果时闪白改为叠化');
  assert.ok(reduced.overlay.dissolve);

  const cut = timeline.sampleFrame(build('切'), 4.05).overlay;
  assert.deepEqual(cut, { fadeToBlack: 0, flashWhite: 0, dissolve: null });
});

test('最后一个镜头只处理淡出；没有镜头时采样返回 null', () => {
  const last = timeline.compile(makeView([makeShot(1, { transition: '淡出' })]));
  assert.ok(timeline.sampleFrame(last, 3.99).overlay.fadeToBlack > 0.9);
  assert.equal(timeline.sampleFrame(timeline.compile(makeView([])), 0), null);
});

test('摘要：序号、场景与角色调度', () => {
  const compiled = timeline.compile(makeView([walkingShot(1, { entityIds: [IDS.cave, IDS.hedgehog, IDS.bat] })]));
  assert.equal(timeline.summarizeShot(compiled.shots[0]), '第 1 镜，岩石洞穴，刺猬从画面左侧中景走到画面右侧中景，面朝画面右侧，蝙蝠（没有站位）');
});

test('景别：按关键词给出取景放大倍数，近的先匹配；全景及更远不放大，无法识别时不放大', () => {
  const zoomOf = (text) => timeline.parseShotSize(text).zoom;
  assert.deepEqual(
    ['大特写', '特写', '近景', '中近景', '中景', '中全景', '全景', '大远景'].map(zoomOf),
    [3, 2.2, 1.8, 1.5, 1.3, 1.15, 1, 1]
  );
  assert.deepEqual(timeline.parseShotSize('神秘景别'), { zoom: 1, label: '神秘景别', supported: false });
  assert.equal(timeline.parseShotSize('').supported, false);
});

test('景别取景：放大时对准主体，特写取说话的角色，中景取所有角色的中心；全景在画面中央；中心限制在不露边的范围内', () => {
  const shot = (shotSize, overrides = {}) =>
    makeShot(1, {
      shotSize,
      entityIds: [IDS.hedgehog, IDS.bat],
      staging: [makeStaging(IDS.hedgehog, { startX: 'left', startDepth: 'middle' }), makeStaging(IDS.bat, { startX: 'right', startDepth: 'middle' })],
      sounds: [makeSound({ speakerEntityId: IDS.bat, text: '你好', startOffsetSeconds: 0, durationSeconds: 2 })],
      ...overrides
    });
  const cameraOf = (shotSize, overrides) => timeline.sampleFrame(timeline.compile(makeView([shot(shotSize, overrides)])), 0).camera;

  assert.deepEqual(cameraOf('全景'), { zoom: 1, offsetX: 0, offsetY: 0, centerX: 0.5, centerY: 0.5 });
  const closeUp = cameraOf('特写');
  assert.equal(closeUp.zoom, 2.2);
  assert.ok(Math.abs(closeUp.centerX - (1 - 0.5 / 2.2)) < 1e-9, '说话的蝙蝠在右侧，取景中心被限制在右边缘内');
  assert.ok(closeUp.centerY < 0.72, '特写对着头部，高于脚下位置');
  const medium = cameraOf('中景');
  assert.equal(medium.zoom, 1.3);
  assert.ok(Math.abs(medium.centerX - 0.5) < 1e-9, '两个角色左右对称，中心在画面中央');
  const noCharacter = timeline.sampleFrame(timeline.compile(makeView([makeShot(1, { shotSize: '特写' })])), 0).camera;
  assert.deepEqual([noCharacter.zoom, noCharacter.centerX, noCharacter.centerY], [2.2, 0.5, 0.5]);
});

test('景别与运镜叠加：缩放相乘', () => {
  const compiled = timeline.compile(makeView([walkingShot(1, { shotSize: '中景', cameraMovement: '推近' })]));
  assert.ok(Math.abs(timeline.sampleFrame(compiled, 4).camera.zoom - 1.3 * 1.15) < 1e-9);
});

test('场景归类：按场景名与场次文字判断地点和时间', () => {
  const classify = (text) => timeline.classifyScene(text);
  assert.deepEqual(classify('灯塔下的码头 傍晚'), { setting: 'sea', time: 'dusk' });
  assert.deepEqual(classify('山洞深处 夜'), { setting: 'cave', time: 'night' });
  assert.deepEqual(classify('第1场 地点1｜内景｜夜'), { setting: 'indoor', time: 'night' });
  assert.deepEqual(classify('老街路口｜外景｜清晨'), { setting: 'street', time: 'dawn' });
  assert.deepEqual(classify('松树林 白天'), { setting: 'forest', time: 'day' });
  assert.deepEqual(classify('一片草原'), { setting: 'field', time: 'day' });
  assert.deepEqual(classify('神秘的地方'), { setting: 'generic', time: 'day' });
  const compiled = timeline.compile(makeView([makeShot(1, { entityIds: [IDS.cave], sceneLabel: '洞内 夜晚' })]));
  assert.deepEqual([compiled.shots[0].scene.setting, compiled.shots[0].scene.time, typeof compiled.shots[0].scene.seed], ['cave', 'night', 'number']);
});

test('道具与特效归类：按名称选择图形，认不出的用通用图形', () => {
  assert.deepEqual(['木桌', '小椅子', '铁门', '台灯', '长剑', '旧书', '木箱', '汽车', '玩具'].map((name) => timeline.classifyProp(name)), ['table', 'chair', 'door', 'light', 'weapon', 'book', 'box', 'vehicle', 'generic']);
  assert.deepEqual(['火花', '火焰', '白烟', '大雨', '飘雪', '闪光'].map((name) => timeline.classifyEffect(name)), ['fire', 'fire', 'smoke', 'rain', 'snow', 'light']);
  const view = makeView([makeShot(1, { entityIds: [IDS.table, IDS.spark], staging: [makeStaging(IDS.table, { startX: 'center' }), makeStaging(IDS.spark, { startX: 'left' })] })]);
  assert.deepEqual(timeline.compile(view).shots[0].actors.map((actor) => actor.glyph), ['table', 'fire']);
});

test('采样附带镜头信息、走位轨迹与行走状态', () => {
  const compiled = timeline.compile(makeView([walkingShot(1, { cameraMovement: '推近', shotSize: '全景' }), makeShot(2)]));
  const frame = timeline.sampleFrame(compiled, 2);
  assert.deepEqual(
    { seq: frame.shot.seq, count: frame.shot.count, shotSize: frame.shot.shotSize, cameraMovement: frame.shot.cameraMovement, duration: frame.shot.duration, prompt: frame.shot.prompt },
    { seq: 1, count: 2, shotSize: '全景', cameraMovement: '推近', duration: 4, prompt: '镜头1的画面' }
  );
  const [actor] = frame.actors;
  assert.equal(actor.isWalking, true);
  assert.deepEqual([actor.path.fromX, actor.path.toX], [0.22, 0.78]);
  assert.equal(timeline.sampleFrame(compiled, 0).actors[0].isWalking, false, '开头停留不算行走');
  assert.equal(timeline.sampleFrame(compiled, 3.9).actors[0].isWalking, false, '结尾停留不算行走');
  assert.equal(frame.hasSpeaker, false);
  const still = timeline.compile(makeView([makeShot(1, { entityIds: [IDS.hedgehog], staging: [makeStaging(IDS.hedgehog, { startX: 'center' })] })]));
  assert.equal(timeline.sampleFrame(still, 1).actors[0].path, null);
});

test('调度俯视图：起点、终点、此刻位置与上一镜终点；位置没有变化时不画上一镜终点', () => {
  const compiled = timeline.compile(
    makeView([
      walkingShot(1),
      makeShot(2, { entityIds: [IDS.hedgehog, IDS.bat], staging: [makeStaging(IDS.hedgehog, { startX: 'center', startDepth: 'front' }), makeStaging(IDS.bat, { startX: 'left' })] }),
      makeShot(3, { entityIds: [IDS.hedgehog], staging: [makeStaging(IDS.hedgehog, { startX: 'center', startDepth: 'front' })] })
    ])
  );
  const first = timeline.buildTopView(compiled, 0, 0);
  assert.equal(first.hasPrevious, false);
  assert.deepEqual([first.actors[0].from, first.actors[0].to], [{ x: 0.22, row: 0.5 }, { x: 0.78, row: 0.5 }]);
  assert.deepEqual(first.actors[0].current, first.actors[0].from, '开头停在起点');
  assert.deepEqual(timeline.buildTopView(compiled, 0, 3.99).actors[0].current, { x: 0.78, row: 0.5 }, '结尾停在终点');

  const second = timeline.buildTopView(compiled, 1, 4.5);
  assert.equal(second.hasPrevious, true);
  assert.deepEqual(second.actors[0].ghost, { x: 0.78, row: 0.5 }, '刺猬上一镜终点在右侧，这一镜在中央前景');
  assert.equal(second.actors[1].ghost, null, '蝙蝠上一镜没有出场');
  assert.equal(timeline.buildTopView(compiled, 2, 8.5).actors[0].ghost, null, '位置没有变化');
  assert.equal(timeline.buildTopView(compiled, 9, 0), null);
});

test('镜头对照：上一镜结尾、本镜开头、本镜结尾；第一个镜头没有上一镜', () => {
  const compiled = timeline.compile(makeView([makeShot(1, { durationSeconds: 3 }), makeShot(2, { durationSeconds: 5 })]));
  assert.deepEqual(timeline.comparePanels(compiled, 1).map((panel) => [panel.key, panel.label, panel.time]), [
    ['previousEnd', '上一镜结尾', 2.98],
    ['start', '本镜开头', 3],
    ['end', '本镜结尾', 7.98]
  ]);
  assert.equal(timeline.comparePanels(compiled, 0)[0].time, null);
  assert.equal(timeline.sampleFrame(compiled, 2.98).shotIndex, 0, '上一镜结尾仍属于上一镜');
  assert.deepEqual(timeline.comparePanels(compiled, 5), []);
});
test('角色种类：河马是河马，不被当成马；人名“河马医生”也按河马画', () => {
  assert.equal(timeline.classifyCharacter('河马'), 'hippo');
  assert.equal(timeline.classifyCharacter('河马医生'), 'hippo');
  assert.equal(timeline.classifyCharacter('老马'), 'horse');
});

test('取景之外：景别放大对准说话的角色时，站位在另一侧的角色整个镜头都看不到；不放大、走入取景或站位本就在画面外的不算', () => {
  const shot = (shotSize, second = {}) =>
    makeShot(1, {
      shotSize,
      entityIds: [IDS.bat, IDS.hedgehog],
      staging: [makeStaging(IDS.bat, { startX: 'left' }), makeStaging(IDS.hedgehog, { startX: 'right', ...second })],
      sounds: [makeSound({ speakerEntityId: IDS.bat, text: '你好', startOffsetSeconds: 0, durationSeconds: 2 })]
    });
  const hidden = (shotSize, second) => [...timeline.framedOut(timeline.compile(makeView([shot(shotSize, second)])), 0)];
  assert.deepEqual(hidden('近景'), [IDS.hedgehog]);
  assert.deepEqual(hidden('特写'), [IDS.hedgehog]);
  assert.deepEqual(hidden('中景'), []);
  assert.deepEqual(hidden('全景'), []);
  assert.deepEqual(hidden('近景', { endX: 'left' }), [], '走进了取景范围');
  assert.deepEqual(hidden('近景', { startX: 'off_right', endX: 'off_right' }), [], '站位本就在画面外，另有检查提示');
  assert.deepEqual([...timeline.framedOut(timeline.compile(makeView([])), 0)], [], '没有镜头');
});

test('角色种类：动物、奇幻角色与人按名称归类；容易是姓氏的单字只在名称末尾才算；设定只看开头的身份介绍', () => {
  const classify = (name, hint) => timeline.classifyCharacter(name, hint);
  assert.deepEqual(
    ['松鼠', '刺猬', '蝙蝠', '小黑猫', '小白兔', '大灰狼', '小熊', '老马', '啄木鸟', '金鱼', '眼镜蛇', '蝴蝶'].map((name) => classify(name)),
    ['squirrel', 'hedgehog', 'bat', 'cat', 'rabbit', 'wolf', 'bear', 'horse', 'bird', 'fish', 'snake', 'butterfly']
  );
  assert.deepEqual(
    ['僵尸新郎', '山神', '小精灵', '邪灵', '魔鬼', '恶魔', '大怪物', '机器人', '天使'].map((name) => classify(name)),
    ['zombie', 'deity', 'elf', 'ghost', 'demon', 'demon', 'monster', 'robot', 'deity']
  );
  assert.deepEqual(['张三', '守夜人', '马丽', '马老师', '熊大', '林夏'].map((name) => classify(name)), ['human', 'human', 'human', 'human', 'human', 'human']);
  assert.equal(classify('熊大', '一只憨厚的熊'), 'bear');
  assert.equal(classify('小白', '是一只白色的小猫'), 'cat');
  assert.equal(classify('老陈', '专门猎杀怪物的猎人'), 'human');
  assert.equal(classify('阿福', '僵尸，行动迟缓'), 'zombie');
  assert.equal(classify('小松鼠', '一个穿着风衣的人'), 'squirrel', '名称优先');
});

test('角色种类带入编译与采样；非角色实体没有种类', () => {
  const view = makeView([makeShot(1, { entityIds: [IDS.hedgehog, IDS.table], staging: [makeStaging(IDS.hedgehog, { startX: 'left' }), makeStaging(IDS.table, { startX: 'right' })] })]);
  view.entities = view.entities.map((entity) => (entity.id === IDS.hedgehog ? { ...entity, hint: '一只小刺猬' } : entity));
  const [hedgehog, table] = timeline.sampleFrame(timeline.compile(view), 0).actors;
  assert.deepEqual([hedgehog.species, table.species], ['hedgehog', '']);
});
test('人的性别与年龄：按称呼判断男女、老人、儿童、婴儿；设定里的“女性”“70 岁”也认；认不出时性别未知、年龄成年', () => {
  const human = (name, hint) => timeline.classifyHuman(name, hint);
  assert.deepEqual(human('王奶奶'), { gender: 'female', age: 'elder' });
  assert.deepEqual(human('老爷爷'), { gender: 'male', age: 'elder' });
  assert.deepEqual(human('小女孩'), { gender: 'female', age: 'child' });
  assert.deepEqual(human('小男孩'), { gender: 'male', age: 'child' });
  assert.deepEqual(human('婴儿'), { gender: 'unknown', age: 'baby' });
  assert.deepEqual(human('公主'), { gender: 'female', age: 'adult' });
  assert.deepEqual(human('少年林川'), { gender: 'unknown', age: 'teen' });
  assert.deepEqual(human('张三'), { gender: 'unknown', age: 'adult' });
  assert.deepEqual(human('林夏', '女性，28 岁，律师'), { gender: 'female', age: 'adult' });
  assert.deepEqual(human('老陈', '男，72 岁，守塔人'), { gender: 'male', age: 'elder' });
  assert.deepEqual(human('小宝', '1 岁的男孩'), { gender: 'male', age: 'baby' });
  assert.deepEqual(human('阿明', '15 岁'), { gender: 'unknown', age: 'teen' });
});

test('会说话的物品与植物：名称里的多字词、设定里的“一朵…”“是一块…”认作 thing 并给出图形；人名里的单字和“守着灯塔的老人”不算', () => {
  const detail = (name, hint) => timeline.classifyCharacterDetail(name, hint);
  assert.deepEqual(detail('宝箱'), { species: 'thing', glyph: 'box' });
  assert.deepEqual(detail('石头'), { species: 'thing', glyph: 'stone' });
  assert.deepEqual(detail('花'), { species: 'thing', glyph: 'flower' });
  assert.deepEqual(detail('小红', '一朵会说话的花，住在窗台'), { species: 'thing', glyph: 'flower' });
  assert.deepEqual(detail('阿福', '是一块石头，穿越而来'), { species: 'thing', glyph: 'stone' });
  assert.deepEqual(detail('小草', ''), { species: 'thing', glyph: 'grass' });
  assert.deepEqual(detail('古树'), { species: 'thing', glyph: 'tree' });
  assert.deepEqual(detail('小花'), { species: 'human', glyph: '' }, '单字出现在名字里不算');
  assert.deepEqual(detail('阿信'), { species: 'human', glyph: '' });
  assert.deepEqual(detail('老陈', '守塔人；守着灯塔的老人'), { species: 'human', glyph: '' });
  assert.deepEqual(detail('小团', '无法形容的生物'), { species: 'blob', glyph: '' });
  assert.deepEqual(detail('史莱姆'), { species: 'blob', glyph: '' });
  assert.equal(timeline.classifyProp('花瓶'), 'cup');
  assert.deepEqual(['石桌', '玫瑰花', '一棵树', '蘑菇', '仙人掌'].map((name) => timeline.classifyProp(name)), ['table', 'flower', 'tree', 'mushroom', 'cactus']);
});

test('性别、年龄与物品图形带入编译与采样：只有人有性别和年龄，只有物品角色有图形', () => {
  const view = makeView([makeShot(1, { entityIds: [IDS.hedgehog, IDS.bat], staging: [makeStaging(IDS.hedgehog, { startX: 'left' }), makeStaging(IDS.bat, { startX: 'right' })] })]);
  view.entities = view.entities.map((entity) => (entity.id === IDS.hedgehog ? { ...entity, name: '王奶奶' } : entity.id === IDS.bat ? { ...entity, name: '宝箱' } : entity));
  const [grandma, box] = timeline.sampleFrame(timeline.compile(view), 0).actors;
  assert.deepEqual([grandma.species, grandma.gender, grandma.age, grandma.glyph], ['human', 'female', 'elder', '']);
  assert.deepEqual([box.species, box.gender, box.age, box.glyph], ['thing', '', '', 'box']);
});
test('场景归类扩展：太空、水下、天空、沙漠、雪地、高山、废墟、村庄；认不出的场景用通用背景', () => {
  const setting = (text) => timeline.classifyScene(text).setting;
  assert.deepEqual(
    ['空间站 夜', '海底龙宫', '云端天宫', '大漠 沙漠', '雪山脚下', '悬崖边', '古老废墟', '小山村', '山谷小路', '山洞', '神秘的地方'].map(setting),
    ['space', 'underwater', 'sky', 'desert', 'snow', 'mountain', 'ruins', 'village', 'forest', 'cave', 'generic']
  );
});

test('道具归类扩展：常见物品都有图形，认不出的用通用图形；特效同理用火花托底', () => {
  const prop = (name) => timeline.classifyProp(name);
  assert.deepEqual(
    ['电视', '闹钟', '魔镜', '钥匙', '雨伞', '皮球', '旗帜', '帐篷', '木桶', '路牌', '宝石', '吉他', '铁锅', '皇冠', '栅栏', '楼梯', '灯塔', '木屋', '城堡', '背包', '雕像', '神秘的东西'].map(prop),
    ['screen', 'clock', 'mirror', 'key', 'umbrella', 'ball', 'flag', 'tent', 'barrel', 'sign', 'gem', 'instrument', 'pot', 'crown', 'fence', 'stairs', 'tower', 'house', 'castle', 'bag', 'stone', 'generic']
  );
  const effect = (name) => timeline.classifyEffect(name);
  assert.deepEqual(
    ['闪电', '魔法阵', '爱心', '音符', '旋风', '泡泡', '落叶', '黑雾', '冲击波', '火焰', '白烟', '大雨', '飘雪', '闪光', '神秘的东西'].map(effect),
    ['lightning', 'magic', 'heart', 'notes', 'wind', 'bubbles', 'leaves', 'dark', 'shockwave', 'fire', 'smoke', 'rain', 'snow', 'light', 'spark']
  );
  assert.equal(timeline.classifyCharacterDetail('玻璃镜子').glyph, 'mirror');
  assert.equal(timeline.classifyCharacterDetail('小金', '是一把钥匙，会说话').glyph, 'key');
});

test('动物、昆虫与微生物：各自归到具体种类，容易混的（长颈鹿、骆驼、熊猫、老虎）不再被当成别的；认不出的兽类用野兽托底', () => {
  const classify = (name) => timeline.classifyCharacter(name);
  assert.deepEqual(
    ['大象', '长颈鹿', '骆驼', '熊猫', '老虎', '狮子', '猎豹', '斑马', '独角兽', '袋鼠', '鳄鱼', '乌龟', '蜥蜴', '恐龙', '猴子', '大猩猩', '犀牛', '河马'].map(classify),
    ['elephant', 'giraffe', 'camel', 'panda', 'tiger', 'lion', 'leopard', 'zebra', 'unicorn', 'kangaroo', 'crocodile', 'turtle', 'lizard', 'dinosaur', 'monkey', 'gorilla', 'rhino', 'hippo']
  );
  assert.deepEqual(
    ['公鸡', '小鸭', '大鹅', '猫头鹰', '鹦鹉', '企鹅', '老鹰', '孔雀', '鸵鸟', '鲨鱼', '鲸鱼', '章鱼', '水母', '螃蟹', '海星'].map(classify),
    ['chicken', 'duck', 'goose', 'owl', 'parrot', 'penguin', 'eagle', 'peacock', 'ostrich', 'shark', 'whale', 'octopus', 'jellyfish', 'crab', 'starfish']
  );
  assert.deepEqual(
    ['蜜蜂', '瓢虫', '蚂蚁', '蜘蛛', '蜻蜓', '蜗牛', '蚯蚓', '蟑螂', '苍蝇', '病毒', '细菌', '真菌', '变形虫'].map(classify),
    ['bee', 'ladybug', 'ant', 'spider', 'dragonfly', 'snail', 'worm', 'beetle', 'insect', 'virus', 'bacteria', 'fungus', 'amoeba']
  );
  assert.equal(classify('不明的野兽'), 'beast');
  assert.equal(classify('张三'), 'human');
});

test('家电、家具、厨卫、武器与特效：各有归类，具体的名称不被“锅”“柜”“光”这类笼统的字抢先', () => {
  const prop = (name) => timeline.classifyProp(name);
  assert.deepEqual(
    ['冰箱', '空调', '洗衣机', '微波炉', '吸油烟机', '燃气灶', '水槽', '马桶', '浴缸', '平底锅', '菜刀', '碗', '盘子', '筷子', '衣柜', '鞋柜', '沙发', '书架', '窗帘', '地毯', '黑板', '壁炉', '吊灯', '灯笼', '手电筒', '蜡烛', '炸弹', '大炮', '火箭', '弓箭', '盾牌', '锤子', '行李箱', '奖杯', '眼镜', '苹果', '蛋糕', '药瓶', '水井', '石桥'].map(prop),
    ['fridge', 'aircon', 'washer', 'microwave', 'hood', 'stove', 'sink', 'toilet', 'bathtub', 'pan', 'knife', 'bowl', 'plate', 'cutlery', 'cabinet', 'cabinet', 'sofa', 'shelf', 'curtain', 'carpet', 'blackboard', 'fireplace', 'chandelier', 'lantern', 'flashlight', 'candle', 'bomb', 'cannon', 'rocket', 'bow', 'shield', 'tool', 'suitcase', 'trophy', 'glasses', 'food', 'cake', 'medicine', 'well', 'bridge']
  );
  const effect = (name) => timeline.classifyEffect(name);
  assert.deepEqual(
    ['爆炸', '烟花', '子弹', '枪口火光', '激光', '舞台灯光', '阴影', '水花', '剑气', '火焰'].map(effect),
    ['explosion', 'fireworks', 'projectile', 'muzzle', 'laser', 'beam', 'shadow', 'splash', 'slash', 'fire']
  );
  assert.deepEqual(['抽油烟机', '蛋糕'].map((name) => timeline.classifyCharacterDetail(name).glyph), ['hood', 'cake']);
  const setting = (text) => timeline.classifyScene(text).setting;
  assert.deepEqual(['厨房 夜', '卫生间', '卧室', '医院病房', '教室', '便利店'].map(setting), ['kitchen', 'bathroom', 'bedroom', 'hospital', 'classroom', 'shop']);
});