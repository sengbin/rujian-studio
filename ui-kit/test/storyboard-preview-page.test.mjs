// ------------------------------------------------------------------------
// 名称：storyboard-preview-page.test.mjs
// 说明：分镜动画预览层（P10）的页面测试：打开与加载、播放控制、时间线跳转、键盘、检查列表跳转与编辑、数据刷新后保持位置、不可预览与加载失败的状态、重复打开、历史版本标记，以及从分镜脚本产出层的入口打开。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：使用 jsdom 加载组件库与 resources/stage 下的预览脚本，宿主请求用假的 hostBridge 应答；jsdom 没有 Canvas，用空操作的假上下文代替，绘制本身在 storyboard-preview-renderer.test.mjs 中检查；放在 ui-kit/test 是因为 npm test 只收集这里的页面测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { IDS, makeShot, makeSound, makeStaging, makeView, PREVIEW_PAGE_SCRIPTS as PREVIEW_SCRIPTS } from './storyboard-preview-fixtures.mjs';
import { createUiEnvironment, fire, pressKey } from './ui-environment.mjs';

const RESOURCES_ROOT = fileURLToPath(new URL('../../resources/', import.meta.url));
const WORK_ID = 1;
const EPISODE_ID = 7;

let env;

afterEach(() => env?.close());

/** 等待已排队的异步任务（含请求应答）执行完。 */
const flush = (milliseconds = 10) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** 三个镜头各 4 秒：第 1 镜角色走动并说话，第 2 镜静止，第 3 镜的音效超出镜头时长（一条警告）。 */
function previewView(overrides = {}) {
  return makeView(
    [
      makeShot(1, {
        entityIds: [IDS.hedgehog],
        staging: [makeStaging(IDS.hedgehog, { startX: 'left', endX: 'right' })],
        sounds: [makeSound({ speakerEntityId: IDS.hedgehog, text: '你好', startOffsetSeconds: 0, durationSeconds: 2 })]
      }),
      makeShot(2, { entityIds: [IDS.hedgehog], staging: [makeStaging(IDS.hedgehog, { startX: 'center' })] }),
      makeShot(3, {
        entityIds: [IDS.hedgehog],
        staging: [makeStaging(IDS.hedgehog, { startX: 'center' })],
        sounds: [makeSound({ kind: 'sfx', text: '水滴', startOffsetSeconds: 3, durationSeconds: 2.5 })]
      })
    ],
    overrides
  );
}

/** 建立测试页面：组件库、假宿主通信桥、空操作的画布上下文与预览脚本；aiStage 用记录调用的替身；台词配音的请求单独记录并由 voiceResponder 应答（缺省没有可用的声音模型）。 */
function setup(responder = () => previewView(), voiceResponder = defaultVoiceResponder) {
  env = createUiEnvironment();
  const { window } = env;
  const requests = [];
  const voiceRequests = [];
  const handlers = new Map();
  const opened = [];
  window.hostBridge = {
    request: async (name, payload) => {
      if (name.startsWith('voicePreview.')) {
        voiceRequests.push({ name, payload });
        return voiceResponder(name, payload);
      }
      requests.push({ name, payload });
      return responder(name, payload);
    },
    onEvent: (name, handler) => handlers.set(name, [...(handlers.get(name) || []), handler])
  };
  window.aiStage = { open: (...args) => opened.push(args), onCloseMissing: () => undefined };
  const context = new Proxy({ measureText: (text) => ({ width: String(text).length * 10 }) }, { get: (target, name) => (name in target ? target[name] : () => undefined), set: () => true });
  window.HTMLCanvasElement.prototype.getContext = () => context;
  for (const file of ['shared/page-format.js', ...PREVIEW_SCRIPTS]) window.eval(readFileSync(`${RESOURCES_ROOT}${file}`, 'utf8'));
  return {
    window,
    doc: env.document,
    requests,
    voiceRequests,
    opened,
    emit: (name, payload) => (handlers.get(name) || []).forEach((handler) => handler(payload)),
    open: (options = {}) => window.aiStoryboardPreview.open({ workId: WORK_ID, episodeId: EPISODE_ID, ...options })
  };
}

/** 缺省的台词配音应答：没有可用的声音模型。 */
function defaultVoiceResponder(name) {
  if (name === 'voicePreview.options') return { models: [], unavailableHint: '还没有可用的声音模型：请到“模型设置”启用。' };
  if (name === 'voicePreview.speakers') return { narrator: 'none', narratorAssetName: null, draftEntityIds: [] };
  throw new Error(`未预期的配音请求：${name}`);
}

const statusText = (doc) => doc.querySelector('.sbp-status__text').textContent;
const timeText = (doc) => doc.querySelector('.sbp-time').textContent;
const buttonByLabel = (doc, label) => doc.querySelector(`.sbp button[aria-label="${label}"]`);

test('打开：请求本集的分镜脚本视图，显示当前镜头、总时长、时间线分段、镜头信息与检查汇总', async () => {
  const { doc, requests, open } = setup();
  open();
  await flush();

  assert.deepEqual(JSON.parse(JSON.stringify(requests.map((request) => [request.name, request.payload]))), [['stage.load', { workId: WORK_ID, stage: 'storyboard_script', episodeId: EPISODE_ID, withImages: true }]]);
  assert.equal(statusText(doc), '第 1 / 3 镜 · 场次1 · 中景');
  assert.equal(timeText(doc), '00:00.0 / 00:12.0');
  assert.equal(doc.querySelectorAll('.sbp-seg').length, 3);
  assert.equal(doc.querySelectorAll('.sbp-seg--current').length, 1);
  assert.ok(doc.querySelector('.sbp-info').textContent.includes('第 1 镜'));
  assert.ok(doc.querySelector('.sbp-info').textContent.includes('刺猬从画面左侧中景走到画面右侧中景'));
  assert.ok(doc.querySelector('.sbp-info__checks').textContent.includes('警告 1 项，提示 0 项'));
  assert.ok(doc.querySelector('.sbp-note').textContent.includes('不代表最终画面'));
});

