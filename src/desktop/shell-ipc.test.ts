// ------------------------------------------------------------------------
// 名称：shell-ipc.test.ts
// 说明：外壳 IPC 的自动化测试：只接受应用窗口发来的消息，消息格式不对时忽略，初始状态只对应用窗口返回。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-11
// 备注：用假的 ipcMain 和窗口代替 Electron；外壳桥使用真实实现，发送内容由假通道记录。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BrowserWindow, IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { MessageRouter } from '../app/messaging/message-router';
import { ShellBridge } from '../app/shell/shell-bridge';
import { SHELL_CHANNELS } from '../app/shell/shell-channels';
import { registerShellIpc } from './shell-ipc';

/** 假的 ipcMain：记录注册的处理函数，供测试直接调用。 */
class FakeIpc {
  readonly listeners = new Map<string, (event: IpcMainEvent, ...args: unknown[]) => void>();
  readonly handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();

  on(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): this {
    this.listeners.set(channel, listener);
    return this;
  }

  handle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, handler);
  }
}

/** 创建一个假的应用窗口和一个来源不同的假发送方。 */
function createFixture() {
  const appContents = {};
  const window = { webContents: appContents, isDestroyed: () => false } as unknown as BrowserWindow;
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const bridge = new ShellBridge({ send: (channel, payload) => void sent.push({ channel, payload }) });
  bridge.registerFrame('a', { router: new MessageRouter().register('ping', () => 'pong'), html: '' });
  const closedKeys: string[] = [];
  bridge.onTabClosed((key) => closedKeys.push(key));
  const ipc = new FakeIpc();
  registerShellIpc(bridge, () => window, () => 'dark', ipc as unknown as Pick<IpcMain, 'on' | 'handle'>);
  return {
    ipc,
    sent,
    closedKeys,
    fromApp: { sender: appContents } as unknown as IpcMainEvent,
    fromOther: { sender: {} } as unknown as IpcMainEvent
  };
}

/** 等待异步处理的消息完成。 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

test('应用窗口发来的页面消息交给外壳桥处理', async () => {
  const { ipc, sent, fromApp } = createFixture();
  ipc.listeners.get(SHELL_CHANNELS.fromFrame)?.(fromApp, { frameId: 'a', message: { type: 'request', requestId: 1, name: 'ping' } });
  await settle();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].payload, { frameId: 'a', message: { type: 'response', requestId: 1, ok: true, data: 'pong' } });
});

test('其他来源发来的页面消息被忽略', async () => {
  const { ipc, sent, fromOther } = createFixture();
  ipc.listeners.get(SHELL_CHANNELS.fromFrame)?.(fromOther, { frameId: 'a', message: { type: 'request', requestId: 1, name: 'ping' } });
  await settle();
  assert.equal(sent.length, 0);
});

test('页面消息的格式不对时被忽略', async () => {
  const { ipc, sent, fromApp } = createFixture();
  const listener = ipc.listeners.get(SHELL_CHANNELS.fromFrame);
  listener?.(fromApp, null);
  listener?.(fromApp, 'text');
  listener?.(fromApp, { frameId: 5, message: {} });
  await settle();
  assert.equal(sent.length, 0);
});

test('标签关闭通知只接受应用窗口发来的字符串键', () => {
  const { ipc, closedKeys, fromApp, fromOther } = createFixture();
  const listener = ipc.listeners.get(SHELL_CHANNELS.tabClosed);
  listener?.(fromOther, 'work-list');
  listener?.(fromApp, 42);
  listener?.(fromApp, 'work-list');
  assert.deepEqual(closedKeys, ['work-list']);
});

test('初始状态只对应用窗口返回，其他来源调用时报错', () => {
  const { ipc, fromApp, fromOther } = createFixture();
  const handler = ipc.handlers.get(SHELL_CHANNELS.ready);
  assert.deepEqual(handler?.(fromApp as unknown as IpcMainInvokeEvent), { theme: 'dark' });
  assert.throws(() => handler?.(fromOther as unknown as IpcMainInvokeEvent), /只有应用窗口可以调用/);
});
