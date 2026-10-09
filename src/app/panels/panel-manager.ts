// ------------------------------------------------------------------------
// 名称：panel-manager.ts
// 说明：页面标签管理：按键复用已打开的页面，装配页面 HTML 与请求路由，并经外壳桥打开、聚焦、关闭标签。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：同一键的页面只保留一个，重复打开时聚焦已有标签；资源地址见 shell-channels.ts。
// ------------------------------------------------------------------------

import { MessageRouter } from '../messaging/message-router';
import { ShellBridge } from '../shell/shell-bridge';
import { ShellTheme, toResourceUrl } from '../shell/shell-channels';
import { APP_PAGE_CSP_SOURCE, createPageHtml } from './page-html';

/** 打开页面所需的选项。 */
export interface PanelOptions {
  /** 页面的唯一键，同一键重复打开时聚焦已有标签。 */
  readonly key: string;
  readonly title: string;
  /** 页面描述，显示在页面顶部标题栏里。 */
  readonly description: string;
  /** 样式文件，路径相对应用资源根目录，使用 `/` 分隔。 */
  readonly styles: readonly string[];
  /** 脚本文件，路径相对应用资源根目录，使用 `/` 分隔。 */
  readonly scripts: readonly string[];
  readonly router: MessageRouter;
}

/** 已打开的页面句柄。 */
export interface OpenedPanel {
  /** 向界面推送事件；页面已关闭时忽略。 */
  postEvent(name: string, payload?: unknown): void;
  /** 关闭页面。 */
  close(): void;
  /** 页面关闭时调用，用于释放订阅。 */
  onDidClose(listener: () => void): void;
}

/** 已打开页面的内部记录。 */
interface OpenedRecord {
  readonly handle: OpenedPanel;
  readonly closeListeners: Array<() => void>;
}

/** 页面标签管理器。 */
export class PanelManager {
  private readonly openedPanels = new Map<string, OpenedRecord>();

  /**
   * @param bridge 与外壳通信的桥。
   * @param getTheme 读取当前界面主题，用于生成页面 HTML。
   */
  constructor(
    private readonly bridge: ShellBridge,
    private readonly getTheme: () => ShellTheme
  ) {
    bridge.onTabClosed((key) => this.release(key));
  }

  /**
   * 聚焦已打开的页面。
   * @param key 页面键。
   * @returns 该键的页面是否已存在（存在则已聚焦）。
   */
  reveal(key: string): boolean {
    if (!this.openedPanels.has(key)) {
      return false;
    }
    this.bridge.revealTab(key);
    return true;
  }

  /**
   * 打开页面；同一键的页面已存在时聚焦并返回已有页面的句柄。
   * @param options 页面选项。
   */
  open(options: PanelOptions): OpenedPanel {
    const existing = this.openedPanels.get(options.key);
    if (existing !== undefined) {
      this.bridge.revealTab(options.key);
      return existing.handle;
    }

    const html = createPageHtml({
      title: options.title,
      description: options.description,
      cspSource: APP_PAGE_CSP_SOURCE,
      styleUris: options.styles.map(toResourceUrl),
      scriptUris: options.scripts.map(toResourceUrl),
      theme: this.getTheme()
    });
    this.bridge.registerFrame(options.key, { router: options.router, html });

    const closeListeners: Array<() => void> = [];
    const handle: OpenedPanel = {
      postEvent: (name, payload) => this.bridge.postEvent(options.key, name, payload),
      close: () => {
        if (this.release(options.key)) {
          this.bridge.closeTab(options.key);
        }
      },
      onDidClose: (listener) => {
        closeListeners.push(listener);
      }
    };
    this.openedPanels.set(options.key, { handle, closeListeners });
    this.bridge.openTab({ key: options.key, title: options.title });
    return handle;
  }

  /**
   * 释放页面：注销页面登记并通知关闭监听者。
   * @returns 该键的页面是否存在。
   */
  private release(key: string): boolean {
    const opened = this.openedPanels.get(key);
    if (opened === undefined) {
      return false;
    }
    this.openedPanels.delete(key);
    this.bridge.unregisterFrame(key);
    opened.closeListeners.forEach((listener) => listener());
    return true;
  }
}