test('信息栏页签：镜头、画面、调度、声音、检查分页显示，默认显示“镜头”，点页签切换并带数量，键盘方向键可切换', async () => {
  const { doc, open } = setup();
  open();
  await flush();
  const tabs = [...doc.querySelectorAll('.sbp-info .ui-tab')];
  assert.deepEqual(tabs.map((tab) => tab.childNodes[0].textContent), ['镜头', '画面', '调度', '声音', '检查']);
  const visible = () => [...doc.querySelectorAll('.sbp-info .sbp-panel')].map((panel) => !panel.hidden);
  assert.deepEqual(visible(), [true, false, false, false, false]);
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');

  tabs[3].click();
  assert.deepEqual(visible(), [false, false, false, true, false]);
  assert.equal(tabs[3].getAttribute('aria-selected'), 'true');
  assert.notEqual(tabs[2].querySelector('.ui-tab__count').textContent, '', '调度页签带出场数量');
  assert.equal(tabs[4].querySelector('.ui-tab__count').textContent, '1', '检查页签带检查项数量');

  tabs[3].dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.deepEqual(visible(), [false, false, false, false, true]);
});

test('时间线：有警告的镜头带标记，声音泳道只显示有内容的类型，镜头组有标记', async () => {
  const { doc, open } = setup();
  open();
  await flush();
  const segments = [...doc.querySelectorAll('.sbp-seg')];
  assert.deepEqual(segments.map((segment) => segment.classList.contains('sbp-seg--warn')), [false, false, true]);
  assert.deepEqual([...doc.querySelectorAll('.sbp-tl-label')].map((label) => label.textContent), ['对白', '音效']);
  assert.equal(doc.querySelectorAll('.sbp-sound').length, 2);
  assert.deepEqual([...doc.querySelectorAll('.sbp-group-mark')].map((mark) => mark.textContent), ['组 1']);
});

test('播放控制：播放与暂停切换按钮名称；下一镜、上一镜、回到开头改变位置；循环按钮有按下状态', async () => {
  const { doc, open } = setup();
  open();
  await flush();

  buttonByLabel(doc, '播放').click();
  assert.ok(buttonByLabel(doc, '暂停'), '播放中按钮变为暂停');
  buttonByLabel(doc, '暂停').click();
  assert.ok(buttonByLabel(doc, '播放'));

  buttonByLabel(doc, '下一镜').click();
  assert.equal(statusText(doc), '第 2 / 3 镜 · 场次2 · 中景');
  assert.equal(timeText(doc), '00:04.0 / 00:12.0');
  buttonByLabel(doc, '下一镜').click();
  buttonByLabel(doc, '上一镜').click();
  assert.equal(statusText(doc), '第 2 / 3 镜 · 场次2 · 中景', '刚进入镜头 3 就点上一镜，回到镜头 2');
  buttonByLabel(doc, '回到开头').click();
  assert.equal(timeText(doc), '00:00.0 / 00:12.0');

  const loop = buttonByLabel(doc, '循环当前镜头');
  assert.equal(loop.getAttribute('aria-pressed'), 'false');
  loop.click();
  assert.equal(loop.getAttribute('aria-pressed'), 'true');
});

test('时间线跳转：点击或拖动按位置跳转，滑块带可读的当前值', async () => {
  const { doc, open } = setup();
  open();
  await flush();
  const tracks = doc.querySelector('.sbp-tl-tracks');

  fire(env, tracks, 'pointerdown', { clientX: 50 });
  assert.equal(timeText(doc), '00:06.0 / 00:12.0');
  assert.equal(statusText(doc), '第 2 / 3 镜 · 场次2 · 中景');
  fire(env, tracks, 'pointermove', { clientX: 90 });
  assert.equal(statusText(doc), '第 3 / 3 镜 · 场次3 · 中景');
  fire(env, tracks, 'pointerup', { clientX: 90 });
  fire(env, tracks, 'pointermove', { clientX: 10 });
  assert.equal(statusText(doc), '第 3 / 3 镜 · 场次3 · 中景', '松开后移动不再跳转');
  assert.equal(tracks.getAttribute('role'), 'slider');
  assert.equal(tracks.getAttribute('aria-valuemax'), '12');
  assert.match(tracks.getAttribute('aria-valuetext'), /^第 3 镜，/);
});

test('键盘：空格播放暂停，方向键前进后退 1 秒，Shift 加方向键切换镜头，Home 与 End 跳到两端；焦点在按钮上时不抢键', async () => {
  const { doc, open } = setup();
  open();
  await flush();
  const tracks = doc.querySelector('.sbp-tl-tracks');

  pressKey(env, tracks, ' ');
  assert.ok(buttonByLabel(doc, '暂停'));
  pressKey(env, tracks, ' ');
  pressKey(env, tracks, 'ArrowRight');
  pressKey(env, tracks, 'ArrowRight');
  pressKey(env, tracks, 'ArrowLeft');
  assert.equal(timeText(doc), '00:01.0 / 00:12.0');
  pressKey(env, tracks, 'ArrowRight', { shiftKey: true });
  assert.equal(timeText(doc), '00:04.0 / 00:12.0');
  pressKey(env, tracks, 'End');
  assert.equal(timeText(doc), '00:12.0 / 00:12.0');
  pressKey(env, tracks, 'Home');
  assert.equal(timeText(doc), '00:00.0 / 00:12.0');
  pressKey(env, buttonByLabel(doc, '播放'), 'ArrowRight');
  assert.equal(timeText(doc), '00:00.0 / 00:12.0', '按钮自己处理按键');
});

test('检查列表：点击检查项跳转到该镜头，“在分镜里编辑”打开分镜编辑区并定位到镜头；当前镜头的检查项高亮', async () => {
  const { doc, open, opened } = setup();
  open();
  await flush();
  const item = doc.querySelector('.sbp-check');
  assert.equal(item.querySelector('span').textContent, '第 3 镜：声音超出镜头时长 1.5 秒，视频里会被截断。');
  assert.ok(!item.classList.contains('sbp-check--current'));

  item.querySelector('.sbp-check__main').click();
  assert.equal(statusText(doc), '第 3 / 3 镜 · 场次3 · 中景');
  assert.ok(doc.querySelector('.sbp-check').classList.contains('sbp-check--current'));

  item.querySelector('.ui-button').click();
  assert.deepEqual(opened, [[WORK_ID, 'storyboard_script', EPISODE_ID, 103]]);
});

