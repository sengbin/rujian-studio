// ------------------------------------------------------------------------
// 名称：group-request-planner.ts
// 说明：把一个镜头组按千问官方提示词公式编译为任务请求快照：总体描述、风格、参考素材引用、分镜编号与时间、镜头语言、站位、台词与音效、无台词与无背景音乐、负向清单；同时决定首帧、参考图、音色参考、画幅与对齐后的时长，并收集提醒。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯函数，不依赖数据库和具体模型；素材只记录文件标识，内容由提交时读取；一个镜头组一次生成一个视频。
// ------------------------------------------------------------------------

import { GenerationParams, JobSnapshot } from '../models/generation';
import { DEFAULT_NEGATIVE_LIST } from '../models/generation-profile';
import { VIDEO_AUDIO_ELEMENTS, VIDEO_AUDIO_ELEMENT_LABELS, VideoAudioElement, VideoAudioMode, VideoCapability } from '../models/model-capability';
import { ENTITY_KIND_LABELS, EntityKind } from '../models/screenplay';
import { ShotRecord, SoundRecord } from '../models/storyboard';
import { FittedDuration, fitGroupDuration } from './group-duration-rules';
import { sumSeconds } from './shot-group-rules';
import { describeStaging } from './staging-rules';
import { VIDEO_PROMPT_FORMAT_VERSION, aspectDiffers, describeCamera, describeImageRatio, describeTransition, endSentence, normalizeNegativeItems } from './video-prompt-rules';

/** 参考图说明里各类实体的称呼：如“守夜人形象参考图1”“灯塔场景参考图2”。 */
const REFERENCE_KIND_WORDS: Readonly<Record<EntityKind, string>> = {
  character: '形象',
  scene: '场景',
  prop: '道具',
  effect: '特效'
};

/** 出场实体的绑定情况：形象参考图与音色参考音频的资产文件标识，没有绑定为 null。 */
export interface EntityReferences {
  readonly entityId: number;
  readonly name: string;
  readonly kind: EntityKind;
  readonly visualFileId: number | null;
  readonly voiceFileId: number | null;
}

/** 编译镜头组请求所需的输入。 */
export interface GroupPlanInput {
  /** 组内镜头，按序号排列。 */
  readonly shots: readonly ShotRecord[];
  readonly storyboardRunId: number;
  readonly providerCode: string;
  readonly modelCode: string;
  readonly capability: VideoCapability;
  readonly params: GenerationParams;
  /** 组内出场的实体（去重）及其绑定，顺序即参考图编号顺序。 */
  readonly entities: readonly EntityReferences[];
  /** 本次是否以上一组的尾帧作首帧；为 true 时不再传参考图和音色参考（首帧不能与参考素材同时使用）。 */
  readonly useFirstFrame?: boolean;
  /** 组内第一个镜头指定资产参考图作首帧时，已解析出的资产图片文件；没有指定或图片已不可用为 null。同样不再传参考图和音色参考，且不会与 useFirstFrame 同时出现。 */
  readonly firstFrameFileId?: number | null;
  /** 组内第一个镜头指定本地图片作首帧时，该镜头保存的首帧图片标识；没有指定或图片已不可用为 null。处理方式同 firstFrameFileId。 */
  readonly firstFrameImageId?: number | null;
  /** 指定的首帧图片的宽高（像素）；用于和作品画幅比较，不一致时提醒。未知时不传。 */
  readonly firstFrameSize?: { readonly width: number | null; readonly height: number | null } | null;
  /** 整体画面风格（分镜脚本的风格或项目风格），写在提示词开头；没有时为 null。 */
  readonly style?: string | null;
}

/** 首帧的规划结果：是否有首帧、首帧标识，以及传给模型的画幅（模型按首帧自适应画幅时为 null）。 */
interface FirstFramePlan {
  readonly present: boolean;
  readonly usesPreviousTail: boolean;
  readonly fileId: number | null;
  readonly imageId: number | null;
  readonly aspectRatio: string | null;
}

/** 参考图的规划结果：参考图文件、提示词里的参考说明，以及实体对应的图片编号。 */
interface ReferenceImagePlan {
  readonly fileIds: number[];
  readonly notes: string[];
  readonly indexByEntity: Map<number, number>;
}

