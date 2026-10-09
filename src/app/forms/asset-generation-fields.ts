// ------------------------------------------------------------------------
// 名称：asset-generation-fields.ts
// 说明：新建资产表单里“生成方式”与出图（音频）参数字段：字段定义、初始值，以及把提交的值解析、校验为生成请求。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-08
// 备注：生成方式有三项：直接出图（用模板拼提示词并立即生成）、AI 生成提示词（只在后台生成提示词）、AI 生成提示词并出图；选项文字随资产类型变化（音频叫“生成音频”）；模型与参数字段只在需要出图时显示，文本模型只在带 AI 时显示；图像的画幅取表单里的“参考图画幅”，音频的语言取表单里的“语言”，不再单设字段。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, ValidationError } from '../../domain/errors';
import { AUDIO_KIND_LABELS, AssetKind, AudioKind } from '../../domain/models/asset';
import { AudioCapability, ImageCapability } from '../../domain/models/model-capability';
import { NO_GENERATION_PROMPT_MESSAGE } from '../../domain/rules/asset-generation-rules';
import { compileAssetPrompt } from '../../domain/rules/asset-prompt-rules';
import { normalizeAssetContent } from '../../domain/rules/asset-rules';
import { GenerationModelOption } from '../services/asset-generation-service';
import { WorkTextModelState } from '../services/text-settings-service';
import { FormValues } from './form-definition';
import { FormFieldSchema } from './form-schema';
import { TEXT_MODEL_FIELD_KEY, createTextModelField } from './text-model-field';

/** 生成方式字段的键。 */
export const GENERATE_MODE_FIELD_KEY = 'generateMode';
/** 出图（音频）模型字段的键。 */
export const RUN_MODEL_FIELD_KEY = 'runModel';
/** 图片数量字段的键。 */
export const RUN_COUNT_FIELD_KEY = 'runCount';
/** 图片分辨率字段的键。 */
export const RUN_RESOLUTION_FIELD_KEY = 'runResolution';
/** 预置音色字段的键。 */
export const RUN_VOICE_FIELD_KEY = 'runVoice';

/** 生成方式：直接出图、AI 生成提示词、AI 生成提示词并出图。 */
export type GenerateMode = 'direct' | 'prompt' | 'promptAndRun';

/** 新建表单打开时读取的模型状态：全部可用的出图（音频）模型和文本模型选择状态。 */
export interface AssetRunState {
  readonly models: readonly GenerationModelOption[];
  readonly textModel: WorkTextModelState;
}

const TEXT_MODEL_PURPOSE = '生成提示词时';
const TEXT_MODEL_NOTE = '；仅对本次生成有效，“仅创建”不会用到';
const AI_UNAVAILABLE_NOTE = '当前没有启用任何文本模型，无法使用这一项。';
const CREATE_ONLY_NOTE = '点“仅创建”只保存设定，不生成。';
const COUNT_PLACEHOLDER = '默认 1 张';
const MODEL_DECIDES_PLACEHOLDER = '由模型决定';
const LANGUAGE_CODES: Readonly<Record<string, string>> = { 中文: 'zh', 英文: 'en' };

/** 出图（音频）动作的称呼：图像类叫“出图”，音频叫“生成音频”。 */
function verbOf(kind: AssetKind): string {
  return kind === 'audio' ? '生成音频' : '出图';
}

/** 模型类型的称呼，用于提示。 */
function nounOf(kind: AssetKind): string {
  return kind === 'audio' ? '音频' : '图像';
}

/** 三种生成方式在界面上的文字。 */
export function generateModeLabels(kind: AssetKind): Readonly<Record<GenerateMode, string>> {
  const verb = verbOf(kind);
  return { direct: `直接${verb}`, prompt: 'AI 生成提示词', promptAndRun: `AI 生成提示词并${verb}` };
}

/** 需要出图（音频）模型与参数的生成方式。 */
const RUN_MODES: readonly GenerateMode[] = ['direct', 'promptAndRun'];
/** 需要文本模型的生成方式。 */
const AI_MODES: readonly GenerateMode[] = ['prompt', 'promptAndRun'];

