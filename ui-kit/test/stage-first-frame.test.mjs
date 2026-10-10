// ------------------------------------------------------------------------
// 名称：stage-first-frame.test.mjs
// 说明：分镜脚本产出层“首帧来源”的 DOM 测试：选“指定图片”出现图片选择（上传、预览、更换、移除），选“资产参考图”才出现资产下拉并在保存时带上资产标识；已保存的首帧会回显；其他来源不带资产和图片。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：使用 jsdom 加载组件库与 resources/stage 下的脚本，宿主请求用假的 hostBridge 应答并记录保存请求；放在 ui-kit/test 是因为 npm test 只收集这里的页面测试。
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
const SCENE_ASSET_ID = 5;

let env;

afterEach(() => env?.close());

/** 构造一个镜头；字段与宿主返回的镜头一致。 */
function makeShot(seq, overrides = {}) {
  return {
    id: FIRST_SHOT_ID + seq - 1,
    seq,
    sceneLabel: '',
    shotSize: '中景',
    cameraAngle: '',
    cameraMovement: '',
    durationSeconds: 3,
    transition: '',
    continuityNote: '',
    firstFrameMode: 'none',
    firstFrameAssetId: null,
    firstFrameImage: null,
    entityIds: [],
    sounds: [],
    prompt: `镜头${seq}的画面`,
    ...overrides
  };
}

/** 宿主返回的分镜脚本阶段视图：两个镜头，资产库里有一个带参考图的场景资产。 */
function makeView(shots) {
  return {
    work: { id: WORK_ID, projectId: 1, name: '作品甲', kind: 'short_drama', kindLabel: '多集短片', sourceType: 'text' },
    episode: { id: EPISODE_ID, seq: 1, title: '第一集' },
    versions: [{ id: 1, version: 1, display: 'pending', isCurrent: true }],
    run: { id: 1, display: 'pending', createdAt: new Date().toISOString(), hasRawOutput: false, modelInfo: '', progress: null },
    params: null,
    shots,
    groups: [{ id: 1, seq: 1, shotIds: shots.map((shot) => shot.id), totalSeconds: 6 }],
    groupMaxSeconds: 12,
    totalSeconds: 6,
    entities: [],
    firstFrameAssets: [{ id: SCENE_ASSET_ID, kindLabel: '场景', name: '灯塔远景' }],
    limits: { maxSoundsPerShot: 20, firstFrameImageMaxBytes: 10 * 1024 * 1024 },
    stagingOptions: {
      x: [{ value: 'left', label: '画面左侧' }, { value: 'center', label: '画面中央' }, { value: 'right', label: '画面右侧' }],
      depth: [{ value: 'front', label: '前景' }, { value: 'middle', label: '中景' }, { value: 'back', label: '背景' }],
      facing: [{ value: 'camera', label: '面向镜头' }, { value: 'left', label: '面朝画面左侧' }]
    },
    soundKinds: [{ kind: 'dialogue', label: '对白' }],
    stale: false,
    actions: { canEdit: true, canApprove: true, canCancel: false, canRetry: false, editNeedsConfirm: false }
  };
}

/** 宿主为已保存的首帧图片返回的文件（一张极小的 PNG）。 */
const SAVED_IMAGE = { name: 'saved.png', mimeType: 'image/png', size: 4, data: Buffer.from([1, 2, 3, 4]).toString('base64'), width: 1, height: 1 };

