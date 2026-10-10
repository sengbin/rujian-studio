// ------------------------------------------------------------------------
// 名称：stage-storyboard.test.mjs
// 说明：分镜脚本产出层工作区布局的 DOM 测试：头部汇总、页签切换与输入保留、保存状态、前后切换镜头、出场实体绑定、声音条目增删及保存载荷。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：使用 jsdom 加载组件库与 resources/stage 下的脚本，宿主请求用假的 hostBridge 应答并记录保存请求；jsdom 没有排版，只检查结构、状态与数据；放在 ui-kit/test 是因为 npm test 只收集这里的页面测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { createUiEnvironment } from './ui-environment.mjs';

const RESOURCES_ROOT = fileURLToPath(new URL('../../resources/', import.meta.url));
const WORK_ID = 1;
const EPISODE_ID = 7;
const FIRST_SHOT_ID = 101;
const SQUIRREL_ID = 11;
const CAVE_ID = 12;
const BLOCKING_TAB_TEXT = '调度';
const SHOT_TAB_TEXT = '镜头';
const CONTENT_TAB_TEXT = '画面与声音';

let env;

afterEach(() => env?.close());

/** 构造一个镜头；字段与宿主返回的镜头一致。 */
function makeShot(seq, overrides = {}) {
  return {
    id: FIRST_SHOT_ID + seq - 1,
    seq,
    sceneLabel: `场次${seq}`,
    shotSize: '中景',
    cameraAngle: '',
    cameraMovement: '',
    durationSeconds: 4,
    transition: '',
    continuityNote: '',
    firstFrameMode: 'none',
    firstFrameAssetId: null,
    entityIds: [],
    sounds: [],
    prompt: `镜头${seq}的画面`,
    ...overrides
  };
}

/** 宿主返回的分镜脚本阶段视图：三个镜头分成两组，作品里有一个角色和一个场景。 */
function makeView() {
  const shots = [makeShot(1), makeShot(2, { entityIds: [SQUIRREL_ID] }), makeShot(3)];
  return {
    work: { id: WORK_ID, projectId: 1, name: '作品甲', kind: 'short_drama', kindLabel: '多集短片', sourceType: 'text' },
    episode: { id: EPISODE_ID, seq: 1, title: '第一集' },
    versions: [{ id: 1, version: 1, display: 'pending', isCurrent: true }],
    run: { id: 1, display: 'pending', createdAt: new Date().toISOString(), hasRawOutput: false, modelInfo: '', progress: null },
    params: { audioMode: 'native', continuity: 'prev_tail', minShotSeconds: null },
    shots,
    groups: [
      { id: 1, seq: 1, shotIds: [shots[0].id, shots[1].id], totalSeconds: 8 },
      { id: 2, seq: 2, shotIds: [shots[2].id], totalSeconds: 4 }
    ],
    groupMaxSeconds: 15,
    totalSeconds: 12,
    entities: [
      { id: SQUIRREL_ID, kind: 'character', kindLabel: '角色', name: '松鼠', isActive: true },
      { id: CAVE_ID, kind: 'scene', kindLabel: '场景', name: '岩石洞穴', isActive: true }
    ],
    firstFrameAssets: [],
    limits: { maxSoundsPerShot: 20, firstFrameImageMaxBytes: 10 * 1024 * 1024 },
    stagingOptions: {
      x: [{ value: 'left', label: '画面左侧' }, { value: 'center', label: '画面中央' }, { value: 'right', label: '画面右侧' }],
      depth: [{ value: 'front', label: '前景' }, { value: 'middle', label: '中景' }, { value: 'back', label: '背景' }],
      facing: [{ value: 'camera', label: '面向镜头' }, { value: 'left', label: '面朝画面左侧' }]
    },
    soundKinds: [
      { kind: 'dialogue', label: '角色对白' },
      { kind: 'narration', label: '旁白' }
    ],
    stale: false,
    actions: { canEdit: true, canApprove: true, canCancel: false, canRetry: false, editNeedsConfirm: false }
  };
}

/** 建立测试页面并打开产出层，返回页面与记录到的保存请求。 */
async function open(view = makeView()) {
  env = createUiEnvironment();
  const { window } = env;
  const saved = [];
  window.hostBridge = {
    request: async (name, payload) => {
      if (name === 'stage.saveShot') {
        saved.push(payload);
        return { ref: payload.ref };
      }
      assert.equal(name, 'stage.load');
      return view;
    },
    onEvent: () => undefined
  };
  for (const file of ['shared/page-format.js', 'stage/stage-actions.js', 'stage/stage-header.js', 'stage/stage.js', 'stage/stage-editor-common.js', 'stage/stage-storyboard-panels.js', 'stage/stage-storyboard.js']) {
    window.eval(readFileSync(`${RESOURCES_ROOT}${file}`, 'utf8'));
  }
  window.aiStage.open(WORK_ID, 'storyboard_script', EPISODE_ID);
  await flush();
  return { window, doc: env.document, saved };
}

