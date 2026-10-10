// ------------------------------------------------------------------------
// 名称：storyboard-shot-fields.ts
// 说明：分镜脚本里镜头与声音字段的共用部分：长度与数量限制、秒数与文本字段的读取、声音条目内容的读取、站位条目的汇总。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：模型输出解析（storyboard-output-rules）与用户编辑规范化（storyboard-edit-rules）共用；两边的错误提示由调用方传入的字段名与标签决定，措辞各自保持不变。
// ------------------------------------------------------------------------

import { SOUND_KIND_LABELS, ShotStaging, SoundDraft, SoundKind, StoryboardEntity } from '../models/storyboard';
import { isRecord, textOf } from './field-readers';
import { readStagingFields } from './staging-rules';

/** 单镜头时长的取值范围（秒）。 */
export const SHOT_SECONDS_MIN = 0.1;
/** 单个镜头时长的上限，单位为秒。 */
export const SHOT_SECONDS_MAX = 600;

/** 镜头场次、景别、机位、运镜、转场等标签字段的长度上限。 */
export const SHOT_LABEL_MAX_LENGTH = 100;
/** 镜头连续性备注的长度上限。 */
export const SHOT_NOTE_MAX_LENGTH = 500;
/** 镜头画面描述（提示词）的长度上限。 */
export const SHOT_PROMPT_MAX_LENGTH = 2000;
/** 声音条目文字的长度上限。 */
export const SOUND_TEXT_MAX_LENGTH = 500;
/** 声音条目语气描述的长度上限。 */
export const SOUND_DELIVERY_MAX_LENGTH = 200;
/** 一个镜头最多的声音条目数。 */
export const MAX_SOUNDS_PER_SHOT = 20;

/** 全部声音类型，顺序同声音类型的定义。 */
export const SOUND_KINDS = Object.keys(SOUND_KIND_LABELS) as SoundKind[];

/** 声音条目内容里在提示中使用的字段名。 */
export interface SoundFieldNames {
  readonly text: string;
  readonly delivery: string;
  readonly startOffset: string;
  readonly duration: string;
}

/** 读取一个文本字段并校验长度，必填时不能为空；name 是提示中使用的字段名，默认用键。 */
export function readShotText(
  record: Record<string, unknown>,
  key: string,
  label: string,
  max: number,
  required: boolean,
  issues: string[],
  name: string = key
): string {
  const value = textOf(record, key);
  if (required && value.length === 0) {
    issues.push(`${label}的 ${name} 不能为空。`);
  } else if (value.length > max) {
    issues.push(`${label}的 ${name} 不能超过 ${max} 字。`);
  }
  return value;
}

/**
 * 读取可选的秒数（数字，或界面提交的数字文本，空文本视为未填）；不是数字或超出范围时记录问题。
 * @param raw 提交的秒数，可以是数字或数字文本。
 * @param field 字段名，用于问题提示。
 * @param label 镜头的名称，用于问题提示。
 * @param positive 为 true 时秒数必须大于 0。
 * @param issues 收集问题的数组，发现问题时追加。
 */
export function readSeconds(raw: unknown, field: string, label: string, positive: boolean, issues: string[]): number | null {
  const value = typeof raw === 'string' ? (raw.trim() === '' ? null : /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : raw) : raw;
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (positive && value <= 0) || value > SHOT_SECONDS_MAX) {
    issues.push(`${label}的 ${field} 必须是${positive ? '大于 0' : '不小于 0'}且不超过 ${SHOT_SECONDS_MAX} 的数字。`);
    return null;
  }
  return value;
}

/** 读取一条声音的台词或描述、说话方式、开始时间与持续时长，问题按这个顺序记录。 */
export function readSoundContent(
  record: Record<string, unknown>,
  label: string,
  names: SoundFieldNames,
  issues: string[]
): Pick<SoundDraft, 'text' | 'delivery' | 'startOffsetSeconds' | 'durationSeconds'> {
  const text = readShotText(record, 'text', label, SOUND_TEXT_MAX_LENGTH, true, issues, names.text);
  const delivery = readShotText(record, 'delivery', label, SOUND_DELIVERY_MAX_LENGTH, false, issues, names.delivery);
  const startOffsetSeconds = readSeconds(record.startOffsetSeconds, names.startOffset, label, false, issues);
  const durationSeconds = readSeconds(record.durationSeconds, names.duration, label, true, issues);
  return { text, delivery, startOffsetSeconds, durationSeconds };
}

/**
 * 汇总一个镜头的站位条目：场景不需要站位，有站位的实体自动加入出场实体，同一实体重复时后面的覆盖前面的。
 * @param items 站位条目。
 * @param resolveEntity 把一条站位对应到实体；对应不上时自行记录问题并返回 undefined。
 * @param labelOf 站位字段问题的前缀，如“守夜人的站位”。
 * @param entityIds 出场实体，有站位的实体会加入其中。
 */
export function collectStaging(
  items: readonly unknown[],
  resolveEntity: (item: unknown, index: number) => StoryboardEntity | undefined,
  labelOf: (entity: StoryboardEntity) => string,
  entityIds: Set<number>,
  issues: string[]
): ShotStaging[] {
  const byEntity = new Map<number, ShotStaging>();
  items.forEach((item, index) => {
    const entity = resolveEntity(item, index);
    if (entity === undefined || entity.kind === 'scene') {
      return;
    }
    const fields = readStagingFields(isRecord(item) ? item : {}, labelOf(entity), issues);
    if (fields !== null) {
      entityIds.add(entity.id);
      byEntity.set(entity.id, { entityId: entity.id, ...fields });
    }
  });
  return [...byEntity.values()];
}
