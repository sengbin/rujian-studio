// ------------------------------------------------------------------------
// 名称：volcengine-image-provider.ts
// 说明：火山引擎 Seedream 图像适配器：按模型能力校验请求，调用方舟的同步图片生成接口，并以任务引用的形式交回结果。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：方舟的图片接口是同步的，一次请求只生成一张图：submit 内并行发起 count 次请求，图片地址编码进 remoteJobId，query 解码后直接返回成功；部分请求失败时保留已成功的图片，全部失败才报错；图片地址 24 小时后过期；水印默认关闭。
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
import { toPixelSize } from '../shared/image-pixel-size';
import { findDescribedModelByCode } from '../shared/provider-model-lookup';
import { ExtraParamSpec, mapExtraParams, parseJson, readObject, toDataUri, validateExtraParams, validateMediaFiles } from '../shared/provider-payload';
import { FetchFunction, VolcengineApiClient, classifyArkErrorCode } from './volcengine-api-client';
import { VOLCENGINE_PROVIDER, VOLCENGINE_PROVIDER_NAME } from './volcengine-catalog';
import {
  SEEDREAM_DEFAULT_TIER,
  SEEDREAM_REFERENCE_MAX_BYTES,
  SEEDREAM_SIZE_STEP,
  SEEDREAM_TIER_PIXELS,
  VOLCENGINE_IMAGE_MODELS,
  VOLCENGINE_IMAGE_PATH,
  VolcengineImageModel
} from './volcengine-image-catalog';

/** 单次图片请求的总超时（毫秒）：同步生成且可能带多张参考图，比普通请求久。 */
const IMAGE_REQUEST_TIMEOUT_MS = 300_000;

/** 模型专有参数：键与请求体中键的对应，取值都是开或关。 */
const EXTRA_PARAMETER_SPECS: Readonly<Record<string, ExtraParamSpec>> = {
  watermark: { apiKey: 'watermark', allowed: [true, false] }
};

/** 火山引擎的图像适配器。 */
export class VolcengineImageProvider implements ImageModelProvider {
  readonly kind = 'image';
  readonly provider: ProviderDescriptor = VOLCENGINE_PROVIDER;
  private readonly client: VolcengineApiClient;

  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   */
  constructor(fetchFunction?: FetchFunction) {
    this.client = new VolcengineApiClient(fetchFunction);
  }

  listModels(): readonly ModelDescriptor<'image'>[] {
    return VOLCENGINE_IMAGE_MODELS.map((model) => model.descriptor);
  }

  getCapability(modelCode: string): ImageCapability | undefined {
    return findDescribedModelByCode(VOLCENGINE_IMAGE_MODELS, modelCode)?.descriptor.capability;
  }

  validate(request: ImageGenerationRequest): readonly string[] {
    const model = findDescribedModelByCode(VOLCENGINE_IMAGE_MODELS, request.modelCode);
    if (model === undefined) {
      return [`${VOLCENGINE_PROVIDER_NAME}没有模型 ${request.modelCode}。`];
    }
    return [...validatePromptAndMedia(request, model), ...validateParameters(request, model), ...validateExtraParams(request.extraParams, EXTRA_PARAMETER_SPECS)];
  }

  async submit(request: ImageGenerationRequest, context: ProviderCallContext): Promise<RemoteJobRef> {
    const issues = this.validate(request);
    if (issues.length > 0) {
      throw new ProviderError('invalid_request', issues.join('；'));
    }
    // 校验已确认模型存在。
    const model = findDescribedModelByCode(VOLCENGINE_IMAGE_MODELS, request.modelCode) as VolcengineImageModel;
    const body = buildRequestBody(request, model);
    const outcomes = await Promise.allSettled(Array.from({ length: request.count }, () => this.generateOne(context, body)));

    const imageUrls = outcomes.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []));
    if (imageUrls.length === 0) {
      // 全部失败时抛出第一个失败，保留它的分类与错误码。
      throw (outcomes[0] as PromiseRejectedResult).reason;
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

  /** 发起一次生成一张图的请求，返回图片地址。 */
  private async generateOne(context: ProviderCallContext, body: Record<string, unknown>): Promise<string> {
    const response = await this.client.postJson(context, VOLCENGINE_IMAGE_PATH, body, IMAGE_REQUEST_TIMEOUT_MS);
    const data = Array.isArray(response.data) ? response.data.map(readObject) : [];
    const image = data.find((item) => typeof item.url === 'string' && item.url !== '');
    if (image !== undefined) {
      return image.url as string;
    }
    const error = readObject(data[0]?.error);
    const code = typeof error.code === 'string' ? error.code : null;
    const message = typeof error.message === 'string' ? `：${error.message}` : '';
    throw new ProviderError(classifyArkErrorCode(code) ?? 'server', `${VOLCENGINE_PROVIDER_NAME}没有返回图片地址${message}`, { code });
  }
}

