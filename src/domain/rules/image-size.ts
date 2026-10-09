// ------------------------------------------------------------------------
// 名称：image-size.ts
// 说明：从图片文件头读取像素宽高（PNG、JPEG、WebP），不解码图片内容。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：纯函数；只读取文件头里的尺寸字段，文件被截断或结构异常时返回 null，由调用方决定如何处理；宽高超过 IMAGE_SIDE_MAX 视为不合理。
// ------------------------------------------------------------------------

/** 图片的像素宽高。 */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** 单边像素的合理上限，超过按读取失败处理。 */
const IMAGE_SIDE_MAX = 65535;

/** JPEG 中不携带图片尺寸的标记（DHT、JPG、DAC）。 */
const JPEG_NON_FRAME_MARKERS: readonly number[] = [0xc4, 0xc8, 0xcc];

/** 读取小端无符号整数（1 至 4 字节）。 */
function readLittleEndian(content: Uint8Array, offset: number, length: number): number {
  let value = 0;
  for (let index = length - 1; index >= 0; index -= 1) {
    value = value * 256 + (content[offset + index] ?? 0);
  }
  return value;
}

/** 读取大端无符号整数（1 至 4 字节）。 */
function readBigEndian(content: Uint8Array, offset: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    value = value * 256 + (content[offset + index] ?? 0);
  }
  return value;
}

/** 宽高都在合理范围内才返回。 */
function toSize(width: number, height: number): ImageSize | null {
  return width >= 1 && height >= 1 && width <= IMAGE_SIDE_MAX && height <= IMAGE_SIDE_MAX ? { width, height } : null;
}

/** PNG：IHDR 块紧跟 8 字节签名，宽高各 4 字节大端。 */
function readPngSize(content: Uint8Array): ImageSize | null {
  return content.length < 24 ? null : toSize(readBigEndian(content, 16, 4), readBigEndian(content, 20, 4));
}

/** JPEG：逐段查找帧头标记（SOF0 至 SOF15，不含 DHT、JPG、DAC），其中依次是精度 1 字节、高 2 字节、宽 2 字节。 */
function readJpegSize(content: Uint8Array): ImageSize | null {
  let offset = 2;
  while (offset + 9 < content.length) {
    if (content[offset] !== 0xff) {
      return null;
    }
    const marker = content[offset + 1];
    // 连续的 0xff 是填充字节。
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && !JPEG_NON_FRAME_MARKERS.includes(marker)) {
      return toSize(readBigEndian(content, offset + 7, 2), readBigEndian(content, offset + 5, 2));
    }
    offset += 2 + readBigEndian(content, offset + 2, 2);
  }
  return null;
}

/** WebP：按首个数据块区分有损（VP8 ）、无损（VP8L）和扩展（VP8X）三种布局。 */
function readWebpSize(content: Uint8Array): ImageSize | null {
  const chunk = String.fromCharCode(...content.slice(12, 16));
  if (chunk === 'VP8X' && content.length >= 30) {
    return toSize(readLittleEndian(content, 24, 3) + 1, readLittleEndian(content, 27, 3) + 1);
  }
  if (chunk === 'VP8L' && content.length >= 25 && content[20] === 0x2f) {
    const bits = readLittleEndian(content, 21, 4);
    return toSize((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8 ' && content.length >= 30) {
    return toSize(readLittleEndian(content, 26, 2) & 0x3fff, readLittleEndian(content, 28, 2) & 0x3fff);
  }
  return null;
}

/**
 * 读取图片的像素宽高。
 * @param content 图片文件内容。
 * @param mime 图片类型，来自文件头识别：image/png、image/jpeg 或 image/webp。
 * @returns 宽高；类型不受支持或文件头不完整时返回 null。
 */
export function readImageSize(content: Uint8Array, mime: string): ImageSize | null {
  switch (mime) {
    case 'image/png':
      return readPngSize(content);
    case 'image/jpeg':
      return readJpegSize(content);
    case 'image/webp':
      return readWebpSize(content);
    default:
      return null;
  }
}