/** 声音的规划结果：实际使用的声音内容、各镜头的声音句子、台词条数、音色参考文件与说明。 */
interface AudioPlan {
  readonly usedElements: VideoAudioElement[] | null;
  readonly soundsByShot: Map<number, string[]>;
  readonly spokenLineCount: number;
  readonly referenceFileIds: number[];
  readonly voiceNotes: string[];
}

/** 声音条目编译成一句提示词。 */
function describeSound(sound: SoundRecord, speakerName: string | undefined): string {
  const delivery = sound.delivery.trim();
  const nuance = delivery === '' ? '' : `（${delivery}）`;
  switch (sound.kind) {
    case 'dialogue':
      return `${speakerName ?? '角色'}${nuance}说：“${sound.text}”`;
    case 'narration':
      return `旁白${nuance}：“${sound.text}”`;
    case 'sfx':
      return `音效：${sound.text}${nuance}`;
    case 'music':
      return `背景音乐：${sound.text}${nuance}`;
  }
}

/** 把秒数写成“分:秒”（分、秒各两位），如 75 秒为 01:15；小数秒保留 1 位。 */
export function formatTimestamp(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  const minutes = Math.floor(rounded / 60);
  const rest = Math.round((rounded - minutes * 60) * 10) / 10;
  const text = Number.isInteger(rest) ? String(rest).padStart(2, '0') : rest.toFixed(1).padStart(4, '0');
  return `${String(minutes).padStart(2, '0')}:${text}`;
}

/** 对白说话人的称呼：说话人有参考图时写成“图N的名字”（官方写法），否则只写名字；不是对白或没有说话人返回 undefined。 */
function speakerLabel(sound: SoundRecord, names: ReadonlyMap<number, string>, imageIndexByEntity: ReadonlyMap<number, number>): string | undefined {
  if (sound.speakerEntityId === null) return undefined;
  const name = names.get(sound.speakerEntityId);
  if (name === undefined) return undefined;
  const index = imageIndexByEntity.get(sound.speakerEntityId);
  return index === undefined ? name : `图${index}的${name}`;
}

/** 第一步：决定首帧。首帧不能与参考图、音色参考同时使用；有首帧且模型按首帧自适应画幅时不再传作品画幅，指定的图片与作品画幅差得多时提醒。 */
function planFirstFrame(input: GroupPlanInput, warnings: string[]): FirstFramePlan {
  const { shots, capability, params } = input;
  const usesPreviousTail = input.useFirstFrame === true;
  const fileId = input.firstFrameFileId ?? null;
  const imageId = input.firstFrameImageId ?? null;
  const present = usesPreviousTail || fileId !== null || imageId !== null;

  const first = shots[0];
  if (first !== undefined && first.firstFrameMode === 'prev_tail' && !usesPreviousTail) {
    warnings.push('这一组设置了“上一镜头尾帧作首帧”，但没有上一组可用，本次不指定首帧。');
  } else if (first !== undefined && ((first.firstFrameMode === 'asset' && fileId === null) || (first.firstFrameMode === 'image' && imageId === null))) {
    warnings.push('这一组设置了“指定图片作首帧”，但指定的图片已不可用，本次不指定首帧。');
  }

  // 有首帧时，官方建议画幅用 adaptive（按首帧宽高比自动匹配），所以不再传作品画幅。
  const followsFirstFrame = present && capability.firstFrameDefinesAspect === true;
  const aspectRatio = followsFirstFrame ? null : params.aspectRatio;
  const frameSize = input.firstFrameSize ?? null;
  if (followsFirstFrame && !usesPreviousTail && frameSize !== null && frameSize.width !== null && frameSize.height !== null && aspectDiffers(frameSize.width, frameSize.height, params.aspectRatio)) {
    warnings.push(`指定的首帧图片比例约为 ${describeImageRatio(frameSize.width, frameSize.height)}，与作品画幅 ${params.aspectRatio} 不一致；视频会按首帧图片的比例生成，不使用作品画幅。`);
  }
  return { present, usesPreviousTail, fileId, imageId, aspectRatio };
}

/** 决定声音模式：本组指定的优先，否则模型支持原生声音就用原生，再否则无声，都不支持为 null。 */
function resolveAudioMode(params: GenerationParams, capability: VideoCapability): VideoAudioMode | null {
  return params.audioMode ?? (capability.audioModes.includes('native') ? 'native' : capability.audioModes.includes('none') ? 'none' : null);
}