/** 等待已排队的异步任务（含请求应答）执行完。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

/** 在输入框或多行文本里输入文字并触发变化。 */
function type(window, element, text) {
  element.value = text;
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/** 按文字找页签按钮。 */
function tabOf(doc, text) {
  return [...doc.querySelectorAll('.storyboard-tabs .ui-tab')].find((tab) => tab.textContent.startsWith(text));
}

/** 按文字找按钮。 */
function buttonOf(root, text) {
  return [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === text);
}

/** 当前选中的镜头序号文字。 */
function currentNumber(doc) {
  return doc.querySelector('.storyboard-shot[aria-current="true"] .storyboard-shot__number').textContent;
}

test('工作区布局：汇总放在头部，信息区的各项分开显示，进度区里没有重复的汇总', async () => {
  const { doc } = await open();
  assert.equal(doc.querySelectorAll('.stage-view.stage-view--workspace').length, 1);

  const meta = [...doc.querySelectorAll('.stage-header__info .stage-meta span')].map((span) => span.textContent);
  assert.deepEqual(meta.slice(0, 2), ['多集短片', '文字灵感']);

  const summary = [...doc.querySelectorAll('.stage-header__info .storyboard-summary__item')].map((item) => item.textContent.trim());
  assert.deepEqual(summary, ['3 个镜头', '总时长 12 秒', '分为 2 组', '单组最长 15 秒', '声音 含声音条目', '镜头连贯 尾帧接首帧']);
  assert.equal(doc.querySelectorAll('.stage-progress-area .storyboard-summary').length, 0);
});

test('镜头导航：序号补零、显示组与时长，镜头标题行有“添加”', async () => {
  const { doc } = await open();
  const items = [...doc.querySelectorAll('.storyboard-shot')];
  assert.equal(items.length, 3);
  assert.equal(items[1].querySelector('.storyboard-shot__number').textContent, '002');
  assert.equal(items[1].querySelector('.storyboard-shot__title').textContent, '镜头2的画面');
  assert.equal(items[1].querySelector('.storyboard-shot__meta').textContent, '第 1 组 · 4 秒');
  assert.equal(doc.querySelector('.storyboard-nav__title').textContent, '镜头（3）');
  assert.ok(buttonOf(doc.querySelector('.storyboard-nav__head'), '添加'));
});

test('组间衔接提醒：组首镜头在导航里标出，选中后在编辑区顶部显示提醒文字；没有提醒的镜头不显示', async () => {
  const view = makeView();
  view.cutNotices = [{ shotId: FIRST_SHOT_ID + 2, code: 'cut_unchanged', text: '第 2 组开头与上一组最后一个镜头相比，景别和机位都没有变化。' }];
  const { doc } = await open(view);
  const items = [...doc.querySelectorAll('.storyboard-shot')];
  assert.equal(items[2].querySelector('.storyboard-shot__meta').textContent, '第 2 组 · 4 秒 · 衔接提醒');
  assert.equal(items[0].querySelector('.storyboard-shot__meta').textContent, '第 1 组 · 4 秒');
  assert.equal(doc.querySelectorAll('.storyboard-editor__notice').length, 0);

  items[2].click();
  await flush();
  const notices = [...doc.querySelectorAll('.storyboard-editor__notice')].map((notice) => notice.textContent);
  assert.deepEqual(notices, ['第 2 组开头与上一组最后一个镜头相比，景别和机位都没有变化。']);
});

test('页签：默认显示“调度”，切换时只显示选中的面板，输入内容保留，方向键切换', async () => {
  const { window, doc } = await open();
  const blocking = tabOf(doc, BLOCKING_TAB_TEXT);
  const shotTab = tabOf(doc, SHOT_TAB_TEXT);
  const content = tabOf(doc, CONTENT_TAB_TEXT);
  const [blockingPanel, shotPanel, contentPanel] = [...doc.querySelectorAll('.storyboard-panel')];
  assert.deepEqual([...doc.querySelectorAll('.storyboard-tabs .ui-tab')].map((tab) => tab.textContent.replace(/（.*）/, '')), ['调度', '镜头', '画面与声音']);
  assert.equal(blocking.getAttribute('aria-selected'), 'true');
  assert.equal(blockingPanel.hidden, false);
  assert.equal(shotPanel.hidden, true);
  assert.equal(contentPanel.hidden, true);
  assert.equal(blocking.getAttribute('aria-controls'), blockingPanel.id);
  assert.equal(blockingPanel.getAttribute('aria-labelledby'), blocking.id);

  content.click();
  assert.equal(content.getAttribute('aria-selected'), 'true');
  assert.equal(blockingPanel.hidden, true);
  assert.equal(contentPanel.hidden, false);
  type(window, contentPanel.querySelector('textarea'), '改过的画面描述');
  shotTab.click();
  blocking.click();
  content.click();
  assert.equal(contentPanel.querySelector('textarea').value, '改过的画面描述', '切换页签不丢失已输入的内容');

  // 方向键在页签间移动。
  blocking.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(shotTab.getAttribute('aria-selected'), 'true');
  assert.equal(shotTab.tabIndex, 0);
  assert.equal(blocking.tabIndex, -1);
});

test('页签：换镜头后沿用所选页签', async () => {
  const { doc } = await open();
  tabOf(doc, SHOT_TAB_TEXT).click();
  buttonOf(doc.querySelector('.storyboard-footer__actions'), '下一个').click();
  await flush();
  assert.equal(currentNumber(doc), '002');
  assert.equal(tabOf(doc, SHOT_TAB_TEXT).getAttribute('aria-selected'), 'true');
  assert.equal(doc.querySelectorAll('.storyboard-panel')[0].hidden, true);
});

test('保存状态：修改后显示“有未保存的修改”并启用保存，时长改动同步到标题旁', async () => {
  const { window, doc, saved } = await open();
  const state = doc.querySelector('.storyboard-editor__state');
  const save = buttonOf(doc.querySelector('.storyboard-footer__actions'), '保存镜头');
  assert.equal(state.textContent, '已保存');
  assert.equal(save.disabled, true);

  const duration = doc.querySelectorAll('.storyboard-row--basic input')[1];
  type(window, duration, '5.5');
  assert.equal(state.textContent, '有未保存的修改');
  assert.ok(state.classList.contains('is-dirty'));
  assert.equal(save.disabled, false);
  const tags = [...doc.querySelectorAll('.storyboard-editor__heading .storyboard-tag')].map((tag) => tag.textContent);
  assert.deepEqual(tags, ['第 1 组', '5.5 秒']);

  save.click();
  await flush();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].durationSeconds, '5.5');
  assert.equal(state.textContent, '已保存');
});

