// ------------------------------------------------------------------------
// 名称：storyboard-output-rules.ts
// 说明：分镜脚本模型输出的解析与校验：镜头、站位、声音、首帧来源，实体按（类型，名称或别名）映射为标识，并检查镜头数与总时长上限。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：输出校验失败抛出 GeneratedOutputError，由阶段记录为失败并保留原始输出；镜头与声音字段的共用读取在 storyboard-shot-fields。
// ------------------------------------------------------------------------

import { GeneratedOutputError } from '../errors';
import { ENTITY_KIND_LABELS, EntityKind } from '../models/screenplay';
import { FirstFrameMode, ShotDraft, ShotStaging, SoundDraft, SoundKind, StoryboardEntity, StoryboardParams } from '../models/storyboard';
import { isRecord, textOf } from './field-readers';
import { groupMaxSecondsOf } from './shot-group-rules';
import { MAX_STAGING_PER_SHOT } from './staging-rules';
import { MAX_SHOTS_LIMIT } from './storyboard-params-rules';
import {
  MAX_SOUNDS_PER_SHOT,
  SHOT_LABEL_MAX_LENGTH,
  SHOT_NOTE_MAX_LENGTH,
  SHOT_PROMPT_MAX_LENGTH,
  SHOT_SECONDS_MAX,
  SHOT_SECONDS_MIN,
  collectStaging,
  readShotText,
  readSoundContent
} from './storyboard-shot-fields';

const ENTITY_KINDS = Object.keys(ENTITY_KIND_LABELS) as EntityKind[];

/** 生成分镜脚本时需要的信息：生成参数、可引用的实体。 */
export interface StoryboardContext {
  readonly params: StoryboardParams;
  readonly entities: readonly StoryboardEntity[];
  /** 本集全部镜头的总时长上限（秒），来自本集目标时长；不填表示不限制。 */
  readonly maxTotalSeconds?: number | null;
  /** 第一个镜头的序号，缺省为 1；按场次分批生成时，后面的批次接着前面批次的序号。 */
  readonly firstSeq?: number;
}

/** 在可引用的实体中按（类型，名称或别名）精确查找；名称优先于别名。 */
function resolveEntity(entities: readonly StoryboardEntity[], kind: EntityKind, name: string): StoryboardEntity | undefined {
  return (
    entities.find((entity) => entity.kind === kind && entity.name === name) ??
    entities.find((entity) => entity.kind === kind && entity.aliases.includes(name))
  );
}

/** 解析一个实体引用：{ kind, name }；field 是引用所在的字段名，用于提示。 */
function parseEntityRef(
  item: unknown,
  entities: readonly StoryboardEntity[],
  label: string,
  issues: string[],
  field = 'entities'
): StoryboardEntity | undefined {
  const record = isRecord(item) ? item : {};
  const kind = record.kind;
  const name = textOf(record, 'name');
  if (typeof kind !== 'string' || !ENTITY_KINDS.includes(kind as EntityKind) || name.length === 0) {
    issues.push(`${label}的 ${field} 每项必须包含 kind（${ENTITY_KINDS.join('、')}）和 name。`);
    return undefined;
  }
  const entity = resolveEntity(entities, kind as EntityKind, name);
  if (entity === undefined) {
    issues.push(`${label}引用了不存在的${ENTITY_KIND_LABELS[kind as EntityKind]}“${name}”，只能引用剧本中已有的实体。`);
  }
  return entity;
}

/** 解析一个镜头的站位条目：实体按（类型，名称）映射，场景不需要站位；有站位的实体自动加入出场实体，同一实体重复时后面的覆盖前面的。 */
function parseStaging(
  value: unknown,
  entities: readonly StoryboardEntity[],
  label: string,
  entityIds: Set<number>,
  issues: string[]
): ShotStaging[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push(`${label}的 staging 必须是数组。`);
    return [];
  }
  if (value.length > MAX_STAGING_PER_SHOT) {
    issues.push(`${label}的站位条目不能超过 ${MAX_STAGING_PER_SHOT} 条。`);
    return [];
  }
  return collectStaging(
    value,
    (item) => parseEntityRef(item, entities, label, issues, 'staging'),
    (entity) => `${label}的${entity.name}站位`,
    entityIds,
    issues
  );
}

