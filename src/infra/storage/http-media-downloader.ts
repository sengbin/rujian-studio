// ------------------------------------------------------------------------
// 名称：http-media-downloader.ts
// 说明：媒体下载的 HTTP 实现：只允许 https 地址与适配器内联的 Base64 data 地址，按大小上限读取内容；fetch 可注入以便测试。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-03
// 备注：先看 Content-Length 提前拒绝过大的文件；读取过程中边读边累计字节数，一旦超过上限立即中止并取消响应流，不会把超大文件整个读入内存；data 地址由直接返回音频内容的适配器生成，解码前先按声明的长度检查大小。
// ------------------------------------------------------------------------

import { MediaDownloader } from '../../domain/ports/media-downloader';
import { BASE64_BODY } from '../../domain/rules/base64-pattern';

/** 超过大小上限时的错误说明。 */
const TOO_LARGE_MESSAGE = '文件超过大小上限。';

/** 适配器内联音频内容的 data 地址：只接受音频类型的 Base64 内容。 */
const AUDIO_DATA_URL_PATTERN = new RegExp(`^data:audio\\/[a-z0-9.+-]+;base64,(${BASE64_BODY})$`);

/** Base64 每 4 个字符还原为 3 个字节。 */
const BASE64_BYTES_PER_GROUP = 3;
const BASE64_CHARS_PER_GROUP = 4;

/** 基于 fetch 的媒体下载器。 */
export class HttpMediaDownloader implements MediaDownloader {
  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   */
  constructor(private readonly fetchFunction: typeof fetch = fetch) {}

  async download(url: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
    if (url.startsWith('data:')) {
      return decodeDataUrl(url, maxBytes);
    }
    if (!url.startsWith('https://')) {
      throw new Error('下载地址必须是 https 地址。');
    }
    const response = await this.fetchFunction(url, { signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`下载失败（HTTP ${response.status}）。`);
    }
    // 声明的大小已超过上限时不再读取响应体；没有声明时以实际读取的字节数为准。
    const declared = readDeclaredLength(response);
    if (declared !== null && declared > maxBytes) {
      await response.body?.cancel();
      throw new Error(TOO_LARGE_MESSAGE);
    }
    if (response.body === null) {
      throw new Error('下载失败：服务器没有返回内容。');
    }
    return readLimited(response.body, maxBytes);
  }
}

/** 解码音频 data 地址；格式不对或解码后超过上限时抛出错误。 */
function decodeDataUrl(url: string, maxBytes: number): Buffer {
  const match = AUDIO_DATA_URL_PATTERN.exec(url);
  if (match === null) {
    throw new Error('内联数据地址必须是 Base64 编码的音频内容。');
  }
  const encoded = match[1];
  if ((encoded.length / BASE64_CHARS_PER_GROUP) * BASE64_BYTES_PER_GROUP > maxBytes + BASE64_BYTES_PER_GROUP) {
    throw new Error(TOO_LARGE_MESSAGE);
  }
  const content = Buffer.from(encoded, 'base64');
  if (content.length > maxBytes) {
    throw new Error(TOO_LARGE_MESSAGE);
  }
  return content;
}

/** 读取响应头 Content-Length；没有或不是合法的非负整数时返回 null。 */
function readDeclaredLength(response: Response): number | null {
  const header = response.headers.get('content-length');
  if (header === null || !/^\d+$/.test(header.trim())) {
    return null;
  }
  return Number(header.trim());
}

/**
 * 流式读取响应体，累计字节数超过上限时立即取消读取并抛出错误。
 * @param body 响应体流。
 * @param maxBytes 允许的最大字节数。
 */
async function readLimited(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.length;
      if (total > maxBytes) {
        throw new Error(TOO_LARGE_MESSAGE);
      }
      chunks.push(value);
    }
  } catch (error) {
    // 超限或读取出错：取消响应流以释放连接；取消本身失败不影响要抛出的原错误。
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks, total);
}