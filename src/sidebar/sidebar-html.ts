// ------------------------------------------------------------------------
// 名称：sidebar-html.ts
// 说明：侧栏页面的 HTML 标记生成，按菜单配置渲染分区和菜单行，可在菜单上方显示提示，并在页面底部显示状态条。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：分区标题、菜单行与按钮前的图标为内联 SVG（见 sidebar-icons.ts）；样式与脚本位于 resources 目录，由外部文件引用；清单见 app/panels/page-resources.ts。
// ------------------------------------------------------------------------

import { createNonce, escapeHtml } from '../app/panels/html-utils';
import { ShellTheme } from '../app/shell/shell-channels';
import { renderSidebarIcon } from './sidebar-icons';
import { SidebarMenuItem, SidebarMenuSection } from './sidebar-menu-config';
import { SidebarStatusEntry } from './sidebar-status';

/** 页面脚本执行（此时样式表已加载）前隐藏页面并关闭过渡，避免先以浏览器默认样式闪现再渐变成主题样式；脚本给 html 加上 is-ready 后解除。 */
const PRELOAD_GUARD_STYLE = 'html:not(.is-ready) body { visibility: hidden; } html:not(.is-ready) * { transition: none !important; }';

/** 生成侧栏 HTML 所需的输入。 */
export interface SidebarHtmlOptions {
  /** CSP 来源，用于放行外部样式文件。 */
  readonly cspSource: string;
  /** 样式文件地址，按顺序引用。 */
  readonly styleUris: readonly string[];
  /** 脚本文件地址，按顺序执行。 */
  readonly scriptUris: readonly string[];
  readonly sections: readonly SidebarMenuSection[];
  /** 显示在菜单上方的提示（如数据库无法打开的原因）；缺省不显示。 */
  readonly notice?: string;
  /** 初始主题，写入 html 与 body 的类；缺省为深色。 */
  readonly theme?: ShellTheme;
  /** 底部状态条显示的应用版本号，不含 v 前缀。 */
  readonly version: string;
  /** 底部状态条的条目。 */
  readonly status: readonly SidebarStatusEntry[];
}

/**
 * 生成侧栏页面的完整 HTML。
 * @param options 资源地址与菜单分区。
 * @returns 可直接作为页面返回的 HTML 字符串。
 */
export function createSidebarHtml(options: SidebarHtmlOptions): string {
  const nonce = createNonce();
  const themeClass = `theme-${options.theme ?? 'dark'}`;
  const noticeHtml = options.notice === undefined ? [] : [renderNotice(options.notice)];
  const sectionsHtml = [...noticeHtml, ...options.sections.map(renderSection)].join('\n');
  const styleTags = options.styleUris.map((uri) => `  <link rel="stylesheet" href="${escapeHtml(uri)}">`).join('\n');
  const scriptTags = options.scriptUris
    .map((uri) => `  <script nonce="${nonce}" src="${escapeHtml(uri)}"></script>`)
    .join('\n');
  return `<!doctype html>
<html lang="zh-CN" class="${themeClass}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${options.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">${PRELOAD_GUARD_STYLE}</style>
${styleTags}
</head>
<body class="${themeClass}">
  <main>
${sectionsHtml}
  </main>
${renderStatusBar(options.version, options.status)}
${scriptTags}
</body>
</html>`;
}

/** 渲染页面底部状态条：数据库、模型等状态条目（文案由页面脚本按 data-status-id 刷新），最后是版本号。 */
function renderStatusBar(version: string, entries: readonly SidebarStatusEntry[]): string {
  const rows = entries
    .map(
      (entry) => `      <li class="status-item" data-status-id="${entry.id}">${renderSidebarIcon(entry.icon)}<span class="status-label">${escapeHtml(entry.label)}</span><span class="status-value" data-level="${entry.level}">${escapeHtml(entry.value)}</span></li>`
    )
    .join('\n');
  const versionRow = `      <li class="status-item">${renderSidebarIcon('tag')}<span class="status-label">版本</span><span class="status-value status-version">v${escapeHtml(version)}</span></li>`;
  return `  <footer class="status-bar" aria-label="应用状态">
    <ul class="status-list">
${rows}
${versionRow}
    </ul>
  </footer>`;
}

/** 渲染提示卡片；用 alert 角色让读屏软件立即读出。 */
function renderNotice(notice: string): string {
  return `    <section class="card">
      <div class="card-inner card-flat">
        <p class="notice" role="alert">${escapeHtml(notice)}</p>
      </div>
    </section>`;
}

/** 渲染一个分区卡片及其菜单行。 */
function renderSection(section: SidebarMenuSection): string {
  const headingId = `section-heading-${section.id}`;
  const rows = section.items.map(renderItem).join('\n');
  return `    <section class="card" aria-labelledby="${headingId}">
      <div class="card-inner card-${section.surface}">
        <h2 id="${headingId}">${renderSidebarIcon(section.icon)}<span>${escapeHtml(section.title)}</span></h2>
        <nav aria-label="${escapeHtml(section.title)}">
${rows}
        </nav>
      </div>
    </section>`;
}

/** 渲染一个菜单行：带图标的主入口按钮（可带小标签），以及可选的带图标尾部操作按钮。 */
function renderItem(item: SidebarMenuItem): string {
  const title = escapeHtml(item.title);
  const hoverTitle = escapeHtml(item.badge === undefined ? item.title : `${item.title}（${item.badge}）`);
  const badgeHtml = item.badge === undefined
    ? ''
    : `<span class="menu-badge">${escapeHtml(item.badge)}</span>`;
  const actionIconHtml = item.actionIcon === undefined ? '' : renderSidebarIcon(item.actionIcon);
  const actionHtml = item.actionLabel === undefined
    ? ''
    : `\n            <button class="menu-action" type="button" aria-label="${escapeHtml(`${item.actionLabel}：${item.title}`)}">${actionIconHtml}</button>`;
  return `          <div class="menu-row" data-item-id="${escapeHtml(item.id)}">
            <button class="menu-main" type="button" title="${hoverTitle}">${renderSidebarIcon(item.icon)}<span class="menu-title">${title}</span>${badgeHtml}</button>${actionHtml}
          </div>`;
}