/** 音频类型的表单文字（或键）转音频类型；不认识的按音色参考。 */
function readAudioKindKey(raw: string | undefined): AudioKind {
  const entries = Object.entries(AUDIO_KIND_LABELS) as Array<[AudioKind, string]>;
  return entries.find(([key, label]) => raw === key || raw === label)?.[0] ?? 'voice';
}

/** 某类资产可用的模型：音频资产只保留支持其音频类型的模型。 */
function modelsFor(kind: AssetKind, models: readonly GenerationModelOption[], audioKind: AudioKind | null): GenerationModelOption[] {
  if (kind !== 'audio' || audioKind === null) {
    return [...models];
  }
  return models.filter((model) => (model.capability as AudioCapability).audioKinds.includes(audioKind));
}

/** 模型选项的文字列表。 */
function labelsOf(models: readonly GenerationModelOption[]): string[] {
  return models.map((model) => model.label);
}

/** 按模型选项文字建立“模型 → 选项”的对照表，供依赖模型的下拉使用。 */
function byModel(models: readonly GenerationModelOption[], pick: (model: GenerationModelOption) => readonly string[]): Record<string, readonly string[]> {
  return Object.fromEntries(models.map((model) => [model.label, pick(model)]));
}

/** 生成方式字段的各项说明；没有文本模型时在带 AI 的选项后追加提示。 */
function describeModes(kind: AssetKind, state: AssetRunState): Record<string, string> {
  const labels = generateModeLabels(kind);
  const verb = verbOf(kind);
  const hasText = state.textModel.choices.length > 0;
  const withNote = (text: string): string => `${text}${hasText ? '' : AI_UNAVAILABLE_NOTE}${CREATE_ONLY_NOTE}`;
  return {
    [labels.direct]: `按已填的设定直接拼成提示词并${verb}，最快，不调用文本模型。${CREATE_ONLY_NOTE}`,
    [labels.prompt]: withNote('由文本模型在后台生成提示词，不会自动生成；检查提示词后再到列表里点“生成”。'),
    [labels.promptAndRun]: withNote(`由文本模型在后台生成提示词，完成后自动${verb}。`)
  };
}

/** 出图（音频）参数里依赖模型的下拉字段：选项随所选模型变化，只在需要出图时显示。 */
function createModelDependentField(
  key: string,
  label: string,
  description: string,
  placeholder: string,
  byValue: Record<string, readonly string[]>,
  initialModel: string,
  visibleModes: readonly string[]
): FormFieldSchema {
  return {
    key,
    label,
    description,
    control: 'select',
    required: false,
    placeholder,
    options: byValue[initialModel] ?? [],
    optionsByValue: { sourceKey: RUN_MODEL_FIELD_KEY, byValue },
    visibleWhen: { sourceKey: GENERATE_MODE_FIELD_KEY, values: visibleModes }
  };
}

/**
 * 创建新建表单里的生成方式字段、出图（音频）参数字段和文本模型字段（放在其他字段之后）。
 * @param kind 资产类型。
 * @param state 打开表单时读取的模型状态。
 */
