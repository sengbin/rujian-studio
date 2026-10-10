// ------------------------------------------------------------------------
// 名称：image-size.test.ts
// 说明：图片文件头处理的自动化测试：按文件头识别格式，PNG、JPEG、WebP（有损、无损、扩展）读出宽高，不完整或类型不支持时返回 null。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：纯函数测试；图片内容只构造文件头需要的字节。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectImageMime, readImageSize } from './image-size';

/** 只含签名与 IHDR 的 PNG 文件头。 */
function png(width: number, height: number): Buffer {
  const content = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(content);
  content.writeUInt32BE(13, 8);
  content.write('IHDR', 12);
  content.writeUInt32BE(width, 16);
  content.writeUInt32BE(height, 20);
  return content;
}

/** JPEG：SOI、一个 APP0 段、可选的 DHT 段，再接 SOF 帧头。 */
function jpeg(width: number, height: number, sofMarker = 0xc0, withDht = false): Buffer {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const dht = withDht ? Buffer.concat([Buffer.from([0xff, 0xc4, 0x00, 0x05]), Buffer.alloc(3)]) : Buffer.alloc(0);
  const sof = Buffer.alloc(19);
  sof.set([0xff, sofMarker, 0x00, 0x11, 0x08]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dht, sof]);
}

/** WebP 外壳：RIFF 头加首个数据块的标识。 */
function webp(chunk: string, length: number): Buffer {
  const content = Buffer.alloc(length);
  content.write('RIFF', 0);
  content.write('WEBP', 8);
  content.write(chunk, 12);
  return content;
}

test('PNG：从 IHDR 读取宽高；文件头不完整或宽高为 0 时返回 null', () => {
  assert.deepEqual(readImageSize(png(1920, 1080), 'image/png'), { width: 1920, height: 1080 });
  assert.equal(readImageSize(png(1920, 1080).subarray(0, 20), 'image/png'), null);
  assert.equal(readImageSize(png(0, 10), 'image/png'), null);
});

test('JPEG：跳过其他段找到帧头，不把 DHT 当作帧头，渐进式（SOF2）同样可读', () => {
  assert.deepEqual(readImageSize(jpeg(640, 480), 'image/jpeg'), { width: 640, height: 480 });
  assert.deepEqual(readImageSize(jpeg(800, 600, 0xc0, true), 'image/jpeg'), { width: 800, height: 600 });
  assert.deepEqual(readImageSize(jpeg(1000, 500, 0xc2), 'image/jpeg'), { width: 1000, height: 500 });
  assert.equal(readImageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), 'image/jpeg'), null);
});

test('WebP：扩展、无损、有损三种布局都能读出宽高', () => {
  const extended = webp('VP8X', 30);
  extended.writeUIntLE(1279, 24, 3);
  extended.writeUIntLE(719, 27, 3);
  assert.deepEqual(readImageSize(extended, 'image/webp'), { width: 1280, height: 720 });

  const lossless = webp('VP8L', 30);
  lossless[20] = 0x2f;
  lossless.writeUInt32LE(((719 & 0x3fff) << 14) | (1279 & 0x3fff), 21);
  assert.deepEqual(readImageSize(lossless, 'image/webp'), { width: 1280, height: 720 });

  const lossy = webp('VP8 ', 30);
  lossy.writeUInt16LE(640, 26);
  lossy.writeUInt16LE(360, 28);
  assert.deepEqual(readImageSize(lossy, 'image/webp'), { width: 640, height: 360 });

  assert.equal(readImageSize(webp('VP8X', 20), 'image/webp'), null);
});

test('不支持的类型返回 null', () => {
  assert.equal(readImageSize(png(10, 10), 'image/gif'), null);
});

test('按文件头识别 PNG、JPEG、WebP，其他内容返回 null', () => {
  assert.equal(detectImageMime(png(10, 10)), 'image/png');
  assert.equal(detectImageMime(jpeg(10, 10)), 'image/jpeg');
  assert.equal(detectImageMime(webp('VP8X', 30)), 'image/webp');
  assert.equal(detectImageMime(Uint8Array.from([1, 2, 3])), null);
});