test('前后切换：上一个、下一个按顺序移动当前镜头，首尾处禁用', async () => {
  const { doc } = await open();
  const actions = doc.querySelector('.storyboard-footer__actions');
  assert.equal(buttonOf(actions, '上一个').disabled, true);

  buttonOf(actions, '下一个').click();
  await flush();
  assert.equal(currentNumber(doc), '002');

  buttonOf(doc.querySelector('.storyboard-footer__actions'), '下一个').click();
  await flush();
  assert.equal(currentNumber(doc), '003');
  const footer = doc.querySelector('.storyboard-footer__actions');
  assert.equal(buttonOf(footer, '下一个').disabled, true);
  assert.equal(buttonOf(footer, '上一个').disabled, false);
});

test('出场实体：按类型分组，点击切换绑定，页签文字同步数量，保存时带上所选实体', async () => {
  const { doc, saved } = await open();
  buttonOf(doc.querySelector('.storyboard-footer__actions'), '下一个').click();
  await flush();

  const groups = [...doc.querySelectorAll('.storyboard-entity-group')];
  assert.deepEqual(
    groups.map((group) => group.querySelector('.storyboard-entity-group__title').textContent),
    ['角色1 个', '场景1 个']
  );
  const squirrel = buttonOf(doc, '松鼠');
  const cave = buttonOf(doc, '岩石洞穴');
  assert.equal(squirrel.getAttribute('aria-pressed'), 'true', '第 2 个镜头已绑定松鼠');
  assert.equal(cave.getAttribute('aria-pressed'), 'false');
  assert.equal(tabOf(doc, BLOCKING_TAB_TEXT).textContent, `${BLOCKING_TAB_TEXT}（1 个实体 · 0 条站位）`);

  cave.click();
  assert.equal(cave.getAttribute('aria-pressed'), 'true');
  assert.equal(tabOf(doc, BLOCKING_TAB_TEXT).textContent, `${BLOCKING_TAB_TEXT}（2 个实体 · 0 条站位）`);
  assert.equal(doc.querySelector('.storyboard-editor__state').textContent, '有未保存的修改');

  buttonOf(doc.querySelector('.storyboard-footer__actions'), '保存镜头').click();
  await flush();
  assert.deepEqual([saved[0].ref, saved[0].entityIds], [FIRST_SHOT_ID + 1, [SQUIRREL_ID, CAVE_ID]]);
});

