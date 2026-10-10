// ------------------------------------------------------------------------
// 名称：audio-request-validation.ts
// 说明：各音频适配器共用的请求校验与音色查找：音频类型、提示词、时长、语言、音色、参考音频是否在模型能力之内，以及按显示名称取音色。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-11
// 备注：参考音频只校验“模型是否支持”；支持参考音频的模型（千问语音）自行追加素材类型、大小等检查。
// ------------------------------------------------------------------------

import { ProviderError } from '../../../domain/errors';
import { AudioCapability } from '../../../domain/models/model-capability';
import { AudioGenerationRequest } from '../../../domain/ports/provider-adapters';

/**
 * 校验音频类型、提示词、时长、语言、音色和参考音频是否在模型能力之内，逐条返回问题。
 * @param request 音频生成请求。
 * @param capability 请求所用模型的音频能力。
 * @returns 问题列表，没有问题时为空。
 */
export function validateAudioContent(request: AudioGenerationRequest, capability: AudioCapability): string[] {
  const issues: string[] = [];
  if (!capability.audioKinds.includes(request.audioKind)) {
    issues.push(`该模型不能生成${request.audioKind}类型的音频，支持：${capability.audioKinds.join('、')}。`);
  }
  if (request.prompt.trim() === '') {
    issues.push('提示词不能为空。');
  }
  if (request.prompt.length > capability.promptMaxLength) {
    issues.push(`提示词不能超过 ${capability.promptMaxLength} 字（当前 ${request.prompt.length} 字）。`);
  }
  if (request.durationSeconds !== null) {
    issues.push('该模型不支持指定时长，时长由内容决定。');
  }
  if (request.language !== null && !capability.languages.includes(request.language)) {
    issues.push(`语言 ${request.language} 不在模型支持的范围内：${capability.languages.join('、')}。`);
  }
  if (request.voice !== null && !capability.voices.includes(request.voice)) {
    issues.push(`该模型不支持预置音色 ${request.voice}。`);
  }
  if (request.referenceAudio !== null && !capability.referenceAudio) {
    issues.push('该模型不支持参考音频。');
  }
  return issues;
}

/**
 * 按显示名称取音色；未指定（null）用默认音色，指定了却不在目录里则报错（校验阶段已拦截）。
 * @param voices 音色目录。
 * @param defaultVoice 未指定音色时使用的默认音色。
 * @param label 音色的显示名称，未指定为 null。
 * @throws ProviderError 音色不在目录里。
 */
export function findVoiceByLabel<TVoice extends { readonly label: string }>(voices: readonly TVoice[], defaultVoice: TVoice, label: string | null): TVoice {
  if (label === null) {
    return defaultVoice;
  }
  const found = voices.find((candidate) => candidate.label === label);
  if (found === undefined) {
    throw new ProviderError('invalid_request', `该模型不支持预置音色 ${label}。`);
  }
  return found;
}
