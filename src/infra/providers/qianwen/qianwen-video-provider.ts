// ------------------------------------------------------------------------
// 名称：qianwen-video-provider.ts
// 说明：千问AI平台万相 3.0 视频适配器：按模型能力校验请求，把与模型无关的生成请求转换为 video-synthesis 异步任务，并查询任务状态；用查询不存在的任务来测试连接。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：素材（首帧、尾帧、参考图、参考音频）以 Base64 内联传输；平台文档未提供取消接口，因此不实现 cancel；结果视频地址 24 小时后过期。
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
import { ExtraParamSpec, mapExtraParams, readObject, toDataUri, validateExtraParams } from '../shared/provider-payload';
import { VideoMediaRules, VideoParameterRules, validateVideoMediaCombination, validateVideoParameters } from '../shared/video-request-validation';
import { FetchFunction, QianwenApiClient } from './qianwen-api-client';
import { QIANWEN_PROVIDER, QIANWEN_VIDEO_MODELS, WAN3_AUDIO_MAX_BYTES, WAN3_IMAGE_MAX_BYTES, WAN3_SEED_MAX } from './qianwen-catalog';
import { ASYNC_HEADERS, CONNECTION_PROBE_PATH, QUERY_TASK_PATH, buildTaskState, readTaskId } from './qianwen-protocol';

/** 创建任务的接口路径。 */
const CREATE_TASK_PATH = '/services/aigc/video-generation/video-synthesis';

/** 提交视频任务的总超时（毫秒）：素材以 Base64 内联上传，与 MiniMax、火山方舟的视频提交一致取 180 秒，高于普通请求的 60 秒。 */
const SUBMIT_TIMEOUT_MS = 180_000;

/** 素材类型（请求体 input.media[].type）。 */
const MEDIA_TYPE_FIRST_FRAME = 'first_frame';
const MEDIA_TYPE_LAST_FRAME = 'last_frame';
const MEDIA_TYPE_REFERENCE_IMAGE = 'reference_image';
const MEDIA_TYPE_REFERENCE_AUDIO = 'reference_audio';

/** 素材校验规则：提示词与素材至少一项，尾帧必须配首帧；只校验素材大类与单个文件大小，不限定具体格式，也不校验请求体合计大小。 */
const MEDIA_RULES: VideoMediaRules = {
  promptRequired: false,
  lastFrameRequiresFirst: true,
  audioRequiresReferenceImage: false,
  image: { maxBytes: WAN3_IMAGE_MAX_BYTES, formats: null },
  audio: { maxBytes: WAN3_AUDIO_MAX_BYTES, formats: null },
  requestMaxBytes: null
};

/** 参数校验规则：时长可不指定（由平台决定）；随机种子有取值范围，由本文件自行校验。 */
const PARAMETER_RULES: VideoParameterRules = { durationRequired: false, seedUnsupported: false };

/** 模型专有参数：键与请求体 parameters 中键的对应，取值都是开或关。 */
const EXTRA_PARAMETER_SPECS: Readonly<Record<string, ExtraParamSpec>> = {
  promptExtend: { apiKey: 'prompt_extend', allowed: [true, false] },
  watermark: { apiKey: 'watermark', allowed: [true, false] }
};

/** 千问AI平台的视频适配器。 */
export class QianwenVideoProvider implements VideoModelProvider {
  readonly kind = 'video';
  readonly provider: ProviderDescriptor = QIANWEN_PROVIDER;
  private readonly client: QianwenApiClient;

  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   */
  constructor(fetchFunction?: FetchFunction) {
    this.client = new QianwenApiClient(fetchFunction);
  }

  listModels(): readonly ModelDescriptor<'video'>[] {
    return QIANWEN_VIDEO_MODELS;
  }

  getCapability(modelCode: string): VideoCapability | undefined {
    return findModelByCode(QIANWEN_VIDEO_MODELS, modelCode)?.capability;
  }

