// ------------------------------------------------------------------------
// 名称：stage-editing.test.mjs
// 说明：各阶段编辑区共用规则的测试：只读原因文案、保存按钮状态、偏差与“最多列 5 项”文案，以及创意、剧本阶段使用这些规则的页面行为（汇总文字、保存按钮、已确认版本被编辑时的确认）。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：使用 jsdom 加载组件库与 resources/stage 下的脚本，宿主请求用假的 hostBridge 应答并记录；放在 ui-kit/test 是因为 npm test 只收集这里的页面测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { createUiEnvironment } from './ui-environment.mjs';

const RESOURCES_ROOT = fileURLToPath(new URL('../../resources/', import.meta.url));
const WORK_ID = 1;
const STAGE_SCRIPTS = [
  'shared/page-format.js',
  'stage/stage-actions.js',
  'stage/stage-header.js',
  'stage/stage.js',
  'stage/stage-editing.js',
  'stage/stage-creative.js',
  'stage/stage-screenplay-list.js',
  'stage/stage-screenplay-editors.js',
  'stage/stage-screenplay-adaptation.js',
  'stage/stage-screenplay.js'
];

let env;

afterEach(() => env?.close());

const WORK = { id: WORK_ID, projectId: 1, name: '作品甲', kind: 'series', kindLabel: '系列短剧', multiEpisode: true, sourceType: 'text' };

/** 页面脚本在 jsdom 窗口里创建的对象与测试不同源，比较前先转成普通对象。 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** 等待已排队的异步任务（含请求应答）执行完。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

/** 通用的运行记录视图。 */
function makeRun(display) {
  return { id: 5, version: 1, display, isCurrent: false, modelInfo: '', errorMessage: null, hasRawOutput: false, progress: null, createdAt: new Date().toISOString(), finishedAt: null, approvedAt: null };
}

/** 建立测试页面：组件库、假的宿主通信桥（记录除加载外的请求），以及阶段脚本。 */
function setup(view) {
  env = createUiEnvironment();
  const { window } = env;
  const requests = [];
  window.hostBridge = {
    request: async (name, payload) => {
      if (name === 'stage.load') return view;
      requests.push([name, payload]);
      return { saved: true };
    },
    onEvent: () => undefined
  };
  for (const file of STAGE_SCRIPTS) window.eval(readFileSync(`${RESOURCES_ROOT}${file}`, 'utf8'));
  return { window, doc: env.document, requests };
}

/** 创意阶段视图：chapters 由调用方给出。 */
function makeCreativeView(chapters, actions = {}) {
  return {
    work: WORK,
    versions: [{ id: 5, version: 1, display: 'pending', isCurrent: false }],
    run: makeRun('pending'),
    params: { chapterMinWords: 800, chapterMaxWords: 1200 },
    chapters,
    totalWords: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    toleranceRatio: 0.15,
    maxCalibrationRounds: 2,
    actions: { canApprove: true, canCancel: false, canRetry: false, canEdit: true, editNeedsConfirm: false, ...actions }
  };
}

/** 构造 count 个章节：参考值由 reference 回调给出，没有则不带参考。 */
function makeChapters(count, reference) {
  return Array.from({ length: count }, (_, index) => ({
    seq: index + 1,
    title: `章${index + 1}`,
    content: `正文${index + 1}`,
    wordCount: 500,
    wordHint: reference ? null : 'short',
    reference: reference ? reference(index) : null
  }));
}

/** 剧本阶段视图：集由调用方给出，另有一个角色实体。 */
function makeScreenplayView(episodes) {
  return {
    work: WORK,
    versions: [{ id: 5, version: 1, display: 'pending', isCurrent: false }],
    run: makeRun('pending'),
    params: null,
    fidelity: 'adapted',
    screenplay: { title: '剧本标题', overview: '剧本梗概', fullText: '剧本正文' },
    adaptation: null,
    toleranceRatio: 0.15,
    maxCalibrationRounds: 2,
    episodes,
    entities: [{ ref: 'e1', kind: 'character', name: '团团', aliases: [], description: '主角', attributes: {}, isActive: true }],
    entityKinds: [{ kind: 'character', label: '角色', attributes: [] }],
    merged: false,
    stale: false,
    downstreamEpisodes: [],
    removedEpisodes: [],
    blockedEpisodes: [],
    actions: { canApprove: true, canCancel: false, canRetry: false, canEdit: true, editNeedsConfirm: false, canReextract: true, canReannotate: false, canConfirmAdaptation: false }
  };
}