/** 第二步：规划参考图。按出场实体顺序，每个实体取形象主资产的第一张图，数量受模型上限限制；有首帧时不传参考图。 */
function planReferenceImages(entities: readonly EntityReferences[], capability: VideoCapability, firstFrame: FirstFramePlan, warnings: string[]): ReferenceImagePlan {
  const plan: ReferenceImagePlan = { fileIds: [], notes: [], indexByEntity: new Map() };
  if (firstFrame.present) {
    if (entities.length > 0) {
      warnings.push(`这一组以${firstFrame.usesPreviousTail ? '上一组的尾帧' : '指定的图片'}作首帧，首帧不能与参考图、音色参考同时使用，本次不传参考素材（角色、场景的形象由${firstFrame.usesPreviousTail ? '尾帧' : '首帧图片'}延续）。`);
    }
    return plan;
  }
  for (const entity of entities) {
    if (entity.visualFileId === null) {
      warnings.push(`${ENTITY_KIND_LABELS[entity.kind]}“${entity.name}”还没有绑定资产，只能按文字描述生成。`);
    } else if (plan.fileIds.length >= capability.referenceImagesMax) {
      warnings.push(`模型最多支持 ${capability.referenceImagesMax} 张参考图，“${entity.name}”的参考图已忽略。`);
    } else {
      plan.fileIds.push(entity.visualFileId);
      plan.indexByEntity.set(entity.entityId, plan.fileIds.length);
      plan.notes.push(`${entity.name}${REFERENCE_KIND_WORDS[entity.kind]}参考图${plan.fileIds.length}`);
    }
  }
  return plan;
}

/** 把各镜头里选中且模型支持的声音条目编译成句子；选了但模型不支持的内容忽略并提醒。 */
function compileSoundLines(
  shots: readonly ShotRecord[],
  entities: readonly EntityReferences[],
  selected: readonly VideoAudioElement[],
  capability: VideoCapability,
  imageIndexByEntity: ReadonlyMap<number, number>,
  warnings: string[]
): { readonly soundsByShot: Map<number, string[]>; readonly spokenLineCount: number } {
  const names = new Map(entities.map((entity) => [entity.entityId, entity.name]));
  const soundsByShot = new Map<number, string[]>();
  const skipped = new Set<VideoAudioElement>();
  let spokenLineCount = 0;
  for (const shot of shots) {
    const lines: string[] = [];
    for (const sound of shot.sounds) {
      if (!sound.isEnabled || !selected.includes(sound.kind)) continue;
      if (!capability.audioElements.includes(sound.kind)) {
        skipped.add(sound.kind);
        continue;
      }
      if (sound.kind === 'dialogue' || sound.kind === 'narration') spokenLineCount += 1;
      lines.push(describeSound(sound, speakerLabel(sound, names, imageIndexByEntity)));
    }
    soundsByShot.set(shot.id, lines);
  }
  if (skipped.size > 0) {
    warnings.push(`模型不支持以下声音内容，已忽略：${VIDEO_AUDIO_ELEMENTS.filter((element) => skipped.has(element)).map((element) => VIDEO_AUDIO_ELEMENT_LABELS[element]).join('、')}。`);
  }
  return { soundsByShot, spokenLineCount };
}

/** 规划音色参考：只服务于对白，没有选对白时说话人不需要音色参考；绑定了音色却没有对白条目的角色提醒用户检查。 */
function planVoiceReferences(
  shots: readonly ShotRecord[],
  entities: readonly EntityReferences[],
  selected: readonly VideoAudioElement[],
  audioLimit: VideoCapability['audioInputMax'],
  warnings: string[]
): { readonly fileIds: number[]; readonly notes: string[] } {
  const fileIds: number[] = [];
  const notes: string[] = [];
  const speakerIds = new Set(
    shots.flatMap((shot) => shot.sounds.filter((sound) => sound.isEnabled && sound.kind === 'dialogue' && selected.includes('dialogue')).map((sound) => sound.speakerEntityId))
  );
  const silentVoiceNames: string[] = [];
  for (const entity of entities) {
    if (audioLimit === null || entity.voiceFileId === null) continue;
    if (!speakerIds.has(entity.entityId)) {
      if (selected.includes('dialogue')) silentVoiceNames.push(entity.name);
      continue;
    }
    if (fileIds.length >= audioLimit.count) continue;
    fileIds.push(entity.voiceFileId);
    notes.push(`${entity.name}音色参考音频${fileIds.length}`);
  }
  if (silentVoiceNames.length > 0) {
    warnings.push(`${silentVoiceNames.join('、')}已绑定音色，但本组没有对白条目，音色未使用。`);
  }
  return { fileIds, notes };
}

