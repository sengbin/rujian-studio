// ------------------------------------------------------------------------
// 名称：storyboard-preview-fixtures.mjs
// 说明：分镜动画测试的共用夹具：在 Node 中加载 resources/stage 下的纯逻辑脚本，并构造宿主返回格式的分镜脚本阶段视图。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：纯逻辑脚本只依赖 window 对象，这里用普通对象代替，因此返回值与测试在同一个运行环境里，可直接比较；放在 ui-kit/test 且不以 .test 结尾，npm test 不会把它当作测试文件。
// ------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RESOURCES_ROOT = fileURLToPath(new URL('../../resources/', import.meta.url));

/** 角色、场景与道具的实体标识。 */
export const IDS = { hedgehog: 11, bat: 12, cave: 21, forest: 22, table: 31, spark: 41 };

/**
 * 在 Node 中加载一个 resources 下的脚本，返回它挂在 window 上的对象。
 * @param {string} file 相对 resources 的路径。
 * @param {Record<string, unknown>} [globals] 需要预先放进 window 的其他对象（如依赖的模块）。
 */
export function loadScript(file, globals = {}) {
  const win = { ...globals };
  new Function('window', readFileSync(`${RESOURCES_ROOT}${file}`, 'utf8'))(win);
  return win;
}

/**
 * 按顺序加载一组脚本，后一个脚本能看到前面脚本挂在 window 上的模块。
 * @param {string[]} files 相对 resources 的路径，按依赖顺序排列。
 * @param {Record<string, unknown>} [globals] 需要预先放进 window 的其他对象。
 * @returns {Record<string, unknown>} 加载完成后的 window。
 */
export function loadScripts(files, globals = {}) {
  return files.reduce((win, file) => loadScript(file, win), globals);
}

/** 时间线需要的脚本：关键词规则、编译、采样。 */
export const TIMELINE_SCRIPTS = [
  'stage/stage-storyboard-preview-rules.js',
  'stage/stage-storyboard-preview-timeline.js',
  'stage/stage-storyboard-preview-timeline-sample.js'
];

/** 绘制相关的脚本：基础绘制、插画（人形、道具表、特效表、背景、入口）、扩展道具与特效与背景、角色、动物与微生物、绘制、对照视图。 */
export const RENDER_SCRIPTS = [
  'stage/stage-storyboard-preview-draw.js',
  'stage/stage-storyboard-preview-art-figure.js',
  'stage/stage-storyboard-preview-art-props.js',
  'stage/stage-storyboard-preview-art-effects.js',
  'stage/stage-storyboard-preview-art-backdrops.js',
  'stage/stage-storyboard-preview-art.js',
  'stage/stage-storyboard-preview-props-home.js',
  'stage/stage-storyboard-preview-props-items.js',
  'stage/stage-storyboard-preview-props-effects.js',
  'stage/stage-storyboard-preview-props-backdrops.js',
  'stage/stage-storyboard-preview-creatures.js',
  'stage/stage-storyboard-preview-bestiary.js',
  'stage/stage-storyboard-preview-renderer.js',
  'stage/stage-storyboard-preview-modes.js'
];

/** 预览页面的全部脚本，与 src/app/panels/page-resources.ts 的 STORYBOARD_PREVIEW_SCRIPTS 保持一致。 */
export const PREVIEW_PAGE_SCRIPTS = [
  ...TIMELINE_SCRIPTS,
  'stage/stage-storyboard-preview-checks.js',
  ...RENDER_SCRIPTS,
  'stage/stage-storyboard-preview-player.js',
  'stage/stage-storyboard-preview-voice.js',
  'stage/stage-storyboard-preview-voice-draft.js',
  'stage/stage-storyboard-preview-stage-view.js',
  'stage/stage-storyboard-preview-controls.js',
  'stage/stage-storyboard-preview-timeline-view.js',
  'stage/stage-storyboard-preview-voice-panel.js',
  'stage/stage-storyboard-preview-info-panel.js',
  'stage/stage-storyboard-preview.js'
];

/** 加载时间线相关的全部脚本，返回 window（含 aiStoryboardRules 与 aiStoryboardTimeline）。 */
export function loadTimelineWindow() {
  return loadScripts(TIMELINE_SCRIPTS);
}

