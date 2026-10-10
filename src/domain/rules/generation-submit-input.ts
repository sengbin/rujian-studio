// ------------------------------------------------------------------------
// 名称：generation-submit-input.ts
// 说明：视频生成提交请求的读取与校验：作品、集、镜头组与生成参数（模型、画幅、分辨率、声音、种子、负向清单、提示词改写）。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯函数；校验失败抛出 ValidationError，指出具体字段而不是静默丢弃。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, ValidationError } from '../errors';
import { GenerationParams } from '../models/generation';
import { isBlank, readIdentifier, readRecord } from './field-readers';
import {
  AUDIO_ELEMENTS_ERROR_TEXT,
  NEGATIVE_LIST_ERROR_TEXT,
  PROMPT_EXTEND_ERROR_TEXT,
  SEED_ERROR_TEXT,
  isValidSeed,
  readAudioElements,
  readNegativeList
} from './generation-profile-rules';

/** 一次提交最多包含的镜头组数。 */
export const MAX_SUBMIT_GROUPS = 100;

/** 画幅、分辨率等文本参数的最大长度。 */
const PARAM_TEXT_MAX_LENGTH = 20;

/** 读取到的提交请求：作品、集、要提交的镜头组与生成参数。 */
export interface SubmitInput {
  readonly workId: number;
  readonly episodeId: number;
  readonly groupIds: readonly number[];
  readonly params: GenerationParams;
}

/** 读取可选的短文本参数；空值为 null。 */
function readOptionalParam(source: Record<string, unknown>, key: string, label: string): string | null {
  const value = source[key];
  if (isBlank(value)) {
    return null;
  }
  if (typeof value !== 'string' || value.length > PARAM_TEXT_MAX_LENGTH) {
    throw new ValidationError({ [key]: `${label}不合法。` });
  }
  return value;
}

/**
 * 读取并校验提交请求。
 * @param rawInput 界面提交的原始内容：workId、episodeId、groupIds、params（modelId、aspectRatio、resolution、audioMode、audioElements、seed、negativeList、promptExtend）。
 * @throws ValidationError 内容不合法。
 */
export function readSubmitInput(rawInput: unknown): SubmitInput {
  const source = readRecord(rawInput);
  const workId = readIdentifier(source, 'workId', '作品');
  const episodeId = readIdentifier(source, 'episodeId', '集');
  const { groupIds } = source;
  if (!Array.isArray(groupIds) || groupIds.length === 0 || groupIds.length > MAX_SUBMIT_GROUPS || !groupIds.every((id) => Number.isInteger(id))) {
    throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: `请选择 1 到 ${MAX_SUBMIT_GROUPS} 个镜头组。` });
  }
  const params = readRecord(source.params);
  const audioMode = readOptionalParam(params, 'audioMode', '声音模式');
  if (audioMode !== null && audioMode !== 'none' && audioMode !== 'native') {
    throw new ValidationError({ audioMode: '声音模式不合法。' });
  }
  // 声音内容与种子为空表示不指定；填写了就必须合法，不合法时指出字段而不是静默丢弃。
  const audioElements = params.audioElements === undefined || params.audioElements === null ? null : readAudioElements(params.audioElements);
  if (audioElements === undefined) {
    throw new ValidationError({ audioElements: AUDIO_ELEMENTS_ERROR_TEXT });
  }
  const seed = params.seed === undefined || params.seed === null ? null : params.seed;
  if (seed !== null && !isValidSeed(seed)) {
    throw new ValidationError({ seed: SEED_ERROR_TEXT });
  }
  const negativeList = params.negativeList === undefined ? null : readNegativeList(params.negativeList);
  if (negativeList === undefined) {
    throw new ValidationError({ negativeList: NEGATIVE_LIST_ERROR_TEXT });
  }
  const promptExtend = params.promptExtend === undefined ? null : params.promptExtend;
  if (promptExtend !== null && typeof promptExtend !== 'boolean') {
    throw new ValidationError({ promptExtend: PROMPT_EXTEND_ERROR_TEXT });
  }
  return {
    workId,
    episodeId,
    groupIds: [...new Set(groupIds as number[])],
    params: {
      modelId: readIdentifier(params, 'modelId', '模型'),
      aspectRatio: readOptionalParam(params, 'aspectRatio', '画幅'),
      resolution: readOptionalParam(params, 'resolution', '分辨率'),
      audioMode,
      audioElements,
      seed,
      negativeList,
      promptExtend,
      // 生成时长只能按镜头组指定，提交请求不携带；镜头组的覆盖在合并参数时补上。
      durationSeconds: null
    }
  };
}