test('打开时指定镜头：从该镜头开始；已打开时再次打开不重复请求，只重新定位', async () => {
  const { doc, open, requests } = setup();
  open({ shotId: 102 });
  await flush();
  assert.equal(statusText(doc), '第 2 / 3 镜 · 场次2 · 中景');

  open({ shotId: 103 });
  open();
  await flush();
  assert.equal(requests.length, 1, '同一集只有一个预览层');
  assert.equal(doc.querySelectorAll('.sbp').length, 1);
  assert.equal(statusText(doc), '第 3 / 3 镜 · 场次3 · 中景');
});

test('数据刷新：收到分镜变化事件后重新加载，播放位置按镜头标识与镜头内偏移保持', async () => {
  let longer = false;
  const { doc, open, emit, requests } = setup(() => {
    const view = previewView();
    if (longer) {
      view.shots[0].durationSeconds = 6;
      view.totalSeconds = 14;
    }
    return view;
  });
  open();
  await flush();
  const tracks = doc.querySelector('.sbp-tl-tracks');
  fire(env, tracks, 'pointerdown', { clientX: (5 / 12) * 100 });
  fire(env, tracks, 'pointerup', { clientX: (5 / 12) * 100 });
  assert.equal(timeText(doc), '00:05.0 / 00:12.0');

  longer = true;
  emit('stage.changed', { workId: WORK_ID + 1, runId: 1 });
  await flush(250);
  assert.equal(requests.length, 1, '其他作品的变化不刷新');
  emit('stage.changed', { workId: WORK_ID, runId: 1 });
  emit('stage.changed', { workId: WORK_ID, runId: 1 });
  await flush(250);
  assert.equal(requests.length, 2, '连续的事件合并为一次加载');
  assert.equal(timeText(doc), '00:07.0 / 00:14.0', '仍在第 2 镜开头后 1 秒');
  assert.equal(statusText(doc), '第 2 / 3 镜 · 场次2 · 中景');
});

test('数据刷新：当前镜头被删除后落到最近的镜头', async () => {
  let count = 3;
  const { doc, open, emit } = setup(() => {
    const view = previewView();
    view.shots = view.shots.slice(0, count);
    view.groups = [];
    return view;
  });
  open({ shotId: 103 });
  await flush();
  assert.equal(statusText(doc), '第 3 / 3 镜 · 场次3 · 中景');
  count = 2;
  emit('stage.changed', { workId: WORK_ID });
  await flush(250);
  assert.equal(statusText(doc), '第 2 / 2 镜 · 场次2 · 中景');
});

test('不可预览：生成中或没有镜头时舞台给出提示，控制按钮禁用', async () => {
  for (const view of [previewView({ run: { id: 1, display: 'running', createdAt: new Date().toISOString(), hasRawOutput: false, modelInfo: '', progress: null } }), previewView({ shots: [], groups: [] })]) {
    const { doc, open } = setup(() => view);
    open();
    await flush();
    assert.ok(buttonByLabel(doc, '播放').disabled);
    assert.ok(buttonByLabel(doc, '下一镜').disabled);
    assert.ok(doc.querySelector('.sbp-info').textContent.includes('分镜脚本生成完成后可以预览'));
    assert.equal(doc.querySelectorAll('.sbp-seg').length, 0);
    env.close();
  }
});

test('加载失败：显示原因与重试，重试成功后恢复', async () => {
  let fail = true;
  const { doc, open, requests } = setup(() => {
    if (fail) throw { message: '这一集还没有分镜脚本生成记录。' };
    return previewView();
  });
  open();
  await flush();
  assert.ok(doc.querySelector('.sbp-error').textContent.includes('这一集还没有分镜脚本生成记录。'));
  assert.ok(!doc.querySelector('.sbp-error').hidden);
  fail = false;
  [...doc.querySelectorAll('.sbp-error .ui-button')].find((button) => button.textContent.includes('重试')).click();
  await flush();
  assert.equal(requests.length, 2);
  assert.ok(doc.querySelector('.sbp-error').hidden);
  assert.equal(statusText(doc), '第 1 / 3 镜 · 场次1 · 中景');
});

test('版本与画幅：预览历史版本时显示“历史版本”标记并带版本号请求；画幅缺失时提示按 16:9 显示', async () => {
  const view = previewView({ aspectRatio: null, versions: [{ id: 2, version: 2, display: 'pending', isCurrent: true }, { id: 1, version: 1, display: 'approved', isCurrent: false }] });
  const { doc, open, requests } = setup(() => view);
  open({ runId: 1 });
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].payload)), { workId: WORK_ID, stage: 'storyboard_script', episodeId: EPISODE_ID, withImages: true, id: 1 });
  const badges = [...doc.querySelectorAll('.sbp-badge')].map((badge) => badge.textContent);
  assert.deepEqual(badges, ['历史版本 v1', '画幅未记录，按 16:9 显示']);
});

test('显示选项：切换名称等选项不影响播放位置；倍速可选', async () => {
  const { doc, open } = setup();
  open();
  await flush();
  buttonByLabel(doc, '下一镜').click();
  const checkboxes = [...doc.querySelectorAll('.sbp-controls__display [role="checkbox"]')];
  assert.deepEqual(checkboxes.map((box) => box.textContent), ['名称', '动作', '轨迹与朝向', '站位网格', '字幕', '画面描述', '景别与运镜', '取景框']);
  assert.deepEqual(checkboxes.map((box) => box.getAttribute('aria-checked')), ['true', 'true', 'true', 'false', 'true', 'true', 'true', 'true']);
  checkboxes[3].click();
  assert.equal(checkboxes[3].getAttribute('aria-checked'), 'true');
  assert.equal(timeText(doc), '00:04.0 / 00:12.0');
  assert.ok(doc.querySelector('.sbp-controls__rate'));
});

