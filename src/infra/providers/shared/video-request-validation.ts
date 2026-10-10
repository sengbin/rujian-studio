// ------------------------------------------------------------------------
// 名称：video-request-validation.ts
// 说明：视频适配器共用的请求校验：素材组合与素材本身（提示词、首尾帧、参考图、参考音频、请求体大小）、画幅、分辨率、时长、声音模式与随机种子。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：校验文案与顺序保持各服务商原样；各服务商的差异（提示词是否必填、尾帧是否必须配首帧、素材大小与格式、请求体上限等）通过规则参数传入；返回问题列表，空数组表示通过，不抛出异常。
// ------------------------------------------------------------------------

import { VideoCapability } from '../../../domain/models/model-capability';
import { MediaInput, VideoGenerationRequest } from '../../../domain/ports/provider-adapters';
import { isDurationAllowed } from '../../../domain/rules/model-capability-rules';
import { validateMediaFiles } from './provider-payload';

/** Base64 编码后体积约为原文件的 4/3。 */
const BASE64_EXPANSION = 4 / 3;

/** 每兆字节的字节数，用于把请求体上限写进提示。 */
const BYTES_PER_MB = 1024 * 1024;

/** 声音模式不在模型能力内时的默认说明。 */
const DEFAULT_AUDIO_MODE_MESSAGE = '该模型不支持所选的声音模式。';

/** 平台接受的素材格式：MIME 类型与提示里的格式名称。 */
export interface VideoFileFormats {
  readonly mimeTypes: readonly string[];
  /** 如“WAV、MP3”。 */
  readonly label: string;
}

/** 一类素材的限制。 */
export interface VideoFileRules {
  /** 单个文件的大小上限，单位为字节。 */
  readonly maxBytes: number;
  /** 平台限定的格式；null 表示只校验 MIME 大类。 */
  readonly formats: VideoFileFormats | null;
}

/** 素材组合与素材本身的校验规则。 */
export interface VideoMediaRules {
  /** 提示词是否必填；false 时有首帧、尾帧或参考素材即可不写提示词。 */
  readonly promptRequired: boolean;
  /** 指定尾帧时是否必须同时指定首帧。 */
  readonly lastFrameRequiresFirst: boolean;
  /** 传参考音频时是否必须同时传参考图。 */
  readonly audioRequiresReferenceImage: boolean;
  readonly image: VideoFileRules;
  readonly audio: VideoFileRules;
  /** 请求体大小上限（字节），Base64 内联的素材合计不得超过它；null 表示平台没有给出上限。 */
  readonly requestMaxBytes: number | null;
}

/** 画幅、分辨率、时长、声音模式与随机种子的校验规则。 */
export interface VideoParameterRules {
  /** 是否必须指定时长。 */
  readonly durationRequired: boolean;
  /** 模型不支持所选声音模式时的说明，缺省为通用说明。 */
  readonly audioModeMessage?: string;
  /** 模型是否完全不支持随机种子；为 false 时由调用方自行校验种子。 */
  readonly seedUnsupported: boolean;
}

/**
 * 校验素材组合与素材本身：提示词、首尾帧与参考素材的互斥、数量、格式与大小。
 * @param request 视频生成请求。
 * @param capability 模型能力。
 * @param rules 服务商的素材规则。
 */
