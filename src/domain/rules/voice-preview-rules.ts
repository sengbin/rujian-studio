// ------------------------------------------------------------------------
// 名称：voice-preview-rules.ts
// 说明：分镜动画台词试听的纯规则：读取试听请求、把台词写成语音模型的提示词、为没有参考音频支持的模型按说话人挑选预置音色、把音色参考的语言换成语言代码；以及未绑定音色时“按描述生成音色”的请求读取与提示词。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：界面提交的内容不可信，标识一律在这里校验；说话人用 speakerKey 区分：角色为 entity:标识，旁白为 narrator。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, ValidationError } from '../errors';
import { FieldErrors, assertNoFieldErrors, readRecord, readText } from './field-readers';

/** 一次台词试听请求：集、可选的分镜版本、声音条目与所选的音频模型。 */
export interface VoicePreviewInput {
  readonly episodeId: number;
  /** 预览固定的分镜版本；缺省为最新版本。 */
  readonly runId: number | undefined;
  readonly soundId: number;
  readonly modelId: number;
  /** 为 true 时绕过缓存重新调用模型，结果替换缓存里的旧结果。 */
  readonly regenerate: boolean;
}

/** 读取已保存配音的请求：集、可选的分镜版本与所选的音频模型。 */
export interface VoiceRestoreInput {
  readonly episodeId: number;
  readonly runId: number | undefined;
  readonly modelId: number;
}

/** 旁白的说话人键。 */
export const NARRATOR_SPEAKER_KEY = 'narrator';

/** 试听台词的长度上限（字）。 */
export const VOICE_SAMPLE_TEXT_MAX_LENGTH = 120;
/** 音色描述与说话方式的长度上限（字）。 */
export const VOICE_DESCRIPTION_MAX_LENGTH = 500;
export const VOICE_DELIVERY_MAX_LENGTH = 200;
/** 采用时音色资产名称的长度上限，与资产名称一致。 */
const VOICE_NAME_MAX_LENGTH = 50;
/** 预置音色名的长度上限。 */
const VOICE_PRESET_MAX_LENGTH = 100;

/** 说话人：角色（entityId）或旁白（null）。 */
export interface VoiceSpeakerInput {
  readonly episodeId: number;
  /** 角色实体标识；旁白为 null。 */
  readonly entityId: number | null;
}

/** 按描述生成音色的请求。 */
export interface VoiceDraftInput extends VoiceSpeakerInput {
  readonly modelId: number;
  /** 用来试听音色的一句台词。 */
  readonly sampleText: string;
  /** 说话方式（情绪、语气、语速），可为空。 */
  readonly delivery: string;
  /** 音色描述，可为空。 */
  readonly description: string;
  /** 预置音色（模型只有预置音色时由用户选）；缺省由系统按说话人挑选。 */
  readonly presetVoice: string | null;
  /** 为 true 时绕过缓存，重新调用模型“换一个”。 */
  readonly regenerate: boolean;
}

/** 采用音色的请求。 */
export interface VoiceAdoptInput extends VoiceSpeakerInput {
  /** 新音频资产的名称。 */
  readonly name: string;
  /** 是否同时绑定到作品里其他还没有该角色音色的集（只对角色有效）。 */
  readonly applyToOtherEpisodes: boolean;
}

/** 读取整数标识；缺失或不是正整数时抛出校验错误。 */
function readPositiveId(source: Record<string, unknown>, key: string, label: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: `${label}标识无效。` });
  }
  return value;
}

/** 读取说话人：entityId 缺省或为 null 表示旁白。 */
function readSpeaker(source: Record<string, unknown>): VoiceSpeakerInput {
  return {
    episodeId: readPositiveId(source, 'episodeId', '集'),
    entityId: source.entityId === undefined || source.entityId === null ? null : readPositiveId(source, 'entityId', '角色')
  };
}

/**
 * 读取并校验试听请求。
 * @param rawInput 界面提交的原始内容：episodeId、runId（可选）、soundId、modelId、regenerate（可选）。
 * @throws ValidationError 标识缺失或不合法。
 */
export function readVoicePreviewInput(rawInput: unknown): VoicePreviewInput {
  const source = readRecord(rawInput);
  return {
    episodeId: readPositiveId(source, 'episodeId', '集'),
    runId: source.runId === undefined || source.runId === null ? undefined : readPositiveId(source, 'runId', '版本'),
    soundId: readPositiveId(source, 'soundId', '声音'),
    modelId: readPositiveId(source, 'modelId', '模型'),
    regenerate: source.regenerate === true
  };
}

/**
 * 读取并校验“读取已保存配音”请求。
 * @param rawInput 界面提交的原始内容：episodeId、runId（可选）、modelId。
 * @throws ValidationError 标识缺失或不合法。
 */
export function readVoiceRestoreInput(rawInput: unknown): VoiceRestoreInput {
  const source = readRecord(rawInput);
  return {
    episodeId: readPositiveId(source, 'episodeId', '集'),
    runId: source.runId === undefined || source.runId === null ? undefined : readPositiveId(source, 'runId', '版本'),
    modelId: readPositiveId(source, 'modelId', '模型')
  };
}

/**
 * 读取说话人（角色或旁白）。
 * @param rawInput 界面提交的原始内容：episodeId、entityId（旁白不填）。
 * @throws ValidationError 标识不合法。
 */
