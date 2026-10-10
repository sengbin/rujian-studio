// ------------------------------------------------------------------------
// 名称：beat-sheet-rules.ts
// 说明：节拍表规则：按模板分配各节拍的参考时长与字数、推导分镜默认参数、校验生成参数、校验模型分配的节拍内容、用户编辑节拍内容的校验。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：设计见 private-docs/rujian-studio/开发文档/production-profile-design.md 第 5.3、11 节；预算由程序计算（不调用模型），模型只分配每个节拍的剧情内容；节拍数量与顺序必须与模板一致。
// ------------------------------------------------------------------------

import { GeneratedOutputError } from '../errors';
import { BeatAssignment, BeatDraft, BeatSheet, BeatSheetParams } from '../models/beat-sheet';
import { BeatTemplate, BeatTemplateItem, ProductionFormatType } from '../models/production-profile';
import { FieldErrors, assertNoFieldErrors, isRecord, readInteger, readOptionalDecimal, readOptionalText, readRecord, readText } from './field-readers';
import { findBeatTemplate, getProductionProfile, listBeatTemplates } from './production-profile-rules';

/** 单集目标时长（秒）的取值范围。 */
export const TARGET_DURATION_MIN_SECONDS = 5;
/** 目标时长的上限，单位为秒。 */
export const TARGET_DURATION_MAX_SECONDS = 1800;
/** 短剧集数参考值的最大值。 */
export const EPISODE_COUNT_MAX = 100;
/** 语速（字/秒）的取值范围，最多一位小数。 */
export const WORDS_PER_SECOND_MIN = 1;
/** 每秒字数（语速）的上限。 */
export const WORDS_PER_SECOND_MAX = 20;
/** 节拍表补充要求的长度上限。 */
export const BEAT_EXTRA_MAX_LENGTH = 2000;
/** 节拍表故事想法的长度上限。 */
export const BEAT_IDEA_MAX_LENGTH = 2000;
/** 单个节拍剧情概要的长度上限。 */
export const BEAT_SYNOPSIS_MAX_LENGTH = 1000;

/** 秒数分配的精度：按 0.1 秒为单位分配。 */
const SECOND_UNITS_PER_SECOND = 10;

/** 一个节拍的参考预算。 */
export interface BeatBudget {
  readonly seq: number;
  readonly estimatedSeconds: number;
  readonly estimatedWords: number;
}

/** 分镜阶段的默认参数参考值。 */
export interface ShotDefaults {
  readonly minShotSeconds: number;
  readonly maxShotSeconds: number;
  readonly maxShots: number;
}

/**
 * 最大余数法把总量按比例分到各项：先取整数部分，再把剩余的单位按小数部分从大到小逐个补上，总和精确等于总量。
 * @param total 要分配的总单位数（整数）。
 * @param ratios 各项的比例。
 */
