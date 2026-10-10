// ------------------------------------------------------------------------
// 名称：panel-tabs.test.ts
// 说明：页面标签管理器的自动化测试：同一键只开一个标签、重复打开时聚焦、两种关闭路径的同步与页面 HTML 装配。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：用记录发送内容的假通道代替 Electron。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageRouter } from '../messaging/message-router';
import { ShellBridge } from '../shell/shell-bridge';
import { SHELL_CHANNELS } from '../shell/shell-channels';
import { PanelTabs, PanelOptions } from './panel-tabs';

const OPTIONS: PanelOptions = {
  key: 'project-list',
  title: '所有项目',
  description: '浏览项目。',
  styles: ['resources/a.css'],
  scripts: ['resources/a.js'],
  router: new MessageRouter()
};

/** 创建面板管理器夹具。 */
function createFixture() {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const bridge = new ShellBridge({ send: (channel, payload) => void sent.push({ channel, payload }) });
  const panels = new PanelTabs(bridge, () => 'light');
  const channels = (): string[] => sent.map((item) => item.channel);
  return { bridge, panels, sent, channels };
}

test('打开页面：登记页面 HTML（带资源地址与主题）并让外壳打开标签', () => {
  const { bridge, panels, sent } = createFixture();
  panels.open(OPTIONS);

  assert.deepEqual(sent, [{ channel: SHELL_CHANNELS.openTab, payload: { key: 'project-list', title: '所有项目' } }]);
  const html = bridge.getFrameHtml('project-list') ?? '';
  assert.match(html, /href="rujian-app:\/\/res\/resources\/a\.css"/);
  assert.match(html, /src="rujian-app:\/\/res\/resources\/a\.js"/);
  assert.match(html, /<body class="theme-light">/);
});

test('同一键重复打开只聚焦已有标签并返回同一个句柄', () => {
  const { panels, channels } = createFixture();
  const first = panels.open(OPTIONS);
  const second = panels.open(OPTIONS);

  assert.equal(first, second);
  assert.deepEqual(channels(), [SHELL_CHANNELS.openTab, SHELL_CHANNELS.revealTab]);
});

test('reveal：已存在时聚焦并返回 true，不存在时返回 false', () => {
  const { panels, channels } = createFixture();
  assert.equal(panels.reveal('project-list'), false);
  panels.open(OPTIONS);
  assert.equal(panels.reveal('project-list'), true);
  assert.deepEqual(channels(), [SHELL_CHANNELS.openTab, SHELL_CHANNELS.revealTab]);
});

test('用户在外壳关闭标签：通知关闭监听者、注销页面，之后可以重新打开', () => {
  const { bridge, panels, channels } = createFixture();
  const handle = panels.open(OPTIONS);
  let closed = 0;
  handle.onDidClose(() => (closed += 1));

  bridge.handleTabClosed('project-list');

  assert.equal(closed, 1);
  assert.equal(bridge.getFrameHtml('project-list'), undefined);
  assert.equal(panels.reveal('project-list'), false);
  panels.open(OPTIONS);
  assert.equal(channels().filter((channel) => channel === SHELL_CHANNELS.openTab).length, 2);
});

test('页面主动关闭：通知监听者并让外壳关闭标签，重复关闭不重复通知', () => {
  const { panels, channels } = createFixture();
  const handle = panels.open(OPTIONS);
  let closed = 0;
  handle.onDidClose(() => (closed += 1));

  handle.close();
  handle.close();

  assert.equal(closed, 1);
  assert.deepEqual(channels(), [SHELL_CHANNELS.openTab, SHELL_CHANNELS.closeTab]);
});

test('推送事件：标签存在时发给该页面，关闭后忽略', () => {
  const { panels, sent } = createFixture();
  const handle = panels.open(OPTIONS);
  handle.postEvent('projects.changed');
  handle.close();
  handle.postEvent('projects.changed');

  const events = sent.filter((item) => item.channel === SHELL_CHANNELS.toFrame);
  assert.equal(events.length, 1);
});

test('不同键的页面互不影响', () => {
  const { panels } = createFixture();
  const first = panels.open(OPTIONS);
  const second = panels.open({ ...OPTIONS, key: 'workbench', title: '生成工作台' });

  assert.notEqual(first, second);
  second.close();
  assert.equal(panels.reveal('project-list'), true);
  assert.equal(panels.reveal('workbench'), false);
});