export function readVoiceSpeakerInput(rawInput: unknown): VoiceSpeakerInput {
  return readSpeaker(readRecord(rawInput));
}

/**
 * 读取并校验“按描述生成音色”的请求。
 * @param rawInput 界面提交的原始内容：episodeId、entityId（旁白不填）、modelId、sampleText、delivery、description、presetVoice、regenerate。
 * @throws ValidationError 标识不合法，或试听台词为空、内容过长。
 */
export function readVoiceDraftInput(rawInput: unknown): VoiceDraftInput {
  const source = readRecord(rawInput);
  const errors: FieldErrors = {};
  const sampleText = readText(source, { key: 'sampleText', label: '试听台词', required: true, maxLength: VOICE_SAMPLE_TEXT_MAX_LENGTH }, errors);
  const delivery = readText(source, { key: 'delivery', label: '说话方式', required: false, maxLength: VOICE_DELIVERY_MAX_LENGTH }, errors);
  const description = readText(source, { key: 'description', label: '音色描述', required: false, maxLength: VOICE_DESCRIPTION_MAX_LENGTH }, errors);
  const presetVoice = readText(source, { key: 'presetVoice', label: '预置音色', required: false, maxLength: VOICE_PRESET_MAX_LENGTH }, errors);
  assertNoFieldErrors(errors);
  return {
    ...readSpeaker(source),
    modelId: readPositiveId(source, 'modelId', '模型'),
    sampleText,
    delivery,
    description,
    presetVoice: presetVoice === '' ? null : presetVoice,
    regenerate: source.regenerate === true
  };
}

/**
 * 读取并校验“采用音色”的请求。
 * @param rawInput 界面提交的原始内容：episodeId、entityId（旁白不填）、name、applyToOtherEpisodes。
 * @throws ValidationError 标识不合法，或名称为空、过长。
 */
export function readVoiceAdoptInput(rawInput: unknown): VoiceAdoptInput {
  const source = readRecord(rawInput);
  const errors: FieldErrors = {};
  const name = readText(source, { key: 'name', label: '名称', required: true, maxLength: VOICE_NAME_MAX_LENGTH }, errors);
  assertNoFieldErrors(errors);
  return { ...readSpeaker(source), name, applyToOtherEpisodes: source.applyToOtherEpisodes === true };
}

/** 说话人键：角色为 entity:标识，旁白为 narrator。 */
export function toSpeakerKey(entityId: number | null): string {
  return entityId === null ? NARRATOR_SPEAKER_KEY : `entity:${entityId}`;
}

/**
 * 把音色描述、说话方式与台词写成“按描述生成音色”的提示词：写成“说话人（音色描述，说话方式）说：“台词””，平台只把括号里的描述当作人物音色。
 * @param description 音色描述，可为空。
 * @param delivery 说话方式，可为空。
 * @param text 台词。
 */
export function buildDraftPrompt(description: string, delivery: string, text: string): string {
  const manner = [description.trim(), delivery.trim()].filter((part) => part !== '');
  const speaker = manner.length === 0 ? '' : `说话人（${manner.join('，')}）`;
  return `${speaker}说：“${text.trim()}”`;
}

/**
 * 按文字猜语言代码：含中日韩汉字为 zh，否则含拉丁字母为 en，都没有为 null。
 * @param text 台词。
 */
export function guessLanguageCode(text: string): 'zh' | 'en' | null {
  if (/[\u4e00-\u9fff]/.test(text)) {
    return 'zh';
  }
  return /[A-Za-z]/.test(text) ? 'en' : null;
}

/** 语言代码对应的资产语言文字（中文、英文）；不认识的为 null。 */
export function toLanguageLabel(code: string | null): string | null {
  return code === 'zh' ? '中文' : code === 'en' ? '英文' : null;
}

/**
 * 把台词写成语音模型的提示词。
 * 模型支持参考音频时按“参考标记 + 说话方式 + 说：“台词””的声音公式书写，标记用于引用参考音频；其他模型只朗读台词本身。
 * @param text 台词。
 * @param delivery 说话方式（情绪、语气、语速），可为空。
 * @param referenceMark 引用参考音频的标记；null 表示不使用参考音频。
 */
export function buildVoicePrompt(text: string, delivery: string, referenceMark: string | null): string {
  const line = text.trim();
  if (referenceMark === null) {
    return line;
  }
  const manner = delivery.trim();
  return `${referenceMark}${manner === '' ? '' : `，${manner}`}，说：“${line}”`;
}

/**
 * 为没有参考音频支持的模型按说话人挑一个预置音色：同一个说话人始终得到同一个音色，不同说话人尽量错开。
 * @param voices 模型的预置音色。
 * @param entityId 说话人实体标识。
 * @returns 音色；模型没有预置音色时为 null（由模型使用默认音色）。
 */
export function pickPresetVoice(voices: readonly string[], entityId: number): string | null {
  return voices.length === 0 ? null : voices[entityId % voices.length];
}

/**
 * 把音色参考资产的语言换成语言代码。
 * @param label 资产的语言设置（中文、英文、其他）。
 * @param supported 模型支持的语言代码。
 * @returns 语言代码；没有设置、为“其他”或模型不支持时为 null。
 */
export function toLanguageCode(label: string | undefined, supported: readonly string[]): string | null {
  const code = label === '中文' ? 'zh' : label === '英文' ? 'en' : null;
  return code !== null && supported.includes(code) ? code : null;
}
