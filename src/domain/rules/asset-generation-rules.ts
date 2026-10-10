// ------------------------------------------------------------------------
// 名称：asset-generation-rules.ts
// 说明：资产生成的规则：修订号的维护、提示词“需更新”与图片“有改动未生成”的推算、能否提交生成的判断、图像与音频生成参数在所选模型能力范围内的校验。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：规则见 private-docs/rujian-studio/开发文档-vscode/database-design.md 4.9；修改表单或提示词只改修订号，不创建空版本；能否生成的判断用“生效提示词”（已保存的，没有时按模板拼）；纯函数，不依赖数据库。
// ------------------------------------------------------------------------

import { AssetContent, AssetGenerationSummary, AssetKind, AssetRecord, AssetUsageSummary } from '../models/asset';
import { AudioCapability, ImageCapability, ModelKind } from '../models/model-capability';
import { PromptSourceAsset, resolveGenerationPrompt } from './asset-prompt-rules';
import { FieldErrors, isBlank } from './field-readers';

/** 资产使用上传文件时不能生成提示词和图片（音频）的提示。 */
export const UPLOAD_SOURCE_GENERATION_MESSAGE = '当前使用的是上传的文件，请先改用生成。';

/** 既没有已保存的提示词，设定也不足以按模板拼出提示词时的提示。 */
export const NO_GENERATION_PROMPT_MESSAGE = '请先补充设定描述（图像类至少一项，音频需要描述），或生成、填写提示词。';

/** 保存资产时要写入的修订信息。 */
export interface AssetRevisionUpdate {
  readonly contentRevision: number;
  readonly promptRevision: number;
  readonly promptContentRevision: number;
}

/** 资产类型对应的生成模型类型：音频资产用音频模型，其余用图像模型。 */
export function modelKindOfAsset(kind: AssetKind): ModelKind {
  return kind === 'audio' ? 'audio' : 'image';
}

/** 稳定的 JSON 文本：键按字典序，用于比较描述字段。 */
function stableAttributes(attributes: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.entries(attributes).sort(([left], [right]) => left.localeCompare(right)));
}

/** 影响生成的表单字段（不含名称、提示词、文件）是否发生变化。 */
export function contentFieldsChanged(previous: AssetRecord, next: AssetContent): boolean {
  return (
    stableAttributes(previous.attributes) !== stableAttributes(next.attributes) ||
    previous.composition !== next.composition ||
    previous.style !== next.style ||
    previous.background !== next.background ||
    previous.referenceAspectRatio !== next.referenceAspectRatio ||
    previous.extraRequirements !== next.extraRequirements
  );
}


/**
 * 计算保存时的修订信息。
 * @param previous 保存前的资产。
 * @param next 提交的新内容。
 */
export function computeRevisionUpdate(previous: AssetRecord, next: AssetContent): AssetRevisionUpdate {
  // 提示词不随表单保存而改变，修订号保持原样；手动改提示词见 computePromptRevision。
  return {
    contentRevision: previous.contentRevision + (contentFieldsChanged(previous, next) ? 1 : 0),
    promptRevision: previous.promptRevision,
    promptContentRevision: previous.promptContentRevision
  };
}

/** 手动保存提示词时要写入的修订信息。 */
export interface PromptRevisionUpdate {
  readonly promptRevision: number;
  readonly promptContentRevision: number;
}

/**
 * 计算手动保存提示词的修订信息：文本有变化才增加修订号；用户亲自保存即视为已确认基于当前表单内容（文本没变也一样），清空则不再有依据。
 * @param previous 保存前的资产。
 * @param next 提交的提示词。
 */
export function computePromptRevision(
  previous: Pick<AssetRecord, 'prompt' | 'promptRevision' | 'contentRevision'>,
  next: { readonly prompt: string }
): PromptRevisionUpdate {
  const changed = previous.prompt !== next.prompt;
  return {
    promptRevision: previous.promptRevision + (changed ? 1 : 0),
    promptContentRevision: next.prompt !== '' ? previous.contentRevision : 0
  };
}

/**
 * 统计资产被多少集使用：集内实体绑定所在的集，加上镜头声音直接指定该音频的集，同一集只算一次；采用版本前据此提示。
 * @param usage 资产的使用情况。
 */
export function countUsedEpisodes(usage: Pick<AssetUsageSummary, 'bindings' | 'soundEpisodes'>): number {
  const episodes = new Set<string>();
  for (const item of [...usage.bindings, ...usage.soundEpisodes]) {
    episodes.add(`${item.workName}#${item.episodeSeq}`);
  }
  return episodes.size;
}
/** 是否有提示词。 */
export function hasPrompt(asset: Pick<AssetRecord, 'prompt'>): boolean {
  return asset.prompt !== '';
}

/** 提示词是否需要更新：有提示词，且表单字段在提示词之后改过。 */
export function isPromptOutdated(asset: Pick<AssetRecord, 'prompt' | 'promptContentRevision' | 'contentRevision'>): boolean {
  return hasPrompt(asset) && asset.promptContentRevision < asset.contentRevision;
}

/** 图片（音频）是否有改动未生成：已有版本，且最新版本记录的修订号落后于资产现在的。 */
export function hasUngeneratedChanges(
  asset: Pick<AssetRecord, 'contentRevision' | 'promptRevision'>,
  summary: AssetGenerationSummary
): boolean {
  const latest = summary.latest;
  return latest !== null && (latest.contentRevision < asset.contentRevision || latest.promptRevision < asset.promptRevision);
}

/** 能否提交生成的判断结果；不能时 reason 说明原因。 */
export interface GenerationAvailability {
  readonly available: boolean;
  readonly reason: string | null;
}

