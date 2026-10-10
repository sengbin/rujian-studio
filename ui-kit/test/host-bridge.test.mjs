// ------------------------------------------------------------------------
// 名称：host-bridge.test.mjs
// 说明：页面通信桥的自动化测试：请求发给父窗口并按编号匹配响应、事件订阅、只接受父窗口的消息、响应主题切换。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：在 vm 中用假的 window、document 运行 resources/shared/host-bridge.js。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources', 'shared', 'host-bridge.js'), 'utf8');

/** 记录类名变化的假元素。 */
function createElement() {
  const classes = new Set();
  return {
    classes,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name))
    }
  };
}

/** 加载通信桥，返回假窗口与可触发消息的函数。 */
function loadBridge() {
  const posted = [];
  const listeners = [];
  const parent = { postMessage: (message, target) => posted.push({ message, target }) };
  const window = { parent, addEventListener: (type, listener) => listeners.push({ type, listener }) };
  const document = { documentElement: createElement(), body: createElement() };
  vm.runInNewContext(SOURCE, { window, document });
  const dispatch = (data, source = parent) => listeners.filter((item) => item.type === 'message').forEach((item) => item.listener({ data, source }));
  return { window, document, posted, parent, dispatch };
}

test('请求发给父窗口，响应按 requestId 匹配：成功时返回数据，失败时以错误载荷拒绝', async () => {
  const { window, posted, dispatch } = loadBridge();
  const ok = window.hostBridge.request('ping', { a: 1 });
  const failed = window.hostBridge.request('boom');

  // vm 中创建的对象与当前上下文不是同一个 realm，先经 JSON 往返再比较。
  assert.deepEqual(JSON.parse(JSON.stringify(posted[0])), { message: { type: 'request', requestId: 1, name: 'ping', payload: { a: 1 } }, target: '*' });
  dispatch({ type: 'response', requestId: 2, ok: false, error: { kind: 'validation', message: '无效' } });
  dispatch({ type: 'response', requestId: 1, ok: true, data: 'pong' });

  assert.equal(await ok, 'pong');
  await assert.rejects(failed, (error) => error.kind === 'validation');
});

test('事件按名称分发给订阅者', () => {
  const { window, dispatch } = loadBridge();
  const received = [];
  window.hostBridge.onEvent('changed', (payload) => received.push(payload));

  dispatch({ type: 'event', name: 'changed', payload: 1 });
  dispatch({ type: 'event', name: 'other', payload: 2 });

  assert.deepEqual(received, [1]);
});

test('只接受父窗口发来的消息', async () => {
  const { window, dispatch } = loadBridge();
  const received = [];
  window.hostBridge.onEvent('changed', (payload) => received.push(payload));

  dispatch({ type: 'event', name: 'changed', payload: 1 }, { postMessage: () => undefined });
  dispatch({ type: 'event', name: 'changed', payload: 2 });

  assert.deepEqual(received, [2]);
});

test('主题消息切换 html 与 body 的亮暗类，非法主题被忽略', () => {
  const { document, dispatch } = loadBridge();

  dispatch({ type: 'theme', theme: 'light' });
  assert.deepEqual([...document.documentElement.classes], ['theme-light']);
  assert.deepEqual([...document.body.classes], ['theme-light']);

  dispatch({ type: 'theme', theme: 'dark' });
  assert.deepEqual([...document.body.classes], ['theme-dark']);

  dispatch({ type: 'theme', theme: 'neon' });
  assert.deepEqual([...document.body.classes], ['theme-dark']);
});
