// ------------------------------------------------------------------------
// 名称：sidebar-html.test.ts
// 说明：侧栏页面 HTML 与降级菜单的自动化测试：提示与底部状态条的渲染、转义、主题类、降级菜单只保留数据备份入口且可点击处理。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-03
// 备注：不依赖 Electron。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageRouter } from '../app/messaging/message-router';
import { SidebarActionRegistry } from './sidebar-actions';
import { createSidebarHtml } from './sidebar-html';
import { SIDEBAR_REQUESTS, registerSidebarHandlers } from './sidebar-handlers';
import { DATABASE_UNAVAILABLE_NOTICE_PREFIX, DEGRADED_SIDEBAR_SECTIONS, SIDEBAR_SECTIONS } from './sidebar-menu-config';
import { buildSidebarStatus } from './sidebar-status';

const BASE_OPTIONS = {
  cspSource: 'rujian-app:',
  styleUris: ['a.css'],
  scriptUris: ['a.js'],
  version: '1.2.3',
  status: buildSidebarStatus({ databaseReady: true, enabledModelCount: 3 })
};

test('样式表加载前页面隐藏且不播放过渡，内联样式用 nonce 放行', () => {
  const html = createSidebarHtml({ ...BASE_OPTIONS, sections: SIDEBAR_SECTIONS });
  const nonce = /<style nonce="([^"]+)">/.exec(html)?.[1];
  assert.ok(nonce, '有带 nonce 的内联样式');
  assert.ok(html.includes(`style-src rujian-app: 'nonce-${nonce}'`));
  assert.match(html, /html:not\(\.is-ready\) body \{ visibility: hidden; \}/);
  assert.match(html, /html:not\(\.is-ready\) \* \{ transition: none !important; \}/);
  assert.ok(html.indexOf('<style nonce') < html.indexOf('rel="stylesheet"'), '先于外部样式表');
});

test('没有提示时不渲染提示卡片', () => {
  const html = createSidebarHtml({ ...BASE_OPTIONS, sections: SIDEBAR_SECTIONS });
  assert.ok(!html.includes('class="notice"'));
});

test('html 与 body 带主题类，缺省为深色', () => {
  const dark = createSidebarHtml({ ...BASE_OPTIONS, sections: SIDEBAR_SECTIONS });
  assert.match(dark, /<html lang="zh-CN" class="vscode-dark">/);
  assert.match(dark, /<body class="vscode-dark">/);
  const light = createSidebarHtml({ ...BASE_OPTIONS, sections: SIDEBAR_SECTIONS, theme: 'light' });
  assert.match(light, /<html lang="zh-CN" class="vscode-light">/);
  assert.match(light, /<body class="vscode-light">/);
});

test('设置分区包含“导出手册 Skill”入口，没有首次使用提示条', () => {
  const html = createSidebarHtml({ ...BASE_OPTIONS, sections: SIDEBAR_SECTIONS });
  assert.ok(html.includes('data-item-id="manual-export"'));
  assert.ok(!html.includes('welcome-tip'));
});

test('分区标题、菜单入口和尾部操作前都有内联 SVG 图标', () => {
  const html = createSidebarHtml({ ...BASE_OPTIONS, sections: SIDEBAR_SECTIONS });
  const items = SIDEBAR_SECTIONS.flatMap((section) => section.items);
  const countIcons = (openTag: string): number => html.split(new RegExp(`${openTag}[^>]*><svg class="menu-icon"`)).length - 1;

  assert.equal(countIcons('<h2'), SIDEBAR_SECTIONS.length);
  assert.equal(countIcons('<button class="menu-main"'), items.length);
  assert.equal(countIcons('<button class="menu-action"'), items.filter((item) => item.actionLabel !== undefined).length);
  assert.ok(!html.includes('<span>创建</span>') && !html.includes('<span>添加</span>'), '尾部操作只显示图标');
  assert.ok(html.includes('aria-label="创建：所有项目"') && html.includes('aria-label="添加：剧本"'), '尾部操作保留可访问名称');
  assert.ok(items.every((item) => item.actionLabel === undefined || item.actionIcon !== undefined), '有尾部操作的菜单行都配了图标');
  assert.ok(!html.includes('<img') && !html.includes('<use'), '图标必须内联，不引用外部文件');
});