/** 第三步：规划声音。只有原生声音模式才编译声音提示词和音色参考；用户选的声音内容（缺省为全部）之外的条目不传；有首帧时不传音色参考。 */
function planAudio(
  input: GroupPlanInput,
  audioMode: VideoAudioMode | null,
  firstFrame: FirstFramePlan,
  imageIndexByEntity: ReadonlyMap<number, number>,
  warnings: string[]
): AudioPlan {
  const { shots, entities, params, capability } = input;
  if (audioMode !== 'native') {
    return { usedElements: null, soundsByShot: new Map(), spokenLineCount: 0, referenceFileIds: [], voiceNotes: [] };
  }
  const selected = params.audioElements ?? VIDEO_AUDIO_ELEMENTS;
  const usedElements = VIDEO_AUDIO_ELEMENTS.filter((element) => selected.includes(element) && capability.audioElements.includes(element));
  const lines = compileSoundLines(shots, entities, selected, capability, imageIndexByEntity, warnings);
  const voices = planVoiceReferences(shots, entities, selected, firstFrame.present ? null : capability.audioInputMax, warnings);
  return { usedElements, soundsByShot: lines.soundsByShot, spokenLineCount: lines.spokenLineCount, referenceFileIds: voices.fileIds, voiceNotes: voices.notes };
}

/** 第四步：决定时长。本组指定了生成时长就按指定值（校验由 validateGroupParams 负责，多出的时间并入最后一个镜头），否则按镜头总时长向上对齐到模型支持的取值。 */
function planDuration(shots: readonly ShotRecord[], capability: VideoCapability, params: GenerationParams, warnings: string[]): FittedDuration {
  const total = sumSeconds(shots);
  const duration: FittedDuration =
    params.durationSeconds === null ? fitGroupDuration(capability.duration, total) : { seconds: params.durationSeconds, adjusted: false, exceedsMax: false };
  if (duration.adjusted) {
    warnings.push(`这一组共 ${total} 秒，不在模型支持的取值内，已调整为 ${duration.seconds} 秒。`);
  }
  return duration;
}

/** 第五步：编译分镜。多镜头写成“分镜 N（起-止）：…”，最后一段补足到对齐后的总时长；单镜头不加编号和时间。 */
function compileSegments(
  shots: readonly ShotRecord[],
  entities: readonly EntityReferences[],
  soundsByShot: ReadonlyMap<number, string[]>,
  totalSeconds: number
): string[] {
  const isMulti = shots.length > 1;
  const entityNames = new Map(entities.map((entity) => [entity.entityId, entity.name]));
  let cursor = 0;
  return shots.map((shot, index) => {
    const start = cursor;
    cursor += shot.durationSeconds;
    const end = index === shots.length - 1 ? Math.max(cursor, totalSeconds) : cursor;
    const camera = endSentence(describeCamera(shot));
    const staging = describeStaging(shot.staging, entityNames);
    const sounds = (soundsByShot.get(shot.id) ?? []).map(endSentence).join('');
    // 最后一个镜头没有组内的下一镜头，它的转场属于组与组之间，不写。
    const transition = index < shots.length - 1 ? endSentence(describeTransition(shot.transition)) : '';
    const body = `${camera}${endSentence(shot.prompt.trim())}${staging}${sounds}${transition}`;
    return isMulti ? `分镜${index + 1}（${formatTimestamp(start)}-${formatTimestamp(end)}）：${body}` : body;
  });
}