function distribute(total: number, ratios: readonly number[]): number[] {
  const exact = ratios.map((ratio) => total * ratio);
  const shares = exact.map((value) => Math.floor(value + 1e-9));
  let remaining = total - shares.reduce((sum, share) => sum + share, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - shares[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const { index } of order) {
    if (remaining <= 0) {
      break;
    }
    shares[index] += 1;
    remaining -= 1;
  }
  return shares;
}

/**
 * 按模板比例分配各节拍的参考时长与字数，四舍五入后总和精确等于目标，不产生累计误差。
 * @param totalSeconds 目标总时长（秒）。
 * @param wordsPerSecond 语速（字/秒）。
 * @param items 模板中的节拍。
 * @returns 各节拍的参考时长（保留一位小数）与参考字数（整数）。
 */
export function allocateBeatBudget(totalSeconds: number, wordsPerSecond: number, items: readonly BeatTemplateItem[]): BeatBudget[] {
  const ratios = items.map((item) => item.targetRatio);
  const seconds = distribute(Math.round(totalSeconds * SECOND_UNITS_PER_SECOND), ratios);
  const words = distribute(Math.round(totalSeconds * wordsPerSecond), ratios);
  return items.map((item, index) => ({
    seq: item.seq,
    estimatedSeconds: seconds[index] / SECOND_UNITS_PER_SECOND,
    estimatedWords: words[index]
  }));
}

/**
 * 由目标时长和建议单镜头时长，推导分镜阶段的默认参数参考值。
 * @param targetDurationSeconds 目标时长（秒）。
 * @param avgShotSeconds 建议单镜头时长（秒）。
 */
export function estimateShotDefaults(targetDurationSeconds: number, avgShotSeconds: number): ShotDefaults {
  return {
    minShotSeconds: Math.max(2, avgShotSeconds - 2),
    maxShotSeconds: avgShotSeconds + 1,
    maxShots: Math.max(1, Math.round(targetDurationSeconds / avgShotSeconds))
  };
}

/** 读取节拍模板：接受模板标识或界面名称，缺省取体量的默认模板。 */
function readTemplate(source: Record<string, unknown>, formatType: ProductionFormatType, errors: FieldErrors): BeatTemplate | undefined {
  const profile = getProductionProfile(formatType);
  const raw = source.beatTemplateId;
  const value = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : profile.beatTemplateId;
  if (value === null) {
    errors.beatTemplateId = `${profile.label}暂不支持生成节拍表。`;
    return undefined;
  }
  const template = findBeatTemplate(value) ?? listBeatTemplates(formatType).find((candidate) => candidate.label === value);
  if (template === undefined || template.formatType !== formatType) {
    errors.beatTemplateId = '节拍模板与作品形态不匹配。';
    return undefined;
  }
  return template;
}

/**
 * 校验并规范化节拍表的生成参数；语速缺省取制作方案的默认值，校准容差与最大重写轮数取制作方案默认值。
 * @param rawInput 界面提交的原始内容，数字字段可以是数字或文本。
 * @param formatType 作品的体量；短视频的集数固定为 1。
 * @throws ValidationError 存在不合法的字段。
 */
export function normalizeBeatSheetParams(rawInput: unknown, formatType: ProductionFormatType): BeatSheetParams {
  const source = readRecord(rawInput);
  const errors: FieldErrors = {};
  const profile = getProductionProfile(formatType);

  const template = readTemplate(source, formatType, errors);
  const targetDurationSeconds = readInteger(
    source,
    { key: 'targetDurationSeconds', label: '目标时长', required: true, min: TARGET_DURATION_MIN_SECONDS, max: TARGET_DURATION_MAX_SECONDS },
    errors
  );
  const episodeCount = !profile.multiEpisode
    ? 1
    : readInteger(source, { key: 'episodeCount', label: '集数', required: true, min: 1, max: EPISODE_COUNT_MAX }, errors);
  const wordsPerSecond =
    readOptionalDecimal(
      source,
      { key: 'wordsPerSecond', label: '语速', min: WORDS_PER_SECOND_MIN, max: WORDS_PER_SECOND_MAX, maxDecimals: 1 },
      errors
    ) ?? profile.wordsPerSecond;
  const idea = readOptionalText(source, { key: 'idea', label: '创作主题或灵感', required: false, maxLength: BEAT_IDEA_MAX_LENGTH }, errors);
  const extra = readOptionalText(source, { key: 'extra', label: '补充要求', required: false, maxLength: BEAT_EXTRA_MAX_LENGTH }, errors);
  assertNoFieldErrors(errors);

  return {
    formatType,
    beatTemplateId: (template as BeatTemplate).id,
    targetDurationSeconds,
    episodeCount,
    wordsPerSecond,
    toleranceRatio: profile.toleranceRatio,
    maxCalibrationRounds: profile.maxCalibrationRounds,
    idea,
    extra
  };
}

/**
 * 校验并整理模型返回的节拍内容：节拍数量与顺序必须与模板一致，不允许增减或合并。
 * @param raw 解析后的 JSON，形如 { "beats": [{ "seq": 1, "synopsis": "…", "sourceRefs": [1] }] }。
 * @param expectedCount 模板的节拍数。
 * @param segmentCount 小说原文的分段数；大于 0 时 sourceRefs 必须在 1 到该数之间，其他素材忽略 sourceRefs。
 * @throws GeneratedOutputError 格式不对、节拍数量或顺序与模板不一致。
 */
export function parseBeatSheet(raw: unknown, expectedCount: number, segmentCount = 0): BeatAssignment[] {
  const items: unknown = isRecord(raw) ? raw.beats : undefined;
  if (!Array.isArray(items)) {
    throw new GeneratedOutputError(['节拍表必须是包含 beats 数组的 JSON，例如 {"beats":[{"seq":1,"synopsis":"…","sourceRefs":[]}]}。']);
  }

  const issues: string[] = [];
  if (items.length !== expectedCount) {
    issues.push(`必须恰好给出 ${expectedCount} 个节拍（当前 ${items.length} 个），按给定顺序，不得增加、删除或合并。`);
  }

  const assignments: BeatAssignment[] = [];
  items.forEach((item, index) => {
    const seq = index + 1;
    if (isRecord(item) && item.seq !== undefined && item.seq !== seq) {
      issues.push(`第 ${seq} 个节拍的 seq 应为 ${seq}，节拍必须按给定顺序排列。`);
    }
    const synopsis = isRecord(item) && typeof item.synopsis === 'string' ? item.synopsis.trim() : '';
    if (synopsis.length === 0 || synopsis.length > BEAT_SYNOPSIS_MAX_LENGTH) {
      issues.push(`第 ${seq} 个节拍的 synopsis 必须是 1 到 ${BEAT_SYNOPSIS_MAX_LENGTH} 字的文本。`);
    }
    assignments.push({ seq, synopsis, sourceRefs: readSourceRefs(isRecord(item) ? item.sourceRefs : undefined, seq, segmentCount, issues) });
  });

  if (issues.length > 0) {
    throw new GeneratedOutputError(issues);
  }
  return assignments;
}

/** 读取节拍依据的原文分段序号；非小说素材一律返回空数组。 */
function readSourceRefs(value: unknown, seq: number, segmentCount: number, issues: string[]): number[] {
  if (segmentCount === 0 || value === undefined) {
    return [];
  }
  const valid = Array.isArray(value) && value.every((entry) => Number.isInteger(entry) && (entry as number) >= 1 && (entry as number) <= segmentCount);
  if (!valid) {
    issues.push(`第 ${seq} 个节拍的 sourceRefs 必须是 1 到 ${segmentCount} 之间的序号数组，没有依据时给空数组。`);
    return [];
  }
  return [...new Set(value as number[])].sort((left, right) => left - right);
}

/**
 * 把程序计算的参考预算与模型分配的内容合成节拍表的节拍。
 * @param template 节拍模板。
 * @param params 节拍表参数。
 * @param assignments 模型分配的内容，按节拍顺序，数量与模板一致。
 */
export function composeBeats(template: BeatTemplate, params: BeatSheetParams, assignments: readonly BeatAssignment[]): BeatDraft[] {
  const budgets = allocateBeatBudget(params.targetDurationSeconds, params.wordsPerSecond, template.items);
  return template.items.map((item, index) => ({
    seq: item.seq,
    label: item.label,
    purpose: item.purpose,
    targetRatio: item.targetRatio,
    estimatedSeconds: budgets[index].estimatedSeconds,
    estimatedWords: budgets[index].estimatedWords,
    synopsis: assignments[index].synopsis,
    sourceRefs: assignments[index].sourceRefs
  }));
}

/**
 * 读取输入快照里的节拍表：下游阶段启动时把已确认的节拍表存进输入快照，之后的生成、重试与偏差计算都以它为准。
 * @param raw 快照里的节拍表。
 * @returns 节拍表；快照里没有或结构不符时为 undefined。
 */
export function readBeatSheetSnapshot(raw: unknown): BeatSheet | undefined {
  if (!isRecord(raw) || !isRecord(raw.params) || !Array.isArray(raw.beats) || raw.beats.length === 0) {
    return undefined;
  }
  const valid = raw.beats.every(
    (beat) => isRecord(beat) && typeof beat.seq === 'number' && typeof beat.estimatedWords === 'number' && typeof beat.estimatedSeconds === 'number' && typeof beat.synopsis === 'string'
  );
  return valid ? (raw as unknown as BeatSheet) : undefined;
}

/** 用户编辑保存的节拍内容。 */
export interface BeatEdit {
  readonly seq: number;
  readonly synopsis: string;
}

/**
 * 校验并规范化用户编辑保存的一个节拍：只允许修改剧情内容。
 * @param rawInput 界面提交的原始内容 { seq, synopsis }。
 * @throws ValidationError 存在不合法的字段。
 */
export function normalizeBeatEdit(rawInput: unknown): BeatEdit {
  const source = readRecord(rawInput);
  const errors: FieldErrors = {};
  const seq = readInteger(source, { key: 'seq', label: '节拍序号', required: true, min: 1, max: 20 }, errors);
  const synopsis = readText(source, { key: 'synopsis', label: '剧情内容', required: true, maxLength: BEAT_SYNOPSIS_MAX_LENGTH }, errors);
  assertNoFieldErrors(errors);
  return { seq, synopsis };
}