/** 对话框里文字完全匹配的按钮，取最上层的一个。 */
const dialogButton = (doc, text) => [...doc.querySelectorAll('.ui-dialog button')].filter((button) => button.textContent.trim() === text).at(-1);

test('只读原因：可编辑为空，生成中、失败或已取消、历史版本各有说明', () => {
  env = createUiEnvironment();
  env.window.eval(readFileSync(`${RESOURCES_ROOT}stage/stage-editing.js`, 'utf8'));
  const { readonlyReason } = env.window.aiStageEditor;
  const view = (display, canEdit) => ({ run: { display }, actions: { canEdit } });
  assert.equal(readonlyReason(view('pending', true)), '');
  assert.equal(readonlyReason(view('running', false)), '生成中，暂不能编辑。');
  assert.equal(readonlyReason(view('failed', false)), '生成尚未成功，暂不能编辑。');
  assert.equal(readonlyReason(view('canceled', false)), '生成尚未成功，暂不能编辑。');
  assert.equal(readonlyReason(view('approved', false)), '历史版本只读；如需修改，请切换到最新版本。');
});

test('偏差与列表文案：带正负号的偏差、参考与实测对照、最多列 5 项并补总数', () => {
  env = createUiEnvironment();
  env.window.eval(readFileSync(`${RESOURCES_ROOT}stage/stage-editing.js`, 'utf8'));
  const { formatDeviation, describeReference, limitedList } = env.window.aiStageEditor;
  assert.equal(formatDeviation(0.084), '+8%');
  assert.equal(formatDeviation(-0.034), '-3%');
  assert.equal(formatDeviation(0), '0%');
  assert.equal(describeReference('30 秒', '32.5 秒', 0.08), '参考 30 秒，实测 32.5 秒，偏差 +8%');
  const format = (item) => `第 ${item} 章`;
  assert.deepEqual(plain(limitedList([1, 2, 3], format, '章')), { listed: '第 1 章、第 2 章、第 3 章', more: '' });
  assert.deepEqual(plain(limitedList([1, 2, 3, 4, 5, 6, 7], format, '章')), { listed: '第 1 章、第 2 章、第 3 章、第 4 章、第 5 章', more: '（共 7 章）' });
});

test('保存按钮：有修改才可点，保存后显示“已保存”；新增的条目始终可点', () => {
  env = createUiEnvironment();
  env.window.eval(readFileSync(`${RESOURCES_ROOT}stage/stage-editing.js`, 'utf8'));
  const { createSaveButton, SAVE_STATE_DIRTY, SAVE_STATE_SAVED } = env.window.aiStageEditor;
  const existing = createSaveButton({ text: '保存', onClick: () => undefined });
  assert.equal(existing.button.element.disabled, true);
  existing.setSaveState(SAVE_STATE_DIRTY);
  assert.equal(existing.button.element.disabled, false);
  assert.equal(existing.button.element.textContent, '保存');
  existing.setSaveState(SAVE_STATE_SAVED);
  assert.equal(existing.button.element.disabled, true);
  assert.equal(existing.button.element.textContent, '已保存');

  const added = createSaveButton({ text: '添加', alwaysEnabled: true, onClick: () => undefined });
  assert.equal(added.button.element.disabled, false);
  added.setSaveState(SAVE_STATE_SAVED);
  assert.equal(added.button.element.disabled, false);
  assert.equal(added.button.element.textContent, '已保存');
  added.setSaveState(SAVE_STATE_DIRTY);
  assert.equal(added.button.element.textContent, '添加');
});

