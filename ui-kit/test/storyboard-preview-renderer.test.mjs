// ------------------------------------------------------------------------
// 名称：storyboard-preview-renderer.test.mjs
// 说明：分镜动画舞台绘制的单元测试：用记录调用的假画布上下文检查名称、动作文字、说话光环、字幕换行与行数、标签、站位网格、转场叠加与空状态；不比较像素。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：jsdom 没有 Canvas，所以只断言绘制调用；每个字符的宽度按 10 像素估算。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDS, loadRenderStack, makeShot, makeSound, makeStaging, makeView } from './storyboard-preview-fixtures.mjs';

const { timeline, sampler, renderer, modes, art, creatures } = loadRenderStack();

const SIZE = { width: 800, height: 450 };

/** 记录调用的假上下文：每次方法调用记入 calls，属性赋值直接保存；文字宽度每字 10 像素。 */
function createFakeContext() {
  const calls = [];
  const target = { calls, measureText: (text) => ({ width: [...String(text)].length * 10 }) };
  return new Proxy(target, {
    get: (object, name) => (name in object ? object[name] : (...args) => calls.push([name, ...args])),
    set: (object, name, value) => {
      object[name] = value;
      return true;
    }
  });
}

/** 画一帧，返回记录的调用。 */
function render(view, time, display, extra = {}) {
  const compiled = timeline.compile(view);
  const frame = sampler.sampleFrame(compiled, time);
  const ctx = createFakeContext();
  renderer.draw(ctx, frame, { ...SIZE, display, ...extra });
  return ctx.calls;
}

/** 所有 fillText 绘制的文字。 */
function textsOf(calls) {
  return calls.filter((call) => call[0] === 'fillText').map((call) => call[1]);
}

/** 一个有刺猬（左）与蝙蝠（右）、道具、特效的镜头。 */
function sceneShot(overrides = {}) {
  return makeShot(1, {
    entityIds: [IDS.cave, IDS.hedgehog, IDS.bat, IDS.table, IDS.spark],
    staging: [
      makeStaging(IDS.hedgehog, { startX: 'left', startDepth: 'middle', action: '抬头观察' }),
      makeStaging(IDS.bat, { startX: 'right', startDepth: 'back', facing: 'left' }),
      makeStaging(IDS.table, { startX: 'center', startDepth: 'back' }),
      makeStaging(IDS.spark, { startX: 'center', startDepth: 'front' })
    ],
    ...overrides
  });
}

test('名称与动作：角色名、道具名、特效名、场景名与动作文字被绘制；关闭名称后不画角色名和道具名', () => {
  const texts = textsOf(render(makeView([sceneShot()]), 1));
  for (const expected of ['刺猬', '蝙蝠', '桌子', '火花', '岩石洞穴', '抬头观察']) assert.ok(texts.includes(expected), `缺少文字 ${expected}`);
  const hidden = textsOf(render(makeView([sceneShot()]), 1, { names: false, actions: false }));
  for (const absent of ['刺猬', '蝙蝠', '桌子', '火花', '抬头观察']) assert.ok(!hidden.includes(absent), `不应出现 ${absent}`);
  assert.ok(hidden.includes('岩石洞穴'), '场景名始终显示');
});

test('未设站位的角色名后带“（未设站位）”并使用虚线轮廓', () => {
  const calls = render(makeView([makeShot(1, { entityIds: [IDS.hedgehog] })]), 1);
  assert.ok(textsOf(calls).includes('刺猬（未设站位）'));
  assert.ok(calls.some((call) => call[0] === 'setLineDash' && call[1].length === 2));
});

test('过长的名称与动作被截断并加省略号', () => {
  const view = makeView([sceneShot({ staging: [makeStaging(IDS.hedgehog, { startX: 'left', action: '一二三四五六七八九十一二三四' })] })]);
  assert.ok(textsOf(render(view, 1)).includes('一二三四五六七八九十一二…'));
});

