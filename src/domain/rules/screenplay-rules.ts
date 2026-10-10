// ------------------------------------------------------------------------
// 名称：screenplay-rules.ts
// 说明：剧本阶段的规则：生成参数校验、剧本包正文与抽取结果（含原稿保真模式按段落序号截取集正文）的输出校验、用户编辑集与实体时的校验。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：输出校验失败抛出 GeneratedOutputError，由阶段记录为失败并保留原始输出；界面提交的编辑内容校验失败抛出 ValidationError。
// ------------------------------------------------------------------------

import { GeneratedOutputError } from '../errors';
import {
  ENTITY_ATTRIBUTES,
  ENTITY_KIND_LABELS,
  EntityDraft,
  EntityEdit,
  EntityKind,
  EpisodeDraft,
  EpisodeEdit,
  PERFORMANCE_ATTRIBUTE_KEY,
  ScreenplayParams,
  ScreenplayStructure,
  ScreenplayText
} from '../models/screenplay';
import { ProductionFormatType } from '../models/production-profile';
import { countWords } from './creative-rules';
import { FieldErrors, assertNoFieldErrors, isBlank, isRecord, readInteger, readOptionalText, readRecord, readText, textOf } from './field-readers';
import { isMultiEpisode } from './production-profile-rules';

/** 不占口播时间的“标签：内容”行：画面、音效、配乐。 */
const SILENT_LINE_LABELS = /^(画面动作|画面|动作|镜头|音效|配乐|背景音乐|BGM|环境音|场景)$/i;
/** “说话人（括号）：台词”这类带标签的行；括号外不含标点，避免把含冒号的叙述句当成台词，括号内允许逗号（如“旁白（赤尾，急促）”）。 */
const LABELED_LINE = /^\s*[-*•]?\s*((?:[^：:，,。！？（(\n]|[（(][^）)\n]*[）)]){1,30}?)\s*[：:]\s*(.*)$/;

/** 单集最大时长（秒）的取值范围。 */
export const EPISODE_DURATION_MIN_SECONDS = 1;
/** 单集最大时长的上限，单位为秒。 */
export const EPISODE_DURATION_MAX_SECONDS = 3600;
/** 集数上限的最大值。 */
export const MAX_EPISODES_LIMIT = 100;
/** 剧本补充要求的长度上限。 */
export const SCREENPLAY_EXTRA_MAX_LENGTH = 2000;
/** 剧本包标题的长度上限。 */
export const SCREENPLAY_TITLE_MAX_LENGTH = 100;
/** 剧本包概要的长度上限。 */
export const SCREENPLAY_OVERVIEW_MAX_LENGTH = 2000;
/** 剧本包正文的长度上限。 */
export const SCREENPLAY_TEXT_MAX_LENGTH = 200000;
/** 集标题的长度上限。 */
export const EPISODE_TITLE_MAX_LENGTH = 60;
/** 集概要的长度上限。 */
export const EPISODE_SYNOPSIS_MAX_LENGTH = 1000;
/** 单集剧本正文的长度上限；单个短视频的剧本包正文就是这一集的正文，因此同样受限。 */
export const EPISODE_TEXT_MAX_LENGTH = 20000;
/** 编辑集时目标时长的上限（秒），不受单集最大时长约束。 */
export const EPISODE_TARGET_EDIT_MAX_SECONDS = 86400;
/** 实体名称的长度上限。 */
export const ENTITY_NAME_MAX_LENGTH = 50;
/** 单个实体最多保存的别名个数。 */
export const ENTITY_ALIAS_MAX_COUNT = 10;
/** 实体描述的长度上限。 */
export const ENTITY_DESCRIPTION_MAX_LENGTH = 500;
/** 实体单个设定字段的长度上限。 */
export const ENTITY_ATTRIBUTE_MAX_LENGTH = 500;
/** 角色“表演与动作”按情绪分条书写，比其他设定字段长。 */
export const ENTITY_PERFORMANCE_MAX_LENGTH = 800;
/** 一份剧本最多抽取的实体数。 */
export const MAX_ENTITIES = 200;
/** 实体类型的全部取值，用于校验。 */
const ENTITY_KINDS = Object.keys(ENTITY_KIND_LABELS) as EntityKind[];
/** 别名输入的分隔符：逗号、顿号和换行。 */
const ALIAS_SEPARATORS = /[,，、\n]/;