test('视图切换：舞台、镜头对照、调度俯视图；切换后说明文字更新，播放位置不变', async () => {
  const { doc, open } = setup();
  open();
  await flush();
  buttonByLabel(doc, '下一镜').click();
  const radios = [...doc.querySelectorAll('.sbp-modes [role="radio"]')];
  assert.deepEqual(radios.map((radio) => radio.textContent), ['舞台', '镜头对照', '调度俯视图']);
  assert.deepEqual(radios.map((radio) => radio.getAttribute('aria-checked')), ['true', 'false', 'false']);
  assert.equal(doc.querySelector('.sbp-modes__hint').textContent, '');

  radios[1].click();
  assert.equal(radios[1].getAttribute('aria-checked'), 'true');
  assert.ok(doc.querySelector('.sbp-modes__hint').textContent.includes('上一镜结尾'));
  radios[2].click();
  assert.ok(doc.querySelector('.sbp-modes__hint').textContent.includes('从上往下'));
  radios[0].click();
  assert.equal(doc.querySelector('.sbp-modes__hint').textContent, '');
  assert.equal(timeText(doc), '00:04.0 / 00:12.0');
});

test('资产缩略图：实体带图片时加载并随视图更新；类型不是位图的被忽略', async () => {
  const loaded = [];
  const { window, doc, open } = setup(() => {
    const view = previewView();
    view.entities = view.entities.map((entity) => {
      if (entity.id === IDS.hedgehog) return { ...entity, image: { mime: 'image/jpeg', data: 'AAAA' } };
      if (entity.id === IDS.bat) return { ...entity, image: { mime: 'text/html', data: 'BBBB' } };
      return { ...entity, image: null };
    });
    return view;
  });
  window.Image = class {
    set src(value) {
      loaded.push(value);
      setTimeout(() => this.onload?.(), 0);
    }
    naturalWidth = 64;
    naturalHeight = 64;
  };
  open();
  await flush(30);
  assert.deepEqual(loaded, ['data:image/jpeg;base64,AAAA']);
  assert.ok(doc.querySelector('.sbp-canvas'));
});

const VOICE_MODELS = [
  { id: 5, label: '千问AI平台 · 千问音频 3.1', supportsReference: true, voices: [] },
  { id: 6, label: '豆包语音 · 豆包语音合成 2.0', supportsReference: false, voices: ['小红', '小明'] }
];

/** 有两句对白的视图：刺猬已绑定音色参考，蝙蝠没有。 */
function voiceView(overrides = {}) {
  const view = makeView(
    [
      makeShot(1, {
        entityIds: [IDS.hedgehog, IDS.bat],
        staging: [makeStaging(IDS.hedgehog, { startX: 'left' }), makeStaging(IDS.bat, { startX: 'right' })],
        sounds: [
          makeSound({ speakerEntityId: IDS.hedgehog, text: '你好', startOffsetSeconds: 0, durationSeconds: 2 }),
          makeSound({ speakerEntityId: IDS.bat, text: '再见', startOffsetSeconds: 2, durationSeconds: 1 })
        ]
      }),
      makeShot(2, { entityIds: [IDS.hedgehog], staging: [makeStaging(IDS.hedgehog, { startX: 'center' })] })
    ],
    overrides
  );
  view.entities = view.entities.map((entity) => (entity.id === IDS.hedgehog ? { ...entity, hasVoice: true } : entity));
  return view;
}

/** 台词配音的假宿主：声音模型可随时替换，合成结果可定制；说话人的临时音色状态、“生成音色”对话框的信息与生成、采用的应答也可定制。 */
function voiceHost({ models = VOICE_MODELS, synthesize, restore, speakers, draftInfo, draft, adopt } = {}) {
  let current = models;
  return {
    setModels: (next) => {
      current = next;
    },
    responder: (name, payload) => {
      if (name === 'voicePreview.options') return { models: current, unavailableHint: current.length === 0 ? '还没有可用的声音模型：请到“模型设置”启用音频服务商。' : null };
      if (name === 'voicePreview.synthesize') return synthesize ? synthesize(payload) : { mime: 'audio/mpeg', data: 'SUQz', cached: false, note: null };
      if (name === 'voicePreview.speakers') return speakers ? speakers() : { narrator: 'none', narratorAssetName: null, draftEntityIds: [] };
      if (name === 'voicePreview.restore') return restore ? restore(payload) : { clips: [] };
      if (name === 'voicePreview.draftInfo') return draftInfo ? draftInfo(payload) : { speakerName: '角色', description: '低沉沙哑', draft: null, suggestedName: '角色·音色', otherEpisodes: 0, narratorAssetName: null };
      if (name === 'voicePreview.draft') return draft ? draft(payload) : { modelId: 5, mime: 'audio/wav', data: 'UklG', sampleText: payload.sampleText, description: payload.description, presetVoice: null, cached: false, note: null };
      if (name === 'voicePreview.adopt') return adopt ? adopt(payload) : { assetId: 9, assetName: payload.name, otherEpisodesBound: 0 };
      throw new Error(`未预期的配音请求：${name}`);
    }
  };
}

