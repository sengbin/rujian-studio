// ------------------------------------------------------------------------
// 名称：compensation.test.ts
// 说明：补偿执行的测试：步骤成功不补偿；失败时补偿并抛出原错误；补偿失败只记录日志，不掩盖原错误。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：无外部依赖。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runWithCompensation } from './compensation';

test('步骤成功：返回结果，不执行补偿', async () => {
  let compensated = false;
  const result = await runWithCompensation(
    async () => 7,
    () => {
      compensated = true;
    },
    '补偿失败'
  );
  assert.equal(result, 7);
  assert.equal(compensated, false);
});

test('步骤失败：执行补偿并抛出原错误', async () => {
  const original = new Error('步骤失败');
  let compensated = false;
  await assert.rejects(
    () =>
      runWithCompensation(
        async () => {
          throw original;
        },
        () => {
          compensated = true;
        },
        '补偿失败'
      ),
    (error) => error === original
  );
  assert.equal(compensated, true);
});

test('补偿失败：记录日志，仍抛出原错误', async () => {
  const original = new Error('步骤失败');
  const compensationError = new Error('补偿也失败');
  const logged: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    await assert.rejects(
      () =>
        runWithCompensation(
          async () => {
            throw original;
          },
          () => {
            throw compensationError;
          },
          '撤销失败'
        ),
      (error) => error === original
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.deepEqual(logged, [['撤销失败', compensationError]]);
});
