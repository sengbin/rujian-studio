// ------------------------------------------------------------------------
// 名称：tail-frame-rules.ts
// 说明：工作台上传尾帧图片的规则：尾帧图片的类型、宽高与内容大小校验，截取失败上报的读取，以及结果视频的大小上限与尾帧不可用的错误码。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯函数；Base64 内容在这里只检查长度，解码由调用方负责。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, ValidationError } from '../errors';
import { readIdentifier, readRecord } from './field-readers';
import { IMAGE_FILE_MAX_BYTES } from './image-size';

/** 单个结果视频的大小上限（字节）：既是保存结果时的下载上限，也是工作台读取视频（截取尾帧）的上限；两处共用，保证保存下来的视频都能被工作台读取。 */
export const RESULT_VIDEO_MAX_BYTES = 200 * 1024 * 1024;

/** 无法从前序镜头组的视频截取尾帧时的错误码。 */
export const TAIL_FRAME_UNAVAILABLE_CODE = 'TailFrameUnavailable';

/** 尾帧图片可接受的图片类型。 */
const TAIL_FRAME_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
/** 尾帧图片单边像素的上限。 */
const TAIL_FRAME_MAX_SIDE = 16384;
/** 尾帧失败说明的最大长度。 */
const TAIL_FRAME_REASON_MAX_LENGTH = 200;

/** 工作台截取到的尾帧图片：Base64 内容尚未解码。 */
export interface TailFrameInput {
  readonly resultId: number;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly dataBase64: string;
}

/**
 * 读取并校验工作台提交的尾帧图片。
 * @param rawInput { resultId, mimeType, width, height, data（Base64） }。
 * @throws ValidationError 内容不合法。
 */
export function readTailFrameInput(rawInput: unknown): TailFrameInput {
  const source = readRecord(rawInput);
  const mimeType = source.mimeType;
  if (typeof mimeType !== 'string' || !TAIL_FRAME_MIME_TYPES.includes(mimeType)) {
    throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '尾帧图片类型必须是 JPEG、PNG 或 WebP。' });
  }
  const side = (key: 'width' | 'height'): number => {
    const value = source[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > TAIL_FRAME_MAX_SIDE) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '尾帧图片的宽高不合法。' });
    }
    return value;
  };
  const { data } = source;
  if (typeof data !== 'string' || data === '' || data.length > Math.ceil((IMAGE_FILE_MAX_BYTES * 4) / 3) + 4) {
    throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: `尾帧图片不能为空，且不超过 ${IMAGE_FILE_MAX_BYTES / (1024 * 1024)} MB。` });
  }
  return { resultId: readIdentifier(source, 'resultId', '结果'), mimeType, width: side('width'), height: side('height'), dataBase64: data };
}

/** 读取截取尾帧失败的上报：结果标识与失败原因（截断到合理长度，缺省为空串）。 */
export function readTailFrameFailure(rawInput: unknown): { readonly resultId: number; readonly reason: string } {
  const source = readRecord(rawInput);
  const reason = typeof source.reason === 'string' ? source.reason.trim().slice(0, TAIL_FRAME_REASON_MAX_LENGTH) : '';
  return { resultId: readIdentifier(source, 'resultId', '结果'), reason };
}