test('说话光环：说话的角色多画一圈；不说话或没有字幕时没有', () => {
  const talking = sceneShot({ sounds: [makeSound({ speakerEntityId: IDS.hedgehog, text: '你好', startOffsetSeconds: 0, durationSeconds: 2 })] });
  const arcsOf = (calls) => calls.filter((call) => call[0] === 'arc').length;
  const speaking = arcsOf(render(makeView([talking]), 1));
  const silent = arcsOf(render(makeView([sceneShot()]), 1));
  assert.equal(speaking, silent + 1);
});

test('字幕：对白带说话人前缀，旁白带“旁白：”；字幕关闭时不画', () => {
  const view = makeView([
    sceneShot({
      sounds: [makeSound({ speakerEntityId: IDS.hedgehog, text: '我想看看洞穴里面。', startOffsetSeconds: 0, durationSeconds: 3 })]
    })
  ]);
  assert.ok(textsOf(render(view, 1)).includes('刺猬：我想看看洞穴里面。'));
  assert.ok(!textsOf(render(view, 1, { captions: false })).includes('刺猬：我想看看洞穴里面。'));
  const narration = makeView([sceneShot({ sounds: [makeSound({ kind: 'narration', text: '森林里又多了几位朋友。', startOffsetSeconds: 0, durationSeconds: 3 })] })]);
  assert.ok(textsOf(render(narration, 1)).includes('旁白：森林里又多了几位朋友。'));
});

test('字幕换行：单条字幕最多两行，放不下的以省略号结尾；同时两条字幕各一行', () => {
  const long = '一二三四五六七八九十'.repeat(20);
  const single = makeView([sceneShot({ sounds: [makeSound({ speakerEntityId: IDS.hedgehog, text: long, startOffsetSeconds: 0, durationSeconds: 3 })] })]);
  const lines = textsOf(render(single, 1)).filter((text) => text.includes('一二三'));
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith('…'));
  assert.ok(lines.every((line) => [...line].length * 10 <= SIZE.width * 0.9), '每行不超过字幕最大宽度');

  const double = makeView([
    sceneShot({
      sounds: [
        makeSound({ speakerEntityId: IDS.hedgehog, text: long, startOffsetSeconds: 0, durationSeconds: 3 }),
        makeSound({ kind: 'narration', text: long, startOffsetSeconds: 0, durationSeconds: 3 })
      ]
    })
  ]);
  assert.equal(textsOf(render(double, 1)).filter((text) => text.includes('一二三')).length, 2);
});

test('换行函数：不超宽的文字一行；超出行数时最后一行以省略号结尾', () => {
  const ctx = createFakeContext();
  assert.deepEqual(renderer.wrapLines(ctx, '短文字', 100, 2), ['短文字']);
  const lines = renderer.wrapLines(ctx, '一二三四五六七八九十', 30, 2);
  assert.deepEqual(lines, ['一二三', '四五…']);
});

test('标签：音效显示在右上，背景音乐显示在左上第二行；关闭运镜时不做变换', () => {
  const view = makeView([
    sceneShot({
      cameraMovement: '推近',
      sounds: [makeSound({ kind: 'sfx', text: '水滴声', startOffsetSeconds: 0, durationSeconds: 3 }), makeSound({ kind: 'music', text: '神秘的木管', startOffsetSeconds: 0, durationSeconds: 4 })]
    })
  ]);
  const texts = textsOf(render(view, 2));
  assert.ok(texts.includes('音效：水滴声') && texts.includes('背景音乐：神秘的木管'));
  const scaleCalls = (calls) => calls.filter((call) => call[0] === 'scale').length;
  assert.equal(scaleCalls(render(view, 2)), 1);
  assert.equal(scaleCalls(render(view, 2, { camera: false })), 0);
});

test('站位网格：打开后画出左、中、右和背景、中景、前景的标注；默认不画', () => {
  const view = makeView([sceneShot()]);
  assert.ok(!textsOf(render(view, 1)).includes('背景'));
  const texts = textsOf(render(view, 1, { grid: true }));
  for (const label of ['左', '中', '右', '背景', '中景', '前景']) assert.ok(texts.includes(label), `缺少网格标注 ${label}`);
});

