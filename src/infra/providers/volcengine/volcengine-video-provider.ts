// ------------------------------------------------------------------------
// 名称：volcengine-video-provider.ts
// 说明：火山引擎 Seedance 视频适配器：按模型能力校验请求，把与模型无关的生成请求转换为方舟的视频生成任务，查询并取消任务；用查询不存在的任务来测试连接。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：素材（首帧、尾帧、参考图、参考音频）以 Base64 内联传输，请求体合计不得超过 64 MB；方舟只允许取消排队中的任务，生成中的任务取消会返回平台的错误说明；视频地址 24 小时后过期；水印默认关闭。
// ------------------------------------------------------------------------

import { ProviderError } from '../../../domain/errors';
import { VideoCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor, ProviderDescriptor } from '../../../domain/models/model-provider';
import {
  MediaInput,
  ProviderCallContext,
  RemoteJobRef,
  RemoteJobState,
  RemoteJobStatus,
  VideoGenerationRequest,
  VideoJobResult,
  VideoModelProvider
} from '../../../domain/ports/provider-adapters';
import { isDurationAllowed } from '../../../domain/rules/model-capability-rules';
import { ExtraParamSpec, mapExtraParams, readObject, toDataUri, validateExtraParams, validateMediaFiles } from '../shared/provider-payload';
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

/** 素材在请求中的角色（content[].role）。 */
const ROLE_FIRST_FRAME = 'first_frame';
const ROLE_LAST_FRAME = 'last_frame';
const ROLE_REFERENCE_IMAGE = 'reference_image';
const ROLE_REFERENCE_AUDIO = 'reference_audio';

/** Base64 编码后体积约为原文件的 4/3。 */
const BASE64_EXPANSION = 4 / 3;

/** 任务状态与统一状态的对应。 */
const TASK_STATUSES: Readonly<Record<string, RemoteJobStatus>> = {
  queued: 'pending',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'canceled',
  expired: 'expired'
};