test('声音条目：添加与删除更新页签数量，对白才显示说话人，保存时带上全部条目', async () => {
  const { doc, saved } = await open();
  tabOf(doc, CONTENT_TAB_TEXT).click();
  assert.equal(doc.querySelector('.storyboard-sound-list .storyboard-empty').textContent, '这个镜头没有声音。');

  buttonOf(doc, '添加声音').click();
  buttonOf(doc, '添加声音').click();
  assert.equal(doc.querySelectorAll('.storyboard-sound').length, 2);
  assert.equal(tabOf(doc, CONTENT_TAB_TEXT).textContent, `${CONTENT_TAB_TEXT}（2 条声音）`);
  const firstRow = doc.querySelector('.storyboard-sound');
  assert.equal(firstRow.querySelector('.storyboard-sound__speaker').hidden, false, '新条目默认是角色对白，显示说话人');
  firstRow.querySelector('[aria-label="声音类型"]').click();
  [...doc.querySelectorAll('.ui-select__option')].find((option) => option.textContent.trim() === '旁白').click();
  assert.equal(firstRow.querySelector('.storyboard-sound__speaker').hidden, true, '旁白不需要说话人');
  assert.equal(firstRow.querySelector('.storyboard-help').hidden, true);

  buttonOf(firstRow, '删除').click();
  assert.equal(doc.querySelectorAll('.storyboard-sound').length, 1);
  assert.equal(tabOf(doc, CONTENT_TAB_TEXT).textContent, `${CONTENT_TAB_TEXT}（1 条声音）`);

  buttonOf(doc.querySelector('.storyboard-footer__actions'), '保存镜头').click();
  await flush();
  assert.equal(saved[0].sounds.length, 1);
  assert.deepEqual([saved[0].sounds[0].kind, saved[0].sounds[0].isEnabled], ['dialogue', true]);
});

test('调度：站位行在出场实体下方，每个出场的非场景实体一行，随出场实体增减，页签显示已填数量，保存时带上站位', async () => {
  const view = makeView();
  view.shots[1] = makeShot(2, {
    entityIds: [SQUIRREL_ID],
    staging: [{ entityId: SQUIRREL_ID, startX: 'left', startDepth: null, endX: null, endDepth: null, facing: null, action: '蹲在树洞口' }]
  });
  const { doc, saved } = await open(view);
  buttonOf(doc.querySelector('.storyboard-footer__actions'), '下一个').click();
  await flush();
  assert.equal(tabOf(doc, BLOCKING_TAB_TEXT).textContent, `${BLOCKING_TAB_TEXT}（1 个实体 · 1 条站位）`);

  const rows = () => [...doc.querySelectorAll('.storyboard-staging')];
  const blockingPanel = doc.querySelector('.storyboard-blocking');
  assert.ok(blockingPanel.querySelector('.storyboard-entity-groups'), '出场实体与站位在同一个页签');
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].querySelector('.storyboard-staging__title').textContent, '松鼠角色');
  assert.equal(rows()[0].querySelector('input').value, '蹲在树洞口');
  assert.equal(rows()[0].querySelector('[aria-label="松鼠起点横向位置"]').textContent.trim(), '画面左侧');

  // 场景不需要站位；取消松鼠出场后没有行，选回后保留已填内容。
  buttonOf(doc, '岩石洞穴').click();
  assert.equal(rows().length, 1);
  buttonOf(doc, '松鼠').click();
  assert.equal(rows().length, 0);
  assert.ok(doc.querySelector('.storyboard-staging-list .storyboard-empty'));
  buttonOf(doc, '松鼠').click();
  assert.equal(rows()[0].querySelector('input').value, '蹲在树洞口');

  rows()[0].querySelector('[aria-label="松鼠终点横向位置"]').click();
  [...doc.querySelectorAll('.ui-select__option')].find((option) => option.textContent.trim() === '画面右侧').click();
  buttonOf(doc.querySelector('.storyboard-footer__actions'), '保存镜头').click();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(saved[0].staging)), [{ entityId: SQUIRREL_ID, startX: 'left', startDepth: null, endX: 'right', endDepth: null, facing: null, action: '蹲在树洞口' }]);
  assert.deepEqual(saved[0].entityIds, [SQUIRREL_ID, CAVE_ID]);
});

test('只读版本：不显示保存与编辑操作，底部说明原因，仍可前后切换', async () => {
  const view = makeView();
  view.actions = { ...view.actions, canEdit: false, canApprove: false };
  const { doc } = await open(view);
  const footer = doc.querySelector('.storyboard-footer');
  assert.match(footer.textContent, /历史版本只读/);
  assert.equal(buttonOf(footer, '保存镜头'), undefined);
  assert.equal(doc.querySelector('.storyboard-editor__state').hidden, true);
  assert.equal(buttonOf(doc.querySelector('.storyboard-nav__head'), '添加'), undefined);
  assert.equal(buttonOf(footer, '下一个').disabled, false);
});
