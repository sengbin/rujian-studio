// ------------------------------------------------------------------------
// 名称：stage-beat-sheet.test.mjs
// 说明：节拍表产出层与剧本改编清单的 DOM 测试：节拍列表显示参考预算、保存节拍发出请求；改编清单勾选后在本地即时重算预计总时长并保存勾选，确认按钮只在可确认时出现。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：使用 jsdom 加载组件库与 resources/stage 下的脚本，宿主请求用假的 hostBridge 应答并记录；放在 ui-kit/test 是因为 npm test 只收集这里的页面测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { createUiEnvironment } from './ui-environment.mjs';

const RESOURCES_ROOT = fileURLToPath(new URL('../../resources/', import.meta.url));
const WORK_ID = 1;

let env;

afterEach(() => env?.close());

/** 通用的运行记录视图。 */
function makeRun(display) {
  return { id: 5, version: 1, display, isCurrent: false, modelInfo: '', errorMessage: null, hasRawOutput: false, progress: null, createdAt: new Date().toISOString(), finishedAt: null, approvedAt: null };
}

const WORK = { id: WORK_ID, projectId: 1, name: '作品甲', kind: 'short_video', kindLabel: '单个短视频', multiEpisode: false, sourceType: 'text' };

/** 节拍表阶段视图：4 个节拍，参考预算 4.5/13.5/7.5/4.5 秒。 */
function makeBeatView() {
  const beats = [
    ['钩子', 0.15, 4.5, 18],
    ['展开', 0.45, 13.5, 54],
    ['转折', 0.25, 7.5, 30],
    ['收尾', 0.15, 4.5, 18]
  ].map(([label, targetRatio, estimatedSeconds, estimatedWords], index) => ({
    seq: index + 1,
    label,
    purpose: `${label}的戏剧目的`,
    targetRatio,
    estimatedSeconds,
    estimatedWords,
    synopsis: `第${index + 1}拍的剧情`,
    sourceRefs: []
  }));
  return {
    work: WORK,
    versions: [{ id: 5, version: 1, display: 'pending', isCurrent: false }],
    run: makeRun('pending'),
    params: { formatType: 'short_video', targetDurationSeconds: 30, wordsPerSecond: 4, episodeCount: 1 },
    templateLabel: '单集短视频（钩子型）',
    beats,
    actions: { canApprove: true, canCancel: false, canRetry: false, canEdit: true, editNeedsConfirm: false }
  };
}

/** 剧本阶段视图：改编清单待确认，还没有正文；基线 360 字（90 秒），目标 30 秒，4 字/秒，容差 15%。 */
function makeScreenplayView(canConfirmAdaptation) {
  return {
    work: WORK,
    versions: [{ id: 5, version: 1, display: 'pending', isCurrent: false }],
    run: makeRun('pending'),
    params: null,
    fidelity: 'adapted',
    screenplay: null,
    adaptation: {
      baselineWords: 360,
      baselineSeconds: 90,
      targetSeconds: 30,
      wordsPerSecond: 4,
      toleranceRatio: 0.15,
      confirmed: !canConfirmAdaptation,
      options: [
        { id: 'option-1', kind: 'subplot', label: '配角感情线', reason: '与主线无关', affectedRefs: ['第2章'], estimatedWordsSaved: 200, estimatedSecondsSaved: 50, recommended: true, selected: true },
        { id: 'option-2', kind: 'scene_skip', label: '宴会场', reason: '只做铺垫', affectedRefs: [], estimatedWordsSaved: 100, estimatedSecondsSaved: 25, recommended: false, selected: false }
      ],
      estimate: { estimatedWords: 160, estimatedSeconds: 40, withinTolerance: false }
    },
    toleranceRatio: 0.15,
    episodes: [],
    entities: [],
    entityKinds: [],
    merged: false,
    stale: false,
    downstreamEpisodes: [],
    removedEpisodes: [],
    blockedEpisodes: [],
    actions: { canApprove: false, canCancel: false, canRetry: false, canEdit: false, editNeedsConfirm: false, canReextract: false, canReannotate: false, canConfirmAdaptation }
  };
}

/** 建立测试页面：组件库、假的宿主通信桥（记录除加载外的请求），以及各阶段脚本。 */
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
  for (const file of ['shared/page-format.js', 'stage/stage.js', 'stage/stage-beat-sheet.js', 'stage/stage-screenplay.js']) {
    window.eval(readFileSync(`${RESOURCES_ROOT}${file}`, 'utf8'));
  }
  return { window, doc: env.document, requests };
}

