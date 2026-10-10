// ------------------------------------------------------------------------
// 名称：staging-rules.ts
// 说明：镜头站位与调度的规则：读取并校验站位字段（模型输出与界面提交共用）、把站位写成视频提示词里的文字。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：纯函数，不依赖具体模型；位置、朝向都以观众看到的画面为准（画面左侧是观众的左边）；不填的位置、朝向视为 null，全空且没有动作的条目视为没有填写。
// ------------------------------------------------------------------------

import {
  STAGE_DEPTH_LABELS,
  STAGE_FACING_LABELS,
  STAGE_X_LABELS,
  ShotStaging,
  StageDepth,
  StageFacing,
  StageX
} from '../models/storyboard';
import { isBlank } from './field-readers';

/** 站位动作文字的最大长度。 */
export const STAGING_ACTION_MAX_LENGTH = 100;
/** 一个镜头最多的站位条目数。 */
export const MAX_STAGING_PER_SHOT = 50;

/** 站位横向位置的全部取值。 */
const STAGE_X_VALUES = Object.keys(STAGE_X_LABELS) as StageX[];
/** 站位纵深的全部取值。 */
const STAGE_DEPTH_VALUES = Object.keys(STAGE_DEPTH_LABELS) as StageDepth[];
/** 站位朝向的全部取值。 */
const STAGE_FACING_VALUES = Object.keys(STAGE_FACING_LABELS) as StageFacing[];

/** 站位字段：不含实体标识。 */
export type StagingFields = Omit<ShotStaging, 'entityId'>;

/** 读取一个枚举字段：空值为 null，不在取值范围内记录问题并返回 null。 */
function readChoice<T extends string>(record: Record<string, unknown>, key: string, values: readonly T[], label: string, issues: string[]): T | null {
  const raw = record[key];
  if (isBlank(raw)) {
    return null;
  }
  if (typeof raw !== 'string' || !values.includes(raw as T)) {
    issues.push(`${label}的 ${key} 必须是以下之一：${values.join('、')}。`);
    return null;
  }
  return raw as T;
}

/**
 * 读取一条站位的字段；全空且没有动作时返回 null，表示这个实体没有填写站位。
 * @param record 模型输出或界面提交的一条站位。
 * @param label 出现在提示里的前缀，如“第 2 个镜头的守夜人站位”。
 * @param issues 收集问题。
 */
export function readStagingFields(record: Record<string, unknown>, label: string, issues: string[]): StagingFields | null {
  const rawAction = record.action;
  const action = typeof rawAction === 'string' ? rawAction.trim() : '';
  if (action.length > STAGING_ACTION_MAX_LENGTH) {
    issues.push(`${label}的 action 不能超过 ${STAGING_ACTION_MAX_LENGTH} 字。`);
  }
  const fields: StagingFields = {
    startX: readChoice(record, 'startX', STAGE_X_VALUES, label, issues),
    startDepth: readChoice(record, 'startDepth', STAGE_DEPTH_VALUES, label, issues),
    endX: readChoice(record, 'endX', STAGE_X_VALUES, label, issues),
    endDepth: readChoice(record, 'endDepth', STAGE_DEPTH_VALUES, label, issues),
    facing: readChoice(record, 'facing', STAGE_FACING_VALUES, label, issues),
    action
  };
  const isEmpty = fields.startX === null && fields.startDepth === null && fields.endX === null && fields.endDepth === null && fields.facing === null && action === '';
  return isEmpty ? null : fields;
}

/** 位置文字：横向加纵深，如“画面左侧前景”；两项都空返回空串。 */
function describePoint(x: StageX | null, depth: StageDepth | null): string {
  return `${x === null ? '' : STAGE_X_LABELS[x]}${depth === null ? '' : STAGE_DEPTH_LABELS[depth]}`;
}

/** 在画面外的位置。 */
function isOffscreen(x: StageX | null): boolean {
  return x === 'off_left' || x === 'off_right';
}

/** 一个实体的站位文字，如“守夜人位于画面左侧前景，面朝画面右侧，移动到画面中央中景，端起油灯”。 */
function describeOne(name: string, staging: ShotStaging): string {
  const parts: string[] = [];
  const start = describePoint(staging.startX, staging.startDepth);
  if (start !== '') {
    parts.push(isOffscreen(staging.startX) ? `从${start}进入画面` : `位于${start}`);
  }
  if (staging.facing !== null) {
    parts.push(STAGE_FACING_LABELS[staging.facing]);
  }
  const end = describePoint(staging.endX, staging.endDepth);
  if (end !== '') {
    parts.push(isOffscreen(staging.endX) ? `向${end}离开画面` : `移动到${end}`);
  }
  if (staging.action !== '') {
    parts.push(staging.action);
  }
  return `${name}${parts.join('，')}`;
}

/**
 * 把镜头的站位写成视频提示词里的一句话：“站位（以观众看到的画面为准）：A；B。”
 * @param staging 镜头的站位条目。
 * @param names 实体标识到名称的映射；找不到名称的条目跳过。
 * @returns 没有可写的内容时返回空串。
 */
export function describeStaging(staging: readonly ShotStaging[], names: ReadonlyMap<number, string>): string {
  const items = staging.flatMap((item) => {
    const name = names.get(item.entityId);
    return name === undefined ? [] : [describeOne(name, item)];
  });
  return items.length === 0 ? '' : `站位（以观众看到的画面为准）：${items.join('；')}。`;
}
