// ------------------------------------------------------------------------
// 名称：volcengine-image-catalog.ts
// 说明：火山引擎（方舟）图像模型目录：Doubao Seedream 5.0 Pro、5.0 Flash、5.0 Lite 与 4.5 的能力描述，以及各模型的分辨率档位与像素范围。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：数值来自方舟文档“图片生成 API”；Seedream 4.0 即将下线，不收录；接口一次请求只生成一张图，生成多张由适配器并行发起多次请求；平台上新增或调整模型时只改这里。
// ------------------------------------------------------------------------

import { ImageCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor } from '../../../domain/models/model-provider';

/** 图片生成接口的路径，相对图片、视频接口地址。 */
export const VOLCENGINE_IMAGE_PATH = '/images/generations';

/** 单张参考图的大小上限，单位为字节。 */
export const SEEDREAM_REFERENCE_MAX_BYTES = 30 * 1024 * 1024;

/** 输出宽高取此数的整数倍，避免出现平台不接受的奇数尺寸。 */
export const SEEDREAM_SIZE_STEP = 16;

/** 单次提交最多生成的图片数；每张图一次请求，并行发起。 */
const SEEDREAM_IMAGES_PER_REQUEST_MAX = 4;

/** 提示词长度上限：平台建议中文不超过 300 字，这里只拦截明显过长的内容。 */
const SEEDREAM_PROMPT_MAX_LENGTH = 4000;

/** 指定画幅但没有指定分辨率时使用的档位。 */
export const SEEDREAM_DEFAULT_TIER = '2K';

/** 分辨率档位与对应的总像素数（如 1K 即 1024×1024 个像素）。 */
export const SEEDREAM_TIER_PIXELS: Readonly<Record<string, number>> = {
  '1K': 1024 * 1024,
  '1.5K': 1536 * 1536,
  '2K': 2048 * 2048,
  '3K': 3072 * 3072,
  '4K': 4096 * 4096
};

/** 各模型共有的画幅，宽高比都在平台允许的 1:16 到 16:1 之内。 */
const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];

/** 一个图像模型的声明及其在请求构造上的差异。 */
export interface VolcengineImageModel {
  readonly descriptor: ModelDescriptor<'image'>;
  /** 指定“宽x高”时允许的总像素范围。 */
  readonly pixelRange: { readonly min: number; readonly max: number };
}

/** 构造 Seedream 的能力：每次请求一张，不支持随机种子与反向提示词。 */
function seedreamCapability(resolutions: readonly string[], referenceImagesMax: number): ImageCapability {
  return {
    aspectRatios: ASPECT_RATIOS,
    resolutions,
    imagesPerRequestMax: SEEDREAM_IMAGES_PER_REQUEST_MAX,
    referenceImagesMax,
    seed: false,
    promptMaxLength: SEEDREAM_PROMPT_MAX_LENGTH
  };
}

/** 5.0 Pro、Flash：档位 1K、1.5K、2K，总像素 921600 至 4624220，最多 10 张参考图。 */
const PRO_PIXEL_RANGE = { min: 921_600, max: 4_624_220 };

/** 5.0 Lite、4.5：总像素 3686400 至 16777216，最多 14 张参考图。 */
const LITE_PIXEL_RANGE = { min: 3_686_400, max: 16_777_216 };

/** 火山引擎提供的图像模型。 */
export const VOLCENGINE_IMAGE_MODELS: readonly VolcengineImageModel[] = [
  {
    descriptor: { code: 'doubao-seedream-5-0-pro-260628', displayName: '豆包 Seedream 5.0 Pro', kind: 'image', capability: seedreamCapability(['1K', '1.5K', '2K'], 10) },
    pixelRange: PRO_PIXEL_RANGE
  },
  {
    descriptor: { code: 'doubao-seedream-5-0-flash-260915', displayName: '豆包 Seedream 5.0 Flash', kind: 'image', capability: seedreamCapability(['1K', '1.5K', '2K'], 10) },
    pixelRange: PRO_PIXEL_RANGE
  },
  {
    descriptor: { code: 'doubao-seedream-5-0-260128', displayName: '豆包 Seedream 5.0 Lite', kind: 'image', capability: seedreamCapability(['2K', '3K', '4K'], 14) },
    pixelRange: LITE_PIXEL_RANGE
  },
  {
    descriptor: { code: 'doubao-seedream-4-5-251128', displayName: '豆包 Seedream 4.5', kind: 'image', capability: seedreamCapability(['2K', '4K'], 14) },
    pixelRange: LITE_PIXEL_RANGE
  }
];
