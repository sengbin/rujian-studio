// ------------------------------------------------------------------------
// 名称：shell-bridge.test.ts
// 说明：外壳桥的自动化测试：页面请求的路由与回复、事件推送、页面注销后的静默，以及标签命令的转发。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：用记录发送内容的假通道代替 Electron。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageRouter } from '../messaging/message-router';
import { ShellBridge } from './shell-bridge';
import { SHELL_CHANNELS } from './shell-channels';

/** 创建带记录的外壳桥。 */
function createFixture() {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const bridge = new ShellBridge({ send: (channel, payload) => void sent.push({ channel, payload }) });
  return { bridge, sent };
}

test('页面请求交给该页面的路由器，响应发回同一页面', async () => {
  const { bridge, sent } = createFixture();
  bridge.registerFrame('a', { router: new MessageRouter().register('ping', () => 'pong'), html: '<p>a</p>' });

  await bridge.handleFrameMessage('a', { type: 'request', requestId: 7, name: 'ping' });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, SHELL_CHANNELS.toFrame);
  assert.deepEqual(sent[0].payload, { frameId: 'a', message: { type: 'response', requestId: 7, ok: true, data: 'pong' } });
});

test('未登记的页面发来的消息被忽略', async () => {
  const { bridge, sent } = createFixture();
  await bridge.handleFrameMessage('missing', { type: 'request', requestId: 1, name: 'ping' });
  assert.equal(sent.length, 0);
});

test('请求处理期间页面被注销，不再回复', async () => {
  const { bridge, sent } = createFixture();
  bridge.registerFrame('a', {
    router: new MessageRouter().register('slow', async () => {
      bridge.unregisterFrame('a');
      return 1;
    }),
    html: ''
  });

  await bridge.handleFrameMessage('a', { type: 'request', requestId: 1, name: 'slow' });

  assert.equal(sent.length, 0);
});

test('事件推送给已登记的页面，注销后不再推送', () => {
  const { bridge, sent } = createFixture();
  bridge.registerFrame('a', { router: new MessageRouter(), html: '' });

  bridge.postEvent('a', 'changed', { id: 1 });
  bridge.unregisterFrame('a');
  bridge.postEvent('a', 'changed');

  assert.deepEqual(sent.map((item) => item.payload), [{ frameId: 'a', message: { type: 'event', name: 'changed', payload: { id: 1 } } }]);
});

test('可读取已登记页面的 HTML，未登记时为 undefined', () => {
  const { bridge } = createFixture();
  bridge.registerFrame('a', { router: new MessageRouter(), html: '<p>a</p>' });
  assert.equal(bridge.getFrameHtml('a'), '<p>a</p>');
  assert.equal(bridge.getFrameHtml('b'), undefined);
});

test('打开、聚焦、关闭标签与主题变化都转发给外壳', () => {
  const { bridge, sent } = createFixture();
  bridge.openTab({ key: 'k', title: '标题' });
  bridge.revealTab('k');
  bridge.closeTab('k');
  bridge.notifyThemeChanged('light');

  assert.deepEqual(sent, [
    { channel: SHELL_CHANNELS.openTab, payload: { key: 'k', title: '标题' } },
    { channel: SHELL_CHANNELS.revealTab, payload: 'k' },
    { channel: SHELL_CHANNELS.closeTab, payload: 'k' },
    { channel: SHELL_CHANNELS.themeChanged, payload: 'light' }
  ]);
});

test('外壳回报标签关闭时通知全部订阅者', () => {
  const { bridge } = createFixture();
  const closed: string[] = [];
  bridge.onTabClosed((key) => closed.push(`1:${key}`));
  bridge.onTabClosed((key) => closed.push(`2:${key}`));

  bridge.handleTabClosed('k');

  assert.deepEqual(closed, ['1:k', '2:k']);
});
