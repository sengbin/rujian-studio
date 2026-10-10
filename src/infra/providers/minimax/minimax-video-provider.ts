// ------------------------------------------------------------------------
// 名称：minimax-video-provider.ts
// 说明：MiniMax H3 视频适配器：按模型能力校验请求，把与模型无关的生成请求转换为 MiniMax 视频生成任务（文生、首尾帧图生、多模态参考生），查询并取消任务；用查询不存在的任务来测试连接。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：素材（首帧、尾帧、参考图、参考音频）以 Base64 内联传输，请求体合计不得超过 64 MB；首尾帧与参考素材互斥，尾帧可以单独使用；平台只允许取消排队中的任务，生成中的任务取消会返回平台的错误说明；视频地址有时效，需及时下载；水印默认关闭。
// ------------------------------------------------------------------------

import { ProviderError } from '../../../domain/errors';
import { VideoCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor, ProviderDescriptor } from '../../../domain/models/model-provider';
import {
  ProviderCallContext,
  RemoteJobRef,
  RemoteJobState,
  VideoGenerationRequest,
  VideoJobResult,
  VideoModelProvider
} from '../../../domain/ports/provider-adapters';
import { findModelByCode } from '../shared/provider-model-lookup';
import { ExtraParamSpec, mapExtraParams, readObject, validateExtraParams } from '../shared/provider-payload';
import { VIDEO_TASK_STATUSES, buildVideoContent } from '../shared/video-task-content';
import { VideoMediaRules, VideoParameterRules, validateVideoMediaCombination, validateVideoParameters } from '../shared/video-request-validation';
import { FetchFunction, MinimaxApiClient, classifyMinimaxErrorCode } from './minimax-api-client';
import { MINIMAX_PROVIDER, MINIMAX_PROVIDER_NAME } from './minimax-catalog';
import {
  MINIMAX_DEFAULT_VIDEO_RESOLUTION,
  MINIMAX_VIDEO_AUDIO_MAX_BYTES,
  MINIMAX_VIDEO_AUDIO_MIME_TYPES,
  MINIMAX_VIDEO_CREATE_PATH,
  MINIMAX_VIDEO_IMAGE_MAX_BYTES,
  MINIMAX_VIDEO_IMAGE_MIME_TYPES,
  MINIMAX_VIDEO_MODELS,
  MINIMAX_VIDEO_QUERY_PATH,
  MINIMAX_VIDEO_REQUEST_MAX_BYTES
} from './minimax-video-catalog';

/** 测试连接时查询的任务标识：不会存在，平台应返回带错误类型的业务错误。 */
const CONNECTION_PROBE_TASK_ID = '0';

/** 提交视频任务的总超时（毫秒）：素材以 Base64 内联上传，可能接近 64 MB。 */
const SUBMIT_TIMEOUT_MS = 180_000;

/** 画幅取值 adaptive：由输入素材决定，有首帧或尾帧时只能用它。 */
const RATIO_ADAPTIVE = 'adaptive';

/** 素材校验规则：提示词必填，尾帧可以单独使用，首尾帧、参考图与参考音频的格式与大小有限制，并受请求体上限约束。 */
const MEDIA_RULES: VideoMediaRules = {
  promptRequired: true,
  lastFrameRequiresFirst: false,
  audioRequiresReferenceImage: false,
  image: { maxBytes: MINIMAX_VIDEO_IMAGE_MAX_BYTES, formats: { mimeTypes: MINIMAX_VIDEO_IMAGE_MIME_TYPES, label: 'JPG、PNG、WEBP、HEIC、HEIF' } },
  audio: { maxBytes: MINIMAX_VIDEO_AUDIO_MAX_BYTES, formats: { mimeTypes: MINIMAX_VIDEO_AUDIO_MIME_TYPES, label: 'WAV、MP3' } },
  requestMaxBytes: MINIMAX_VIDEO_REQUEST_MAX_BYTES
};

/** 参数校验规则：时长必填，视频始终带原生声音，不支持随机种子。 */
const PARAMETER_RULES: VideoParameterRules = {
  durationRequired: true,
  audioModeMessage: '该模型的视频始终带原生声音，不支持所选的声音模式。',
  seedUnsupported: true
};

/** 模型专有参数：键与请求体中键的对应，取值都是开或关。 */
const EXTRA_PARAMETER_SPECS: Readonly<Record<string, ExtraParamSpec>> = {
  watermark: { apiKey: 'aigc_watermark', allowed: [true, false] }
};

/** MiniMax 的视频适配器。 */
export class MinimaxVideoProvider implements VideoModelProvider {
  readonly kind = 'video';
  readonly provider: ProviderDescriptor = MINIMAX_PROVIDER;
  private readonly client: MinimaxApiClient;

  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   */
  constructor(fetchFunction?: FetchFunction) {
    this.client = new MinimaxApiClient(fetchFunction);
  }

