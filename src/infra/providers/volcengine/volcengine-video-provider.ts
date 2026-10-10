// ------------------------------------------------------------------------
// 名称：volcengine-video-provider.ts
// 说明：火山引擎 Seedance 视频适配器：按模型能力校验请求，把与模型无关的生成请求转换为方舟的视频生成任务，查询并取消任务；用查询不存在的任务来测试连接。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：素材（首帧、尾帧、参考图、参考音频）以 Base64 内联传输，请求体合计不得超过 64 MB；方舟只允许取消排队中的任务，生成中的任务取消会返回平台的错误说明；视频地址 24 小时后过期；水印默认关闭。
// ------------------------------------------------------------------------

import { ProviderError } from '../../../domain/errors';
import { VideoCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor, ProviderDescriptor } from '../../../domain/models/model-provider';
import {
  ProviderCallContext,
  RemoteJobRef,
  RemoteJobState,
  RemoteJobStatus,
  VideoGenerationRequest,
  VideoJobResult,
  VideoModelProvider
} from '../../../domain/ports/provider-adapters';
import { findDescribedModelByCode } from '../shared/provider-model-lookup';
import { ExtraParamSpec, mapExtraParams, readObject, validateExtraParams } from '../shared/provider-payload';
import { VideoMediaRules, VideoParameterRules, validateVideoMediaCombination, validateVideoParameters } from '../shared/video-request-validation';
import { VIDEO_TASK_STATUSES, buildVideoContent } from '../shared/video-task-content';
import { FetchFunction, VolcengineApiClient, classifyArkErrorCode } from './volcengine-api-client';
import { VOLCENGINE_PROVIDER, VOLCENGINE_PROVIDER_NAME } from './volcengine-catalog';
import {
  SEEDANCE_AUDIO_MAX_BYTES,
  SEEDANCE_AUDIO_MIME_TYPES,
  SEEDANCE_IMAGE_MAX_BYTES,
  SEEDANCE_REQUEST_MAX_BYTES,
  VOLCENGINE_VIDEO_MODELS,
  VolcengineVideoModel
} from './volcengine-video-catalog';

/** 视频生成任务的接口路径，后接任务标识用于查询与取消。 */
const TASKS_PATH = '/contents/generations/tasks';

/** 测试连接时查询的任务路径：任务标识不会存在，平台应返回带错误码的业务错误。 */
const CONNECTION_PROBE_PATH = `${TASKS_PATH}/cgt-00000000-0000-0000-0000-000000000000`;

/** 提交视频任务的总超时（毫秒）：素材以 Base64 内联上传，可能接近 64 MB。 */
const SUBMIT_TIMEOUT_MS = 180_000;

/** 任务状态与统一状态的对应：在共有状态之外，方舟的任务可能已过期。 */
const TASK_STATUSES: Readonly<Record<string, RemoteJobStatus>> = { ...VIDEO_TASK_STATUSES, expired: 'expired' };

/** 参数校验规则：时长可不指定（由平台决定），不支持随机种子。 */
const PARAMETER_RULES: VideoParameterRules = { durationRequired: false, seedUnsupported: true };

/** 模型专有参数：键与请求体中键的对应，取值都是开或关。 */
const EXTRA_PARAMETER_SPECS: Readonly<Record<string, ExtraParamSpec>> = {
  watermark: { apiKey: 'watermark', allowed: [true, false] }
};

/** 素材校验规则：提示词与素材至少一项，尾帧必须配首帧；参考音频是否可以单独使用取决于模型。 */
function buildMediaRules(model: VolcengineVideoModel): VideoMediaRules {
  return {
    promptRequired: false,
    lastFrameRequiresFirst: true,
    audioRequiresReferenceImage: !model.audioOnlyReference,
    image: { maxBytes: SEEDANCE_IMAGE_MAX_BYTES, formats: null },
    audio: { maxBytes: SEEDANCE_AUDIO_MAX_BYTES, formats: { mimeTypes: SEEDANCE_AUDIO_MIME_TYPES, label: 'WAV、MP3' } },
    requestMaxBytes: SEEDANCE_REQUEST_MAX_BYTES
  };
}

/** 火山引擎的视频适配器。 */
export class VolcengineVideoProvider implements VideoModelProvider {
  readonly kind = 'video';
  readonly provider: ProviderDescriptor = VOLCENGINE_PROVIDER;
  private readonly client: VolcengineApiClient;

  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   */
  constructor(fetchFunction?: FetchFunction) {
    this.client = new VolcengineApiClient(fetchFunction);
  }

