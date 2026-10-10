// ------------------------------------------------------------------------
// 名称：text-model-selection.test.ts
// 说明：文本模型选择键的自动化测试：生成与解析。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-03
// 备注：纯函数测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTextModelKey, providerModelKey } from './text-model-selection';

test('服务商模型键：服务商代码与模型代码往返解析，模型代码可以含斜杠', () => {
  const key = providerModelKey('qianwen', 'qwen3.8-max');
  assert.equal(key, 'model:qianwen/qwen3.8-max');
  assert.deepEqual(parseTextModelKey(key), { providerCode: 'qianwen', modelCode: 'qwen3.8-max' });
  assert.deepEqual(parseTextModelKey('model:siliconflow/deepseek/v3'), { providerCode: 'siliconflow', modelCode: 'deepseek/v3' });
});

test('格式不正确的键无法解析', () => {
  for (const key of ['', 'gpt-4o', 'other:', 'other:gpt-4o', 'model:', 'model:qianwen', 'model:/x', 'model:qianwen/', `model:a/${'x'.repeat(200)}`]) {
    assert.equal(parseTextModelKey(key), undefined, key);
  }
});