  validate(request: VideoGenerationRequest): readonly string[] {
    const capability = this.getCapability(request.modelCode);
    if (capability === undefined) {
      return [`千问AI平台没有模型 ${request.modelCode}。`];
    }
    return [
      ...validateVideoMediaCombination(request, capability, MEDIA_RULES),
      ...validateParameters(request, capability),
      ...validateExtraParams(request.extraParams, EXTRA_PARAMETER_SPECS)
    ];
  }

  async submit(request: VideoGenerationRequest, context: ProviderCallContext): Promise<RemoteJobRef> {
    const issues = this.validate(request);
    if (issues.length > 0) {
      throw new ProviderError('invalid_request', issues.join('；'));
    }
    const response = await this.client.postJson(context, CREATE_TASK_PATH, buildRequestBody(request), ASYNC_HEADERS, SUBMIT_TIMEOUT_MS);
    return { modelCode: request.modelCode, remoteJobId: readTaskId(response) };
  }

  checkConnection(context: ProviderCallContext): Promise<void> {
    return this.client.checkConnection(context, CONNECTION_PROBE_PATH);
  }

  async query(ref: RemoteJobRef, context: ProviderCallContext): Promise<RemoteJobState<VideoJobResult>> {
    const response = await this.client.getJson(context, `${QUERY_TASK_PATH}/${encodeURIComponent(ref.remoteJobId)}`);
    const output = readObject(response.output);
    return buildTaskState(output, () => {
      const videoUrl = output.video_url;
      if (typeof videoUrl !== 'string' || videoUrl === '') {
        throw new ProviderError('server', '任务已成功，但千问AI平台没有返回视频地址。');
      }
      const usage = readObject(response.usage);
      return { videoUrl, durationSeconds: typeof usage.output_video_duration === 'number' ? usage.output_video_duration : null };
    });
  }
}

/** 校验参数是否在模型能力范围内；随机种子须在 0 到 WAN3_SEED_MAX 之间且模型支持。 */
function validateParameters(request: VideoGenerationRequest, capability: VideoCapability): string[] {
  const issues = validateVideoParameters(request, capability, PARAMETER_RULES);
  if (request.seed !== null && (!capability.seed || !Number.isInteger(request.seed) || request.seed < 0 || request.seed > WAN3_SEED_MAX)) {
    issues.push(`随机种子必须是 0 到 ${WAN3_SEED_MAX} 之间的整数，且模型需支持随机种子。`);
  }
  return issues;
}

/** 按素材组合构造 input.media；首尾帧与参考素材已由校验保证互斥。 */
function buildMedia(request: VideoGenerationRequest): Array<{ type: string; url: string }> {
  const media: Array<{ type: string; url: string }> = [];
  if (request.firstFrame !== null) media.push({ type: MEDIA_TYPE_FIRST_FRAME, url: toDataUri(request.firstFrame) });
  if (request.lastFrame !== null) media.push({ type: MEDIA_TYPE_LAST_FRAME, url: toDataUri(request.lastFrame) });
  for (const image of request.referenceImages) media.push({ type: MEDIA_TYPE_REFERENCE_IMAGE, url: toDataUri(image) });
  for (const audio of request.referenceAudios) media.push({ type: MEDIA_TYPE_REFERENCE_AUDIO, url: toDataUri(audio) });
  return media;
}

/** 构造创建任务的请求体；null 的参数不写入，由平台使用默认值。 */
function buildRequestBody(request: VideoGenerationRequest): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (request.prompt.trim() !== '') input.prompt = request.prompt;
  const media = buildMedia(request);
  if (media.length > 0) input.media = media;

  const parameters: Record<string, unknown> = {};
  if (request.resolution !== null) parameters.resolution = request.resolution;
  if (request.aspectRatio !== null) parameters.ratio = request.aspectRatio;
  // 智能时长的取值 -1 与平台一致，直接透传。
  if (request.durationSeconds !== null) parameters.duration = request.durationSeconds;
  if (request.audioMode !== null) parameters.audio = request.audioMode === 'native';
  if (request.seed !== null) parameters.seed = request.seed;
  Object.assign(parameters, mapExtraParams(request.extraParams, EXTRA_PARAMETER_SPECS));
  return { model: request.modelCode, input, parameters };
}