test('转场叠加：淡出画黑色遮罩，闪白画白色遮罩；叠化再画一次舞台层', () => {
  const fill = (calls) => calls.filter((call) => call[0] === 'fillRect').length;
  const view = (transition) => makeView([sceneShot({ transition }), makeShot(2)]);
  const plain = render(view('切'), 3.95);
  const faded = render(view('淡出'), 3.98);
  assert.equal(fill(faded) - fill(plain), 1, '多画一层变黑遮罩');
  const dissolved = render(view('叠化'), 4.1);
  assert.ok(fill(dissolved) > fill(plain), '叠化时叠加了上一镜头的画面');
});

test('空状态：画深色底与居中的提示文字', () => {
  const ctx = createFakeContext();
  renderer.drawEmpty(ctx, 800, 450, '分镜脚本生成完成后可以预览');
  assert.deepEqual(textsOf(ctx.calls), ['分镜脚本生成完成后可以预览']);
  assert.ok(ctx.calls.some((call) => call[0] === 'fillRect'));
});

test('镜头信息：左上角依次是场景名与“第 N / M 镜 · 景别 · 机位 · 运镜 · 时长”；hud 关闭时都不画', () => {
  const view = makeView([sceneShot({ cameraMovement: '推近' }), makeShot(2)]);
  const texts = textsOf(render(view, 1));
  assert.ok(texts.includes('第 1 / 2 镜 · 中景 · 平视 · 推近 · 4 秒'));
  assert.ok(texts.includes('岩石洞穴'));
  const quiet = textsOf(render(view, 1, undefined, { hud: false }));
  assert.ok(!quiet.includes('岩石洞穴') && !quiet.some((text) => text.startsWith('第 1')));
});

test('画面描述条：底部显示“画面：…”，字幕让到它上方；关闭后不画', () => {
  const view = makeView([sceneShot({ prompt: '洞穴里有一张桌子和两个小动物。', sounds: [makeSound({ speakerEntityId: IDS.hedgehog, text: '你好', startOffsetSeconds: 0, durationSeconds: 2 })] })]);
  assert.ok(textsOf(render(view, 1)).includes('画面：洞穴里有一张桌子和两个小动物。'));
  assert.ok(!textsOf(render(view, 1, { description: false })).includes('画面：洞穴里有一张桌子和两个小动物。'));
  const captionTop = (display) => render(view, 1, display).find((call) => call[0] === 'fillText' && call[1] === '刺猬：你好')[3];
  assert.ok(captionTop({ description: true }) < captionTop({ description: false }), '有描述条时字幕上移');
});

test('走位轨迹与朝向：打开时画虚线轨迹和扇形，关闭后不画；取景框同理', () => {
  const walking = makeView([makeShot(1, { entityIds: [IDS.hedgehog], staging: [makeStaging(IDS.hedgehog, { startX: 'left', endX: 'right' })] })]);
  const dashes = (display) => render(walking, 2, display).filter((call) => call[0] === 'setLineDash' && call[1].length === 2 && call[1][0] === 6 && call[1][1] === 5).length;
  assert.equal(dashes({ trail: true }), 1);
  assert.equal(dashes({ trail: false }), 0);
  const strokes = (display) => render(walking, 2, display).filter((call) => call[0] === 'stroke').length;
  assert.ok(strokes({ frame: true }) > strokes({ frame: false }), '取景框多画几笔');
});

test('资产图：角色头像、道具图块与场景背景使用传入的图片；没有图片时不调用 drawImage', () => {
  const view = makeView([sceneShot()]);
  const image = (name) => ({ element: { name }, width: 100, height: 100 });
  const images = new Map([[IDS.hedgehog, image('刺猬')], [IDS.table, image('桌子')], [IDS.cave, image('洞穴')]]);
  const used = render(view, 1, undefined, { images }).filter((call) => call[0] === 'drawImage').map((call) => call[1].name);
  assert.deepEqual(used.sort(), ['刺猬', '桌子', '洞穴']);
  assert.equal(render(view, 1).filter((call) => call[0] === 'drawImage').length, 0);
});