/**
 * 统计剧本里的口播字数（台词与旁白），不计场次标题、画面动作、音效和配乐；用它按语速估算时长才接近成片。
 * 没有任何台词或旁白时退回统计全文，避免估算为 0。
 * @param text 剧本正文。
 */
export function countSpokenWords(text: string): number {
  let spoken = 0;
  for (const line of text.split(/\r?\n/)) {
    const match = LABELED_LINE.exec(line);
    if (match === null) {
      continue;
    }
    const label = match[1].replace(/[（(][^）)]*[）)]/g, '').trim();
    if (label !== '' && !SILENT_LINE_LABELS.test(label)) {
      spoken += countWords(match[2].replace(/[（(][^）)]*[）)]/g, ''));
    }
  }
  return spoken > 0 ? spoken : countWords(text);
}

/**
 * 某个设定字段的长度上限。
 * @param key 设定字段的键。
 */
export function entityAttributeMaxLength(key: string): number {
  return key === PERFORMANCE_ATTRIBUTE_KEY ? ENTITY_PERFORMANCE_MAX_LENGTH : ENTITY_ATTRIBUTE_MAX_LENGTH;
}

/** 生成剧本时需要的作品信息，来自作品和输入快照。 */
export interface ScreenplayContext {
  readonly formatType: ProductionFormatType;
  readonly workName: string;
  readonly params: ScreenplayParams;
}

/**
 * 校验并规范化剧本阶段的生成参数（F4 中影响生成的字段）。
 * @param rawInput 界面提交的原始内容，数字字段可以是数字或文本。
 * @param formatType 作品体量；单集体量的集数上限固定为 1，不读取提交值。
 * @throws ValidationError 存在不合法的字段。
 */
export function normalizeScreenplayParams(rawInput: unknown, formatType: ProductionFormatType): ScreenplayParams {
  const source = readRecord(rawInput);
  const errors: FieldErrors = {};
  const maxEpisodeDurationSeconds = readInteger(
    source,
    { key: 'maxEpisodeDurationSeconds', label: '单集最大时长', required: true, min: EPISODE_DURATION_MIN_SECONDS, max: EPISODE_DURATION_MAX_SECONDS },
    errors
  );
  const maxEpisodes = !isMultiEpisode(formatType)
    ? 1
    : readInteger(source, { key: 'maxEpisodes', label: '集数上限', required: true, min: 1, max: MAX_EPISODES_LIMIT }, errors);
  const extra = readOptionalText(source, { key: 'extra', label: '补充要求', required: false, maxLength: SCREENPLAY_EXTRA_MAX_LENGTH }, errors);
  assertNoFieldErrors(errors);
  return { maxEpisodeDurationSeconds, maxEpisodes, extra };
}

/**
 * 校验并整理模型返回的剧本包：标题、梗概、正文。
 * @param raw 模型提交的 { title, overview, fullText }。
 * @param singleEpisode 是否只有一集；只有一集时正文不得超过单集正文上限。
 * @throws GeneratedOutputError 缺字段、为空或过长。
 */
