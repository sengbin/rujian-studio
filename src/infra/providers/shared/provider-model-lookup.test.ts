// ------------------------------------------------------------------------
// 名称：provider-model-lookup.test.ts
// 说明：服务商模型目录查找的自动化测试：按代码查找模型。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-11
// 备注：纯函数测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findDescribedModelByCode, findModelByCode } from './provider-model-lookup';

test('按代码查找模型：直接带 code 的目录与包在 descriptor 里的目录，找不到返回 undefined', () => {
  const plain = [{ code: 'a' }, { code: 'b' }];
  assert.equal(findModelByCode(plain, 'b'), plain[1]);
  assert.equal(findModelByCode(plain, 'x'), undefined);
  const wrapped = [{ descriptor: { code: 'a' }, extra: 1 }, { descriptor: { code: 'b' }, extra: 2 }];
  assert.equal(findDescribedModelByCode(wrapped, 'b'), wrapped[1]);
  assert.equal(findDescribedModelByCode(wrapped, 'x'), undefined);
});
