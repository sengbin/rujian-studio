// ------------------------------------------------------------------------
// 名称：shell-channels.ts
// 说明：外壳（渲染进程）与主进程之间的通道名、消息类型和页面地址约定。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：主进程、预加载脚本与外壳界面共用，只放常量和类型，不依赖 Electron 与 Node。
// ------------------------------------------------------------------------

/** 页面资源所用的自定义协议名（不含冒号）。 */
export const APP_PROTOCOL = 'rujian-app';

/** 侧栏菜单页面的页面标识，不对应任何标签。 */
export const SIDEBAR_FRAME_ID = 'sidebar';

/** 外壳与主进程之间的 IPC 通道名。 */
export const SHELL_CHANNELS = {
  /** 外壳 → 主进程：页面发来的消息。载荷 `{ frameId, message }`。 */
  fromFrame: 'shell:from-frame',
  /** 主进程 → 外壳：发给页面的响应或事件。载荷 `{ frameId, message }`。 */
  toFrame: 'shell:to-frame',
  /** 外壳 → 主进程：用户关闭了标签。载荷为标签键。 */
  tabClosed: 'shell:tab-closed',
  /** 主进程 → 外壳：打开标签。载荷 {@link TabDescriptor}。 */
  openTab: 'shell:open-tab',
  /** 主进程 → 外壳：聚焦标签。载荷为标签键。 */
  revealTab: 'shell:reveal-tab',
  /** 主进程 → 外壳：关闭标签。载荷为标签键。 */
  closeTab: 'shell:close-tab',
  /** 主进程 → 外壳：系统主题变化。载荷为 {@link ShellTheme}。 */
  themeChanged: 'shell:theme-changed',
  /** 主进程 → 外壳：快捷键命令。载荷为 {@link ShellCommand}。 */
  command: 'shell:command',
  /** 外壳 → 主进程（invoke）：外壳加载完成，返回初始状态。 */
  ready: 'shell:ready'
} as const;

/** 界面主题。 */
export type ShellTheme = 'light' | 'dark';

/** 快捷键触发的外壳命令。 */
export type ShellCommand = 'closeActiveTab' | 'nextTab' | 'previousTab';

/** 一个标签的描述。 */
export interface TabDescriptor {
  /** 标签键，同时是页面标识。 */
  readonly key: string;
  readonly title: string;
}

/** 外壳加载完成后主进程返回的初始状态。 */
export interface ShellInitialState {
  readonly theme: ShellTheme;
}

/** 预加载脚本暴露给外壳界面的接口（`window.rujianShell`）。 */
export interface RujianShellApi {
  ready(): Promise<ShellInitialState>;
  sendFrameMessage(frameId: string, message: unknown): void;
  notifyTabClosed(key: string): void;
  onFrameMessage(listener: (frameId: string, message: unknown) => void): void;
  onOpenTab(listener: (tab: TabDescriptor) => void): void;
  onRevealTab(listener: (key: string) => void): void;
  onCloseTab(listener: (key: string) => void): void;
  onThemeChanged(listener: (theme: ShellTheme) => void): void;
  onCommand(listener: (command: ShellCommand) => void): void;
}

/** 页面在 `iframe` 中加载的地址；页面标识里可能含冒号等字符，需要编码。 */
export function toFrameUrl(frameId: string): string {
  return `${APP_PROTOCOL}://page/${encodeURIComponent(frameId)}`;
}

/** 静态资源（相对应用资源根目录，使用 `/` 分隔）的地址。 */
export function toResourceUrl(relativePath: string): string {
  return `${APP_PROTOCOL}://res/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}