/** 让音频元素的播放与暂停只做记录，返回已播放的地址。 */
function stubMedia(window) {
  const played = [];
  window.HTMLMediaElement.prototype.play = function () {
    played.push(this.getAttribute('src') ?? this.src);
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function () {
    this.dispatchEvent(new window.Event('pause'));
  };
  return played;
}

const voiceRowText = (doc) => doc.querySelector('.sbp-voice').textContent;
const previewButtons = (doc) => [...doc.querySelectorAll('.sbp-sound-voice .ui-audio-preview button')];

test('台词配音：没有可用的声音模型时提示去“模型设置”配置，没有试听按钮，合成与同步开关不可用；没绑定音色的说话人说明原因', async () => {
  const host = voiceHost({ models: [] });
  const { doc, open, voiceRequests } = setup(() => voiceView(), host.responder);
  open();
  await flush();

  assert.equal(voiceRequests[0].name, 'voicePreview.options');
  const hint = doc.querySelector('.sbp-voice__hint');
  assert.ok(!hint.hidden);
  assert.ok(hint.textContent.includes('模型设置'));
  assert.equal(doc.querySelector('.sbp-voice__model').children.length, 0, '没有模型时没有下拉');
  assert.equal(previewButtons(doc).length, 0);
  assert.equal(doc.querySelectorAll('.sbp-sound-voice--none').length, 1, '蝙蝠没绑定音色');
  assert.ok(doc.querySelector('.sbp-sound-voice--none').textContent.includes('蝙蝠还没有音色'));
  assert.ok(doc.querySelector('.sbp-sound-voice--none button'), '有“生成音色”入口');
  const batch = [...doc.querySelectorAll('.sbp-voice .ui-button')].find((button) => button.textContent.includes('合成本镜头配音'));
  assert.ok(batch.disabled);
  assert.equal(doc.querySelector('.sbp-voice [role="checkbox"]').getAttribute('aria-disabled'), 'true');
});

test('台词配音：有模型时出现下拉；只有已绑定音色的对白带试听按钮，点击合成并播放，再点同样内容提示没有重新调用模型', async () => {
  let calls = 0;
  const host = voiceHost({
    synthesize: () => {
      calls += 1;
      return { mime: 'audio/mpeg', data: 'SUQz', cached: calls > 1, note: null };
    }
  });
  const { window, doc, open, voiceRequests } = setup(() => voiceView(), host.responder);
  const played = stubMedia(window);
  open();
  await flush();

  assert.ok(doc.querySelector('.sbp-voice__hint').hidden);
  assert.equal(doc.querySelector('.sbp-voice .ui-select__value').textContent, VOICE_MODELS[0].label, '默认选第一个模型');
  assert.equal(previewButtons(doc).length, 1, '只有刺猬的对白可以试听');
  assert.equal(previewButtons(doc)[0].getAttribute('aria-label'), '试听刺猬的台词');
  assert.ok(voiceRowText(doc).includes('本镜头 1 条对白可配音，已合成 0 条；整集已合成 0/1 条，1 条需要合成（还没合成，或台词、说话方式改过）。'));

  previewButtons(doc)[0].click();
  await flush();
  const request = voiceRequests.find((item) => item.name === 'voicePreview.synthesize');
  assert.deepEqual(JSON.parse(JSON.stringify(request.payload)), { workId: WORK_ID, episodeId: EPISODE_ID, runId: 1, soundId: request.payload.soundId, modelId: 5 });
  assert.equal(played.length, 1);
  assert.ok(played[0].startsWith('data:audio/mpeg;base64,SUQz'));
  assert.ok(voiceRowText(doc).includes('已调用模型合成。'));

  // 台词没有变化：宿主返回缓存，界面说明没有重新调用模型。
  buttonByLabel(doc, '下一镜').click();
  buttonByLabel(doc, '上一镜').click();
  previewButtons(doc)[0].click();
  await flush();
  assert.equal(calls, 2);
  assert.ok(doc.querySelector('.sbp-voice__status').textContent.includes('没有重新调用模型'));
});

test('台词配音：所选模型不支持参考音频时显示宿主的说明；合成失败显示原因', async () => {
  let fail = false;
  const host = voiceHost({
    synthesize: () => {
      if (fail) throw { message: '尚未配置“豆包语音”的访问密钥，请到“设置 > 模型”填写。' };
      return { mime: 'audio/mpeg', data: 'SUQz', cached: false, note: '所选模型不支持参考音频，“刺猬”按预置音色试听。' };
    }
  });
  const { window, doc, open } = setup(() => voiceView(), host.responder);
  stubMedia(window);
  open();
  await flush();

  previewButtons(doc)[0].click();
  await flush();
  assert.ok(doc.querySelector('.sbp-voice__status').textContent.includes('不支持参考音频'));

  // 换镜头再回来会重建试听按钮，这次宿主返回失败：配音行显示原因。
  fail = true;
  buttonByLabel(doc, '下一镜').click();
  buttonByLabel(doc, '上一镜').click();
  previewButtons(doc)[0].click();
  await flush();
  const status = doc.querySelector('.sbp-voice__status');
  assert.ok(status.textContent.includes('访问密钥'));
  assert.ok(status.classList.contains('status-error'));
});

test('台词配音：在模型设置里启用或关闭声音模型后，模型下拉实时刷新；所选模型被关闭时改选第一个', async () => {
  const host = voiceHost({ models: [] });
  const { doc, open, emit, voiceRequests } = setup(() => voiceView(), host.responder);
  open();
  await flush();
  assert.ok(!doc.querySelector('.sbp-voice__hint').hidden);
  assert.equal(previewButtons(doc).length, 0);

  // 启用声音模型：下拉与试听按钮出现，提示消失。
  host.setModels(VOICE_MODELS);
  emit('models.changed');
  emit('models.changed');
  await flush(300);
  assert.equal(voiceRequests.filter((item) => item.name === 'voicePreview.options').length, 2, '连续的事件合并为一次读取');
  assert.ok(doc.querySelector('.sbp-voice__hint').hidden);
  assert.equal(doc.querySelector('.sbp-voice .ui-select__value').textContent, VOICE_MODELS[0].label);
  assert.equal(previewButtons(doc).length, 1);

  // 选第二个模型。
  doc.querySelector('.sbp-voice .ui-select__trigger').click();
  [...env.document.querySelectorAll('.ui-select__option')].find((option) => option.textContent === VOICE_MODELS[1].label).click();
  assert.equal(doc.querySelector('.sbp-voice .ui-select__value').textContent, VOICE_MODELS[1].label);

  // 第二个模型被关闭：改选剩下的第一个。
  host.setModels([VOICE_MODELS[0]]);
  emit('models.changed');
  await flush(300);
  assert.equal(doc.querySelector('.sbp-voice .ui-select__value').textContent, VOICE_MODELS[0].label);

  // 全部关闭：回到提示，试听按钮消失。
  host.setModels([]);
  emit('models.changed');
  await flush(300);
  assert.ok(!doc.querySelector('.sbp-voice__hint').hidden);
  assert.equal(previewButtons(doc).length, 0);
  assert.equal(doc.querySelector('.sbp-voice__model').children.length, 0);
});

test('台词配音：模型读取失败时在配音行显示原因', async () => {
  const { doc, open } = setup(() => voiceView(), () => {
    throw { message: '声音模型读取失败了。' };
  });
  open();
  await flush();
  assert.ok(!doc.querySelector('.sbp-voice__hint').hidden);
  assert.ok(doc.querySelector('.sbp-voice__hint').textContent.includes('声音模型读取失败了。'));
});

test('台词配音：“合成本镜头配音”依次合成可试听的对白并汇报进度；台词修改后（声音标识变化）会重新请求', async () => {
  let text = '你好';
  const host = voiceHost();
  const { window, doc, open, emit, voiceRequests } = setup(
    () => {
      const view = voiceView();
      view.shots[0].sounds[0] = { ...view.shots[0].sounds[0], id: text === '你好' ? 501 : 502, text };
      return view;
    },
    host.responder
  );
  stubMedia(window);
  open();
  await flush();

  const batch = () => [...doc.querySelectorAll('.sbp-voice .ui-button')].find((button) => button.textContent.includes('合成本镜头配音'));
  assert.ok(!batch().disabled);
  batch().click();
  await flush();
  assert.deepEqual(voiceRequests.filter((item) => item.name === 'voicePreview.synthesize').map((item) => item.payload.soundId), [501]);
  assert.ok(doc.querySelector('.sbp-voice__status').textContent.includes('1 条配音已合成'));
  assert.equal(doc.querySelector('.sbp-voice__progress').textContent, '', '合成完成后进度行清空');
  assert.ok(doc.querySelector('.sbp-voice__summary').textContent.includes('整集已合成 1/1 条'), '统计单独一行');
  buttonByLabel(doc, '下一镜').click();
  buttonByLabel(doc, '上一镜').click();
  assert.ok(doc.querySelector('.sbp-voice__status').textContent.includes('1 条配音已合成'), '切换镜头不清除提示');

  // 保存了新台词：声音标识变化，需要重新合成（是否真正调用模型由宿主按内容判断）。
  text = '你好呀';
  emit('stage.changed', { workId: WORK_ID });
  await flush(300);
  assert.ok(doc.querySelector('.sbp-voice__summary').textContent.includes('已合成 0 条'), '新台词还没有合成结果');
  batch().click();
  await flush();
  assert.deepEqual(voiceRequests.filter((item) => item.name === 'voicePreview.synthesize').map((item) => item.payload.soundId), [501, 502]);
});

test('台词配音：勾选“播放时配音”后，播放到已合成对白的开始时间就播放它的配音；暂停与跳转时停止', async () => {
  const host = voiceHost();
  const { window, doc, open } = setup(() => voiceView(), host.responder);
  const played = stubMedia(window);
  open();
  await flush();
  [...doc.querySelectorAll('.sbp-voice .ui-button')].find((button) => button.textContent.includes('合成本镜头配音')).click();
  await flush();

  doc.querySelector('.sbp-voice [role="checkbox"]').click();
  assert.equal(doc.querySelector('.sbp-voice [role="checkbox"]').getAttribute('aria-checked'), 'true');
  buttonByLabel(doc, '播放').click();
  await flush(120);
  assert.equal(played.filter((source) => source.startsWith('data:audio/mpeg')).length, 1, '对白在 0 秒开始，播放时配音随之播放');
  assert.equal(played.filter((source) => source.startsWith('data:audio/wav')).length, 4, '勾选时先用静音解锁一组音频元素');
  buttonByLabel(doc, '暂停').click();
});

test('入口：分镜脚本产出层头部的“分镜动画”按钮打开预览，镜头编辑区的“从此镜头预览”定位到当前镜头；没有镜头时按钮禁用', async () => {
  env = createUiEnvironment();
  const { window } = env;
  const doc = env.document;
  const requests = [];
  let view = previewView();
  window.hostBridge = {
    request: async (name, payload) => {
      requests.push({ name, payload });
      return view;
    },
    onEvent: () => undefined
  };
  const context = new Proxy({ measureText: (text) => ({ width: String(text).length * 10 }) }, { get: (target, name) => (name in target ? target[name] : () => undefined), set: () => true });
  window.HTMLCanvasElement.prototype.getContext = () => context;
  for (const file of ['shared/page-format.js', 'stage/stage-actions.js', 'stage/stage-header.js', 'stage/stage.js', 'stage/stage-editing.js', 'stage/stage-storyboard-panels.js', 'stage/stage-storyboard.js', ...PREVIEW_SCRIPTS]) {
    window.eval(readFileSync(`${RESOURCES_ROOT}${file}`, 'utf8'));
  }
  window.aiStage.open(WORK_ID, 'storyboard_script', EPISODE_ID);
  await flush();

  const header = [...doc.querySelectorAll('.stage-bar__buttons .ui-button')].find((button) => button.textContent.includes('分镜动画'));
  assert.ok(header && !header.disabled);
  const fromShot = [...doc.querySelectorAll('.storyboard-editor__tools .ui-button')].find((button) => button.textContent.includes('从此镜头预览'));
  assert.ok(fromShot && !fromShot.disabled);

  // 先选中第 2 个镜头，再从该镜头预览。
  doc.querySelectorAll('.storyboard-shot')[1].click();
  await flush();
  [...doc.querySelectorAll('.storyboard-editor__tools .ui-button')].find((button) => button.textContent.includes('从此镜头预览')).click();
  await flush();
  assert.equal(doc.querySelectorAll('.sbp').length, 1);
  assert.equal(statusText(doc), '第 2 / 3 镜 · 场次2 · 中景');
  assert.equal(requests.filter((request) => request.name.startsWith('stage.')).at(-1).name, 'stage.load');

  env.close();
  env = createUiEnvironment();
  const empty = env.window;
  view = previewView({ shots: [], groups: [] });
  empty.hostBridge = { request: async () => view, onEvent: () => undefined };
  for (const file of ['shared/page-format.js', 'stage/stage-actions.js', 'stage/stage-header.js', 'stage/stage.js', 'stage/stage-editing.js', 'stage/stage-storyboard-panels.js', 'stage/stage-storyboard.js', ...PREVIEW_SCRIPTS]) {
    empty.eval(readFileSync(`${RESOURCES_ROOT}${file}`, 'utf8'));
  }
  empty.aiStage.open(WORK_ID, 'storyboard_script', EPISODE_ID);
  await flush();
  const disabled = [...env.document.querySelectorAll('.stage-bar__buttons .ui-button')].find((button) => button.textContent.includes('分镜动画'));
  assert.ok(disabled && disabled.disabled, '没有镜头时不能预览');
});

/** 弹出页面里按文字找按钮；多个弹出页面叠放时取最上面（最后打开）的那个。 */
const dialogButton = (doc, text) => [...doc.querySelectorAll('.ui-dialog button')].filter((button) => button.textContent.includes(text)).at(-1);

test('台词配音：打开预览时把宿主保存在本地的配音读回来（不合成）；台词改过后显示“需要合成”，不会自动合成', async () => {
  let text = '你好';
  const host = voiceHost({ restore: () => (text === '你好' ? { clips: [{ soundId: 501, mime: 'audio/mpeg', data: 'SUQz' }] } : { clips: [] }) });
  const { window, doc, open, emit, voiceRequests } = setup(
    () => {
      const view = voiceView();
      view.shots[0].sounds[0] = { ...view.shots[0].sounds[0], id: 501, text };
      return view;
    },
    host.responder
  );
  stubMedia(window);
  open();
  await flush(30);

  assert.ok(voiceRequests.some((item) => item.name === 'voicePreview.restore' && item.payload.modelId === 5), '打开时读取已保存的配音');
  assert.equal(voiceRequests.filter((item) => item.name === 'voicePreview.synthesize').length, 0, '读取不合成');
  assert.ok(voiceRowText(doc).includes('整集已合成 1/1 条。'), voiceRowText(doc));
  assert.equal(doc.querySelector('.sbp-sound-voice__state').textContent, '已合成');

  text = '你好呀';
  emit('stage.changed', { workId: WORK_ID });
  await flush(300);
  assert.equal(voiceRequests.filter((item) => item.name === 'voicePreview.synthesize').length, 0, '台词改了不会自动合成');
  assert.equal(doc.querySelector('.sbp-sound-voice__state').textContent, '需要合成');
  assert.ok(doc.querySelector('.sbp-sound-voice__state').classList.contains('sbp-sound-voice__state--pending'));
  assert.ok(voiceRowText(doc).includes('1 条需要合成'), voiceRowText(doc));
});

test('台词配音：“重新合成本镜头”“重新合成整集”确认后绕过缓存（请求带 regenerate），取消则不请求', async () => {
  const host = voiceHost();
  const { window, doc, open, voiceRequests } = setup(() => voiceView(), host.responder);
  stubMedia(window);
  open();
  await flush();

  const button = (text) => [...doc.querySelectorAll('.sbp-voice .ui-button')].find((item) => item.textContent.includes(text));
  const synth = () => voiceRequests.filter((item) => item.name === 'voicePreview.synthesize');
  button('合成本镜头配音').click();
  await flush();
  assert.equal(synth().length, 1);

  button('重新合成本镜头').click();
  await flush();
  dialogButton(doc, '取消').click();
  await flush();
  assert.equal(synth().length, 1, '取消后不请求');

  button('重新合成本镜头').click();
  await flush();
  dialogButton(doc, '重新合成').click();
  await flush();
  assert.equal(synth().length, 2);
  assert.equal(synth()[1].payload.regenerate, true);
  assert.equal('regenerate' in synth()[0].payload, false);
  assert.ok(doc.querySelector('.sbp-voice__status').textContent.includes('已重新合成'));

  button('重新合成整集').click();
  await flush();
  dialogButton(doc, '重新合成').click();
  await flush();
  assert.equal(synth().length, 3);
  assert.equal(synth()[2].payload.regenerate, true);
});

test('台词配音：“合成整集配音”先确认费用，确认后合成整集可试听的对白；取消则不请求', async () => {
  const host = voiceHost();
  const { window, doc, open, voiceRequests } = setup(() => voiceView(), host.responder);
  stubMedia(window);
  open();
  await flush();

  const all = () => [...doc.querySelectorAll('.sbp-voice .ui-button')].find((button) => button.textContent.includes('合成整集配音'));
  assert.ok(!all().disabled);
  all().click();
  await flush();
  dialogButton(doc, '取消').click();
  await flush();
  assert.equal(voiceRequests.filter((item) => item.name === 'voicePreview.synthesize').length, 0, '取消后不请求');

  all().click();
  await flush();
  dialogButton(doc, '合成').click();
  await flush();
  assert.equal(voiceRequests.filter((item) => item.name === 'voicePreview.synthesize').length, 1);
  assert.ok(doc.querySelector('.sbp-voice__status').textContent.includes('整集 1 条配音已合成'));
});

test('生成音色：没有音色的角色点“生成音色”，按描述生成试听、换一个、采用后绑定并重新读取分镜，临时音色随之变成正式绑定', async () => {
  const draftIds = [];
  let bound = false;
  const adopted = [];
  const host = voiceHost({
    speakers: () => ({ narrator: 'none', narratorAssetName: null, draftEntityIds: [...draftIds] }),
    draftInfo: () => ({ speakerName: '蝙蝠', description: '尖细急促的声音', draft: null, suggestedName: '蝙蝠·音色', otherEpisodes: 2, narratorAssetName: null }),
    draft: (payload) => {
      if (!draftIds.includes(IDS.bat)) draftIds.push(IDS.bat);
      return { modelId: 5, mime: 'audio/wav', data: 'UklG', sampleText: payload.sampleText, description: payload.description, presetVoice: null, cached: false, note: null };
    },
    adopt: (payload) => {
      adopted.push(payload);
      bound = true;
      draftIds.length = 0;
      return { assetId: 9, assetName: payload.name, otherEpisodesBound: 2 };
    }
  });
  const view = () => {
    const base = voiceView();
    return bound ? { ...base, entities: base.entities.map((entity) => (entity.id === IDS.bat ? { ...entity, hasVoice: true } : entity)) } : base;
  };
  const { doc, open, requests, voiceRequests } = setup(() => view(), host.responder);
  open();
  await flush();
  doc.querySelector('.sbp-sound-voice--none button').click();
  await flush();

  assert.equal(doc.querySelector('.sbp-draft textarea[aria-label="音色描述"]').value, '尖细急促的声音');
  assert.equal(doc.querySelector('.sbp-draft textarea[aria-label="试听台词"]').value, '再见');
  assert.ok(doc.querySelector('.sbp-draft__adopt').hidden, '生成之前没有采用区');
  assert.ok(dialogButton(doc, '采用并绑定').disabled);

  dialogButton(doc, '生成试听').click();
  await flush();
  const requestsOf = () => voiceRequests.filter((item) => item.name === 'voicePreview.draft').map((item) => JSON.parse(JSON.stringify(item.payload)));
  assert.deepEqual(requestsOf()[0], { workId: WORK_ID, episodeId: EPISODE_ID, entityId: IDS.bat, modelId: 5, sampleText: '再见', delivery: '', description: '尖细急促的声音', presetVoice: '', regenerate: false });
  assert.ok(!doc.querySelector('.sbp-draft__adopt').hidden);
  assert.ok(!dialogButton(doc, '采用并绑定').disabled);
  assert.ok(doc.querySelector('.sbp-draft__actions .ui-audio-preview'), '生成后可以试听');
  assert.ok(doc.querySelector('.sbp-sound-voice__tag'), '预览里蝙蝠的台词标出临时音色');
  assert.equal(doc.querySelector('.sbp-sound-voice__tag').textContent, '临时音色');

  dialogButton(doc, '换一个').click();
  await flush();
  assert.equal(requestsOf()[1].regenerate, true, '换一个不用缓存');

  dialogButton(doc, '采用并绑定').click();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(adopted)), [{ workId: WORK_ID, episodeId: EPISODE_ID, entityId: IDS.bat, name: '蝙蝠·音色', applyToOtherEpisodes: true }]);
  assert.equal(doc.querySelector('.sbp-draft'), null, '采用后对话框关闭');
  assert.equal(requests.filter((request) => request.name === 'stage.load').length, 2, '采用后重新读取分镜');
  assert.ok(doc.querySelector('.sbp-voice__status').textContent.includes('已保存为声音资产“蝙蝠·音色”并绑定，并同时用于其他 2 集'));
  assert.equal(doc.querySelector('.sbp-sound-voice__tag'), null, '不再是临时音色');
  assert.equal(doc.querySelectorAll('.sbp-sound-voice--none').length, 0);
});