/** 解析一个镜头的声音条目；声音模式为无声时忽略。 */
function parseSounds(
  value: unknown,
  context: StoryboardContext,
  label: string,
  entityIds: Set<number>,
  issues: string[]
): SoundDraft[] {
  const { params, entities } = context;
  if (params.audioMode === 'none' || value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push(`${label}的 sounds 必须是数组。`);
    return [];
  }
  if (value.length > MAX_SOUNDS_PER_SHOT) {
    issues.push(`${label}的声音条目不能超过 ${MAX_SOUNDS_PER_SHOT} 条。`);
    return [];
  }
  const sounds: SoundDraft[] = [];
  value.forEach((item, index) => {
    const soundLabel = `${label}的第 ${index + 1} 条声音`;
    const record = isRecord(item) ? item : {};
    const kind = record.kind;
    if (typeof kind !== 'string' || !params.audioElements.includes(kind as SoundKind)) {
      issues.push(`${soundLabel}的 kind 必须是以下之一：${params.audioElements.join('、')}。`);
      return;
    }
    let speakerEntityId: number | null = null;
    if (kind === 'dialogue') {
      const speaker = textOf(record, 'speaker');
      const entity = speaker.length === 0 ? undefined : resolveEntity(entities, 'character', speaker);
      if (entity === undefined) {
        issues.push(`${soundLabel}的 speaker 必须是剧本中已有的角色名称。`);
        return;
      }
      speakerEntityId = entity.id;
      entityIds.add(entity.id);
    }
    const content = readSoundContent(
      record,
      soundLabel,
      { text: 'text', delivery: 'delivery', startOffset: 'startOffsetSeconds', duration: 'durationSeconds' },
      issues
    );
    sounds.push({ kind: kind as SoundKind, speakerEntityId, ...content, isEnabled: true });
  });
  return sounds;
}

/** 解析镜头的首帧来源：按连贯策略决定，由 AI 判断时读取模型给出的值。 */
function parseFirstFrame(record: Record<string, unknown>, seq: number, params: StoryboardParams, label: string, issues: string[]): FirstFrameMode {
  if (params.continuity === 'none' || params.continuity === 'cut' || seq === 1) {
    if (seq === 1 && params.continuity === 'ai' && record.firstFrameMode === 'prev_tail') {
      issues.push(`${label}是第 1 个镜头，没有上一镜头，firstFrameMode 不能是 prev_tail。`);
    }
    return 'none';
  }
  if (params.continuity === 'prev_tail') {
    return 'prev_tail';
  }
  const mode = record.firstFrameMode;
  if (mode === undefined || mode === null || mode === 'none') {
    return 'none';
  }
  if (mode !== 'prev_tail') {
    issues.push(`${label}的 firstFrameMode 必须是 none 或 prev_tail。`);
  }
  return 'prev_tail';
}