export function createGenerationFields(kind: AssetKind, state: AssetRunState): FormFieldSchema[] {
  const labels = generateModeLabels(kind);
  const runModes = RUN_MODES.map((mode) => labels[mode]);
  const aiModes = AI_MODES.map((mode) => labels[mode]);
  const isAudio = kind === 'audio';
  const initialAudioKind: AudioKind = 'voice';
  const noun = nounOf(kind);

  const initialModels = modelsFor(kind, state.models, isAudio ? initialAudioKind : null);
  const modelField: FormFieldSchema = {
    key: RUN_MODEL_FIELD_KEY,
    label: `${noun}模型`,
    description:
      state.models.length === 0
        ? `没有可用的${noun}模型：请先在“设置 > 模型”中启用${noun}模型并配置访问密钥。`
        : `${verbOf(kind)}使用的模型；点“仅创建”时不使用。`,
    control: 'select',
    required: false,
    followsFirstOption: true,
    options: labelsOf(initialModels),
    visibleWhen: { sourceKey: GENERATE_MODE_FIELD_KEY, values: runModes },
    ...(isAudio
      ? {
          optionsByValue: {
            sourceKey: 'audioKind',
            byValue: Object.fromEntries(
              (Object.entries(AUDIO_KIND_LABELS) as Array<[AudioKind, string]>).map(([key, label]) => [label, labelsOf(modelsFor(kind, state.models, key))])
            )
          }
        }
      : {})
  };
  const initialModel = initialModels[0]?.label ?? '';

  const parameterFields: FormFieldSchema[] = isAudio
    ? [
        createModelDependentField(
          RUN_VOICE_FIELD_KEY,
          '预置音色',
          '部分模型提供预置音色，可选；不选由模型决定。',
          MODEL_DECIDES_PLACEHOLDER,
          byModel(state.models, (model) => (model.capability as AudioCapability).voices),
          initialModel,
          runModes
        )
      ]
    : [
        createModelDependentField(
          RUN_COUNT_FIELD_KEY,
          '生成数量',
          '一次生成的图片数量，它们属于同一个版本；不选为 1 张。',
          COUNT_PLACEHOLDER,
          byModel(state.models, (model) =>
            Array.from({ length: (model.capability as ImageCapability).imagesPerRequestMax }, (_, index) => String(index + 1))
          ),
          initialModel,
          runModes
        ),
        createModelDependentField(
          RUN_RESOLUTION_FIELD_KEY,
          '分辨率',
          '画幅取上面的“参考图画幅”，所选模型不支持时无法提交。',
          MODEL_DECIDES_PLACEHOLDER,
          byModel(state.models, (model) => (model.capability as ImageCapability).resolutions),
          initialModel,
          runModes
        )
      ];

  const textModelField: FormFieldSchema = {
    ...createTextModelField(state.textModel, TEXT_MODEL_PURPOSE, TEXT_MODEL_NOTE),
    visibleWhen: { sourceKey: GENERATE_MODE_FIELD_KEY, values: aiModes }
  };

  return [
    {
      key: GENERATE_MODE_FIELD_KEY,
      label: '生成方式',
      description: `决定创建后做什么；${CREATE_ONLY_NOTE}`,
      descriptionByValue: { sourceKey: GENERATE_MODE_FIELD_KEY, byValue: describeModes(kind, state) },
      control: 'select',
      required: true,
      options: Object.values(labels)
    },
    modelField,
    ...parameterFields,
    textModelField
  ];
}

/**
 * 新建表单里生成相关字段的初始值：默认的生成方式、第一个可用模型、文本模型的初始选择。
 * @param kind 资产类型。
 * @param state 打开表单时读取的模型状态。
 * @param defaultMode 默认的生成方式。
 * @param textModelInitial 文本模型字段的初始值。
 */
export function createGenerationInitialValues(kind: AssetKind, state: AssetRunState, defaultMode: GenerateMode, textModelInitial: string): FormValues {
  const first = modelsFor(kind, state.models, kind === 'audio' ? 'voice' : null)[0];
  return {
    [GENERATE_MODE_FIELD_KEY]: generateModeLabels(kind)[defaultMode],
    [RUN_MODEL_FIELD_KEY]: first?.label ?? '',
    [TEXT_MODEL_FIELD_KEY]: textModelInitial
  };
}

/**
 * 读取提交的生成方式。
 * @throws ValidationError 没有选择生成方式或选项无效。
 */
export function readGenerateMode(kind: AssetKind, values: FormValues): GenerateMode {
  const labels = generateModeLabels(kind);
  const found = (Object.entries(labels) as Array<[GenerateMode, string]>).find(([, label]) => label === values[GENERATE_MODE_FIELD_KEY]);
  if (found === undefined) {
    throw new ValidationError({ [GENERATE_MODE_FIELD_KEY]: '请选择生成方式。' });
  }
  return found[0];
}

/** 生成方式是否需要出图（音频）。 */
export function needsRun(mode: GenerateMode): boolean {
  return RUN_MODES.includes(mode);
}

/** 生成方式是否需要文本模型。 */
export function needsText(mode: GenerateMode): boolean {
  return AI_MODES.includes(mode);
}

/**
 * 确认有可用的文本模型；没有时不能选择带 AI 的生成方式。
 * @throws ValidationError 没有启用任何文本模型。
 */
export function assertTextModelAvailable(kind: AssetKind, state: AssetRunState): void {
  if (state.textModel.choices.length === 0) {
    throw new ValidationError({
      [GENERATE_MODE_FIELD_KEY]: `没有启用任何文本模型，无法使用 AI 生成提示词。请先在“设置 > 模型”中启用文本模型，或改选“${generateModeLabels(kind).direct}”。`
    });
  }
}

