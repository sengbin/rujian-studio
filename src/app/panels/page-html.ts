// ------------------------------------------------------------------------
// 名称：page-html.ts
// 说明：生成标签页面的 HTML 外壳：CSP、主题类、顶部标题栏（页面名称、描述与右侧工具栏插槽）、样式与脚本引用和挂载点。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：页面内容由脚本渲染到 #app，不在 HTML 中内联数据或样式；标题栏由宿主渲染，页面脚本不再自己显示页面标题，搜索框、筛选等工具控件放进 #page-toolbar。
// ------------------------------------------------------------------------

import { APP_PROTOCOL, ShellTheme } from '../shell/shell-channels';
import { createNonce, escapeHtml } from './html-utils';

/** 页面 CSP 放行的来源：应用自定义协议。 */
export const APP_PAGE_CSP_SOURCE = `${APP_PROTOCOL}:`;

/** 生成页面 HTML 所需的输入。 */
export interface PageHtmlOptions {
  /** 页面名称，与标签页标题一致，显示在顶部标题栏。 */
  readonly title: string;
  /** 页面描述，显示在标题后面。 */
  readonly description: string;
  /** CSP 来源，放行外部样式文件。 */
  readonly cspSource: string;
  /** 样式文件地址，按顺序引用。 */
  readonly styleUris: readonly string[];
  /** 脚本文件地址，按顺序执行。 */
  readonly scriptUris: readonly string[];
  /** 初始主题，写入 html 与 body 的类（页面样式按 theme-light、theme-dark 切换）；缺省为深色。 */
  readonly theme?: ShellTheme;
}

/**
 * 生成页面的完整 HTML。
 * @param options 标题与资源地址。
 */
export function createPageHtml(options: PageHtmlOptions): string {
  const nonce = createNonce();
  const styleTags = options.styleUris.map((uri) => `  <link rel="stylesheet" href="${escapeHtml(uri)}">`).join('\n');
  const scriptTags = options.scriptUris
    .map((uri) => `  <script nonce="${nonce}" src="${escapeHtml(uri)}"></script>`)
    .join('\n');
  const themeClass = `theme-${options.theme ?? 'dark'}`;
  return `<!doctype html>
<html lang="zh-CN" class="${themeClass}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${options.cspSource}; img-src data:; media-src data: blob:; script-src 'nonce-${nonce}';">
  <title>${escapeHtml(options.title)}</title>
${styleTags}
</head>
<body class="${themeClass}">
  <header class="page-header">
    <div class="page-header__text">
      <h1 class="ui-title page-header__title">${escapeHtml(options.title)}</h1>
      <p class="page-header__description">${escapeHtml(options.description)}</p>
    </div>
    <div id="page-toolbar" class="page-header__toolbar"></div>
  </header>
  <div id="app"></div>
${scriptTags}
</body>
</html>`;
}
