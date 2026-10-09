// ------------------------------------------------------------------------
// 名称：minimax-video-catalog.ts
// 说明：MiniMax 视频模型目录：MiniMax H3 与 H3 Max 的能力描述，以及视频任务接口的路径、素材格式与大小、请求体的上限。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：数值来自 MiniMax 开放平台文档“创建视频生成任务”“查询任务”“取消或删除任务”：视频始终带原生声音（没有开关）；接口要求必填分辨率与时长，分辨率没指定时用 DEFAULT_VIDEO_RESOLUTION；有首帧、尾帧时画幅由图片决定（传 adaptive）；参考视频暂不支持（请求里没有对应素材）；平台上新增或调整模型时只改这里。
// ------------------------------------------------------------------------

import { VideoCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor } from '../../../domain/models/model-provider';

/** 视频任务接口的路径，相对接口地址：创建与取消、删除用同一路径后接任务标识，查询用单独的路径。 */
export const MINIMAX_VIDEO_CREATE_PATH = '/v2/video_generation';
export const MINIMAX_VIDEO_QUERY_PATH = '/v2/query/video_generation';

/** 单张图片素材（首帧、尾帧、参考图）的大小上限，单位为字节。 */
export const MINIMAX_VIDEO_IMAGE_MAX_BYTES = 30 * 1024 * 1024;

/** 单段参考音频的大小上限，单位为字节。 */
export const MINIMAX_VIDEO_AUDIO_MAX_BYTES = 15 * 1024 * 1024;

/** 单次请求体的大小上限，单位为字节；Base64 内联的素材合计不得超过它。 */
export const MINIMAX_VIDEO_REQUEST_MAX_BYTES = 64 * 1024 * 1024;

/** 图片素材允许的 MIME 类型。 */
export const MINIMAX_VIDEO_IMAGE_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/** 参考音频允许的 MIME 类型：平台只支持 WAV 与 MP3。 */
export const MINIMAX_VIDEO_AUDIO_MIME_TYPES: readonly string[] = ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3'];

/** 没有指定分辨率时使用的档位：两个模型都支持。 */
export const MINIMAX_DEFAULT_VIDEO_RESOLUTION = '768P';

/** 提示词长度上限：平台按字符计算，单个文本最多 7000 字符。 */
const PROMPT_MAX_LENGTH = 7000;

/** 参考图最多张数与参考音频的限制。 */
const REFERENCE_IMAGES_MAX = 9;
const AUDIO_INPUT_LIMIT = { count: 3, maxSeconds: 15 };

/** 构造 H3 系列的能力：首尾帧、参考图、参考音频与原生声音，不支持随机种子。 */
function minimaxVideoCapability(options: Pick<VideoCapability, 'resolutions' | 'duration'>): VideoCapability {
  return {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    resolutions: options.resolutions,
    duration: options.duration,
    fps: [],
    audioModes: ['native'],
    audioElements: ['dialogue', 'narration', 'sfx', 'music'],
    voiceReference: true,
    audioInputMax: AUDIO_INPUT_LIMIT,
    firstFrame: true,
    lastFrame: true,
    referenceImagesMax: REFERENCE_IMAGES_MAX,
    seed: false,
    firstFrameDefinesAspect: true,
    promptMaxLength: PROMPT_MAX_LENGTH
  };
}

/** MiniMax 提供的视频模型。 */
export const MINIMAX_VIDEO_MODELS: readonly ModelDescriptor<'video'>[] = [
  {
    code: 'MiniMax-H3',
    displayName: 'MiniMax H3',
    kind: 'video',
    capability: minimaxVideoCapability({ resolutions: ['768P', '2K'], duration: { min: 4, max: 15, step: 1 } })
  },
  {
    code: 'MiniMax-H3-Max',
    displayName: 'MiniMax H3 Max（极速）',
    kind: 'video',
    capability: minimaxVideoCapability({ resolutions: ['480P', '768P'], duration: { min: 5, max: 15, step: 1 } })
  }
];