test('矢量插画：每种场景类型、时间、道具与特效图形都能画出，说话与行走状态不报错', () => {
  const compiled = timeline.compile(makeView([sceneShot({ sounds: [makeSound({ speakerEntityId: IDS.hedgehog, text: '你好', startOffsetSeconds: 0, durationSeconds: 3 })] })]));
  const frame = sampler.sampleFrame(compiled, 1);
  for (const setting of ['indoor', 'street', 'forest', 'cave', 'sea', 'field', 'generic']) {
    for (const time of ['day', 'dusk', 'dawn', 'night']) {
      const ctx = createFakeContext();
      renderer.draw(ctx, { ...frame, scene: { ...frame.scene, setting, time } }, { ...SIZE });
      assert.ok(ctx.calls.length > 20, `${setting}/${time} 有绘制内容`);
    }
  }
  const glyphProps = ['table', 'chair', 'door', 'window', 'light', 'weapon', 'book', 'box', 'bed', 'vehicle', 'plant', 'cup', 'phone', 'generic'];
  const glyphEffects = ['fire', 'smoke', 'rain', 'snow', 'light', 'spark'];
  const actors = [
    ...glyphProps.map((glyph, index) => ({ ...frame.actors.find((actor) => actor.kind === 'prop'), glyph, x: 0.1 + index * 0.05 })),
    ...glyphEffects.map((glyph, index) => ({ ...frame.actors.find((actor) => actor.kind === 'effect'), glyph, x: 0.2 + index * 0.1 }))
  ];
  const ctx = createFakeContext();
  renderer.draw(ctx, { ...frame, actors }, SIZE);
  assert.ok(ctx.calls.length > 100);
});

test('镜头对照：三幅画面并排带标题，没有上一镜的位置画提示；画面不画 hud', () => {
  const compiled = timeline.compile(makeView([sceneShot(), makeShot(2, { entityIds: [IDS.cave] })]));
  const panelsOf = (index) =>
    sampler.comparePanels(compiled, index).map((panel) => ({ label: panel.label, frame: panel.time === null ? null : sampler.sampleFrame(compiled, panel.time, { reducedMotion: true }) }));
  const first = createFakeContext();
  modes.drawCompare(first, panelsOf(0), { ...SIZE });
  assert.deepEqual(textsOf(first.calls).filter((text) => ['上一镜结尾', '本镜开头', '本镜结尾', '没有上一镜'].includes(text)), ['没有上一镜', '上一镜结尾', '本镜开头', '本镜结尾']);
  assert.equal(first.calls.filter((call) => call[0] === 'clip').length, 3);
  const second = createFakeContext();
  modes.drawCompare(second, panelsOf(1), { ...SIZE });
  assert.ok(!textsOf(second.calls).includes('没有上一镜'));
  assert.ok(!textsOf(second.calls).some((text) => text.startsWith('第 ')), '对照里的画面不带镜头信息卡');
});

test('调度俯视图：标题、网格标注、摄影机、实体名称、起点轨迹与上一镜终点；没有数据时画空状态', () => {
  const compiled = timeline.compile(
    makeView([
      makeShot(1, { entityIds: [IDS.hedgehog], staging: [makeStaging(IDS.hedgehog, { startX: 'left', endX: 'right' })] }),
      makeShot(2, { entityIds: [IDS.cave, IDS.hedgehog, IDS.bat], staging: [makeStaging(IDS.hedgehog, { startX: 'center', startDepth: 'front', endX: 'left', endDepth: 'front' })] })
    ])
  );
  const ctx = createFakeContext();
  modes.drawTopView(ctx, sampler.buildTopView(compiled, 1, 5), { ...SIZE });
  const texts = textsOf(ctx.calls);
  for (const expected of ['第 2 镜 · 调度俯视图 · 岩石洞穴', '摄影机', '刺猬', '蝙蝠（未设站位）', '上一镜终点', '左外', '右外', '背景', '前景']) assert.ok(texts.includes(expected), `缺少文字 ${expected}`);
  const empty = createFakeContext();
  modes.drawTopView(empty, null, { ...SIZE, emptyText: '没有可预览的镜头' });
  assert.deepEqual(textsOf(empty.calls), ['没有可预览的镜头']);
});
test('非人类角色：每个种类都能画出，说话、行走、没有站位与资产头像都不报错，并给出头部位置与高度', () => {
  const { creatures } = loadRenderStack();
  const species = ['human', ...creatures.SPECIES];
  assert.ok(species.length >= 28);
  for (const kind of species) {
    for (const extra of [{}, { walking: true }, { speaking: true }, { placed: false }, { image: { element: { name: kind }, width: 64, height: 64 } }, { facing: 'left' }, { facing: 'away' }]) {
      const ctx = createFakeContext();
      const info = creatures.drawCharacter(ctx, { x: 400, y: 300, unit: 4, color: 'rgb(229, 72, 77)', facing: 'right', walking: false, speaking: false, placed: true, phase: 0.7, image: null, species: kind, seed: 3, ...extra });
      assert.ok(ctx.calls.length > 10, `${kind} 有绘制内容`);
      assert.ok([info.headX, info.headY, info.headR, info.height].every(Number.isFinite) && info.height > 5, `${kind} 返回头部位置与高度`);
      assert.ok(info.headY < 300, `${kind} 的头在脚的上方`);
    }
  }
});

