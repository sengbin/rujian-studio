// ------------------------------------------------------------------------
// 名称：asset-prompt-rules.ts
// 说明：资产提示词的规则：把资产内容整理为提示词素材，按类型给出画面（声音）重点，校验模型返回的提示词，按固定模板直接拼出提示词，并解析提交生成时实际使用的提示词。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：图像类资产生成参考图提示词，音频资产生成音频生成提示词；素材来自已保存的资产；模型输出不合格抛出 GeneratedOutputError；生效提示词“已保存的优先，没有时按模板拼”，模板拼法见 compileAssetPrompt。
// ------------------------------------------------------------------------

import { GeneratedOutputError } from '../errors';
import {
  ASSET_ATTRIBUTE_FIELDS,
  ASSET_KIND_LABELS,
  AUDIO_KIND_LABELS,
  AssetKind,
  AssetRecord,
  AudioKind
} from '../models/asset';
import { ASSET_PROMPT_MAX_LENGTH } from './asset-rules';

/** 随请求发送给模型的参考图数量上限。 */
export const ASSET_PROMPT_MAX_IMAGES = 3;

/** 参考图原文件超过这个大小时，改发缩略图，避免请求过大。 */
export const ASSET_PROMPT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** 各类型图像资产参考图的画面重点，写入提示词模板。 */
const IMAGE_FOCUS: Readonly<Record<Exclude<AssetKind, 'audio'>, string>> = {
  character: '单个角色的形象：面部与发型、体型、服装与配饰，主体完整、居中，不出现其他人物。',
  scene: '一个空间或场景环境：布局、陈设、光线与氛围，通常不出现人物。',
  prop: '单个道具：外形、材质、颜色、细节与当前状态，主体清晰突出。',
  effect: '一种视觉特效：形态、颜色、质感、动态与对环境的影响。'
};

/** 各类型音频的重点，写入提示词模板。 */
const AUDIO_FOCUS: Readonly<Record<AudioKind, string>> = {
  voice: '一段示范语音：按“角色台词 + 情绪 + 语气 + 语速 + 音色 + 口音”描述说话人的声音，并给出一句符合角色的示范台词，让人听一句就能判断音色。',
  music: '一段背景音乐：按“背景音乐/配乐 + 风格”描述，写明风格、情绪、主要乐器、节奏与速度，是否纯音乐。',
  sfx: '一个音效：按“发声材质 + 动作 + 环境音”描述，写明发声物体的材质、发出声音的动作和所处的环境音，尽量具体。'
};

/** 整理后的资产草稿。 */
export interface AssetDraftDescription {
  /** 草稿里的名称；没有填写为空串。 */
  readonly name: string;
  /** “标签：内容”形式的行，名称在最前。 */
  readonly lines: readonly string[];
  /** 名称以外用户填写的字段数。 */
  readonly detailCount: number;
}

/** 模型生成的提示词。 */
export interface AssetPrompts {
  readonly prompt: string;
}

/**
 * 读取音频资产的类型；音频类型在创建时必填，缺失或取值不合法说明数据有误。
 * @throws Error attributes 里没有有效的 audio_kind。
 */
export function readAudioKind(attributes: Readonly<Record<string, string>>): AudioKind {
  const value = attributes.audio_kind;
  if (value === undefined || !Object.hasOwn(AUDIO_KIND_LABELS, value)) {
    throw new Error('音频资产缺少有效的音频类型（audio_kind），无法判断它是音色、配乐还是音效。');
  }
  return value as AudioKind;
}

/** 资产类型（音频为其音频类型）在提示词里的名称，用作模板变量。 */
export function promptKindLabel(asset: Pick<AssetRecord, 'kind' | 'attributes'>): string {
  return asset.kind === 'audio' ? AUDIO_KIND_LABELS[readAudioKind(asset.attributes)] : ASSET_KIND_LABELS[asset.kind];
}

/** 资产的画面（声音）重点。 */
export function promptFocus(asset: Pick<AssetRecord, 'kind' | 'attributes'>): string {
  return asset.kind === 'audio' ? AUDIO_FOCUS[readAudioKind(asset.attributes)] : IMAGE_FOCUS[asset.kind];
}

/** 把已保存的资产转换为表单键的文本值，供整理草稿使用。 */
export function assetToDraftValues(asset: AssetRecord): Record<string, string> {
  const values: Record<string, string> = { name: asset.name, extra: asset.extraRequirements };
  if (asset.kind === 'audio') {
    values.audioKind = AUDIO_KIND_LABELS[readAudioKind(asset.attributes)];
    values.description = asset.attributes.description ?? '';
    values.language = asset.attributes.language ?? '';
    return values;
  }
  values.composition = asset.composition;
  values.style = asset.style ?? '';
  values.background = asset.background;
  values.referenceAspectRatio = asset.referenceAspectRatio ?? '';
  for (const field of ASSET_ATTRIBUTE_FIELDS[asset.kind]) {
    values[field.formKey] = asset.attributes[field.key] ?? '';
  }
  return values;
}

/**
 * 把资产内容整理成提示词素材；空字段不列出。
 * @param kind 资产类型。
 * @param values 表单键到文本。
 */