/** 建立测试页面并打开产出层，返回页面与记录到的保存请求、读取首帧图片的请求。 */
async function open(shots) {
  env = createUiEnvironment();
  const { window } = env;
  const saved = [];
  const reads = [];
  window.hostBridge = {
    request: async (name, payload) => {
      if (name === 'stage.saveShot') {
        saved.push(payload);
        return { ref: payload.ref };
      }
      if (name === 'stage.readShotFirstFrame') {
        reads.push(payload.ref);
        return SAVED_IMAGE;
      }
      assert.equal(name, 'stage.load');
      return makeView(shots);
    },
    onEvent: () => undefined
  };
  for (const file of ['shared/page-format.js', 'stage/stage-actions.js', 'stage/stage-header.js', 'stage/stage.js', 'stage/stage-editor-common.js', 'stage/stage-storyboard-panels.js', 'stage/stage-storyboard.js']) {
    window.eval(readFileSync(`${RESOURCES_ROOT}${file}`, 'utf8'));
  }
  window.aiStage.open(WORK_ID, 'storyboard_script', EPISODE_ID, shots[0].id);
  await flush();
  // 首帧来源在“镜头”页签里。
  [...env.document.querySelectorAll('.storyboard-tabs .ui-tab')].find((tab) => tab.textContent.startsWith('镜头')).click();
  return { window, doc: env.document, saved, reads };
}

/** 等待已排队的异步任务（含请求应答）执行完。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

/** 在页面里点开某个下拉并选中显示为 label 的选项。 */
function choose(doc, ariaLabel, label) {
  doc.querySelector(`[aria-label="${ariaLabel}"]`).click();
  const option = [...doc.querySelectorAll('.ui-select__option')].find((item) => item.textContent.trim() === label);
  assert.ok(option, `下拉“${ariaLabel}”里应有选项“${label}”`);
  option.click();
}

/** 首帧资产字段（外壳）；用于检查是否显示。 */
function assetField(doc) {
  return doc.querySelector('[aria-label="首帧资产"]').closest('.ui-field');
}

/** 首帧图片字段（外壳）。 */
function imageField(doc) {
  return doc.querySelector('.storyboard-first-frame-image');
}

/** 点“保存镜头”并等待请求完成。 */
async function clickSave(doc) {
  [...doc.querySelectorAll('.storyboard-footer__actions button')].find((button) => button.textContent.trim() === '保存镜头').click();
  await flush();
}

/** 模拟用户在首帧图片的文件选择框中选中一个文件，并等到控件读取完成（缩略图变成新文件）；负载高时读取会慢，所以轮询而不是固定等待。 */
async function pickImage(window, doc, name, bytes) {
  const before = thumbnailSources(doc)[0];
  const input = imageField(doc).querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [new window.File([new window.Uint8Array(bytes)], name, { type: 'image/png' })], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const after = thumbnailSources(doc)[0];
    if (after !== undefined && after !== before) return;
  }
  assert.fail(`选择“${name}”后控件没有读取完成`);
}

/** 首帧图片控件里列出的文件缩略图地址。 */
function thumbnailSources(doc) {
  return [...imageField(doc).querySelectorAll('.ui-file-picker__thumb-image')].map((image) => image.getAttribute('src'));
}

test('首帧来源：选“资产参考图”才出现首帧资产下拉，保存时带上所选资产，不带图片', async () => {
  const { doc, saved } = await open([makeShot(1), makeShot(2)]);
  assert.equal(assetField(doc).hidden, true, '默认不指定首帧时不显示首帧资产');
  assert.equal(imageField(doc).hidden, true, '默认不指定首帧时不显示首帧图片');

  choose(doc, '首帧来源', '资产参考图');
  assert.equal(assetField(doc).hidden, false);
  assert.equal(imageField(doc).hidden, true);
  choose(doc, '首帧资产', '[场景] 灯塔远景');

  await clickSave(doc);
  assert.equal(saved.length, 1);
  assert.deepEqual([saved[0].ref, saved[0].firstFrameMode, saved[0].firstFrameAssetId], [FIRST_SHOT_ID, 'asset', SCENE_ASSET_ID]);
  assert.ok(!('firstFrameImage' in saved[0]));

  choose(doc, '首帧来源', '不指定');
  assert.equal(assetField(doc).hidden, true, '改回其他来源后隐藏首帧资产');
});