export function parseScreenplayText(raw: unknown, singleEpisode: boolean): ScreenplayText {
  if (!isRecord(raw)) {
    throw new GeneratedOutputError(['剧本必须是包含 title、overview 和 fullText 的对象。']);
  }
  const title = textOf(raw, 'title');
  const overview = textOf(raw, 'overview');
  const fullText = textOf(raw, 'fullText');

  // 逐项收集问题并一次性反馈，让模型一次改完；只有一集时正文还要受单集上限约束。
  const issues: string[] = [];
  if (title.length === 0 || title.length > SCREENPLAY_TITLE_MAX_LENGTH) {
    issues.push(`title 必须是 1 到 ${SCREENPLAY_TITLE_MAX_LENGTH} 字的文本。`);
  }
  if (overview.length === 0 || overview.length > SCREENPLAY_OVERVIEW_MAX_LENGTH) {
    issues.push(`overview 必须是 1 到 ${SCREENPLAY_OVERVIEW_MAX_LENGTH} 字的文本。`);
  }
  if (fullText.length === 0) {
    issues.push('fullText 不能为空。');
  } else if (fullText.length > SCREENPLAY_TEXT_MAX_LENGTH) {
    issues.push(`fullText 有 ${fullText.length} 字，超过上限 ${SCREENPLAY_TEXT_MAX_LENGTH} 字。`);
  } else if (singleEpisode && fullText.length > EPISODE_TEXT_MAX_LENGTH) {
    issues.push(`单个短视频的剧本正文有 ${fullText.length} 字，超过 ${EPISODE_TEXT_MAX_LENGTH} 字，请精简。`);
  }
  if (issues.length > 0) {
    throw new GeneratedOutputError(issues);
  }
  return { title, overview, fullText };
}

/** 读取并校验一集；序号由顺序决定。 */
function parseEpisode(item: unknown, index: number, context: ScreenplayContext, fullText: string, issues: string[]): EpisodeDraft {
  const seq = index + 1;
  const record = isRecord(item) ? item : {};
  const single = !isMultiEpisode(context.formatType);

  // 单集作品没有分集：标题取作品名、正文取整篇剧本，不要求模型重复给出。
  const title = single ? context.workName : textOf(record, 'title');
  if (title.length === 0 || title.length > EPISODE_TITLE_MAX_LENGTH) {
    issues.push(`第 ${seq} 集标题必须是 1 到 ${EPISODE_TITLE_MAX_LENGTH} 字的文本。`);
  }
  const synopsis = textOf(record, 'synopsis');
  if (synopsis.length === 0 || synopsis.length > EPISODE_SYNOPSIS_MAX_LENGTH) {
    issues.push(`第 ${seq} 集梗概必须是 1 到 ${EPISODE_SYNOPSIS_MAX_LENGTH} 字的文本。`);
  }
  const screenplayText = single ? fullText : textOf(record, 'screenplayText');
  if (screenplayText.length === 0 || screenplayText.length > EPISODE_TEXT_MAX_LENGTH) {
    issues.push(`第 ${seq} 集 screenplayText 必须是 1 到 ${EPISODE_TEXT_MAX_LENGTH} 字的文本。`);
  }

  // 目标时长可以省略；给了就必须是不超过单集最大时长的正整数。
  const rawDuration = record.targetDurationSeconds;
  let targetDurationSeconds: number | null = null;
  if (rawDuration !== undefined && rawDuration !== null) {
    const max = context.params.maxEpisodeDurationSeconds;
    if (typeof rawDuration !== 'number' || !Number.isInteger(rawDuration) || rawDuration < 1 || rawDuration > max) {
      issues.push(`第 ${seq} 集 targetDurationSeconds 必须是 1 到 ${max} 之间的整数。`);
    } else {
      targetDurationSeconds = rawDuration;
    }
  }
  return { seq, title, synopsis, screenplayText, targetDurationSeconds };
}

