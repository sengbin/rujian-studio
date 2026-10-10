// ------------------------------------------------------------------------
// 名称：page-format.test.mjs
// 说明：页面共用脚本 page-format.js 的测试：日期时间与字节格式化、错误说明文字、请求封装、表单打开器与 Base64 解码。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：使用 jsdom 加载组件库与 resources/shared 下的页面共用脚本；宿主通信桥用假实现。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createUiEnvironment } from './ui-environment.mjs';

let env;

/** 每个用例使用全新的页面，结束后释放。 */
function setup() {
  env = createUiEnvironment();
  return { format: env.window.pageFormat, ui: env.aiUi, window: env.window };
}

afterEach(() => env?.close());

/** 构造一个记录显示内容的假提示区。 */
function fakeMessage() {
  const calls = [];
  return { calls, show: (text, isError) => calls.push([text, Boolean(isError)]) };
}

test('日期时间与字节：沿用中文本地格式和组件库的字节规则', () => {
  const { format } = setup();
  const iso = '2026-10-10T08:09:10.000Z';
  assert.equal(format.formatDateTime(iso), new Date(iso).toLocaleString('zh-CN'));
  assert.equal(format.formatBytes(1536), '1.5 KB');
  assert.equal(format.formatBytes(12), '12 B');
});

test('错误文字：字段错误逐项换行列出，否则取错误说明，都没有用通用提示', () => {
  const { format } = setup();
  assert.equal(format.errorText({ fieldErrors: { a: '甲错', b: '乙错' }, message: '总说明' }), '甲错\n乙错');
  assert.equal(format.errorText({ fieldErrors: {}, message: '总说明' }), '总说明');
  assert.equal(format.errorText(new Error('出错了')), '出错了');
  assert.equal(format.errorText({}), '操作失败，请重试。');
  assert.equal(format.errorText(undefined), '操作失败，请重试。');
});

test('请求封装：成功返回数据，失败把错误文字交给回调并返回 undefined', async () => {
  const { format } = setup();
  const errors = [];
  assert.equal(await format.requestAction(async () => 7, (text) => errors.push(text)), 7);
  assert.equal(await format.requestAction(async () => Promise.reject(new Error('坏了')), (text) => errors.push(text)), undefined);
  assert.deepEqual(errors, ['坏了']);
});

test('动作执行器：先清除提示再请求，失败时显示原因；提示区可由函数延后给出', async () => {
  const { format, window } = setup();
  const requests = [];
  window.hostBridge = {
    request: async (name, payload) => {
      requests.push([name, payload]);
      if (name === 'bad') throw new Error('服务不可用');
      return { ok: name };
    }
  };
  const message = fakeMessage();
  const run = format.createActionRunner(message);
  assert.deepEqual(await run('good', { id: 1 }), { ok: 'good' });
  assert.equal(await run('bad'), undefined);
  assert.deepEqual(message.calls, [['', false], ['', false], ['服务不可用', true]]);
  assert.deepEqual(requests, [['good', { id: 1 }], ['bad', undefined]]);

  let current = null;
  const lazy = format.createActionRunner(() => current);
  assert.equal(await lazy('bad'), undefined, '没有提示区时不报错');
  current = fakeMessage();
  await lazy('bad');
  assert.deepEqual(current.calls, [['', false], ['服务不可用', true]]);
});

test('表单打开器：已有表单打开时忽略新的请求，关闭后可再次打开，独占流程同样互斥', async () => {
  const { format } = setup();
  const opened = [];
  const releases = [];
  const forms = {
    open: (options) =>
      new Promise((resolve) => {
        opened.push(options.form);
        releases.push(resolve);
      })
  };
  const opener = format.createFormOpener(forms);
  assert.equal(opener.isOpen(), false);
  const first = opener.open({ form: 'a' });
  assert.equal(opener.isOpen(), true);
  assert.equal(await opener.open({ form: 'b' }), undefined);
  assert.equal(await opener.runExclusive(async () => 'x'), undefined);
  assert.deepEqual(opened, ['a']);
  releases[0](true);
  assert.equal(await first, true);
  assert.equal(opener.isOpen(), false);

  const second = opener.open({ form: 'c' });
  releases[1](false);
  assert.equal(await second, false);
  assert.equal(await opener.runExclusive(async () => 'done'), 'done');
});

test('表单打开器：打开失败后也会释放占用', async () => {
  const { format } = setup();
  const opener = format.createFormOpener({ open: async () => Promise.reject(new Error('打不开')) });
  await assert.rejects(() => opener.open({ form: 'a' }), /打不开/);
  assert.equal(opener.isOpen(), false);
});

test('Base64 解码：还原字节', () => {
  const { format } = setup();
  assert.deepEqual([...format.decodeBase64('AQID')], [1, 2, 3]);
});
