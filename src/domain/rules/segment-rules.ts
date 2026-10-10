// ------------------------------------------------------------------------
// 名称：segment-rules.ts
// 说明：集正文结构标注的规则：校验模型按序号返回的片段标注，并把用户在界面上修改的标注合并到已有片段。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：片段原文始终来自程序切分，标注只引用序号；说话人必须是已知角色（名称或别名），对不上时标为说话人未知并提示核对，不让模型凭空创造人名。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, GeneratedOutputError, ValidationError } from '../errors';
import { SEGMENT_KIND_LABELS, SegmentKind, TextSegment } from '../models/screenplay';
import { isRecord, readRecord } from './field-readers';

/** 说话人名称的长度上限，与实体名称一致。 */
export const SPEAKER_NAME_MAX_LENGTH = 50;

/** 一次返回的问题说明最多列出的条数，避免标注全错时反馈过长。 */
const MAX_REPORTED_ISSUES = 10;

/** 原文分段类型的全部取值，用于校验。 */
const SEGMENT_KINDS = Object.keys(SEGMENT_KIND_LABELS) as SegmentKind[];

/** 已知的角色：名称与别名，用于核对说话人。 */
export interface KnownCharacter {
  readonly name: string;
  readonly aliases: readonly string[];
}

/** 把说话人名称对到已知角色的正式名称；对不上返回 null。 */
function resolveSpeaker(value: unknown, characters: readonly KnownCharacter[]): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const spoken = value.trim();
  const found = characters.find((character) => character.name === spoken || character.aliases.includes(spoken));
  return found === undefined ? null : found.name;
}

/**
 * 校验并整理模型对一批片段的标注，结果的文字取自 pieces。
 * @param raw 模型提交的 { labels: [{ index, kind, speaker?, uncertain? }] }，index 从 1 开始，必须与片段一一对应。
 * @param pieces 这一批片段的原文。
 * @param characters 已知角色。
 * @throws GeneratedOutputError 格式不对、数量或序号不一致、类型不合法。
 */
export function parseSegmentLabels(raw: unknown, pieces: readonly string[], characters: readonly KnownCharacter[]): TextSegment[] {
  const labels = isRecord(raw) ? raw.labels : undefined;
  if (!Array.isArray(labels)) {
    throw new GeneratedOutputError(['结果必须是包含 labels 数组的对象。']);
  }
  const issues: string[] = [];
  if (labels.length !== pieces.length) {
    issues.push(`labels 有 ${labels.length} 项，必须与片段数量 ${pieces.length} 一致，每个片段一项、按序号排列。`);
  }

  const segments = pieces.map((text, position): TextSegment => {
    const label = isRecord(labels[position]) ? labels[position] : {};
    const number = position + 1;
    if (label.index !== number) {
      issues.push(`第 ${number} 项的 index 必须是 ${number}。`);
    }
    const kind = label.kind;
    if (typeof kind !== 'string' || !SEGMENT_KINDS.includes(kind as SegmentKind)) {
      issues.push(`第 ${number} 项的 kind 必须是 ${SEGMENT_KINDS.join('、')} 之一。`);
      return { text, kind: 'narration', speaker: null, uncertain: true };
    }
    if (kind === 'narration') {
      return { text, kind, speaker: null, uncertain: label.uncertain === true };
    }
    const speaker = resolveSpeaker(label.speaker, characters);
    return { text, kind: kind as SegmentKind, speaker, uncertain: label.uncertain === true || speaker === null };
  });

  if (issues.length > 0) {
    const reported = issues.slice(0, MAX_REPORTED_ISSUES);
    throw new GeneratedOutputError(issues.length > reported.length ? [...reported, `另有 ${issues.length - reported.length} 项问题。`] : reported);
  }
  return segments;
}

/**
 * 把界面提交的标注修改合并到已有片段：片段原文不变；类型或说话人被改动的片段不再标记待核对。
 * @param rawInput 界面提交的内容；segments 缺省表示没有修改标注。segments 为按片段顺序排列的 [{ kind, speaker }]。
 * @param current 已有的片段。
 * @returns 合并后的片段；没有提交标注修改时返回 null。
 * @throws ValidationError 数量与已有片段不一致，或类型、说话人不合法。
 */
export function applySegmentLabelEdits(rawInput: unknown, current: readonly TextSegment[]): TextSegment[] | null {
  const labels = readRecord(rawInput).segments;
  if (labels === undefined || labels === null) {
    return null;
  }
  if (!Array.isArray(labels) || labels.length !== current.length) {
    throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '结构标注与正文不一致，请刷新后重试。' });
  }
  return current.map((segment, position) => {
    const label = isRecord(labels[position]) ? labels[position] : {};
    const kind = label.kind;
    if (typeof kind !== 'string' || !SEGMENT_KINDS.includes(kind as SegmentKind)) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: `第 ${position + 1} 个片段的类型不合法。` });
    }
    const rawSpeaker = label.speaker;
    if (rawSpeaker !== undefined && rawSpeaker !== null && typeof rawSpeaker !== 'string') {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: `第 ${position + 1} 个片段的说话人必须是文本。` });
    }
    const spoken = typeof rawSpeaker === 'string' ? rawSpeaker.trim() : '';
    if (spoken.length > SPEAKER_NAME_MAX_LENGTH) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: `第 ${position + 1} 个片段的说话人不能超过 ${SPEAKER_NAME_MAX_LENGTH} 字。` });
    }
    const speaker = kind === 'narration' || spoken.length === 0 ? null : spoken;
    const changed = kind !== segment.kind || speaker !== segment.speaker;
    return { text: segment.text, kind: kind as SegmentKind, speaker, uncertain: changed ? false : segment.uncertain };
  });
}