/** 读取别名：去除空白、与名称相同和重复的项。 */
function readAliases(value: unknown, name: string, label: string, issues: string[]): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((alias) => typeof alias !== 'string')) {
    issues.push(`${label}的 aliases 必须是文本数组。`);
    return [];
  }
  // 去掉空白、与名称相同的别名和重复项。
  const aliases = [...new Set((value as string[]).map((alias) => alias.trim()).filter((alias) => alias.length > 0 && alias !== name))];
  if (aliases.length > ENTITY_ALIAS_MAX_COUNT || aliases.some((alias) => alias.length > ENTITY_NAME_MAX_LENGTH)) {
    issues.push(`${label}的别名最多 ${ENTITY_ALIAS_MAX_COUNT} 个，每个不超过 ${ENTITY_NAME_MAX_LENGTH} 字。`);
  }
  return aliases;
}

/** 读取设定字段：只取该类型允许的键，值必须是非空文本；空值忽略。 */
function readAttributes(value: unknown, kind: EntityKind, label: string, issues: string[]): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (value === undefined || value === null) {
    return attributes;
  }
  if (!isRecord(value)) {
    issues.push(`${label}的 attributes 必须是对象。`);
    return attributes;
  }
  // 只读取该类型允许的设定字段：空值忽略，其余必须是不超长的文本。
  for (const { key } of ENTITY_ATTRIBUTES[kind]) {
    const entry = value[key];
    if (isBlank(entry)) {
      continue;
    }
    if (typeof entry !== 'string' || entry.trim().length > entityAttributeMaxLength(key)) {
      issues.push(`${label}的 ${key} 必须是不超过 ${entityAttributeMaxLength(key)} 字的文本。`);
    } else if (entry.trim().length > 0) {
      attributes[key] = entry.trim();
    }
  }
  return attributes;
}

/** 读取并校验一个实体；names 记录已出现的（类型，名称）用于查重。 */
function parseEntity(item: unknown, index: number, names: Set<string>, issues: string[]): EntityDraft | undefined {
  const record = isRecord(item) ? item : {};
  const label = `第 ${index + 1} 个实体`;
  const kind = record.kind;
  if (typeof kind !== 'string' || !ENTITY_KINDS.includes(kind as EntityKind)) {
    issues.push(`${label}的 kind 必须是 ${ENTITY_KINDS.join('、')} 之一。`);
    return undefined;
  }
  const name = textOf(record, 'name');
  if (name.length === 0 || name.length > ENTITY_NAME_MAX_LENGTH) {
    issues.push(`${label}的 name 必须是 1 到 ${ENTITY_NAME_MAX_LENGTH} 字的文本。`);
    return undefined;
  }
  // 同类型的实体按名称查重，重复的丢弃并记问题。
  const key = `${kind}\u0000${name}`;
  if (names.has(key)) {
    issues.push(`${ENTITY_KIND_LABELS[kind as EntityKind]}“${name}”重复出现，同类型的实体名称不能重复。`);
    return undefined;
  }
  names.add(key);

  const description = textOf(record, 'description');
  if (description.length > ENTITY_DESCRIPTION_MAX_LENGTH) {
    issues.push(`${label}的 description 不能超过 ${ENTITY_DESCRIPTION_MAX_LENGTH} 字。`);
  }
  return {
    kind: kind as EntityKind,
    name,
    aliases: readAliases(record.aliases, name, label, issues),
    description,
    attributes: readAttributes(record.attributes, kind as EntityKind, label, issues),
    isActive: true
  };
}

/**
 * 校验并整理模型从剧本正文抽取的集和实体。
 * @param raw 模型提交的 { episodes, entities }。
 * @param context 作品形态、作品名称与生成参数；单个短视频只能有 1 集，标题取作品名称、正文取剧本包正文。
 * @param fullText 剧本包正文。
 * @throws GeneratedOutputError 格式不对、集数不符或实体重名。
 */