test('底部状态条：位于菜单之后，含各状态条目和版本号，不重复显示应用名', () => {
  const html = createSidebarHtml({ ...BASE_OPTIONS, sections: SIDEBAR_SECTIONS });

  assert.ok(html.indexOf('<footer class="status-bar"') > html.lastIndexOf('class="menu-row"'), '状态条在菜单之后');
  assert.ok(html.includes('<span class="status-value status-version">v1.2.3</span>'));
  assert.ok(!html.slice(html.indexOf('<footer')).includes('如见 Studio'), '应用名不在状态条里重复显示');
  assert.ok(html.includes('data-status-id="database"') && html.includes('<span class="status-value" data-level="normal">正常</span>'));
  assert.ok(html.includes('data-status-id="models"') && html.includes('<span class="status-value" data-level="normal">已启用 3 个</span>'));
});

test('底部状态条：降级模式只显示不可用的数据库状态，并以文字和等级表达', () => {
  const status = buildSidebarStatus({ databaseReady: false });
  const html = createSidebarHtml({ ...BASE_OPTIONS, sections: DEGRADED_SIDEBAR_SECTIONS, status });

  assert.ok(html.includes('<span class="status-value" data-level="error">不可用</span>'));
  assert.ok(!html.includes('data-status-id="models"'));
});

test('有提示时渲染在菜单上方，带 alert 角色，并转义 HTML', () => {
  const notice = `${DATABASE_UNAVAILABLE_NOTICE_PREFIX}无法解析 <script>alert(1)</script> & "文件"`;
  const html = createSidebarHtml({ ...BASE_OPTIONS, sections: DEGRADED_SIDEBAR_SECTIONS, notice });

  assert.match(html, /<p class="notice" role="alert">数据库无法打开：/);
  assert.ok(!html.includes('<script>alert(1)'), '提示中的标记必须被转义');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;文件&quot;'));
  assert.ok(html.indexOf('class="notice"') < html.indexOf('class="menu-row"'), '提示在菜单之前');
});

test('降级菜单：只有数据备份（恢复）一个入口，没有尾部操作，条目标识与完整菜单中的数据备份一致', () => {
  const items = DEGRADED_SIDEBAR_SECTIONS.flatMap((section) => section.items);
  assert.deepEqual(items, [{ id: 'data-backup', title: '数据备份（恢复）', icon: 'database-export' }]);

  const fullMenuItem = SIDEBAR_SECTIONS.flatMap((section) => section.items).find((item) => item.id === 'data-backup');
  assert.ok(fullMenuItem !== undefined, '完整菜单中存在同一个条目');
  assert.equal(createSidebarHtml({ ...BASE_OPTIONS, sections: DEGRADED_SIDEBAR_SECTIONS }).split('menu-row').length - 1, 1);
});

test('降级菜单：点击数据备份入口由注册的动作处理，其他入口不存在', async () => {
  let opened = 0;
  const registry = new SidebarActionRegistry(DEGRADED_SIDEBAR_SECTIONS).register('data-backup', 'main', () => void (opened += 1));
  const router = new MessageRouter();
  registerSidebarHandlers(router, registry, () => []);
  const click = (itemId: string) => router.handle({ type: 'request', requestId: 1, name: SIDEBAR_REQUESTS.open, payload: { itemId, target: 'main' } });

  const handled = await click('data-backup');
  assert.ok(handled?.ok && (handled.data as { handled: boolean }).handled);
  assert.equal(opened, 1);

  const other = await click('project-list');
  assert.ok(other?.ok && !(other.data as { handled: boolean }).handled, '降级菜单没有其他入口，点击视为尚未开放');
  assert.throws(() => registry.register('project-list', 'main', () => undefined), /不存在菜单行/);
});