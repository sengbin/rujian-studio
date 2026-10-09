// ------------------------------------------------------------------------
// 名称：adaptation-checklist-rules.ts
// 说明：结构性改编清单规则：判断是否需要改编清单、校验模型给出的取舍项、按用户勾选本地重算预计总时长、规范化用户的勾选提交。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：设计见 docs/production-profile-design.md 第 7.1、7.2、7.4 节；勾选变化只做本地重算，不调用模型；模型估算的节省字数只是参考，预计总时长以这里的重算为准。
// ------------------------------------------------------------------------

import { GeneratedOutputError } from '../errors';
import { AdaptationChecklist, AdaptationOption, AdaptationOptionKind } from '../models/adaptation-checklist';
import { FieldErrors, assertNoFieldErrors, readRecord } from './field-readers';
import { evaluateCalibration } from './timing-calibration-rules';

/** 取舍项文字字段的长度上限。 */
export const ADAPTATION_LABEL_MAX_LENGTH = 100;
export const ADAPTATION_REASON_MAX_LENGTH = 500;
/** 一份清单最多的取舍项数。 */
export const ADAPTATION_OPTIONS_MAX = 50;
/** 一个取舍项最多关联的定位标识数。 */
const AFFECTED_REFS_MAX = 20;
/** 单个定位标识的长度上限，只允许章节、场景或人物名称这类短文本。 */
const AFFECTED_REF_MAX_LENGTH = 40;

const OPTION_KINDS: readonly AdaptationOptionKind[] = ['subplot', 'character_merge', 'scene_skip', 'other'];

/** 取舍项类型的界面名称。 */
export const ADAPTATION_KIND_LABELS: Readonly<Record<AdaptationOptionKind, string>> = {
  subplot: '支线',
  character_merge: '人物合并',
  scene_skip: '场次跳过',
  other: '其他'
};

/** 预计总量：按当前勾选重算的结果。 */
export interface EstimatedTotal {
  readonly estimatedWords: number;
  readonly estimatedSeconds: number;
  readonly withinTolerance: boolean;
}

/**
 * 判断是否需要结构性改编清单：改编前的预计时长超出目标时长的容差上限才需要；
 * 已在容差内，或内容比目标还短（没有可取舍的内容）时跳过，直接进入正文生成。
 * @param baselineSeconds 改编前预计时长（秒）。
 * @param targetSeconds 目标时长（秒）。
 * @param toleranceRatio 容差比例。
 */
export function needsAdaptation(baselineSeconds: number, targetSeconds: number, toleranceRatio: number): boolean {
  const result = evaluateCalibration(baselineSeconds, targetSeconds, toleranceRatio);
  return !result.withinTolerance && result.deviationRatio > 0;
}

/** 判断值是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 校验并整理模型返回的取舍项；标识按顺序分配，用户勾选状态初始等于模型的默认建议。
 * @param raw 解析后的 JSON，形如 { "options": [{ "kind", "label", "reason", "affectedRefs", "estimatedWordsSaved", "recommended" }] }，也接受直接的数组；没有可取舍的内容时 options 为空数组。
 * @param wordsPerSecond 语速（字/秒），用于把节省字数换算为秒。
 * @throws GeneratedOutputError 格式不对或字段不合法。
 */
