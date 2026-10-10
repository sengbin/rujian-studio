// ------------------------------------------------------------------------
// 名称：minimax-image-provider.ts
// 说明：MiniMax 图像适配器：按模型能力校验请求，调用同步的图片生成接口（文生图、带人物参考的图生图），并以任务引用的形式交回结果。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：接口是同步的，一次请求可用 n 生成多张：submit 内完成生成，图片地址编码进 remoteJobId，query 解码后直接返回成功；图片地址 24 小时后过期；部分图片因内容安全未返回时保留已生成的，全部未返回才报错；参考图以 Base64 内联；水印默认关闭。
// ------------------------------------------------------------------------

import { ProviderError } from '../../../domain/errors';
import { ImageCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor, ProviderDescriptor } from '../../../domain/models/model-provider';
import {
  ImageGenerationRequest,
  ImageJobResult,
  ImageModelProvider,
  ProviderCallContext,
  RemoteJobRef,
  RemoteJobState
} from '../../../domain/ports/provider-adapters';
import { findModelByCode } from '../shared/provider-model-lookup';
import { ExtraParamSpec, mapExtraParams, parseJson, readObject, toDataUri, validateExtraParams, validateMediaFiles } from '../shared/provider-payload';
import { FetchFunction, MinimaxApiClient } from './minimax-api-client';
import { MINIMAX_PROVIDER, MINIMAX_PROVIDER_NAME } from './minimax-catalog';
import {
  MINIMAX_IMAGE_MODELS,
  MINIMAX_IMAGE_PATH,
  MINIMAX_IMAGE_REFERENCE_MAX_BYTES,
  MINIMAX_IMAGE_REFERENCE_MIME_TYPES,
  MINIMAX_IMAGE_SUBJECT_TYPE
} from './minimax-image-catalog';

/** 单次图片请求的总超时（毫秒）：同步生成且可能带参考图，比普通请求久。 */
const IMAGE_REQUEST_TIMEOUT_MS = 300_000;

/** 模型专有参数：键与请求体中键的对应，取值都是开或关。 */
const EXTRA_PARAMETER_SPECS: Readonly<Record<string, ExtraParamSpec>> = {
  watermark: { apiKey: 'aigc_watermark', allowed: [true, false] }
};

/** MiniMax 的图像适配器。 */
export class MinimaxImageProvider implements ImageModelProvider {
  readonly kind = 'image';
  readonly provider: ProviderDescriptor = MINIMAX_PROVIDER;
  private readonly client: MinimaxApiClient;

  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   */
  constructor(fetchFunction?: FetchFunction) {
    this.client = new MinimaxApiClient(fetchFunction);
  }

  listModels(): readonly ModelDescriptor<'image'>[] {
    return MINIMAX_IMAGE_MODELS;
  }

  getCapability(modelCode: string): ImageCapability | undefined {
    return findModelByCode(MINIMAX_IMAGE_MODELS, modelCode)?.capability;
  }

  validate(request: ImageGenerationRequest): readonly string[] {
    const model = findModelByCode(MINIMAX_IMAGE_MODELS, request.modelCode);
    if (model === undefined) {
      return [`${MINIMAX_PROVIDER_NAME}没有模型 ${request.modelCode}。`];
    }
    return [...validatePromptAndMedia(request, model.capability), ...validateParameters(request, model.capability), ...validateExtraParams(request.extraParams, EXTRA_PARAMETER_SPECS)];
  }

  async submit(request: ImageGenerationRequest, context: ProviderCallContext): Promise<RemoteJobRef> {
    const issues = this.validate(request);
    if (issues.length > 0) {
      throw new ProviderError('invalid_request', issues.join('；'));
    }
    const response = await this.client.postJson(context, MINIMAX_IMAGE_PATH, buildRequestBody(request), IMAGE_REQUEST_TIMEOUT_MS);
    const imageUrls = readImageUrls(response);
    if (imageUrls.length === 0) {
      const failedCount = Number(readObject(response.metadata).failed_count);
      throw failedCount > 0
        ? new ProviderError('content_rejected', `${MINIMAX_PROVIDER_NAME}因内容安全检查没有返回图片，请调整提示词或参考图。`)
        : new ProviderError('server', `${MINIMAX_PROVIDER_NAME}没有返回图片地址。`);
    }
    const result: ImageJobResult = { imageUrls };
    return { modelCode: request.modelCode, remoteJobId: JSON.stringify(result) };
  }