test('首帧来源：选“指定图片”出现图片选择，选中的本地图片显示缩略图，保存时带上文件内容', async () => {
  const { window, doc, saved } = await open([makeShot(1), makeShot(2)]);
  choose(doc, '首帧来源', '指定图片');
  assert.equal(imageField(doc).hidden, false);
  assert.equal(assetField(doc).hidden, true);

  await pickImage(window, doc, 'tail.png', [9, 8, 7]);
  assert.equal(thumbnailSources(doc).length, 1);
  assert.ok(thumbnailSources(doc)[0].startsWith('data:image/png;base64,'));

  await clickSave(doc);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].firstFrameMode, 'image');
  assert.deepEqual({ ...saved[0].firstFrameImage }, { name: 'tail.png', mimeType: 'image/png', size: 3, data: Buffer.from([9, 8, 7]).toString('base64') });
});

test('首帧来源：已保存的指定图片读取后预览，没有改动时保存不重传图片，换图时带新图片，移除后保存传空', async () => {
  const savedShot = makeShot(1, { firstFrameMode: 'image', firstFrameImage: { id: 3, fileName: 'saved.png', mime: 'image/png', width: 1, height: 1, sizeBytes: 4 } });
  const { window, doc, saved, reads } = await open([savedShot, makeShot(2)]);
  // 已保存的图片由宿主读出后放进控件；负载高时读取会慢，所以轮询等待。
  for (let attempt = 0; attempt < 100 && thumbnailSources(doc).length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(reads, [FIRST_SHOT_ID], '按镜头读取已保存的图片');
  assert.equal(doc.querySelector('[aria-label="首帧来源"]').textContent.trim(), '指定图片');
  assert.equal(imageField(doc).hidden, false);
  assert.deepEqual(thumbnailSources(doc), [`data:image/png;base64,${SAVED_IMAGE.data}`]);

  // 没有改图片：换一下来源再换回来以便可以保存，提交里不带图片内容。
  choose(doc, '首帧来源', '不指定');
  choose(doc, '首帧来源', '指定图片');
  await clickSave(doc);
  assert.equal(saved[0].firstFrameMode, 'image');
  assert.ok(!('firstFrameImage' in saved[0]), '没有改动的已保存图片不重传');

  // 更换：选择新图片后提交新的内容。
  await pickImage(window, doc, 'new.png', [5, 5]);
  assert.equal(thumbnailSources(doc).length, 1);
  await clickSave(doc);
  assert.deepEqual({ ...saved[1].firstFrameImage }, { name: 'new.png', mimeType: 'image/png', size: 2, data: Buffer.from([5, 5]).toString('base64') });

  // 移除：控件为空时提交 null，由宿主提示重新选择。
  [...imageField(doc).querySelectorAll('button')].find((button) => button.textContent === '移除').click();
  assert.equal(thumbnailSources(doc).length, 0);
  await clickSave(doc);
  assert.equal(saved[2].firstFrameImage, null);
});

test('首帧来源：已保存的资产参考图回显；资产已被删除时选中“资产参考图”但没有选定的资产；第 1 个镜头没有“上一镜头尾帧”', async () => {
  const withAsset = await open([makeShot(1, { firstFrameMode: 'asset', firstFrameAssetId: SCENE_ASSET_ID }), makeShot(2)]);
  assert.equal(withAsset.doc.querySelector('[aria-label="首帧来源"]').textContent.trim(), '资产参考图');
  assert.equal(withAsset.doc.querySelector('[aria-label="首帧资产"]').textContent.trim(), '[场景] 灯塔远景');
  assert.equal(assetField(withAsset.doc).hidden, false);
  assert.equal(imageField(withAsset.doc).hidden, true);
  withAsset.doc.querySelector('[aria-label="首帧来源"]').click();
  const labels = [...withAsset.doc.querySelectorAll('.ui-select__option')].map((item) => item.textContent.trim());
  assert.deepEqual(labels, ['不指定', '指定图片', '资产参考图']);
  env.close();

  const deleted = await open([makeShot(1, { firstFrameMode: 'asset', firstFrameAssetId: null }), makeShot(2)]);
  assert.equal(deleted.doc.querySelector('[aria-label="首帧来源"]').textContent.trim(), '资产参考图');
  assert.notEqual(deleted.doc.querySelector('[aria-label="首帧资产"]').textContent.trim(), '[场景] 灯塔远景');
});