export function validateVideoMediaCombination(request: VideoGenerationRequest, capability: VideoCapability, rules: VideoMediaRules): string[] {
  const issues: string[] = [];
  const hasFrames = request.firstFrame !== null || request.lastFrame !== null;
  const hasReferences = request.referenceImages.length > 0 || request.referenceAudios.length > 0;

  if (rules.promptRequired) {
    if (request.prompt.trim() === '') {
      issues.push('提示词不能为空，该模型每次请求都必须有文字描述。');
    }
  } else if (request.prompt.trim() === '' && !hasFrames && !hasReferences) {
    issues.push('提示词和素材至少要提供一项。');
  }
  if (request.prompt.length > capability.promptMaxLength) {
    issues.push(`提示词不能超过 ${capability.promptMaxLength} 字（当前 ${request.prompt.length} 字）。`);
  }
  if (rules.lastFrameRequiresFirst && request.lastFrame !== null && request.firstFrame === null) {
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

  const images = [request.firstFrame, request.lastFrame, ...request.referenceImages].filter((media): media is MediaInput => media !== null);
  issues.push(...validateMediaFiles(images, 'image/', '图片', rules.image.maxBytes));
  const imageFormats = rules.image.formats;
  if (imageFormats !== null && images.some((image) => image.mimeType.startsWith('image/') && !imageFormats.mimeTypes.includes(image.mimeType))) {
    issues.push(`图片素材只支持 ${imageFormats.label} 格式。`);
  }
  if (request.referenceImages.length > capability.referenceImagesMax) {
    issues.push(`参考图最多 ${capability.referenceImagesMax} 张（当前 ${request.referenceImages.length} 张）。`);
  }

  issues.push(...validateReferenceAudios(request, capability, rules));

  if (rules.requestMaxBytes !== null) {
    const inlineBytes = [...images, ...request.referenceAudios].reduce((total, media) => total + media.data.byteLength, 0);
    if (inlineBytes * BASE64_EXPANSION > rules.requestMaxBytes) {
      issues.push(`素材合计超过请求体上限 ${rules.requestMaxBytes / BYTES_PER_MB} MB，请减少或压缩素材。`);
    }
  }
  return issues;
}

/** 校验参考音频：模型是否支持、数量、格式、大小，以及是否必须同时传参考图。 */
function validateReferenceAudios(request: VideoGenerationRequest, capability: VideoCapability, rules: VideoMediaRules): string[] {
  const audios = request.referenceAudios;
  const limit = capability.audioInputMax;
  if (audios.length === 0) {
    return [];
  }
  if (limit === null) {
    return ['该模型不支持参考音频。'];
  }
  const issues = validateMediaFiles(audios, 'audio/', '音频', rules.audio.maxBytes);
  const audioFormats = rules.audio.formats;
  if (audioFormats !== null && audios.some((audio) => !audioFormats.mimeTypes.includes(audio.mimeType))) {
    issues.push(`参考音频只支持 ${audioFormats.label} 格式。`);
  }
  if (audios.length > limit.count) {
    issues.push(`参考音频最多 ${limit.count} 段（当前 ${audios.length} 段）。`);
  }
  if (rules.audioRequiresReferenceImage && request.referenceImages.length === 0) {
    issues.push('该模型不能只传参考音频，请同时绑定角色或场景的参考图。');
  }
  return issues;
}

/**
 * 校验画幅、分辨率、时长、声音模式和随机种子是否在模型能力范围内。
 * @param request 视频生成请求。
 * @param capability 模型能力。
 * @param rules 服务商的参数规则。
 */
export function validateVideoParameters(request: VideoGenerationRequest, capability: VideoCapability, rules: VideoParameterRules): string[] {
  const issues: string[] = [];
  if (request.aspectRatio !== null && !capability.aspectRatios.includes(request.aspectRatio)) {
    issues.push(`画幅 ${request.aspectRatio} 不在模型支持的范围内：${capability.aspectRatios.join('、')}。`);
  }
  if (request.resolution !== null && !capability.resolutions.includes(request.resolution)) {
    issues.push(`分辨率 ${request.resolution} 不在模型支持的范围内：${capability.resolutions.join('、')}。`);
  }
  if (request.durationSeconds === null) {
    if (rules.durationRequired) {
      issues.push('该模型必须指定视频时长。');
    }
  } else if (!isDurationAllowed(capability.duration, request.durationSeconds)) {
    issues.push(`时长 ${request.durationSeconds} 秒不在模型支持的范围内。`);
  }
  if (request.audioMode !== null && !capability.audioModes.includes(request.audioMode)) {
    issues.push(rules.audioModeMessage ?? DEFAULT_AUDIO_MODE_MESSAGE);
  }
  if (rules.seedUnsupported && request.seed !== null) {
    issues.push('该模型不支持随机种子。');
  }
  return issues;
}