test('生成音色：生成失败显示原因；采用时重名在名称字段上提示并保持对话框打开；只有预置音色的模型改为选预置音色', async () => {
  let failDraft = true;
  const host = voiceHost({
    models: [VOICE_MODELS[1], { ...VOICE_MODELS[0], voices: [] }],
    draft: () => {
      if (failDraft) throw { message: '余额不足。' };
      return { modelId: 6, mime: 'audio/wav', data: 'UklG', sampleText: '再见', description: '', presetVoice: '小明', cached: false, note: '所选模型只有预置音色。' };
    },
    adopt: () => {
      throw { kind: 'conflict', message: '已有同名资产，请换一个名称。', fieldErrors: { name: '已有同名资产，请换一个名称。' } };
    }
  });
  const { doc, open, voiceRequests } = setup(() => voiceView(), host.responder);
  open();
  await flush();
  doc.querySelector('.sbp-sound-voice--none button').click();
  await flush();

  assert.equal(doc.querySelector('.sbp-draft textarea[aria-label="音色描述"]'), null, '只有预置音色的模型没有描述');
  assert.ok(doc.querySelector('.sbp-draft').textContent.includes('预置音色'));
  dialogButton(doc, '生成试听').click();
  await flush();
  assert.ok(doc.querySelector('.sbp-draft__message').textContent.includes('余额不足'));
  assert.ok(doc.querySelector('.sbp-draft__message').classList.contains('status-error'));
  assert.ok(doc.querySelector('.sbp-draft__adopt').hidden);

  failDraft = false;
  dialogButton(doc, '生成试听').click();
  await flush();
  const payload = voiceRequests.filter((item) => item.name === 'voicePreview.draft').at(-1).payload;
  assert.equal(payload.description, '', '预置音色的模型不带描述');
  assert.ok(doc.querySelector('.sbp-draft__message').textContent.includes('只有预置音色'));

  dialogButton(doc, '采用并绑定').click();
  await flush();
  assert.ok(doc.querySelector('.sbp-draft'), '失败时对话框保持打开');
  assert.ok(doc.querySelector('.sbp-draft__adopt').textContent.includes('已有同名资产'));
});