test('创意汇总：自由创作的章节不在设定范围时最多列 5 章并补总数；参考模式超出容差时逐章显示偏差', async () => {
  const free = setup(makeCreativeView(makeChapters(7)));
  free.window.aiStage.open(WORK_ID, 'creative');
  await flush();
  const freeText = free.doc.body.textContent;
  assert.ok(freeText.includes('有 7 章不在该范围：第 1 章 500 字、第 2 章 500 字、第 3 章 500 字、第 4 章 500 字、第 5 章 500 字（共 7 章）。'), freeText);
  env.close();

  const reference = setup(makeCreativeView(makeChapters(2, () => ({ targetWords: 400, deviationRatio: 0.25, withinTolerance: false }))));
  reference.window.aiStage.open(WORK_ID, 'creative');
  await flush();
  const refText = reference.doc.body.textContent;
  assert.ok(refText.includes('有 2 章超出参考字数的容差 ±15%'), refText);
  assert.ok(refText.includes('第 1 章（参考 400 字，实测 500 字，偏差 +25%）、第 2 章（参考 400 字，实测 500 字，偏差 +25%）'), refText);
});

test('创意编辑：修改后保存按钮可点，已确认的版本先确认再保存，保存后按钮显示“已保存”', async () => {
  const { window, doc, requests } = setup(makeCreativeView(makeChapters(1), { editNeedsConfirm: true }));
  window.aiStage.open(WORK_ID, 'creative');
  await flush();

  const save = () => [...doc.querySelectorAll('.stage-editor__actions button')].find((button) => button.textContent === '保存本章' || button.textContent === '已保存');
  assert.equal(save().textContent, '保存本章');
  assert.equal(save().disabled, true);
  const title = doc.querySelector('.stage-editor__title input');
  title.value = '新标题';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(save().disabled, false);
  save().click();
  await flush();
  assert.ok([...doc.querySelectorAll('.ui-dialog')].at(-1).textContent.includes('该版本已确认采用。保存后将回到待确认，需要重新确认。'));
  assert.equal(requests.length, 0, '确认之前不发请求');
  dialogButton(doc, '保存').click();
  await flush();
  assert.deepEqual(plain(requests), [['stage.saveChapter', { id: 5, seq: 1, title: '新标题', content: '正文1', workId: WORK_ID, stage: 'creative' }]]);
  assert.equal(save().textContent, '已保存');
  assert.equal(save().disabled, true);
});

test('剧本：超出容差的集在汇总里最多列 5 集，编辑集后保存发出带定位值的请求', async () => {
  const episodes = Array.from({ length: 7 }, (_, index) => ({
    ref: `ep${index + 1}`,
    seq: index + 1,
    title: `集${index + 1}`,
    synopsis: '梗概',
    screenplayText: '正文',
    targetDurationSeconds: null,
    reference: { targetSeconds: 30, actualSeconds: 40, deviationRatio: 1 / 3, withinTolerance: false }
  }));
  const { window, doc, requests } = setup(makeScreenplayView(episodes));
  window.aiStage.open(WORK_ID, 'screenplay');
  await flush();

  const summary = doc.body.textContent;
  assert.ok(summary.includes('有 7 集超出目标时长的容差，已自动重写 2 轮仍未达标（已达上限）：第 1 集（参考 30 秒，实测 40 秒，偏差 +33%）'), summary);
  assert.ok(summary.includes('第 5 集（参考 30 秒，实测 40 秒，偏差 +33%）。可直接编辑调整后再确认采用。'), summary);
  assert.ok(!summary.includes('第 6 集（参考'), '只列前 5 集');
  assert.deepEqual([...doc.querySelectorAll('.stage-item__meta')].slice(1, 3).map((item) => item.textContent), ['40 / 30 秒', '40 / 30 秒']);

  const items = [...doc.querySelectorAll('.stage-item')];
  items[1].click();
  await flush();
  const title = doc.querySelector('.stage-editor input');
  assert.equal(title.value, '集1');
  title.value = '新集名';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  const save = [...doc.querySelectorAll('.stage-editor__actions button')].find((button) => button.textContent === '保存');
  assert.equal(save.disabled, false);
  save.click();
  await flush();
  assert.deepEqual(plain(requests.map(([name, payload]) => [name, payload.ref, payload.title])), [['stage.saveEpisode', 'ep1', '新集名']]);
  assert.equal([...doc.querySelectorAll('.stage-editor__actions button')].some((button) => button.textContent === '已保存'), true);
});