  listModels(): readonly ModelDescriptor<'video'>[] {
    return VOLCENGINE_VIDEO_MODELS.map((model) => model.descriptor);
  }

  getCapability(modelCode: string): VideoCapability | undefined {
    return findDescribedModelByCode(VOLCENGINE_VIDEO_MODELS, modelCode)?.descriptor.capability;
  }

  validate(request: VideoGenerationRequest): readonly string[] {
    const model = findDescribedModelByCode(VOLCENGINE_VIDEO_MODELS, request.modelCode);
    if (model === undefined) {
      return [`${VOLCENGINE_PROVIDER_NAME}没有模型 ${request.modelCode}。`];
    }
    const capability = model.descriptor.capability;
    return [
      ...validateVideoMediaCombination(request, capability, buildMediaRules(model)),
      ...validateVideoParameters(request, capability, PARAMETER_RULES),
      ...validateExtraParams(request.extraParams, EXTRA_PARAMETER_SPECS)
    ];
  }

  async submit(request: VideoGenerationRequest, context: ProviderCallContext): Promise<RemoteJobRef> {
    const issues = this.validate(request);
    if (issues.length > 0) {
      throw new ProviderError('invalid_request', issues.join('；'));
    }
    const response = await this.client.postJson(context, TASKS_PATH, buildRequestBody(request), SUBMIT_TIMEOUT_MS);
    const taskId = response.id;
    if (typeof taskId !== 'string' || taskId === '') {
      throw new ProviderError('server', `${VOLCENGINE_PROVIDER_NAME}没有返回任务标识。`);
    }
    return { modelCode: request.modelCode, remoteJobId: taskId };
  }

  checkConnection(context: ProviderCallContext): Promise<void> {
    return this.client.checkConnection(context, CONNECTION_PROBE_PATH);
  }

  async query(ref: RemoteJobRef, context: ProviderCallContext): Promise<RemoteJobState<VideoJobResult>> {
    const response = await this.client.getJson(context, `${TASKS_PATH}/${encodeURIComponent(ref.remoteJobId)}`);
    const status = typeof response.status === 'string' ? TASK_STATUSES[response.status] : undefined;
    if (status === undefined) {
      throw new ProviderError('server', `${VOLCENGINE_PROVIDER_NAME}返回了无法识别的任务状态：${String(response.status)}。`);
    }
    if (status === 'succeeded') {
      const videoUrl = readObject(response.content).video_url;
      if (typeof videoUrl !== 'string' || videoUrl === '') {
        throw new ProviderError('server', `任务已成功，但${VOLCENGINE_PROVIDER_NAME}没有返回视频地址。`);
      }
      return {
        status,
        result: { videoUrl, durationSeconds: typeof response.duration === 'number' ? response.duration : null },
        errorCategory: null,
        errorCode: null,
        errorMessage: null
      };
    }
    if (status === 'failed') {
      const error = readObject(response.error);
      const code = typeof error.code === 'string' ? error.code : null;
      const message = typeof error.message === 'string' ? error.message : null;
      return { status, result: null, errorCategory: classifyArkErrorCode(code) ?? 'server', errorCode: code, errorMessage: message };
    }
    return { status, result: null, errorCategory: null, errorCode: null, errorMessage: null };
  }

  async cancel(ref: RemoteJobRef, context: ProviderCallContext): Promise<void> {
    await this.client.deleteJson(context, `${TASKS_PATH}/${encodeURIComponent(ref.remoteJobId)}`);
  }
}

/** 构造创建任务的请求体；null 的参数不写入，由平台使用默认值；分辨率用小写，水印默认关闭。 */
function buildRequestBody(request: VideoGenerationRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { model: request.modelCode, content: buildVideoContent(request), watermark: false };
  if (request.resolution !== null) body.resolution = request.resolution.toLowerCase();
  if (request.aspectRatio !== null) body.ratio = request.aspectRatio;
  // 智能时长的取值 -1 与平台一致，直接透传。
  if (request.durationSeconds !== null) body.duration = request.durationSeconds;
  if (request.audioMode !== null) body.generate_audio = request.audioMode === 'native';
  Object.assign(body, mapExtraParams(request.extraParams, EXTRA_PARAMETER_SPECS));
  return body;
}
