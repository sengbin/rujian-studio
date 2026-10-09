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

/** 素材在请求中的角色（content[].role）。 */
const ROLE_FIRST_FRAME = 'first_frame';
const ROLE_LAST_FRAME = 'last_frame';
const ROLE_REFERENCE_IMAGE = 'reference_image';
const ROLE_REFERENCE_AUDIO = 'reference_audio';

/** 画幅取值 adaptive：由输入素材决定，有首帧或尾帧时只能用它。 */
const RATIO_ADAPTIVE = 'adaptive';

/** Base64 编码后体积约为原文件的 4/3。 */
const BASE64_EXPANSION = 4 / 3;

/** 任务状态与统一状态的对应。 */
const TASK_STATUSES: Readonly<Record<string, RemoteJobStatus>> = {
  queued: 'pending',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'canceled'
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
    return findModel(modelCode)?.capability;
  }

  validate(request: VideoGenerationRequest): readonly string[] {
    const model = findModel(request.modelCode);
    if (model === undefined) {
      return [`${MINIMAX_PROVIDER_NAME}没有模型 ${request.modelCode}。`];
    }
    return [
      ...validateMediaCombination(request, model.capability),
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
    const status = typeof task.status === 'string' ? TASK_STATUSES[task.status] : undefined;
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

function findModel(modelCode: string): ModelDescriptor<'video'> | undefined {
  return MINIMAX_VIDEO_MODELS.find((model) => model.code === modelCode);
}

/** 校验素材组合与素材本身：提示词必填、首尾帧与参考素材互斥、数量、格式与大小。 */
function validateMediaCombination(request: VideoGenerationRequest, capability: VideoCapability): string[] {
  const issues: string[] = [];
  const hasFrames = request.firstFrame !== null || request.lastFrame !== null;
  const hasReferences = request.referenceImages.length > 0 || request.referenceAudios.length > 0;

  if (request.prompt.trim() === '') {
    issues.push('提示词不能为空，该模型每次请求都必须有文字描述。');
  }
  if (request.prompt.length > capability.promptMaxLength) {
    issues.push(`提示词不能超过 ${capability.promptMaxLength} 字（当前 ${request.prompt.length} 字）。`);
  }
  if (hasFrames && hasReferences) {
    issues.push('首帧、尾帧不能与参考图、参考音频同时使用。');
  }

  const images = [request.firstFrame, request.lastFrame, ...request.referenceImages].filter((media): media is MediaInput => media !== null);
  issues.push(...validateMediaFiles(images, 'image/', '图片', MINIMAX_VIDEO_IMAGE_MAX_BYTES));
  if (images.some((image) => image.mimeType.startsWith('image/') && !MINIMAX_VIDEO_IMAGE_MIME_TYPES.includes(image.mimeType))) {
    issues.push('图片素材只支持 JPG、PNG、WEBP、HEIC、HEIF 格式。');
  }
  if (request.referenceImages.length > capability.referenceImagesMax) {
    issues.push(`参考图最多 ${capability.referenceImagesMax} 张（当前 ${request.referenceImages.length} 张）。`);
  }

  issues.push(...validateReferenceAudios(request, capability));

  const inlineBytes = [...images, ...request.referenceAudios].reduce((total, media) => total + media.data.byteLength, 0);
  if (inlineBytes * BASE64_EXPANSION > MINIMAX_VIDEO_REQUEST_MAX_BYTES) {
    issues.push(`素材合计超过请求体上限 ${MINIMAX_VIDEO_REQUEST_MAX_BYTES / 1024 / 1024} MB，请减少或压缩素材。`);
  }
  return issues;
}

/** 校验参考音频：数量、格式、大小。 */
function validateReferenceAudios(request: VideoGenerationRequest, capability: VideoCapability): string[] {
  const audios = request.referenceAudios;
  const limit = capability.audioInputMax;
  if (audios.length === 0) {
    return [];
  }
  if (limit === null) {
    return ['该模型不支持参考音频。'];
  }
  const issues = validateMediaFiles(audios, 'audio/', '音频', MINIMAX_VIDEO_AUDIO_MAX_BYTES);
  if (audios.some((audio) => !MINIMAX_VIDEO_AUDIO_MIME_TYPES.includes(audio.mimeType))) {
    issues.push('参考音频只支持 WAV、MP3 格式。');
  }
  if (audios.length > limit.count) {
    issues.push(`参考音频最多 ${limit.count} 段（当前 ${audios.length} 段）。`);
  }
  return issues;
}

/** 校验画幅、分辨率、时长、声音模式和随机种子是否在模型能力范围内；时长必填，没有首尾帧和参考素材时画幅必填。 */
function validateParameters(request: VideoGenerationRequest, capability: VideoCapability): string[] {
  const issues: string[] = [];
  if (request.aspectRatio !== null && !capability.aspectRatios.includes(request.aspectRatio)) {
    issues.push(`画幅 ${request.aspectRatio} 不在模型支持的范围内：${capability.aspectRatios.join('、')}。`);
  }
  if (request.resolution !== null && !capability.resolutions.includes(request.resolution)) {
    issues.push(`分辨率 ${request.resolution} 不在模型支持的范围内：${capability.resolutions.join('、')}。`);
  }
  if (request.durationSeconds === null) {
    issues.push('该模型必须指定视频时长。');
  } else if (!isDurationAllowed(capability.duration, request.durationSeconds)) {
    issues.push(`时长 ${request.durationSeconds} 秒不在模型支持的范围内。`);
  }
  if (request.audioMode !== null && !capability.audioModes.includes(request.audioMode)) {
    issues.push('该模型的视频始终带原生声音，不支持所选的声音模式。');
  }
  if (request.seed !== null) {
    issues.push('该模型不支持随机种子。');
  }
  if (request.aspectRatio === null && request.firstFrame === null && request.lastFrame === null && request.referenceImages.length === 0 && request.referenceAudios.length === 0) {
    issues.push('纯文字生成视频必须指定画幅。');
  }
  return issues;
}

/** 按素材组合构造 content：文本在前，素材按角色标注；首尾帧与参考素材已由校验保证互斥。 */
function buildContent(request: VideoGenerationRequest): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: request.prompt }];
  const image = (media: MediaInput, role: string): Record<string, unknown> => ({ type: 'image_url', image_url: { url: toDataUri(media) }, role });
  if (request.firstFrame !== null) content.push(image(request.firstFrame, ROLE_FIRST_FRAME));
  if (request.lastFrame !== null) content.push(image(request.lastFrame, ROLE_LAST_FRAME));
  for (const reference of request.referenceImages) content.push(image(reference, ROLE_REFERENCE_IMAGE));
  for (const audio of request.referenceAudios) content.push({ type: 'audio_url', audio_url: { url: toDataUri(audio) }, role: ROLE_REFERENCE_AUDIO });
  return content;
}

/** 构造创建任务的请求体：分辨率没指定时用默认档位，画幅在有首尾帧或没指定时用 adaptive；水印默认关闭。 */
function buildRequestBody(request: VideoGenerationRequest): Record<string, unknown> {
  const hasFrames = request.firstFrame !== null || request.lastFrame !== null;
  const body: Record<string, unknown> = {
    model: request.modelCode,
    content: buildContent(request),
    resolution: request.resolution ?? MINIMAX_DEFAULT_VIDEO_RESOLUTION,
    duration: request.durationSeconds,
    ratio: hasFrames ? RATIO_ADAPTIVE : (request.aspectRatio ?? RATIO_ADAPTIVE),
    aigc_watermark: false
  };
  Object.assign(body, mapExtraParams(request.extraParams, EXTRA_PARAMETER_SPECS));
  return body;
}