test('旁白：没有旁白音色时给“生成音色”入口，请求不带角色，没有“其他集”选项', async () => {
  const narrationView = () => makeView([makeShot(1, { sounds: [makeSound({ kind: 'narration', text: '夜幕降临', startOffsetSeconds: 0, durationSeconds: 2 })] })]);
  const host = voiceHost({ draftInfo: () => ({ speakerName: '旁白', description: '', draft: null, suggestedName: '作品甲·旁白', otherEpisodes: 0, narratorAssetName: null }) });
  const { doc, open, voiceRequests } = setup(narrationView, host.responder);
  open();
  await flush();
  assert.ok(doc.querySelector('.sbp-sound-voice--none').textContent.includes('旁白还没有音色'));
  doc.querySelector('.sbp-sound-voice--none button').click();
  await flush();
  const info = voiceRequests.find((item) => item.name === 'voicePreview.draftInfo');
  assert.equal(info.payload.entityId, null);
  assert.ok([...doc.querySelectorAll('.ui-dialog__title')].at(-1).textContent.includes('旁白'));
  assert.equal(doc.querySelector('.sbp-draft [role="checkbox"]'), null, '旁白没有“其他集”选项');
  dialogButton(doc, '关闭').click();
  await flush();
  assert.equal(doc.querySelector('.sbp-draft'), null);
});