/** 解析并校验一个镜头；序号由顺序决定。 */
function parseShot(item: unknown, index: number, context: StoryboardContext, issues: string[]): ShotDraft {
  const { params, entities } = context;
  const seq = (context.firstSeq ?? 1) + index;
  const label = `第 ${seq} 个镜头`;
  const record = isRecord(item) ? item : {};

  const sceneLabel = readShotText(record, 'sceneLabel', label, SHOT_LABEL_MAX_LENGTH, false, issues);
  const shotSize = readShotText(record, 'shotSize', label, SHOT_LABEL_MAX_LENGTH, false, issues);
  const cameraAngle = readShotText(record, 'cameraAngle', label, SHOT_LABEL_MAX_LENGTH, false, issues);
  const cameraMovement = readShotText(record, 'cameraMovement', label, SHOT_LABEL_MAX_LENGTH, false, issues);
  const transition = readShotText(record, 'transition', label, SHOT_LABEL_MAX_LENGTH, false, issues);
  const continuityNote = readShotText(record, 'continuityNote', label, SHOT_NOTE_MAX_LENGTH, false, issues);
  const prompt = readShotText(record, 'prompt', label, SHOT_PROMPT_MAX_LENGTH, true, issues);

  const minSeconds = params.minShotSeconds ?? SHOT_SECONDS_MIN;
  const maxSeconds = Math.min(params.maxShotSeconds ?? SHOT_SECONDS_MAX, groupMaxSecondsOf(params));
  const rawDuration = record.durationSeconds;
  let durationSeconds = minSeconds;
  if (typeof rawDuration !== 'number' || !Number.isFinite(rawDuration) || rawDuration < minSeconds || rawDuration > maxSeconds) {
    issues.push(`${label}的 durationSeconds 必须是 ${minSeconds} 到 ${maxSeconds} 之间的数字。`);
  } else {
    durationSeconds = rawDuration;
  }

  const entityIds = new Set<number>();
  const rawEntities = record.entities;
  if (rawEntities !== undefined && rawEntities !== null) {
    if (!Array.isArray(rawEntities)) {
      issues.push(`${label}的 entities 必须是数组。`);
    } else {
      for (const ref of rawEntities) {
        const entity = parseEntityRef(ref, entities, label, issues);
        if (entity !== undefined) {
          entityIds.add(entity.id);
        }
      }
    }
  }
  const staging = parseStaging(record.staging, entities, label, entityIds, issues);
  const sounds = parseSounds(record.sounds, context, label, entityIds, issues);

  return {
    seq,
    sceneLabel,
    shotSize,
    cameraAngle,
    cameraMovement,
    durationSeconds,
    transition,
    continuityNote,
    firstFrameMode: parseFirstFrame(record, seq, params, label, issues),
    firstFrameAssetId: null,
    entityIds: [...entityIds],
    staging,
    sounds,
    prompt
  };
}

/**
 * 校验并整理模型生成的一集分镜脚本。
 * @param raw 模型提交的 { shots }。
 * @param context 生成参数与可引用的实体；镜头引用的实体按（类型，名称或别名）映射为实体标识。镜头数上限与总时长上限按本次调用（一批）计算。
 * @throws GeneratedOutputError 格式不对、镜头数超限、时长越界或引用了不存在的实体。
 */
export function parseStoryboard(raw: unknown, context: StoryboardContext): ShotDraft[] {
  if (!isRecord(raw) || !Array.isArray(raw.shots)) {
    throw new GeneratedOutputError(['结果必须是包含 shots 数组的对象。']);
  }
  const issues: string[] = [];
  const limit = context.params.maxShots ?? MAX_SHOTS_LIMIT;
  if (raw.shots.length === 0) {
    issues.push('shots 至少需要 1 个镜头。');
  } else if (raw.shots.length > limit) {
    issues.push(`shots 有 ${raw.shots.length} 个，超过上限 ${limit} 个，请合并或精简镜头。`);
  }
  const shots = raw.shots.slice(0, limit).map((item, index) => parseShot(item, index, context, issues));
  const maxTotal = context.maxTotalSeconds ?? null;
  if (maxTotal !== null && issues.length === 0) {
    // 保留一位小数，避免浮点累加误差误判。
    const total = Math.round(shots.reduce((sum, shot) => sum + shot.durationSeconds, 0) * 10) / 10;
    if (total > maxTotal) {
      issues.push(`所有镜头总时长 ${total} 秒，超过本集目标时长 ${maxTotal} 秒，请减少镜头或缩短镜头时长。`);
    }
  }
  if (issues.length > 0) {
    throw new GeneratedOutputError(issues);
  }
  return shots;
}