export function parseAdaptationOptions(raw: unknown, wordsPerSecond: number): AdaptationOption[] {
  const items: unknown = Array.isArray(raw) ? raw : isRecord(raw) ? raw.options : undefined;
  if (!Array.isArray(items)) {
    throw new GeneratedOutputError(['取舍清单必须是包含 options 数组的 JSON；没有可取舍的内容时给空数组。']);
  }
  if (items.length > ADAPTATION_OPTIONS_MAX) {
    throw new GeneratedOutputError([`取舍项有 ${items.length} 项，超过上限 ${ADAPTATION_OPTIONS_MAX} 项，请只保留最有价值的。`]);
  }

  const issues: string[] = [];
  const options = items.map((item, index): AdaptationOption => {
    const position = index + 1;
    const record = isRecord(item) ? item : {};
    const validKind = typeof record.kind === 'string' && OPTION_KINDS.includes(record.kind as AdaptationOptionKind);
    if (!validKind) {
      issues.push(`第 ${position} 项的 kind 必须是 ${OPTION_KINDS.join('、')} 之一。`);
    }
    const kind = validKind ? (record.kind as AdaptationOptionKind) : 'other';
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
    if (label.length === 0 || label.length > ADAPTATION_LABEL_MAX_LENGTH) {
      issues.push(`第 ${position} 项的 label 必须是 1 到 ${ADAPTATION_LABEL_MAX_LENGTH} 字的文本。`);
    }
    if (reason.length === 0 || reason.length > ADAPTATION_REASON_MAX_LENGTH) {
      issues.push(`第 ${position} 项的 reason 必须是 1 到 ${ADAPTATION_REASON_MAX_LENGTH} 字的文本。`);
    }
    const saved = record.estimatedWordsSaved;
    if (typeof saved !== 'number' || !Number.isFinite(saved) || saved < 0) {
      issues.push(`第 ${position} 项的 estimatedWordsSaved 必须是非负数字。`);
    }
    const refs = record.affectedRefs;
    if (refs !== undefined && (!Array.isArray(refs) || refs.length > AFFECTED_REFS_MAX || refs.some((ref) => typeof ref !== 'string'))) {
      issues.push(`第 ${position} 项的 affectedRefs 必须是不超过 ${AFFECTED_REFS_MAX} 个文本的数组。`);
    } else if (Array.isArray(refs) && refs.some((ref: string) => ref.length > AFFECTED_REF_MAX_LENGTH || /^\s*[{[]/.test(ref))) {
      issues.push(`第 ${position} 项的 affectedRefs 每项必须是不超过 ${AFFECTED_REF_MAX_LENGTH} 字的章节、场景或人物名称（如 "第3章"、"灰耳"），不得是 JSON 或长描述。`);
    }
    const estimatedWordsSaved = typeof saved === 'number' && saved >= 0 ? Math.round(saved) : 0;
    const recommended = record.recommended === true;
    return {
      id: `option-${position}`,
      kind,
      label,
      reason,
      affectedRefs: Array.isArray(refs) ? (refs as string[]).map((ref) => ref.trim()).filter((ref) => ref.length > 0) : [],
      estimatedWordsSaved,
      estimatedSecondsSaved: toSeconds(estimatedWordsSaved, wordsPerSecond),
      recommended,
      selected: recommended
    };
  });

  if (issues.length > 0) {
    throw new GeneratedOutputError(issues);
  }
  return options;
}

/** 字数换算为秒，保留一位小数。 */
function toSeconds(words: number, wordsPerSecond: number): number {
  return Math.round((words / wordsPerSecond) * 10) / 10;
}

/**
 * 按当前各取舍项的勾选状态，在本地重算预计总字数与总时长，不调用模型。
 * @param checklist 改编清单。
 */
export function computeEstimatedTotal(checklist: AdaptationChecklist): EstimatedTotal {
  const saved = checklist.options.filter((option) => option.selected).reduce((sum, option) => sum + option.estimatedWordsSaved, 0);
  const estimatedWords = Math.max(0, checklist.baselineWords - saved);
  const estimatedSeconds = toSeconds(estimatedWords, checklist.wordsPerSecond);
  return {
    estimatedWords,
    estimatedSeconds,
    withinTolerance: evaluateCalibration(estimatedSeconds, checklist.targetSeconds, checklist.toleranceRatio).withinTolerance
  };
}

/**
 * 校验用户提交的勾选：selected 是被勾选的取舍项标识，必须都存在于清单中。
 * @param rawInput 界面提交的原始内容 { selected: string[] }。
 * @param checklist 当前清单。
 * @returns 被勾选的标识集合。
 * @throws ValidationError 提交内容不合法。
 */
export function normalizeSelection(rawInput: unknown, checklist: AdaptationChecklist): ReadonlySet<string> {
  const source = readRecord(rawInput);
  const errors: FieldErrors = {};
  const value = source.selected;
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
    errors.selected = '勾选内容必须是标识数组。';
  } else {
    const known = new Set(checklist.options.map((option) => option.id));
    const unknown = (value as string[]).filter((id) => !known.has(id));
    if (unknown.length > 0) {
      errors.selected = '勾选了清单中不存在的取舍项，请刷新后重试。';
    }
  }
  assertNoFieldErrors(errors);
  return new Set(value as string[]);
}

/**
 * 把确认采用的取舍项整理为提示词中的“已确认排除或合并的内容”；没有勾选项时返回空串。
 * @param checklist 已确认的改编清单；没有清单时传 undefined。
 */
export function describeConfirmedOptions(checklist: AdaptationChecklist | undefined): string {
  const selected = checklist?.options.filter((option) => option.selected) ?? [];
  return selected.map((option) => `- ${ADAPTATION_KIND_LABELS[option.kind]}：${option.label}（${option.reason}）`).join('\n');
}
