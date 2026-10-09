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

/** 加载时间线编译模块。 */
export function loadTimeline() {
  return loadScript('stage/stage-storyboard-preview-timeline.js').aiStoryboardTimeline;
}

/** 按依赖顺序加载绘制相关的全部脚本（时间线、插画、绘制、对照视图），返回各模块。 */
export function loadRenderStack() {
  const timelineWindow = loadScript('stage/stage-storyboard-preview-timeline.js');
  const artWindow = loadScript('stage/stage-storyboard-preview-art.js', timelineWindow);
  const propsWindow = loadScript('stage/stage-storyboard-preview-props.js', artWindow);
  const creaturesWindow = loadScript('stage/stage-storyboard-preview-creatures.js', propsWindow);
  const bestiaryWindow = loadScript('stage/stage-storyboard-preview-bestiary.js', creaturesWindow);
  const rendererWindow = loadScript('stage/stage-storyboard-preview-renderer.js', bestiaryWindow);
  const modesWindow = loadScript('stage/stage-storyboard-preview-modes.js', rendererWindow);
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
    stagingOptions: { x: [], depth: [], facing: [] },
    soundKinds: [],
    stale: false,
    actions: { canEdit: true, canApprove: true, canCancel: false, canRetry: false, editNeedsConfirm: false },
    ...overrides
  };
}