test('非人类角色经渲染器画出：说话的动物也有光环；动物的名字在身体上方；有头像时调用 drawImage', () => {
  const squirrel = { ...makeView([]).entities[0], id: IDS.hedgehog, name: '松鼠' };
  const view = makeView([makeShot(1, { entityIds: [IDS.hedgehog], staging: [makeStaging(IDS.hedgehog, { startX: 'center', startDepth: 'middle' })], sounds: [makeSound({ speakerEntityId: IDS.hedgehog, text: '你好', startOffsetSeconds: 0, durationSeconds: 3 })] })], {
    entities: [squirrel]
  });
  const arcs = (calls) => calls.filter((call) => call[0] === 'arc').length;
  const speaking = render(view, 1);
  const silent = render(makeView([makeShot(1, { entityIds: [IDS.hedgehog], staging: [makeStaging(IDS.hedgehog, { startX: 'center', startDepth: 'middle' })] })], { entities: [squirrel] }), 1);
  assert.equal(arcs(speaking), arcs(silent) + 1);
  const label = speaking.find((call) => call[0] === 'fillText' && call[1] === '松鼠');
  assert.ok(label && label[3] < 0.72 * SIZE.height - 14 * 0.0072 * SIZE.height, '名字在 15u 高的松鼠上方');
  const images = new Map([[IDS.hedgehog, { element: { name: '头像' }, width: 64, height: 64 }]]);
  assert.deepEqual(render(view, 1, undefined, { images }).filter((call) => call[0] === 'drawImage').map((call) => call[1].name), ['头像']);
});