  async query(ref: RemoteJobRef): Promise<RemoteJobState<ImageJobResult>> {
    const result = readObject(parseJson(ref.remoteJobId));
    const imageUrls = Array.isArray(result.imageUrls) ? result.imageUrls.filter((url): url is string => typeof url === 'string' && url !== '') : [];
    if (imageUrls.length === 0) {
      throw new ProviderError('invalid_request', '图片任务引用已损坏，无法取得图片地址。');
    }
    return { status: 'succeeded', result: { imageUrls }, errorCategory: null, errorCode: null, errorMessage: null };
  }
}

/** 校验提示词、反向提示词和参考图。 */
function validatePromptAndMedia(request: ImageGenerationRequest, capability: ImageCapability): string[] {
  const issues: string[] = [];
  if (request.prompt.trim() === '') {
    issues.push('提示词不能为空。');
  }
  if (request.prompt.length > capability.promptMaxLength) {
    issues.push(`提示词不能超过 ${capability.promptMaxLength} 字（当前 ${request.prompt.length} 字）。`);
  }
  if (request.negativePrompt !== null) {
    issues.push('该模型不支持反向提示词。');
  }
  if (request.referenceImages.length > capability.referenceImagesMax) {
    issues.push(`参考图最多 ${capability.referenceImagesMax} 张（当前 ${request.referenceImages.length} 张）。`);
  }
  issues.push(...validateMediaFiles(request.referenceImages, 'image/', '图片', MINIMAX_IMAGE_REFERENCE_MAX_BYTES));
  if (request.referenceImages.some((image) => image.mimeType.startsWith('image/') && !MINIMAX_IMAGE_REFERENCE_MIME_TYPES.includes(image.mimeType))) {
    issues.push('参考图只支持 JPG、PNG 格式。');
  }
  return issues;
}

/** 校验画幅、分辨率、数量和随机种子是否在模型能力范围内。 */
function validateParameters(request: ImageGenerationRequest, capability: ImageCapability): string[] {
  const issues: string[] = [];
  if (request.aspectRatio !== null && !capability.aspectRatios.includes(request.aspectRatio)) {
    issues.push(`画幅 ${request.aspectRatio} 不在模型支持的范围内：${capability.aspectRatios.join('、')}。`);
  }
  if (request.resolution !== null) {
    issues.push('该模型不支持指定分辨率，尺寸由画幅决定。');
  }
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > capability.imagesPerRequestMax) {
    issues.push(`生成数量必须是 1 到 ${capability.imagesPerRequestMax} 之间的整数（当前 ${request.count}）。`);
  }
  if (request.seed !== null && (!Number.isSafeInteger(request.seed) || request.seed < 0)) {
    issues.push('随机种子必须是不小于 0 的整数。');
  }
  return issues;
}

/** 构造请求体：返回图片地址；null 的参数不写入，由平台使用默认值；有参考图时作为人物主体参考；水印默认关闭。 */
function buildRequestBody(request: ImageGenerationRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { model: request.modelCode, prompt: request.prompt, response_format: 'url', n: request.count, aigc_watermark: false };
  if (request.aspectRatio !== null) body.aspect_ratio = request.aspectRatio;
  if (request.seed !== null) body.seed = request.seed;
  if (request.referenceImages.length > 0) {
    body.subject_reference = request.referenceImages.map((image) => ({ type: MINIMAX_IMAGE_SUBJECT_TYPE, image_file: toDataUri(image) }));
  }
  Object.assign(body, mapExtraParams(request.extraParams, EXTRA_PARAMETER_SPECS));
  return body;
}

/** 从响应里取出图片地址。 */
function readImageUrls(response: Record<string, unknown>): string[] {
  const imageUrls = readObject(response.data).image_urls;
  return Array.isArray(imageUrls) ? imageUrls.filter((url): url is string => typeof url === 'string' && url !== '') : [];
}