/**
 * 判断能否提交图片（音频）生成；提示词取已保存的，没有时按模板拼，两者都没有才不能生成。
 * @param asset 资产。
 * @param summary 版本摘要。
 * @param hasUsableModel 是否有可用的同类型模型。
 */
export function checkGenerationAvailability(
  asset: PromptSourceAsset & Pick<AssetRecord, 'promptStatus' | 'fileSource'>,
  summary: AssetGenerationSummary,
  hasUsableModel: boolean
): GenerationAvailability {
  const noun = asset.kind === 'audio' ? '音频' : '图像';
  // 使用上传文件的资产没有生成入口，要生成须先改用生成。
  if (asset.fileSource === 'upload') {
    return { available: false, reason: UPLOAD_SOURCE_GENERATION_MESSAGE };
  }
  if (asset.promptStatus === 'running') {
    return { available: false, reason: '提示词生成中，完成后才能生成。' };
  }
  if (resolveGenerationPrompt(asset) === '') {
    return { available: false, reason: NO_GENERATION_PROMPT_MESSAGE };
  }
  if (summary.latest !== null && (summary.latest.status === 'queued' || summary.latest.status === 'running')) {
    return { available: false, reason: '正在生成，请等待完成。' };
  }
  if (!hasUsableModel) {
    return { available: false, reason: `请先在“设置 > 模型”中启用${noun}模型并配置访问密钥。` };
  }
  return { available: true, reason: null };
}

/** 音频语言（界面文字）对应的语言代码。 */
const LANGUAGE_CODES: Readonly<Record<string, string>> = { 中文: 'zh', 英文: 'en' };

/**
 * 把音频语言的界面文字转换为语言代码。
 * @returns 语言代码；没有设置或为“其他”时为 undefined。
 */
export function languageCodeOf(label: string | undefined): string | undefined {
  return label !== undefined && Object.hasOwn(LANGUAGE_CODES, label) ? LANGUAGE_CODES[label] : undefined;
}

/** 图像生成参数在不同入口的错误字段键：表单用表单字段键，生成请求用载荷键。 */
export interface ImageRunParamKeys {
  readonly count: string;
  readonly aspectRatio: string;
  readonly resolution: string;
}

/** 音频生成参数在不同入口的错误字段键。 */
export interface AudioRunParamKeys {
  readonly language: string;
  readonly voice: string;
}

/** 图像生成请求中受模型能力限制的参数；不指定的画幅、分辨率为 null。 */
export interface ImageRunParams {
  readonly count: number;
  readonly aspectRatio: string | null;
  readonly resolution: string | null;
}

/** 音频生成请求中受模型能力限制的参数；不指定的语言、预置音色为 null。 */
export interface AudioRunParams {
  readonly language: string | null;
  readonly voice: string | null;
}

/** 读取可选的下拉值：空串或未提供视为不指定；不在可选范围内时按 key 记录字段错误。 */
function readRunOption(value: unknown, options: readonly string[], key: string, outOfRangeMessage: string, errors: FieldErrors): string | null {
  if (isBlank(value)) {
    return null;
  }
  if (typeof value !== 'string' || !options.includes(value)) {
    errors[key] = outOfRangeMessage;
    return null;
  }
  return value;
}

/** 画幅不在模型支持范围内的提示；模型没有画幅可选时提示不能指定。 */
function aspectRatioMessage(value: unknown, options: readonly string[]): string {
  return options.length === 0
    ? '所选模型不支持指定画幅，请留空。'
    : `所选模型不支持画幅 ${String(value)}（支持：${options.join('、')}），请换一个画幅或模型。`;
}

/**
 * 校验图像生成参数是否在所选模型的能力范围内：数量是 1 到单次上限的整数，画幅、分辨率在模型支持的取值中。
 * 表单与生成服务共用；不合法的项按 keys 记录到 errors，不抛出。
 * @param input 数量、画幅、分辨率；数量缺省为 1，画幅与分辨率为空串或缺省表示不指定。
 */
export function readImageRunParams(
  input: { readonly count?: unknown; readonly aspectRatio?: unknown; readonly resolution?: unknown },
  capability: ImageCapability,
  keys: ImageRunParamKeys,
  errors: FieldErrors
): ImageRunParams {
  const count = input.count === undefined ? 1 : input.count;
  const countValid = typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= capability.imagesPerRequestMax;
  if (!countValid) {
    errors[keys.count] = `生成数量必须是 1 到 ${capability.imagesPerRequestMax} 之间的整数。`;
  }
  return {
    count: countValid ? count : 1,
    aspectRatio: readRunOption(input.aspectRatio, capability.aspectRatios, keys.aspectRatio, aspectRatioMessage(input.aspectRatio, capability.aspectRatios), errors),
    resolution: readRunOption(input.resolution, capability.resolutions, keys.resolution, '分辨率不在所选模型支持的范围内。', errors)
  };
}

/**
 * 校验音频生成参数是否在所选模型的能力范围内：语言、预置音色在模型支持的取值中。
 * 表单与生成服务共用；不合法的项按 keys 记录到 errors，不抛出。
 * @param input 语言代码与预置音色；空串或缺省表示不指定。
 */
export function readAudioRunParams(
  input: { readonly language?: unknown; readonly voice?: unknown },
  capability: AudioCapability,
  keys: AudioRunParamKeys,
  errors: FieldErrors
): AudioRunParams {
  return {
    language: readRunOption(input.language, capability.languages, keys.language, '语言不在所选模型支持的范围内。', errors),
    voice: readRunOption(input.voice, capability.voices, keys.voice, '预置音色不在所选模型支持的范围内。', errors)
  };
}