/** 加载时间线编译模块。 */
export function loadTimeline() {
  return loadTimelineWindow().aiStoryboardTimeline;
}

/** 按依赖顺序加载绘制相关的全部脚本（时间线、插画、绘制、对照视图），返回各模块。 */
export function loadRenderStack() {
  const modesWindow = loadScripts([...TIMELINE_SCRIPTS, ...RENDER_SCRIPTS]);
  return {
    timeline: modesWindow.aiStoryboardTimeline,
    art: modesWindow.aiStoryboardArt,
    creatures: modesWindow.aiStoryboardCreatures,
    renderer: modesWindow.aiStoryboardRenderer,
    modes: modesWindow.aiStoryboardModes
  };
}

/** 构造一个镜头；字段与宿主返回的镜头一致。 */
export function makeShot(seq, overrides = {}) {
  return {
    id: 100 + seq,
    seq,
    sceneLabel: `场次${seq}`,
    shotSize: '中景',
    cameraAngle: '平视',
    cameraMovement: '',
    durationSeconds: 4,
    transition: '切',
    continuityNote: '',
    firstFrameMode: 'none',
    firstFrameAssetId: null,
    entityIds: [],
    staging: [],
    sounds: [],
    prompt: `镜头${seq}的画面`,
    ...overrides
  };
}

/** 构造一个站位；未写的位置与朝向为空。 */
export function makeStaging(entityId, overrides = {}) {
  return { entityId, startX: null, startDepth: null, endX: null, endDepth: null, facing: null, action: '', ...overrides };
}

/** 构造一条声音；标识自动递增，与宿主返回的声音条目一样每条不同。 */
let nextSoundId = 1000;
export function makeSound(overrides = {}) {
  return { id: nextSoundId++, kind: 'dialogue', speakerEntityId: null, text: '你好', delivery: '', startOffsetSeconds: null, durationSeconds: null, isEnabled: true, ...overrides };
}

/** 宿主返回的分镜脚本阶段视图：作品里有两个角色、两个场景、一个道具和一个特效。 */
export function makeView(shots, overrides = {}) {
  const list = shots ?? [makeShot(1), makeShot(2), makeShot(3)];
  return {
    work: { id: 1, projectId: 1, name: '作品甲', kind: 'short_drama', kindLabel: '多集短片', sourceType: 'text' },
    episode: { id: 7, seq: 1, title: '第一集' },
    versions: [{ id: 1, version: 1, display: 'pending', isCurrent: true }],
    run: { id: 1, display: 'pending', createdAt: new Date().toISOString(), hasRawOutput: false, modelInfo: '', progress: null },
    params: null,
    aspectRatio: '16:9',
    shots: list,
    groups: [{ id: 1, seq: 1, shotIds: list.map((shot) => shot.id), totalSeconds: list.reduce((sum, shot) => sum + shot.durationSeconds, 0) }],
    cutNotices: [],
    groupMaxSeconds: 15,
    totalSeconds: list.reduce((sum, shot) => sum + shot.durationSeconds, 0),
    entities: [
      { id: IDS.hedgehog, kind: 'character', kindLabel: '角色', name: '刺猬', isActive: true, hasVoice: false },
      { id: IDS.bat, kind: 'character', kindLabel: '角色', name: '蝙蝠', isActive: true, hasVoice: false },
      { id: IDS.cave, kind: 'scene', kindLabel: '场景', name: '岩石洞穴', isActive: true, hasVoice: false },
      { id: IDS.forest, kind: 'scene', kindLabel: '场景', name: '森林', isActive: true, hasVoice: false },
      { id: IDS.table, kind: 'prop', kindLabel: '道具', name: '桌子', isActive: true, hasVoice: false },
      { id: IDS.spark, kind: 'effect', kindLabel: '特效', name: '火花', isActive: true, hasVoice: false }
    ],
    firstFrameAssets: [],
    limits: { maxSoundsPerShot: 20, firstFrameImageMaxBytes: 10 * 1024 * 1024 },
    stagingOptions: { x: [], depth: [], facing: [] },
    soundKinds: [],
    stale: false,
    actions: { canEdit: true, canApprove: true, canCancel: false, canRetry: false, editNeedsConfirm: false },
    ...overrides
  };
}
