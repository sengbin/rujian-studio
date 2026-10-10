// ------------------------------------------------------------------------
// 名称：generation-failure-copy.test.ts
// 说明：生成失败原因说明的自动化测试：应用自己产生的错误码有专门说明、每个失败分类都有名称与建议、密钥类建议与服务商无关。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯函数测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PREVIOUS_GROUP_UNAVAILABLE_CODE, describeJobFailure } from './generation-failure-copy';
import { TAIL_FRAME_UNAVAILABLE_CODE } from './tail-frame-rules';

test('失败说明：应用自己产生的错误码有专门的说明，其他错误码按分类', () => {
  const unavailable = describeJobFailure({ category: 'invalid_request', code: PREVIOUS_GROUP_UNAVAILABLE_CODE, message: 'x' });
  assert.match(unavailable.label, /上一组/);
  assert.match(describeJobFailure({ category: 'invalid_request', code: TAIL_FRAME_UNAVAILABLE_CODE, message: 'x' }).label, /尾帧/);
  assert.equal(describeJobFailure({ category: 'server', code: 'constructor', message: 'x' }).label, '服务端错误');
});

test('失败原因说明：每一类都有名称与处理建议，内容审核类指引修改镜头', () => {
  const categories = ['auth', 'rate_limited', 'invalid_request', 'content_rejected', 'server', 'network'] as const;
  for (const category of categories) {
    const described = describeJobFailure({ category, code: null, message: 'm' });
    assert.ok(described.label !== '' && described.hint !== '');
  }
  const rejected = describeJobFailure({ category: 'content_rejected', code: 'DataInspectionFailed', message: 'x' });
  assert.equal(rejected.label, '内容审核未通过');
  assert.match(rejected.hint, /编辑镜头/);
});

test('失败原因说明：密钥类建议与服务商无关，不指向某一家的控制台', () => {
  const auth = describeJobFailure({ category: 'auth', code: null, message: 'm' });
  assert.match(auth.hint, /访问密钥是否正确.*是否有权限使用该模型/);
  assert.ok(!/火山|方舟|千问|MiniMax/.test(auth.hint), auth.hint);
});