/** 页面脚本在 jsdom 窗口里创建的对象与测试不同源，比较前先转成普通对象。 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** 等待已排队的异步任务（含请求应答）执行完。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

test('节拍表：左侧列出节拍与参考预算，编辑剧情后保存发出带版本与节拍序号的请求', async () => {
  const { window, doc, requests } = setup(makeBeatView());
  window.aiStage.open(WORK_ID, 'beat_sheet');
  await flush();

  const items = [...doc.querySelectorAll('.stage-item')];
  assert.deepEqual(items.map((item) => item.querySelector('.stage-item__title').textContent), ['1. 钩子', '2. 展开', '3. 转折', '4. 收尾']);
  assert.deepEqual(items.map((item) => item.querySelector('.stage-item__meta').textContent), ['约 4.5 秒 / 18 字', '约 13.5 秒 / 54 字', '约 7.5 秒 / 30 字', '约 4.5 秒 / 18 字']);
  assert.ok(doc.body.textContent.includes('目标时长 30 秒，按 4 字/秒约 120 字'));

  const field = doc.querySelector('.stage-editor textarea');
  assert.equal(field.value, '第1拍的剧情');
  field.value = '新的开场';
  field.dispatchEvent(new window.Event('input', { bubbles: true }));
  const save = [...doc.querySelectorAll('.stage-editor__actions button')].find((button) => button.textContent === '保存本拍');
  assert.equal(save.disabled, false);
  save.click();
  await flush();
  assert.deepEqual(plain(requests), [['stage.saveBeat', { id: 5, seq: 1, synopsis: '新的开场', workId: WORK_ID, stage: 'beat_sheet' }]]);
});

test('改编清单：勾选后在本地即时重算预计总时长并保存勾选，确认按钮只在可确认时出现', async () => {
  const { window, doc, requests } = setup(makeScreenplayView(true));
  window.aiStage.open(WORK_ID, 'screenplay');
  await flush();

  const status = () => doc.querySelector('.stage-adaptation [role="status"]').textContent;
  const boxes = () => [...doc.querySelectorAll('.stage-adaptation [role="checkbox"]')];
  // 默认按模型建议勾选第 1 项：360 - 200 = 160 字，按 4 字/秒为 40 秒，仍超出 30 秒的容差上限。
  assert.ok(status().startsWith('当前预计总时长 40 秒 / 目标时长 30 秒（容差 ±15%，改编前预计 90 秒）。仍超出目标'), status());
  assert.deepEqual(boxes().map((box) => box.getAttribute('aria-checked')), ['true', 'false']);

  // 再勾选第 2 项：只剩 60 字（15 秒），低于目标；取消第 1 项后只省 100 字，剩 65 秒。
  boxes()[1].click();
  assert.ok(status().includes('当前预计总时长 15 秒') && status().includes('已低于目标时长'), status());
  boxes()[0].click();
  assert.ok(status().includes('当前预计总时长 65 秒') && status().includes('仍超出目标'), status());
  await flush();

  // 每次勾选变化只保存勾选，没有向宿主请求重算。
  assert.deepEqual(
    plain(requests.filter(([name]) => name === 'stage.saveAdaptation').map(([, payload]) => payload.selected)),
    [['option-1', 'option-2'], ['option-2']]
  );
  const confirm = [...doc.querySelectorAll('.stage-adaptation .stage-editor__actions button')].find((button) => button.textContent === '确认取舍并生成正文');
  assert.ok(confirm, '待确认时有确认按钮');
});

test('改编清单已确认：勾选框禁用，没有确认按钮，说明正在生成正文', async () => {
  const { window, doc } = setup(makeScreenplayView(false));
  window.aiStage.open(WORK_ID, 'screenplay');
  await flush();

  const boxes = [...doc.querySelectorAll('.stage-adaptation [role="checkbox"]')];
  assert.deepEqual(boxes.map((box) => box.getAttribute('aria-disabled')), ['true', 'true']);
  assert.equal(doc.querySelectorAll('.stage-adaptation .stage-editor__actions').length, 0);
  assert.ok(doc.querySelector('.stage-adaptation').textContent.includes('改编取舍已确认，正在按取舍生成剧本正文'));
});
