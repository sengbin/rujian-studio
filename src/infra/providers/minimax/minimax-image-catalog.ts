// ------------------------------------------------------------------------
// 名称：minimax-image-catalog.ts
// 说明：MiniMax 图像模型目录：image-01 与 image-01-live 的能力描述，以及图片生成接口的路径与参考图限制。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：数值来自 MiniMax 开放平台文档“文生图”“图生图”：画幅对应固定像素，不提供分辨率档位；参考图是“人物主体参考”（type 为 character），建议单人正面照，所以最多按 1 张；21:9 只有 image-01 支持；平台上新增或调整模型时只改这里。
// ------------------------------------------------------------------------

import { ImageCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor } from '../../../domain/models/model-provider';

/** 图片生成接口的路径，相对接口地址。 */
export const MINIMAX_IMAGE_PATH = '/v1/image_generation';

/** 单张参考图的大小上限，单位为字节。 */
export const MINIMAX_IMAGE_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;

/** 参考图允许的 MIME 类型：平台只支持 JPG、JPEG、PNG。 */
export const MINIMAX_IMAGE_REFERENCE_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/jpg', 'image/png'];

/** 参考图在请求里的主体类型：目前只支持人物。 */
export const MINIMAX_IMAGE_SUBJECT_TYPE = 'character';

/** 单次提交最多生成的图片数。 */
const IMAGES_PER_REQUEST_MAX = 9;

/** 提示词长度上限。 */
const PROMPT_MAX_LENGTH = 1500;

/** 两个模型共有的画幅。 */
const COMMON_ASPECT_RATIOS = ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16'];

/** 构造图像模型的能力：不支持反向提示词，没有分辨率档位。 */
function minimaxImageCapability(aspectRatios: readonly string[]): ImageCapability {
  return {
    aspectRatios,
    resolutions: [],
    imagesPerRequestMax: IMAGES_PER_REQUEST_MAX,
    referenceImagesMax: 1,
    seed: true,
    promptMaxLength: PROMPT_MAX_LENGTH
  };
}

/** MiniMax 提供的图像模型。 */
export const MINIMAX_IMAGE_MODELS: readonly ModelDescriptor<'image'>[] = [
  { code: 'image-01', displayName: 'MiniMax 图像 01', kind: 'image', capability: minimaxImageCapability([...COMMON_ASPECT_RATIOS, '21:9']) },
  { code: 'image-01-live', displayName: 'MiniMax 图像 01 Live', kind: 'image', capability: minimaxImageCapability(COMMON_ASPECT_RATIOS) }
];