/** 模型专有参数：键与请求体中键的对应，取值都是开或关。 */
const EXTRA_PARAMETER_SPECS: Readonly<Record<string, ExtraParamSpec>> = {
  watermark: { apiKey: 'watermark', allowed: [true, false] }
};

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
    return findModel(modelCode)?.descriptor.capability;
  }

  validate(request: VideoGenerationRequest): readonly string[] {
    const model = findModel(request.modelCode);
    if (model === undefined) {
      return [`${VOLCENGINE_PROVIDER_NAME}没有模型 ${request.modelCode}。`];
    }
    return [
      ...validateMediaCombination(request, model),
      ...validateParameters(request, model.descriptor.capability),
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

function findModel(modelCode: string): VolcengineVideoModel | undefined {
  return VOLCENGINE_VIDEO_MODELS.find((model) => model.descriptor.code === modelCode);
}

/** 校验素材组合与素材本身：首尾帧与参考素材互斥、尾帧必须配首帧、数量、格式与大小。 */
function validateMediaCombination(request: VideoGenerationRequest, model: VolcengineVideoModel): string[] {
  const issues: string[] = [];
  const capability = model.descriptor.capability;
  const hasFrames = request.firstFrame !== null || request.lastFrame !== null;
  const hasReferences = request.referenceImages.length > 0 || request.referenceAudios.length > 0;

  if (request.prompt.trim() === '' && !hasFrames && !hasReferences) {
    issues.push('提示词和素材至少要提供一项。');
  }
  if (request.prompt.length > capability.promptMaxLength) {
    issues.push(`提示词不能超过 ${capability.promptMaxLength} 字（当前 ${request.prompt.length} 字）。`);
  }
  if (request.lastFrame !== null && request.firstFrame === null) {
    issues.push('指定尾帧时必须同时指定首帧。');
  }
  if (hasFrames && hasReferences) {
    issues.push('首帧、尾帧不能与参考图、参考音频同时使用。');
  }
  if (request.firstFrame !== null && !capability.firstFrame) {
    issues.push('该模型不支持首帧。');
  }
  if (request.lastFrame !== null && !capability.lastFrame) {
    issues.push('该模型不支持尾帧。');
  }

  const frames = [request.firstFrame, request.lastFrame, ...request.referenceImages].filter((media): media is MediaInput => media !== null);
  issues.push(...validateMediaFiles(frames, 'image/', '图片', SEEDANCE_IMAGE_MAX_BYTES));
  if (request.referenceImages.length > capability.referenceImagesMax) {
    issues.push(`参考图最多 ${capability.referenceImagesMax} 张（当前 ${request.referenceImages.length} 张）。`);
  }

  issues.push(...validateReferenceAudios(request, model));

  const inlineBytes = [...frames, ...request.referenceAudios].reduce((total, media) => total + media.data.byteLength, 0);
  if (inlineBytes * BASE64_EXPANSION > SEEDANCE_REQUEST_MAX_BYTES) {
    issues.push(`素材合计超过请求体上限 ${SEEDANCE_REQUEST_MAX_BYTES / 1024 / 1024} MB，请减少或压缩素材。`);
  }
  return issues;
}

/** 校验参考音频：数量、格式、大小，以及 Seedance 2.0 系列不能只传音频。 */
function validateReferenceAudios(request: VideoGenerationRequest, model: VolcengineVideoModel): string[] {
  const audios = request.referenceAudios;
  const limit = model.descriptor.capability.audioInputMax;
  if (audios.length === 0) {
    return [];
  }
  if (limit === null) {
    return ['该模型不支持参考音频。'];
  }
  const issues = validateMediaFiles(audios, 'audio/', '音频', SEEDANCE_AUDIO_MAX_BYTES);
  if (audios.some((audio) => !SEEDANCE_AUDIO_MIME_TYPES.includes(audio.mimeType))) {
    issues.push('参考音频只支持 WAV、MP3 格式。');
  }
  if (audios.length > limit.count) {
    issues.push(`参考音频最多 ${limit.count} 段（当前 ${audios.length} 段）。`);
  }
  if (!model.audioOnlyReference && request.referenceImages.length === 0) {
    issues.push('该模型不能只传参考音频，请同时绑定角色或场景的参考图。');
  }
  return issues;
}

/** 校验画幅、分辨率、时长、声音模式和随机种子是否在模型能力范围内。 */
function validateParameters(request: VideoGenerationRequest, capability: VideoCapability): string[] {
  const issues: string[] = [];
  if (request.aspectRatio !== null && !capability.aspectRatios.includes(request.aspectRatio)) {
    issues.push(`画幅 ${request.aspectRatio} 不在模型支持的范围内：${capability.aspectRatios.join('、')}。`);
  }
  if (request.resolution !== null && !capability.resolutions.includes(request.resolution)) {
    issues.push(`分辨率 ${request.resolution} 不在模型支持的范围内：${capability.resolutions.join('、')}。`);
  }
  if (request.durationSeconds !== null && !isDurationAllowed(capability.duration, request.durationSeconds)) {
    issues.push(`时长 ${request.durationSeconds} 秒不在模型支持的范围内。`);
  }
  if (request.audioMode !== null && !capability.audioModes.includes(request.audioMode)) {
    issues.push('该模型不支持所选的声音模式。');
  }
  if (request.seed !== null) {
    issues.push('该模型不支持随机种子。');
  }
  return issues;
}

/** 按素材组合构造 content：文本在前，素材按角色标注；首尾帧与参考素材已由校验保证互斥。 */
function buildContent(request: VideoGenerationRequest): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  if (request.prompt.trim() !== '') content.push({ type: 'text', text: request.prompt });
  const image = (media: MediaInput, role: string): Record<string, unknown> => ({ type: 'image_url', image_url: { url: toDataUri(media) }, role });
  if (request.firstFrame !== null) content.push(image(request.firstFrame, ROLE_FIRST_FRAME));
  if (request.lastFrame !== null) content.push(image(request.lastFrame, ROLE_LAST_FRAME));
  for (const reference of request.referenceImages) content.push(image(reference, ROLE_REFERENCE_IMAGE));
  for (const audio of request.referenceAudios) content.push({ type: 'audio_url', audio_url: { url: toDataUri(audio) }, role: ROLE_REFERENCE_AUDIO });
  return content;
}

/** 构造创建任务的请求体；null 的参数不写入，由平台使用默认值；分辨率用小写，水印默认关闭。 */
function buildRequestBody(request: VideoGenerationRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { model: request.modelCode, content: buildContent(request), watermark: false };
  if (request.resolution !== null) body.resolution = request.resolution.toLowerCase();
  if (request.aspectRatio !== null) body.ratio = request.aspectRatio;
  // 智能时长的取值 -1 与平台一致，直接透传。
  if (request.durationSeconds !== null) body.duration = request.durationSeconds;
  if (request.audioMode !== null) body.generate_audio = request.audioMode === 'native';
  Object.assign(body, mapExtraParams(request.extraParams, EXTRA_PARAMETER_SPECS));
  return body;
}
