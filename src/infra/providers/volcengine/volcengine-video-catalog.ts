// ------------------------------------------------------------------------
// 名称：volcengine-video-catalog.ts
// 说明：火山引擎（方舟）视频模型目录：Doubao Seedance 2.5 与 2.0 系列（标准、Fast、Mini）的能力描述，以及素材大小、格式与请求体的上限。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：数值来自方舟文档“创建视频生成任务 API”“模型列表”；Seedance 1.0 系列即将下线，不收录；2.x 系列不支持随机种子与提示词改写开关；平台上新增或调整模型时只改这里。
// ------------------------------------------------------------------------

import { VideoCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor } from '../../../domain/models/model-provider';

/** 单张图片素材（首帧、尾帧、参考图）的大小上限，单位为字节。 */
export const SEEDANCE_IMAGE_MAX_BYTES = 30 * 1024 * 1024;

/** 单段参考音频的大小上限，单位为字节。 */
export const SEEDANCE_AUDIO_MAX_BYTES = 15 * 1024 * 1024;

/** 单次请求体的大小上限，单位为字节；Base64 内联的素材合计不得超过它。 */
export const SEEDANCE_REQUEST_MAX_BYTES = 64 * 1024 * 1024;

/** 参考音频允许的 MIME 类型：平台只支持 WAV 与 MP3。 */
export const SEEDANCE_AUDIO_MIME_TYPES: readonly string[] = ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3'];

/** 提示词长度上限：平台建议中文不超过 500 字，这里只拦截明显过长的内容。 */
const SEEDANCE_PROMPT_MAX_LENGTH = 4000;

/** 一个视频模型的声明及其在请求校验上的差异。 */
export interface VolcengineVideoModel {
  readonly descriptor: ModelDescriptor<'video'>;
  /** 是否允许只传参考音频：Seedance 2.5 可以，2.0 系列必须同时传参考图。 */
  readonly audioOnlyReference: boolean;
}

/** 构造 Seedance 的能力：2.x 系列都支持首尾帧、参考图、参考音频与原生声音，不支持随机种子。 */
function seedanceCapability(options: Pick<VideoCapability, 'resolutions' | 'duration' | 'referenceImagesMax' | 'audioInputMax'>): VideoCapability {
  return {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    resolutions: options.resolutions,
    duration: options.duration,
    fps: [24],
    audioModes: ['none', 'native'],
    audioElements: ['dialogue', 'narration', 'sfx', 'music'],
    voiceReference: true,
    audioInputMax: options.audioInputMax,
    firstFrame: true,
    lastFrame: true,
    referenceImagesMax: options.referenceImagesMax,
    seed: false,
    firstFrameDefinesAspect: true,
    promptMaxLength: SEEDANCE_PROMPT_MAX_LENGTH
  };
}

/** Seedance 2.5：4 至 30 秒，最多 30 张参考图、10 段参考音频，可只传音频。 */
const SEEDANCE_25_CAPABILITY = seedanceCapability({
  resolutions: ['480P', '720P', '1080P'],
  duration: { min: 4, max: 30, step: 1, allowAuto: true },
  referenceImagesMax: 30,
  audioInputMax: { count: 10, maxSeconds: 30 }
});

/** Seedance 2.0 系列：4 至 15 秒，最多 9 张参考图、3 段参考音频；标准版额外支持 1080P 与 4K。 */
function seedance20Capability(resolutions: readonly string[]): VideoCapability {
  return seedanceCapability({
    resolutions,
    duration: { min: 4, max: 15, step: 1, allowAuto: true },
    referenceImagesMax: 9,
    audioInputMax: { count: 3, maxSeconds: 15 }
  });
}

/** 火山引擎提供的视频模型。 */
export const VOLCENGINE_VIDEO_MODELS: readonly VolcengineVideoModel[] = [
  {
    descriptor: { code: 'doubao-seedance-2-5-260628', displayName: '豆包 Seedance 2.5', kind: 'video', capability: SEEDANCE_25_CAPABILITY },
    audioOnlyReference: true
  },
  {
    descriptor: {
      code: 'doubao-seedance-2-0-260128',
      displayName: '豆包 Seedance 2.0',
      kind: 'video',
      capability: seedance20Capability(['480P', '720P', '1080P', '4K'])
    },
    audioOnlyReference: false
  },
  {
    descriptor: { code: 'doubao-seedance-2-0-fast-260128', displayName: '豆包 Seedance 2.0 Fast', kind: 'video', capability: seedance20Capability(['480P', '720P']) },
    audioOnlyReference: false
  },
  {
    descriptor: { code: 'doubao-seedance-2-0-mini-260615', displayName: '豆包 Seedance 2.0 Mini', kind: 'video', capability: seedance20Capability(['480P', '720P']) },
    audioOnlyReference: false
  }
];
