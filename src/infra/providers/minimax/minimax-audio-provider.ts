// ------------------------------------------------------------------------
// 名称：minimax-audio-provider.ts
// 说明：MiniMax 语音适配器：按模型能力校验请求，调用同步语音合成接口把文字合成为语音，并以任务引用的形式交回结果。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：接口是同步的：submit 内完成合成，结果（音频地址与时长）编码进 remoteJobId，query 解码后直接返回成功；请求用 url 输出方式，音频地址 24 小时有效，平台若返回 hex 音频数据则转成 data 地址；说话方式换算为语速、音量（平台没有语音指令，情绪由模型按文字自动匹配）；使用 HTTP Bearer 密钥，与其他类型共用同一份访问密钥。
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
import { readDeliveryRates } from '../../../domain/rules/voice-delivery-rules';
import { readObject, validateExtraParams } from '../shared/provider-payload';
import { FetchFunction, MinimaxApiClient } from './minimax-api-client';
import {
  MINIMAX_AUDIO_MODELS,
  MINIMAX_LANGUAGE_BOOSTS,
  MINIMAX_SPEECH_BITRATE,
  MINIMAX_SPEECH_CHANNEL,
  MINIMAX_SPEECH_FORMAT,
  MINIMAX_SPEECH_MIME_TYPE,
  MINIMAX_SPEECH_PATH,
  MINIMAX_SPEECH_SAMPLE_RATE,
  MINIMAX_VOICES
} from './minimax-audio-catalog';
import { MINIMAX_PROVIDER, MINIMAX_PROVIDER_NAME } from './minimax-catalog';

/** 单次语音合成请求的总超时（毫秒）：同步合成较长文字时比普通请求久。 */
const SPEECH_REQUEST_TIMEOUT_MS = 120_000;

/** 语速、音量的基准值与调整值的换算：调整值（-50 到 100，百分比）按 1 + 调整值 / 100 换算，落在平台允许的 0.5 到 2 之内。 */
const RATE_BASE = 1;
const RATE_PERCENT_DIVISOR = 100;

/** 毫秒与秒的换算。 */
const MS_PER_SECOND = 1000;

/** MiniMax 的音频适配器。 */
export class MinimaxAudioProvider implements AudioModelProvider {
  readonly kind = 'audio';
  readonly provider: ProviderDescriptor = MINIMAX_PROVIDER;
  private readonly client: MinimaxApiClient;

  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   */
  constructor(fetchFunction?: FetchFunction) {
    this.client = new MinimaxApiClient(fetchFunction);
  }

  listModels(): readonly ModelDescriptor<'audio'>[] {
    return MINIMAX_AUDIO_MODELS;
  }

  getCapability(modelCode: string): AudioCapability | undefined {
    return findModel(modelCode)?.capability;
  }

  validate(request: AudioGenerationRequest): readonly string[] {
    const capability = this.getCapability(request.modelCode);
    if (capability === undefined) {
      return [`${MINIMAX_PROVIDER_NAME}没有模型 ${request.modelCode}。`];
    }
    return [...validateContent(request, capability), ...validateExtraParams(request.extraParams, {})];
  }

  async submit(request: AudioGenerationRequest, context: ProviderCallContext): Promise<RemoteJobRef> {
    const issues = this.validate(request);
    if (issues.length > 0) {
      throw new ProviderError('invalid_request', issues.join('；'));
    }
    const response = await this.client.postJson(context, MINIMAX_SPEECH_PATH, buildRequestBody(request), SPEECH_REQUEST_TIMEOUT_MS);
    return { modelCode: request.modelCode, remoteJobId: JSON.stringify(readAudioResult(response)) };
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
  return MINIMAX_AUDIO_MODELS.find((model) => model.code === modelCode);
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

/** 构造请求体：音色按显示名称换算成平台的音色标识，未指定时用第一个音色；说话方式换算为语速与音量；返回音频地址。 */
function buildRequestBody(request: AudioGenerationRequest): Record<string, unknown> {
  const voice = MINIMAX_VOICES.find((candidate) => candidate.label === request.voice) ?? MINIMAX_VOICES[0];
  const { speechRate, loudnessRate } = readDeliveryRates(request.delivery ?? '');
  const body: Record<string, unknown> = {
    model: request.modelCode,
    text: request.prompt,
    stream: false,
    output_format: 'url',
    voice_setting: {
      voice_id: voice.voiceId,
      speed: RATE_BASE + speechRate / RATE_PERCENT_DIVISOR,
      vol: RATE_BASE + loudnessRate / RATE_PERCENT_DIVISOR
    },
    audio_setting: {
      sample_rate: MINIMAX_SPEECH_SAMPLE_RATE,
      bitrate: MINIMAX_SPEECH_BITRATE,
      format: MINIMAX_SPEECH_FORMAT,
      channel: MINIMAX_SPEECH_CHANNEL
    }
  };
  if (request.language !== null) body.language_boost = MINIMAX_LANGUAGE_BOOSTS[request.language];
  return body;
}

/** 从响应里取出音频：地址原样返回，hex 数据转成 data 地址；时长取自 extra_info.audio_length（毫秒）。 */
function readAudioResult(response: Record<string, unknown>): AudioJobResult {
  const audio = readObject(response.data).audio;
  if (typeof audio !== 'string' || audio === '') {
    throw new ProviderError('server', `${MINIMAX_PROVIDER_NAME}没有返回音频。`);
  }
  const audioUrl = audio.startsWith('https://') ? audio : `data:${MINIMAX_SPEECH_MIME_TYPE};base64,${Buffer.from(audio, 'hex').toString('base64')}`;
  const lengthMs = readObject(response.extra_info).audio_length;
  return { audioUrl, durationSeconds: typeof lengthMs === 'number' ? lengthMs / MS_PER_SECOND : null };
}

/** 解析 JSON；不合法时返回 undefined，由调用方按任务引用损坏处理。 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
