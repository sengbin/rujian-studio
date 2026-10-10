// ------------------------------------------------------------------------
// 名称：shell-renderer.test.mjs
// 说明：外壳界面（标签栏与页面 iframe 管理）的 DOM 测试：标签的结构与操作、iframe 的沙箱权限、来源识别与消息转发。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-11
// 备注：使用 jsdom 加载 tsc 编译到 .test-build 的外壳模块（npm test 会先编译）；放在 ui-kit/test 是因为 npm test 在这里收集 DOM 测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);

let dom;

/** 建立全新的页面并把 document 暴露给被测模块，返回编译后的外壳模块。 */
function setup() {
  dom = new JSDOM('<!doctype html><div id="bar"></div><div id="views"></div>');
  globalThis.document = dom.window.document;
  // jsdom 没有排版，没有实现滚动到可见。
  dom.window.Element.prototype.scrollIntoView = () => {};
  return {
    bar: dom.window.document.getElementById('bar'),
    views: dom.window.document.getElementById('views'),
    ...require('../../.test-build/renderer/tab-bar.js'),
    ...require('../../.test-build/renderer/tab-state.js'),
    ...require('../../.test-build/renderer/frame-host.js')
  };
}

afterEach(() => {
  dom?.window.close();
  delete globalThis.document;
});

/** 创建带两个标签的标签栏，返回标签栏与记录的回调。 */
function createBar() {
  const env = setup();
  const state = new env.TabState();
  state.open({ key: 'a', title: '甲页' });
  state.open({ key: 'b', title: '乙页' });
  const calls = [];
  const tabBar = new env.TabBar(env.bar, state, {
    onActivate: (key) => calls.push(['activate', key]),
    onClose: (key) => calls.push(['close', key])
  });
  tabBar.render();
  return { ...env, state, calls };
}

test('标签栏：每个标签是容器加页签按钮加关闭按钮，当前标签标记为选中', () => {
  const { bar } = createBar();
  const tabs = [...bar.querySelectorAll('.tab')];
  assert.equal(tabs.length, 2);
  const labels = tabs.map((tab) => tab.querySelector('[role="tab"]'));
  assert.deepEqual(labels.map((label) => label.textContent), ['甲页', '乙页']);
  assert.deepEqual(labels.map((label) => label.getAttribute('aria-selected')), ['false', 'true']);
  assert.ok(tabs[1].classList.contains('is-active'));
  assert.equal(bar.querySelectorAll('[role="tab"] button').length, 0, '页签内不嵌套按钮');
  assert.deepEqual([...bar.querySelectorAll('.tab__close')].map((button) => button.getAttribute('aria-label')), ['关闭 甲页', '关闭 乙页']);
});

test('标签栏：点击页签按钮激活，点击关闭按钮只关闭、不激活', () => {
  const { bar, calls } = createBar();
  bar.querySelectorAll('[role="tab"]')[0].click();
  bar.querySelectorAll('.tab__close')[1].click();
  assert.deepEqual(calls, [['activate', 'a'], ['close', 'b']]);
});

test('标签栏：中键点击标签关闭它', () => {
  const { bar, calls } = createBar();
  const event = new dom.window.MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
  bar.querySelector('.tab').dispatchEvent(event);
  assert.deepEqual(calls, [['close', 'a']]);
  assert.equal(event.defaultPrevented, true);
});

test('页面 iframe：只开放脚本与表单，不加 allow-same-origin', () => {
  const { views, FrameHost } = setup();
  const frame = new FrameHost('dark').create('work-list', views, '作品');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-forms');
  assert.equal(frame.title, '作品');
  assert.ok(frame.src.startsWith('rujian-app:'));
});

test('页面 iframe：同一标识重复创建返回已有的，移除后可重新创建', () => {
  const { views, FrameHost } = setup();
  const host = new FrameHost('dark');
  const first = host.create('a', views, 'A');
  assert.equal(host.create('a', views, 'A'), first);
  assert.equal(views.querySelectorAll('iframe').length, 1);
  host.remove('a');
  assert.equal(views.querySelectorAll('iframe').length, 0);
  assert.notEqual(host.create('a', views, 'A'), first);
});

test('页面 iframe：只识别自己创建的 iframe 作为消息来源', () => {
  const { views, FrameHost } = setup();
  const host = new FrameHost('dark');
  const frame = host.create('a', views, 'A');
  assert.equal(host.frameIdOf(frame.contentWindow), 'a');
  assert.equal(host.frameIdOf(dom.window), undefined);
  assert.equal(host.frameIdOf(null), undefined);
});

test('页面 iframe：消息只发给存在的页面，切换主题通知全部页面', () => {
  const { views, FrameHost } = setup();
  const host = new FrameHost('dark');
  const frame = host.create('a', views, 'A');
  const received = [];
  frame.contentWindow.postMessage = (message, target) => received.push([message, target]);
  host.post('a', { type: 'event' });
  host.post('missing', { type: 'event' });
  host.setTheme('light');
  assert.deepEqual(received, [[{ type: 'event' }, '*'], [{ type: 'theme', theme: 'light' }, '*']]);
});