/** 校验提示词、反向提示词和参考图。 */
function validatePromptAndMedia(request: ImageGenerationRequest, model: VolcengineImageModel): string[] {
  const issues: string[] = [];
  const capability = model.descriptor.capability;
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
  issues.push(...validateMediaFiles(request.referenceImages, 'image/', '图片', SEEDREAM_REFERENCE_MAX_BYTES));
  return issues;
}

/** 校验画幅、分辨率、数量和随机种子是否在模型能力范围内，以及画幅与分辨率换算出的尺寸是否在模型的像素范围内。 */
function validateParameters(request: ImageGenerationRequest, model: VolcengineImageModel): string[] {
  const issues: string[] = [];
  const capability = model.descriptor.capability;
  if (request.aspectRatio !== null && !capability.aspectRatios.includes(request.aspectRatio)) {
    issues.push(`画幅 ${request.aspectRatio} 不在模型支持的范围内：${capability.aspectRatios.join('、')}。`);
  }
  if (request.resolution !== null && !capability.resolutions.includes(request.resolution)) {
    issues.push(`分辨率 ${request.resolution} 不在模型支持的范围内：${capability.resolutions.join('、')}。`);
  }
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > capability.imagesPerRequestMax) {
    issues.push(`生成数量必须是 1 到 ${capability.imagesPerRequestMax} 之间的整数（当前 ${request.count}）。`);
  }
  if (request.seed !== null) {
    issues.push('该模型不支持随机种子。');
  }
  if (issues.length === 0 && request.aspectRatio !== null) {
    const tier = request.resolution ?? SEEDREAM_DEFAULT_TIER;
    const { width, height } = toPixelSize(request.aspectRatio, SEEDREAM_TIER_PIXELS[tier], SEEDREAM_SIZE_STEP);
    const pixels = width * height;
    if (pixels < model.pixelRange.min || pixels > model.pixelRange.max) {
      issues.push(`画幅 ${request.aspectRatio} 与分辨率 ${tier} 换算出的尺寸 ${width}x${height} 不在模型支持的像素范围内，请换一个分辨率。`);
    }
  }
  return issues;
}

/**
 * 决定请求体中的 size：都没指定时不传，由模型自行决定；
 * 只指定分辨率时直接传档位；指定了画幅时换算成“宽x高”（方舟不允许档位与像素混用）。
 */
function resolveSize(request: ImageGenerationRequest): string | undefined {
  if (request.aspectRatio === null) {
    return request.resolution ?? undefined;
  }
  const { width, height } = toPixelSize(request.aspectRatio, SEEDREAM_TIER_PIXELS[request.resolution ?? SEEDREAM_DEFAULT_TIER], SEEDREAM_SIZE_STEP);
  return `${width}x${height}`;
}

/** 构造请求体：每次请求只生成一张图；null 的参数不写入，由平台使用默认值；水印默认关闭。 */
function buildRequestBody(request: ImageGenerationRequest, model: VolcengineImageModel): Record<string, unknown> {
  const body: Record<string, unknown> = { model: model.descriptor.code, prompt: request.prompt, response_format: 'url', watermark: false };
  const size = resolveSize(request);
  if (size !== undefined) body.size = size;
  const images = request.referenceImages.map(toDataUri);
  if (images.length === 1) body.image = images[0];
  else if (images.length > 1) body.image = images;
  Object.assign(body, mapExtraParams(request.extraParams, EXTRA_PARAMETER_SPECS));
  return body;
}