/** 第六步：拼装提示词：总体描述、风格、参考说明、分镜、无台词与无背景音乐、负向清单。 */
function composePrompt(
  shotCount: number,
  segments: readonly string[],
  style: string,
  referenceNotes: readonly string[],
  audioMode: VideoAudioMode | null,
  audio: AudioPlan,
  negativeList: string | null
): { readonly prompt: string; readonly negativeItems: string[] } {
  const sections: string[] = [];
  sections.push(shotCount > 1 ? `共 ${shotCount} 个镜头，按时间顺序依次呈现，镜头之间自然衔接。` : '生成单镜头。');
  if (style !== '') sections.push(endSentence(`风格：${style}`));
  if (referenceNotes.length > 0) sections.push(`${referenceNotes.join('，')}。`);
  sections.push(...segments);
  // 官方：不写台词，模型会自己加台词；不写背景音乐，模型会自己发挥。用户没要的内容要明确写“无”。
  if (audioMode === 'native') {
    const absent: string[] = [];
    if (audio.spokenLineCount === 0) absent.push('无台词');
    if (audio.usedElements !== null && !audio.usedElements.includes('music')) absent.push('无背景音乐');
    if (absent.length > 0) sections.push(`${absent.join('，')}。`);
  }
  const negativeItems = normalizeNegativeItems(negativeList ?? DEFAULT_NEGATIVE_LIST, sections.join('\n'));
  if (negativeItems.length > 0) sections.push(`负向清单：${negativeItems.join('，')}。`);
  return { prompt: sections.join('\n'), negativeItems };
}

/**
 * 把一个镜头组编译为任务请求快照，写法依据千问AI平台官方提示词指南：
 * 提示词 = 总体描述（单镜头声明或镜头数）+ 风格 + 参考素材引用 + 分镜 N（起-止）：镜头语言与画面、台词、音效与背景音乐、转场 + 无台词、无背景音乐 + 负向清单。
 * 镜头的景别、机位与视角、摄影机运动由字段编译，所以镜头的提示词只需描述主体、场景与动作。
 * 上一组尾帧作首帧由调用方通过 useFirstFrame 告知（尾帧图片不进快照，由任务记录）；资产参考图作首帧由调用方解析出资产图片文件后通过 firstFrameFileId 告知、本地指定图片作首帧通过 firstFrameImageId 告知（标识进快照）；组内其他镜头的首帧设置在同一个视频内自然衔接，不需要处理。
 * 组总时长超过模型单次最长时长的情况由调用方先用 maxGroupSeconds 拒绝；这里对齐后的时长不会超过模型最长时长。本组指定了生成时长（params.durationSeconds）时直接采用，是否合法由调用方先用 validateGroupParams 检查。
 * @param input 镜头组、模型能力、生成参数与出场实体的绑定。
 */
export function planGroupRequest(input: GroupPlanInput): JobSnapshot {
  const { shots, capability, params, entities } = input;
  const warnings: string[] = [];

  const firstFrame = planFirstFrame(input, warnings);
  const audioMode = resolveAudioMode(params, capability);
  const images = planReferenceImages(entities, capability, firstFrame, warnings);
  const audio = planAudio(input, audioMode, firstFrame, images.indexByEntity, warnings);
  const duration = planDuration(shots, capability, params, warnings);
  const segments = compileSegments(shots, entities, audio.soundsByShot, duration.seconds);
  const { prompt, negativeItems } = composePrompt(shots.length, segments, input.style?.trim() ?? '', [...images.notes, ...audio.voiceNotes], audioMode, audio, params.negativeList);

  return {
    storyboardRunId: input.storyboardRunId,
    shotIds: shots.map((shot) => shot.id),
    providerCode: input.providerCode,
    modelCode: input.modelCode,
    prompt,
    promptFormat: VIDEO_PROMPT_FORMAT_VERSION,
    params: {
      aspectRatio: firstFrame.aspectRatio,
      resolution: params.resolution,
      durationSeconds: duration.seconds,
      audioMode,
      audioElements: audio.usedElements,
      seed: params.seed,
      negativeList: negativeItems.length > 0 ? negativeItems.join('，') : null,
      extraParams: params.promptExtend !== null && capability.promptExtend === true ? { promptExtend: params.promptExtend } : {}
    },
    referenceImageFileIds: images.fileIds,
    referenceAudioFileIds: audio.referenceFileIds,
    firstFrameFileId: firstFrame.fileId,
    firstFrameImageId: firstFrame.imageId,
    warnings
  };
}
