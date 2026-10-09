// ------------------------------------------------------------------------
// 名称：sidebar-page.ts
// 说明：侧栏页面的装配：菜单内容的类型，以及用菜单分区、状态条、版本和主题生成侧栏页面 HTML。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：取代 VS Code 版的侧栏视图提供者；资源清单见 app/panels/page-resources.ts。
// ------------------------------------------------------------------------

import { SIDEBAR_PAGE_RESOURCES } from '../app/panels/page-resources';
import { APP_PAGE_CSP_SOURCE } from '../app/panels/page-html';
import { ShellTheme, toResourceUrl } from '../app/shell/shell-channels';
import { createSidebarHtml } from './sidebar-html';
import { SidebarMenuSection } from './sidebar-menu-config';
import { SidebarStatusEntry } from './sidebar-status';

/** 侧栏要显示的内容：菜单分区，以及可选的提示。 */
export interface SidebarContent {
  readonly sections: readonly SidebarMenuSection[];
  /** 显示在菜单上方的提示，如数据库无法打开的原因；缺省不显示。 */
  readonly notice?: string;
}

/** 生成侧栏页面 HTML 所需的输入。 */
export interface SidebarPageOptions {
  readonly content: SidebarContent;
  /** 应用版本号，显示在底部状态条。 */
  readonly version: string;
  /** 状态条的初始条目。 */
  readonly status: readonly SidebarStatusEntry[];
  readonly theme: ShellTheme;
}

/** 生成侧栏页面的完整 HTML。 */
export function createSidebarPageHtml(options: SidebarPageOptions): string {
  return createSidebarHtml({
    cspSource: APP_PAGE_CSP_SOURCE,
    styleUris: SIDEBAR_PAGE_RESOURCES.styles.map(toResourceUrl),
    scriptUris: SIDEBAR_PAGE_RESOURCES.scripts.map(toResourceUrl),
    sections: options.content.sections,
    notice: options.content.notice,
    theme: options.theme,
    version: options.version,
    status: options.status
  });
}