test('动作气泡：相邻角色的气泡不重叠', () => {
  const view = makeView([
    makeShot(1, {
      entityIds: [IDS.hedgehog, IDS.bat],
      staging: [makeStaging(IDS.hedgehog, { startX: 'center', startDepth: 'middle', action: '悬在半空中' }), makeStaging(IDS.bat, { startX: 'right', startDepth: 'middle', action: '蜷成小团后舒展身体' })]
    })
  ]);
  const calls = render(view, 1);
  const bubble = (text) => {
    const call = calls.find((entry) => entry[0] === 'fillText' && entry[1] === text);
    return { x: call[2], y: call[3], width: [...text].length * 10 };
  };
  const first = bubble('悬在半空中');
  const second = bubble('蜷成小团后舒展身体');
  assert.ok(Math.abs(first.x - second.x) >= (first.width + second.width) / 2 || Math.abs(first.y - second.y) >= 18, '横向错开或纵向错开');
});
test('人的各种年龄与性别、各种会说话的物品与植物、软体生物都能画出，并给出头部位置与高度；儿童与婴儿比成人矮', () => {
  const { creatures } = loadRenderStack();
  const base = { x: 400, y: 300, unit: 4, color: 'rgb(229, 72, 77)', facing: 'right', walking: false, speaking: false, placed: true, phase: 0.7, image: null, seed: 3 };
  const heights = {};
  for (const gender of ['male', 'female', 'unknown']) {
    for (const age of ['baby', 'child', 'teen', 'adult', 'elder']) {
      for (const extra of [{}, { walking: true, speaking: true }, { facing: 'away' }, { facing: 'camera', placed: false }, { image: { element: {}, width: 8, height: 8 } }]) {
        const ctx = createFakeContext();
        const info = creatures.drawCharacter(ctx, { ...base, species: 'human', gender, age, ...extra });
        assert.ok(ctx.calls.length > 10 && [info.headX, info.headY, info.headR, info.height].every(Number.isFinite), `${gender}/${age}`);
        assert.ok(info.headY < 300);
        if (Object.keys(extra).length === 0) heights[`${gender}/${age}`] = info.height;
      }
    }
  }
  assert.ok(heights['male/baby'] < heights['male/child'] && heights['male/child'] < heights['male/teen'] && heights['male/teen'] < heights['male/adult'], '年龄越小越矮');
  const glyphs = ['table', 'chair', 'door', 'window', 'light', 'weapon', 'book', 'box', 'bed', 'vehicle', 'plant', 'cup', 'phone', 'generic', 'flower', 'grass', 'tree', 'stone', 'mushroom', 'cactus'];
  for (const glyph of [...glyphs, 'unknown-glyph']) {
    for (const extra of [{}, { walking: true, speaking: true }, { facing: 'away' }, { image: { element: {}, width: 8, height: 8 } }]) {
      const ctx = createFakeContext();
      const info = creatures.drawCharacter(ctx, { ...base, species: 'thing', glyph, ...extra });
      assert.ok(ctx.calls.length > 10 && info.height > 10 && info.headY < 300, `物品 ${glyph}`);
    }
  }
  for (const extra of [{}, { walking: true, speaking: true }, { image: { element: {}, width: 8, height: 8 } }]) {
    const ctx = createFakeContext();
    assert.ok(creatures.drawCharacter(ctx, { ...base, species: 'blob', ...extra }).height > 10);
  }
});
test('托底：全部场景类型、全部道具与物品图形、全部特效图形，以及表里没有的名称都能画出', () => {
  const { creatures, art } = loadRenderStack();
  const compiled = timeline.compile(makeView([sceneShot()]));
  const frame = sampler.sampleFrame(compiled, 1);
  const settings = ['indoor', 'street', 'forest', 'cave', 'sea', 'field', 'space', 'underwater', 'sky', 'desert', 'snow', 'mountain', 'ruins', 'village', 'kitchen', 'bathroom', 'bedroom', 'hospital', 'classroom', 'shop', 'generic', '不存在的类型'];
  for (const setting of settings) {
    const ctx = createFakeContext();
    renderer.draw(ctx, { ...frame, scene: { ...frame.scene, setting, time: 'day' } }, { ...SIZE });
    assert.ok(ctx.calls.length > 20, `场景 ${setting}`);
  }
  const glyphs = [...Object.keys(art.PROPS), '表里没有的图形'];
  assert.ok(Object.keys(art.PROPS).length >= 90);
  const incomplete = Object.entries(art.PROPS).filter(([, def]) => typeof def.paint !== 'function' || !(def.height > 0) || !(def.face && def.face.r > 0 && def.face.cy > 0)).map(([glyph]) => glyph);
  assert.deepEqual(incomplete, [], '每种图形都有绘制函数、高度和脸的位置');
  const prop = frame.actors.find((actor) => actor.kind === 'prop');
  const base = { x: 400, y: 300, unit: 4, color: 'rgb(139, 107, 74)', facing: 'right', walking: false, speaking: false, placed: true, phase: 0.5, image: null, seed: 1 };
  for (const glyph of glyphs) {
    const propCtx = createFakeContext();
    renderer.draw(propCtx, { ...frame, actors: [{ ...prop, glyph }] }, SIZE);
    assert.ok(propCtx.calls.length > 20, `道具 ${glyph}`);
    const thingCtx = createFakeContext();
    assert.ok(creatures.drawCharacter(thingCtx, { ...base, species: 'thing', glyph }).height > 8, `物品角色 ${glyph}`);
  }
  const effect = frame.actors.find((actor) => actor.kind === 'effect');
  for (const glyph of ['fire', 'smoke', 'rain', 'snow', 'light', 'spark', 'lightning', 'magic', 'heart', 'notes', 'wind', 'bubbles', 'leaves', 'dark', 'shockwave', 'explosion', 'fireworks', 'projectile', 'muzzle', 'beam', 'laser', 'shadow', 'splash', 'slash', '表里没有的图形']) {
    for (const reducedMotion of [false, true]) {
      const ctx = createFakeContext();
      renderer.draw(ctx, { ...frame, actors: [{ ...effect, glyph }] }, { ...SIZE, reducedMotion });
      assert.ok(ctx.calls.length > 20, `特效 ${glyph}`);
    }
  }
});