/**
 * 确认已填的设定足够按模板拼出提示词（用于直接出图）。
 * @throws ValidationError 表单内容不合法，或设定不足以拼出提示词。
 */
export function assertDirectPromptReady(kind: AssetKind, values: FormValues): void {
  const { content } = normalizeAssetContent(values, kind, 'generated');
  if (compileAssetPrompt({ kind, ...content }) === '') {
    throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: NO_GENERATION_PROMPT_MESSAGE });
  }
}

/**
 * 把表单里的出图（音频）参数解析为提交生成的请求（不含资产标识），并按所选模型的能力校验。
 * 图像的画幅取“参考图画幅”，模型有画幅可选但不支持该画幅时报错，不悄悄换成别的；音频的语言取“语言”，同理。
 * @param kind 资产类型。
 * @param values 表单提交的值。
 * @param state 打开表单时读取的模型状态。
 * @throws ValidationError 没有可用模型、没有选择模型，或参数不在所选模型支持的范围内。
 */
export function readRunRequest(kind: AssetKind, values: FormValues, state: AssetRunState): Record<string, unknown> {
  const audioKind = kind === 'audio' ? readAudioKindKey(values.audioKind) : null;
  const candidates = modelsFor(kind, state.models, audioKind);
  const noun = nounOf(kind);
  if (candidates.length === 0) {
    throw new ValidationError({
      [RUN_MODEL_FIELD_KEY]: `没有可用的${noun}模型，请先在“设置 > 模型”中启用并配置访问密钥，或改选“${generateModeLabels(kind).prompt}”。`
    });
  }
  const model = candidates.find((candidate) => candidate.label === values[RUN_MODEL_FIELD_KEY]);
  if (model === undefined) {
    throw new ValidationError({ [RUN_MODEL_FIELD_KEY]: `请选择${noun}模型。` });
  }

  const errors: Record<string, string> = {};
  let request: Record<string, unknown>;
  if (kind === 'audio') {
    const capability = model.capability as AudioCapability;
    const languageCode = LANGUAGE_CODES[(values.language ?? '').trim()] ?? '';
    let language = '';
    if (audioKind === 'voice' && languageCode !== '' && capability.languages.length > 0) {
      if (capability.languages.includes(languageCode)) {
        language = languageCode;
      } else {
        errors.language = `所选模型不支持语言“${values.language}”，请换一个模型或语言。`;
      }
    }
    const voice = values[RUN_VOICE_FIELD_KEY] ?? '';
    if (voice !== '' && !capability.voices.includes(voice)) {
      errors[RUN_VOICE_FIELD_KEY] = '预置音色不在所选模型支持的范围内。';
    }
    request = { modelId: model.id, language, voice };
  } else {
    const capability = model.capability as ImageCapability;
    const rawCount = values[RUN_COUNT_FIELD_KEY] ?? '';
    const count = rawCount === '' ? 1 : Number(rawCount);
    if (!Number.isInteger(count) || count < 1 || count > capability.imagesPerRequestMax) {
      errors[RUN_COUNT_FIELD_KEY] = `生成数量必须是 1 到 ${capability.imagesPerRequestMax} 之间的整数。`;
    }
    const resolution = values[RUN_RESOLUTION_FIELD_KEY] ?? '';
    if (resolution !== '' && !capability.resolutions.includes(resolution)) {
      errors[RUN_RESOLUTION_FIELD_KEY] = '分辨率不在所选模型支持的范围内。';
    }
    const ratio = (values.referenceAspectRatio ?? '').trim();
    let aspectRatio = '';
    if (ratio !== '' && capability.aspectRatios.length > 0) {
      if (capability.aspectRatios.includes(ratio)) {
        aspectRatio = ratio;
      } else {
        errors.referenceAspectRatio = `所选模型不支持画幅 ${ratio}（支持：${capability.aspectRatios.join('、')}），请换一个参考图画幅或模型。`;
      }
    }
    request = { modelId: model.id, count, aspectRatio, resolution, useReferenceImages: false };
  }
  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }
  return request;
}
