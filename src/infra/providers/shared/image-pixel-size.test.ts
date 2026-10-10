// ------------------------------------------------------------------------
// 名称：image-pixel-size.test.ts
// 说明：画幅换算像素尺寸的自动化测试。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-11
// 备注：纯函数测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toPixelSize } from './image-pixel-size';

test('画幅换算像素尺寸：宽高是步长的整数倍，总像素不超过上限', () => {
  assert.deepEqual(toPixelSize('1:1', 1_048_576, 16), { width: 1024, height: 1024 });
  const wide = toPixelSize('16:9', 2_073_600, 16);
  assert.equal(wide.width % 16, 0);
  assert.equal(wide.height % 16, 0);
  assert.ok(wide.width * wide.height <= 2_073_600);
  assert.ok(wide.width > wide.height);
});