/** 带透明度记录的假上下文：初始透明度为 initial；save 与 restore 按栈保存、恢复透明度；记录赋过的最大透明度。 */
function createAlphaContext(initial) {
  const state = { globalAlpha: initial, maxAlpha: initial, stack: [], measureText: (text) => ({ width: [...String(text)].length * 10 }) };
  return new Proxy(state, {
    get: (object, name) => {
      if (name === 'save') return () => object.stack.push(object.globalAlpha);
      if (name === 'restore') return () => { object.globalAlpha = object.stack.pop(); };
      return name in object ? object[name] : () => 0;
    },
    set: (object, name, value) => {
      object[name] = value;
      if (name === 'globalAlpha') object.maxAlpha = Math.max(object.maxAlpha, value);
      return true;
    }
  });
}

test('透明度：背景、道具、特效、角色在调用方设置的透明度基础上绘制并恢复，不会把透明度置回 1（否则叠化与淡出失效）', () => {
  const INITIAL = 0.5;
  const check = (label, draw) => {
    const ctx = createAlphaContext(INITIAL);
    draw(ctx);
    assert.ok(Math.abs(ctx.globalAlpha - INITIAL) < 1e-9, `${label}：结束后透明度应恢复为 ${INITIAL}，实际 ${ctx.globalAlpha}`);
    assert.ok(ctx.maxAlpha <= INITIAL + 1e-9, `${label}：绘制中透明度不应超过 ${INITIAL}，实际最大 ${ctx.maxAlpha}`);
  };
  const { scene } = sampler.sampleFrame(timeline.compile(makeView([sceneShot()])), 1);
  for (const setting of ['indoor', 'street', 'forest', 'cave', 'sea', 'field', 'space', 'underwater', 'sky', 'desert', 'snow', 'mountain', 'ruins', 'village', 'kitchen', 'bathroom', 'bedroom', 'hospital', 'classroom', 'shop', 'generic']) {
    for (const time of ['day', 'night', 'dusk']) {
      check(`背景 ${setting}/${time}`, (ctx) => art.drawBackdrop(ctx, { ...scene, setting, time }, 800, 450));
    }
  }
  for (const glyph of Object.keys(art.PROPS)) check(`道具 ${glyph}`, (ctx) => art.drawProp(ctx, glyph, 400, 300, 4, 'rgb(204, 136, 68)', false));
  for (const glyph of ['fire', 'smoke', 'rain', 'snow', 'light', 'lightning', 'magic', 'heart', 'notes', 'wind', 'bubbles', 'leaves', 'dark', 'shockwave', 'explosion', 'fireworks', 'projectile', 'beam', 'laser', 'shadow', 'splash', 'slash', 'unknown']) {
    check(`特效 ${glyph}`, (ctx) => art.drawEffect(ctx, glyph, 400, 300, 40, 'rgb(204, 136, 68)', 0.35, false, { angle: 0.3 }));
  }
  for (const species of creatures.SPECIES) {
    check(`角色 ${species}`, (ctx) =>
      creatures.drawCharacter(ctx, { x: 400, y: 300, unit: 4, color: 'rgb(204, 136, 68)', facing: 'right', walking: false, speaking: false, placed: true, phase: 1.2, image: null, species, gender: null, seed: 1 })
    );
  }
});