export function parseStructure(raw: unknown, context: ScreenplayContext, fullText: string): ScreenplayStructure {
  if (!isRecord(raw) || !Array.isArray(raw.episodes) || !Array.isArray(raw.entities)) {
    throw new GeneratedOutputError(['结果必须是包含 episodes 数组和 entities 数组的对象。']);
  }

  const issues: string[] = [];
  const { maxEpisodes } = context.params;
  if (raw.episodes.length === 0) {
    issues.push('episodes 至少需要 1 集。');
  } else if (!isMultiEpisode(context.formatType) && raw.episodes.length !== 1) {
    issues.push(`单个短视频只能有 1 集，现在有 ${raw.episodes.length} 集。`);
  } else if (raw.episodes.length > maxEpisodes) {
    issues.push(`episodes 有 ${raw.episodes.length} 集，超过上限 ${maxEpisodes} 集，请合并或精简。`);
  }
  if (raw.entities.length > MAX_ENTITIES) {
    issues.push(`entities 有 ${raw.entities.length} 个，超过上限 ${MAX_ENTITIES} 个，请合并次要实体。`);
  }

  const episodes = raw.episodes.map((item, index) => parseEpisode(item, index, context, fullText, issues));
  const names = new Set<string>();
  const entities = raw.entities
    .map((item, index) => parseEntity(item, index, names, issues))
    .filter((entity): entity is EntityDraft => entity !== undefined);

  if (issues.length > 0) {
    throw new GeneratedOutputError(issues);
  }
  return { episodes, entities };
}

/**
 * 校验并整理原稿保真模式下模型抽取的集和实体：多集的每集只给出起止段落序号，集正文由程序按序号从原文截取，保证与原稿一致。
 * @param raw 模型提交的 { episodes: [{ title, synopsis, startParagraph, endParagraph }], entities }；单个短视频不需要段落序号。
 * @param context 作品形态、作品名称与生成参数。
 * @param paragraphs 剧本包正文的段落，按顺序拼接等于正文。
 * @throws GeneratedOutputError 格式不对、段落序号不连续或没有覆盖全文、集数不符或实体重名。
 */
export function parseVerbatimStructure(raw: unknown, context: ScreenplayContext, paragraphs: readonly string[]): ScreenplayStructure {
  const fullText = paragraphs.join('').trim();
  if (!isMultiEpisode(context.formatType) || !isRecord(raw) || !Array.isArray(raw.episodes)) {
    return parseStructure(raw, context, fullText);
  }

  const issues: string[] = [];
  let expectedStart = 1;
  const episodes = raw.episodes.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const start = record.startParagraph;
    const end = record.endParagraph;
    const label = `第 ${index + 1} 集`;
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end)) {
      issues.push(`${label}的 startParagraph 和 endParagraph 必须是整数。`);
      return record;
    }
    if (start !== expectedStart) {
      issues.push(`${label}必须从第 ${expectedStart} 段开始（各集连续、不重叠、不遗漏），现在从第 ${start} 段开始。`);
      return record;
    }
    if (end < start || end > paragraphs.length) {
      issues.push(`${label}的 endParagraph 必须在 ${start} 到 ${paragraphs.length} 之间。`);
      return record;
    }
    expectedStart = end + 1;
    return { ...record, screenplayText: paragraphs.slice(start - 1, end).join('').trim() };
  });
  if (issues.length === 0 && expectedStart !== paragraphs.length + 1) {
    issues.push(`最后一集必须结束在第 ${paragraphs.length} 段，现在只覆盖到第 ${expectedStart - 1} 段，不能遗漏原文。`);
  }
  if (issues.length > 0) {
    throw new GeneratedOutputError(issues);
  }
  return parseStructure({ ...raw, episodes }, context, fullText);
}

/**
 * 校验并规范化用户编辑保存的剧本包正文。
 * @param rawInput 界面提交的原始内容 { fullText }。
 * @throws ValidationError 为空或过长。
 */
export function normalizeScreenplayTextEdit(rawInput: unknown): string {
  const errors: FieldErrors = {};
  const fullText = readText(
    readRecord(rawInput),
    { key: 'fullText', label: '剧本包正文', required: true, maxLength: SCREENPLAY_TEXT_MAX_LENGTH },
    errors
  );
  assertNoFieldErrors(errors);
  return fullText;
}

