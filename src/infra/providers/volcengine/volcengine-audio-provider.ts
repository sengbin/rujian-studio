// ------------------------------------------------------------------------
// 名称：volcengine-audio-provider.ts
// 说明：豆包语音音频适配器：按模型能力校验请求，调用豆包语音合成把文字合成为语音，并以任务引用的形式交回结果。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：语音合成接口是同步的且直接返回音频内容（没有下载地址）：submit 内完成合成，音频以 data 地址编码进 remoteJobId，query 解码后直接返回成功；豆包语音是独立于方舟的服务商，有自己的接口地址与访问密钥；它没有免费的探测接口，因此测试连接用一段极短文字真实合成一次（会产生极少量计费）。
// ------------------------------------------------------------------------

import { ProviderError } from '../../../domain/errors';
import { AudioCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor, ProviderDescriptor } from '../../../domain/models/model-provider';
import {
  AudioGenerationRequest,
  AudioJobResult,
  AudioModelProvider,
  ProviderCallContext,
  RemoteJobRef,
  RemoteJobState
} from '../../../domain/ports/provider-adapters';
import { buildDeliveryInstruction, readDeliveryRates } from '../../../domain/rules/voice-delivery-rules';
import { readObject, validateExtraParams } from '../shared/provider-payload';
import { FetchFunction } from './volcengine-api-client';
import {
  VOLCENGINE_AUDIO_MODELS,
  VOLCENGINE_SPEECH_FORMAT,
  VOLCENGINE_SPEECH_MIME_TYPE,
  VOLCENGINE_SPEECH_RESOURCE_ID,
  VOLCENGINE_SPEECH_SAMPLE_RATE,
  VOLCENGINE_VOICES
} from './volcengine-audio-catalog';
import { VOLCENGINE_SPEECH_PROVIDER, VOLCENGINE_SPEECH_PROVIDER_NAME } from './volcengine-catalog';
import { VolcengineSpeechClient } from './volcengine-speech-client';

/** 测试连接时合成的文字：尽量短，把计费降到最低。 */
const CONNECTION_PROBE_TEXT = '你好';

/** 豆包语音的音频适配器。 */
export class VolcengineAudioProvider implements AudioModelProvider {
  readonly kind = 'audio';
  readonly provider: ProviderDescriptor = VOLCENGINE_SPEECH_PROVIDER;
  private readonly client: VolcengineSpeechClient;

  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   */
  constructor(fetchFunction?: FetchFunction) {
    this.client = new VolcengineSpeechClient(fetchFunction);
  }

  listModels(): readonly ModelDescriptor<'audio'>[] {
    return VOLCENGINE_AUDIO_MODELS;
  }

  getCapability(modelCode: string): AudioCapability | undefined {
    return findModel(modelCode)?.capability;
  }

  validate(request: AudioGenerationRequest): readonly string[] {
    const capability = this.getCapability(request.modelCode);
    if (capability === undefined) {
      return [`${VOLCENGINE_SPEECH_PROVIDER_NAME}没有模型 ${request.modelCode}。`];
    }
    return [...validateContent(request, capability), ...validateExtraParams(request.extraParams, {})];
  }

  async submit(request: AudioGenerationRequest, context: ProviderCallContext): Promise<RemoteJobRef> {
    const issues = this.validate(request);
    if (issues.length > 0) {
      throw new ProviderError('invalid_request', issues.join('；'));
    }
    const audio = await this.client.synthesize(context, VOLCENGINE_SPEECH_RESOURCE_ID, buildRequestBody(request.prompt, request.voice, request.delivery ?? ''));
    const result: AudioJobResult = { audioUrl: `data:${VOLCENGINE_SPEECH_MIME_TYPE};base64,${audio.toString('base64')}`, durationSeconds: null };
    return { modelCode: request.modelCode, remoteJobId: JSON.stringify(result) };
  }

  async checkConnection(context: ProviderCallContext): Promise<void> {
    await this.client.synthesize(context, VOLCENGINE_SPEECH_RESOURCE_ID, buildRequestBody(CONNECTION_PROBE_TEXT, null, ''));
  }

  async query(ref: RemoteJobRef): Promise<RemoteJobState<AudioJobResult>> {
    const audio = readObject(parseJson(ref.remoteJobId));
    if (typeof audio.audioUrl !== 'string' || audio.audioUrl === '') {
      throw new ProviderError('invalid_request', '音频任务引用已损坏，无法取得音频内容。');
    }
    const durationSeconds = typeof audio.durationSeconds === 'number' ? audio.durationSeconds : null;
    return { status: 'succeeded', result: { audioUrl: audio.audioUrl, durationSeconds }, errorCategory: null, errorCode: null, errorMessage: null };
  }
}

function findModel(modelCode: string): ModelDescriptor<'audio'> | undefined {
  return VOLCENGINE_AUDIO_MODELS.find((model) => model.code === modelCode);
}

/** 校验音频类型、要朗读的文字、语言、音色、时长和参考音频。 */
function validateContent(request: AudioGenerationRequest, capability: AudioCapability): string[] {
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
  if (request.referenceAudio !== null) {
    issues.push('该模型不支持参考音频。');
  }
  return issues;
}

/** 构造请求体：音色按显示名称换算成平台的音色标识，未指定时用第一个音色；说话方式换成语音指令（情绪、语气）与语速、音量数值。 */
function buildRequestBody(text: string, voiceLabel: string | null, delivery: string): Record<string, unknown> {
  const voice = VOLCENGINE_VOICES.find((candidate) => candidate.label === voiceLabel) ?? VOLCENGINE_VOICES[0];
  const { speechRate, loudnessRate } = readDeliveryRates(delivery);
  const instruction = buildDeliveryInstruction(delivery);
  return {
    req_params: {
      text,
      speaker: voice.speaker,
      audio_params: {
        format: VOLCENGINE_SPEECH_FORMAT,
        sample_rate: VOLCENGINE_SPEECH_SAMPLE_RATE,
        ...(speechRate === 0 ? {} : { speech_rate: speechRate }),
        ...(loudnessRate === 0 ? {} : { loudness_rate: loudnessRate })
      },
      // additions 要求是 JSON 字符串
      ...(instruction === null ? {} : { additions: JSON.stringify({ context_texts: [instruction] }) })
    }
  };
}

/** 解析 JSON；不合法时返回 undefined，由调用方按任务引用损坏处理。 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