export function describeAssetDraft(kind: AssetKind, values: Readonly<Record<string, unknown>>): AssetDraftDescription {
  const read = (key: string): string => {
    const value = values[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const lines: string[] = [];
  let detailCount = 0;
  const addDetail = (label: string, key: string): void => {
    const text = read(key);
    if (text.length > 0) {
      lines.push(`${label}：${text}`);
      detailCount += 1;
    }
  };

  const name = read('name');
  if (name.length > 0) {
    lines.push(`${ASSET_KIND_LABELS[kind]}名称：${name}`);
  }
  if (kind === 'audio') {
    lines.push(`音频类型：${read('audioKind') || AUDIO_KIND_LABELS.voice}`);
    addDetail('描述', 'description');
    addDetail('语言', 'language');
    addDetail('补充要求', 'extra');
    return { name, lines, detailCount };
  }

  addDetail('视角与构图', 'composition');
  const style = read('style');
  if (style.length > 0) {
    lines.push(`画面风格：${style}`);
    detailCount += 1;
  }
  addDetail('背景', 'background');
  addDetail('参考图画幅', 'referenceAspectRatio');
  for (const field of ASSET_ATTRIBUTE_FIELDS[kind]) {
    addDetail(field.label, field.formKey);
  }
  addDetail('补充要求', 'extra');
  return { name, lines, detailCount };
}

/**
 * 校验模型提交的提示词。
 * @param raw 模型通过工具提交的对象。
 * @throws GeneratedOutputError 缺少提示词、为空或过长。
 */
export function parseAssetPrompts(raw: unknown): AssetPrompts {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new GeneratedOutputError(['结果必须是包含 prompt 的对象。']);
  }
  const source = raw as Record<string, unknown>;
  const issues: string[] = [];
  const value = source.prompt;
  const prompt = typeof value === 'string' ? value.trim() : '';
  if (prompt.length === 0) {
    issues.push('提示词不能为空。');
  } else if (prompt.length > ASSET_PROMPT_MAX_LENGTH) {
    issues.push(`提示词有 ${prompt.length} 字，超过上限 ${ASSET_PROMPT_MAX_LENGTH} 字。`);
  }
  if (issues.length > 0) {
    throw new GeneratedOutputError(issues);
  }
  return { prompt };
}

/** 拼接或解析生效提示词所需的资产内容。 */
export type PromptSourceAsset = Pick<
  AssetRecord,
  'kind' | 'name' | 'prompt' | 'attributes' | 'composition' | 'style' | 'background' | 'referenceAspectRatio' | 'extraRequirements'
>;

/** 模板直出的图像提示词末尾固定追加的约束。 */
const TEMPLATE_IMAGE_SUFFIX = '画面中不出现文字、标识、水印和边框。';

/** 与画面无关、拼图像提示词时不写入的描述字段（角色的音色描述）。 */
const NON_VISUAL_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set(['voice_description']);

/** 去掉首尾空白和结尾的标点，避免拼接后出现重复标点。 */
function trimClause(text: string): string {
  return text.trim().replace(/[。；;.\s]+$/u, '');
}

/**
 * 按固定模板把资产设定拼成生成提示词，不调用文本模型。
 * 图像类：名称、各描述字段、构图、背景、画面风格、补充要求、画幅，末尾固定追加“不出现文字水印”的约束；至少要有一项视觉描述。
 * 音频：描述与补充要求，描述为空时不能拼。
 * @param asset 资产或还没有保存的草稿内容。
 * @returns 提示词；信息不足时为空串。
 */
export function compileAssetPrompt(asset: PromptSourceAsset): string {
  const extra = trimClause(asset.extraRequirements);
  if (asset.kind === 'audio') {
    const description = trimClause(asset.attributes.description ?? '');
    if (description === '') {
      return '';
    }
    return extra === '' ? description : `${description}。${extra}`;
  }

  const details: string[] = [];
  const addDetail = (label: string, value: string | null): void => {
    const text = trimClause(value ?? '');
    if (text !== '') {
      details.push(`${label}：${text}`);
    }
  };
  for (const field of ASSET_ATTRIBUTE_FIELDS[asset.kind]) {
    if (!NON_VISUAL_ATTRIBUTE_KEYS.has(field.key)) {
      addDetail(field.label, asset.attributes[field.key] ?? '');
    }
  }
  addDetail('视角与构图', asset.composition);
  addDetail('背景', asset.background);
  addDetail('画面风格', asset.style);
  addDetail('补充要求', extra);

  const name = trimClause(asset.name);
  if (name === '' || details.length === 0) {
    return '';
  }
  const clauses = [`${ASSET_KIND_LABELS[asset.kind]}参考图：${name}`, ...details];
  const ratio = trimClause(asset.referenceAspectRatio ?? '');
  if (ratio !== '') {
    clauses.push(`画幅比例：${ratio}`);
  }
  return `${clauses.join('；')}。${TEMPLATE_IMAGE_SUFFIX}`;
}

/**
 * 读取提交生成时实际使用的提示词：资产有保存的提示词（手动填写或 AI 生成）就用它，否则按模板实时拼出。
 * @param asset 资产。
 * @returns 提示词；两者都没有时为空串。
 */
export function resolveGenerationPrompt(asset: PromptSourceAsset): string {
  return asset.prompt !== '' ? asset.prompt : compileAssetPrompt(asset);
}