/**
 * 校验并规范化用户编辑保存的一集（F12“集编辑”）。
 * @param rawInput 界面提交的原始内容。
 * @throws ValidationError 存在不合法的字段。
 */
export function normalizeEpisodeEdit(rawInput: unknown): EpisodeEdit {
  const source = readRecord(rawInput);
  const errors: FieldErrors = {};
  const title = readText(source, { key: 'title', label: '集标题', required: true, maxLength: EPISODE_TITLE_MAX_LENGTH }, errors);
  const synopsis = readText(source, { key: 'synopsis', label: '本集梗概', required: false, maxLength: EPISODE_SYNOPSIS_MAX_LENGTH }, errors);
  const screenplayText = readText(
    source,
    { key: 'screenplayText', label: '本集剧本正文', required: false, maxLength: EPISODE_TEXT_MAX_LENGTH },
    errors
  );
  const rawDuration = source.targetDurationSeconds;
  const hasDuration = !(rawDuration === undefined || rawDuration === null || (typeof rawDuration === 'string' && rawDuration.trim() === ''));
  const duration = hasDuration
    ? readInteger(
        source,
        { key: 'targetDurationSeconds', label: '本集目标时长', required: true, min: 1, max: EPISODE_TARGET_EDIT_MAX_SECONDS },
        errors
      )
    : null;
  assertNoFieldErrors(errors);
  return { title, synopsis, screenplayText, targetDurationSeconds: duration };
}

/**
 * 校验并规范化用户编辑保存的一个实体（F12“实体编辑”）；类型不能修改，设定字段按类型取舍。
 * @param rawInput 界面提交的原始内容，aliases 为逗号、顿号或换行分隔的文本。
 * @param kind 实体类型。
 * @throws ValidationError 存在不合法的字段。
 */
export function normalizeEntityEdit(rawInput: unknown, kind: EntityKind): EntityEdit {
  const source = readRecord(rawInput);
  const errors: FieldErrors = {};
  const name = readText(source, { key: 'name', label: '实体名称', required: true, maxLength: ENTITY_NAME_MAX_LENGTH }, errors);
  const description = readText(
    source,
    { key: 'description', label: '设定摘要', required: false, maxLength: ENTITY_DESCRIPTION_MAX_LENGTH },
    errors
  );

  const rawAliases = source.aliases;
  if (rawAliases !== undefined && rawAliases !== null && typeof rawAliases !== 'string') {
    errors.aliases = '别名必须是文本。';
  }
  const aliases =
    typeof rawAliases === 'string'
      ? [...new Set(rawAliases.split(ALIAS_SEPARATORS).map((alias) => alias.trim()).filter((alias) => alias.length > 0 && alias !== name))]
      : [];
  if (aliases.length > ENTITY_ALIAS_MAX_COUNT || aliases.some((alias) => alias.length > ENTITY_NAME_MAX_LENGTH)) {
    errors.aliases = `别名最多 ${ENTITY_ALIAS_MAX_COUNT} 个，每个不超过 ${ENTITY_NAME_MAX_LENGTH} 字。`;
  }

  const rawAttributes = source.attributes === undefined || source.attributes === null ? {} : source.attributes;
  const attributeSource = readRecord(rawAttributes);
  const attributes: Record<string, string> = {};
  for (const { key, label } of ENTITY_ATTRIBUTES[kind]) {
    const text = readText(attributeSource, { key, label, required: false, maxLength: entityAttributeMaxLength(key) }, errors);
    if (text.length > 0) {
      attributes[key] = text;
    }
  }

  const isActive = source.isActive === undefined ? true : source.isActive === true;
  assertNoFieldErrors(errors);
  return { name, aliases, description, attributes, isActive };
}