test('旁白：作品已有旁白音色时可试听并可更换，用临时音色时标明并可采用；旁白计入可配音的台词', async () => {
  const narrationView = () => makeView([makeShot(1, { sounds: [makeSound({ kind: 'narration', text: '夜幕降临', startOffsetSeconds: 0, durationSeconds: 2 })] })]);
  for (const [state, expectedButton, expectedTag] of [['bound', '更换音色', null], ['draft', '采用…', '临时音色']]) {
    const host = voiceHost({ speakers: () => ({ narrator: state, narratorAssetName: state === 'bound' ? '旁白嗓音' : null, draftEntityIds: [] }) });
    const { doc, open, window } = setup(narrationView, host.responder);
    open();
    await flush();
    assert.equal(doc.querySelectorAll('.sbp-sound-voice--none').length, 0, state);
    assert.equal(previewButtons(doc).length, 1, state);
    assert.equal(previewButtons(doc)[0].getAttribute('aria-label'), '试听旁白的台词', state);
    assert.ok([...doc.querySelectorAll('.sbp-sound-voice button')].some((button) => button.textContent.includes(expectedButton)), state);
    assert.equal(doc.querySelector('.sbp-sound-voice__tag')?.textContent ?? null, expectedTag, state);
    assert.ok(doc.querySelector('.sbp-voice').textContent.includes('本镜头 1 条对白可配音'), state);
    window.close();
  }
});