  listModels(): readonly ModelDescriptor<'video'>[] {
    return MINIMAX_VIDEO_MODELS;
  }

  getCapability(modelCode: string): VideoCapability | undefined {
    return findModelByCode(MINIMAX_VIDEO_MODELS, modelCode)?.capability;
  }

  validate(request: VideoGenerationRequest): readonly string[] {
    const model = findModelByCode(MINIMAX_VIDEO_MODELS, request.modelCode);
    if (model === undefined) {
      return [`${MINIMAX_PROVIDER_NAME}没有模型 ${request.modelCode}。`];
    }
    return [
      ...validateVideoMediaCombination(request, model.capability, MEDIA_RULES),
      ...validateParameters(request, model.capability),
      ...validateExtraParams(request.extraParams, EXTRA_PARAMETER_SPECS)
    ];
  }

  async submit(request: VideoGenerationRequest, context: ProviderCallContext): Promise<RemoteJobRef> {
    const issues = this.validate(request);
    if (issues.length > 0) {
      throw new ProviderError('invalid_request', issues.join('；'));
    }
    const response = await this.client.postJson(context, MINIMAX_VIDEO_CREATE_PATH, buildRequestBody(request), SUBMIT_TIMEOUT_MS);
    const taskId = response.task_id;
    if (typeof taskId !== 'string' || taskId === '') {
      throw new ProviderError('server', `${MINIMAX_PROVIDER_NAME}没有返回任务标识。`);
    }
    return { modelCode: request.modelCode, remoteJobId: taskId };
  }

  checkConnection(context: ProviderCallContext): Promise<void> {
    return this.client.checkConnection(context, `${MINIMAX_VIDEO_QUERY_PATH}/${CONNECTION_PROBE_TASK_ID}`);
  }

  async query(ref: RemoteJobRef, context: ProviderCallContext): Promise<RemoteJobState<VideoJobResult>> {
    const response = await this.client.getJson(context, `${MINIMAX_VIDEO_QUERY_PATH}/${encodeURIComponent(ref.remoteJobId)}`);
    const task = readObject(response.task);
    const status = typeof task.status === 'string' ? VIDEO_TASK_STATUSES[task.status] : undefined;
    if (status === undefined) {
      throw new ProviderError('server', `${MINIMAX_PROVIDER_NAME}返回了无法识别的任务状态：${String(task.status)}。`);
    }
    if (status === 'succeeded') {
      const videoUrl = readObject(task.content).url;
      if (typeof videoUrl !== 'string' || videoUrl === '') {
        throw new ProviderError('server', `任务已成功，但${MINIMAX_PROVIDER_NAME}没有返回视频地址。`);
      }
      return {
        status,
        result: { videoUrl, durationSeconds: typeof task.duration === 'number' ? task.duration : null },
        errorCategory: null,
        errorCode: null,
        errorMessage: null
      };
    }
    if (status === 'failed') {
      const error = readObject(task.error);
      const code = typeof error.code === 'string' && error.code !== '' ? error.code : null;
      const message = typeof error.message === 'string' ? error.message : null;
      return { status, result: null, errorCategory: classifyMinimaxErrorCode(code) ?? 'server', errorCode: code, errorMessage: message };
    }
    return { status, result: null, errorCategory: null, errorCode: null, errorMessage: null };
  }

  async cancel(ref: RemoteJobRef, context: ProviderCallContext): Promise<void> {
    await this.client.deleteJson(context, `${MINIMAX_VIDEO_CREATE_PATH}/${encodeURIComponent(ref.remoteJobId)}`);
  }
}

/** 校验参数是否在模型能力范围内；时长必填，没有首尾帧和参考素材时画幅必填。 */
function validateParameters(request: VideoGenerationRequest, capability: VideoCapability): string[] {
  const issues = validateVideoParameters(request, capability, PARAMETER_RULES);
  if (request.aspectRatio === null && request.firstFrame === null && request.lastFrame === null && request.referenceImages.length === 0 && request.referenceAudios.length === 0) {
    issues.push('纯文字生成视频必须指定画幅。');
  }
  return issues;
}

/** 构造创建任务的请求体：分辨率没指定时用默认档位，画幅在有首尾帧或没指定时用 adaptive；水印默认关闭。 */
function buildRequestBody(request: VideoGenerationRequest): Record<string, unknown> {
  const hasFrames = request.firstFrame !== null || request.lastFrame !== null;
  const body: Record<string, unknown> = {
    model: request.modelCode,
    content: buildVideoContent(request),
    resolution: request.resolution ?? MINIMAX_DEFAULT_VIDEO_RESOLUTION,
    duration: request.durationSeconds,
    ratio: hasFrames ? RATIO_ADAPTIVE : (request.aspectRatio ?? RATIO_ADAPTIVE),
    aigc_watermark: false
  };
  Object.assign(body, mapExtraParams(request.extraParams, EXTRA_PARAMETER_SPECS));
  return body;
}
