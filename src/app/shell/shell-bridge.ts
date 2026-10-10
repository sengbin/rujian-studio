// ------------------------------------------------------------------------
// 名称：shell-bridge.ts
// 说明：主进程端的外壳桥：登记页面（标签页与侧栏）的请求路由器和 HTML，把页面请求交给路由器并把响应、事件送回，驱动外壳打开、聚焦、关闭标签。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：不依赖 Electron，通过 ShellTransport 与外壳通信，便于测试；页面消息的发送在页面销毁后立即停止。
// ------------------------------------------------------------------------

import { MessageRouter } from '../messaging/message-router';
import { EventEnvelope } from '../messaging/envelope';
import { SHELL_CHANNELS, ShellTheme, TabDescriptor } from './shell-channels';

/** 向外壳界面发送消息的能力；外壳尚不可用（窗口已关闭）时应忽略。 */
export interface ShellTransport {
  send(channel: string, payload: unknown): void;
}

/** 登记一个页面所需的内容。 */
export interface FrameRegistration {
  readonly router: MessageRouter;
  /** 页面完整 HTML，由自定义协议返回。 */
  readonly html: string;
}

/** 外壳桥。 */
export class ShellBridge {
  private readonly frames = new Map<string, FrameRegistration>();
  private readonly tabClosedListeners: Array<(key: string) => void> = [];

  /** @param transport 与外壳界面的通道。 */
  constructor(private readonly transport: ShellTransport) {}

  /**
   * 登记页面；同一标识重复登记会覆盖。
   * @param frameId 页面标识。
   * @param registration 页面登记信息（页面 HTML 与请求路由）。
   */
  registerFrame(frameId: string, registration: FrameRegistration): void {
    this.frames.set(frameId, registration);
  }

  /**
   * 注销页面，之后该页面的消息被忽略、事件不再发送。
   * @param frameId 页面标识。
   */
  unregisterFrame(frameId: string): void {
    this.frames.delete(frameId);
  }

  /**
   * 读取页面的 HTML；未登记时返回 undefined。
   * @param frameId 页面标识。
   */
  getFrameHtml(frameId: string): string | undefined {
    return this.frames.get(frameId)?.html;
  }

  /**
   * 处理页面发来的消息：交给该页面的路由器并回复；页面未登记（已关闭）时忽略。
   * @param frameId 页面标识。
   * @param message 页面发来的原始消息。
   */
  async handleFrameMessage(frameId: string, message: unknown): Promise<void> {
    const registration = this.frames.get(frameId);
    if (registration === undefined) {
      return;
    }
    const response = await registration.router.handle(message);
    // 处理期间页面可能已关闭，此时不再回复。
    if (response !== undefined && this.frames.get(frameId) === registration) {
      this.transport.send(SHELL_CHANNELS.toFrame, { frameId, message: response });
    }
  }

  /**
   * 向页面推送事件；页面未登记时忽略。
   * @param frameId 页面标识。
   * @param name 事件名称。
   * @param payload 事件附带的数据，可省略。
   */
  postEvent(frameId: string, name: string, payload?: unknown): void {
    if (!this.frames.has(frameId)) {
      return;
    }
    const event: EventEnvelope = { type: 'event', name, payload };
    this.transport.send(SHELL_CHANNELS.toFrame, { frameId, message: event });
  }

  /**
   * 让外壳打开标签。
   * @param tab 标签描述。
   */
  openTab(tab: TabDescriptor): void {
    this.transport.send(SHELL_CHANNELS.openTab, tab);
  }

  /**
   * 让外壳聚焦标签。
   * @param key 标签键。
   */
  revealTab(key: string): void {
    this.transport.send(SHELL_CHANNELS.revealTab, key);
  }

  /**
   * 让外壳关闭标签（程序主动关闭，外壳不会再回报关闭）。
   * @param key 标签键。
   */
  closeTab(key: string): void {
    this.transport.send(SHELL_CHANNELS.closeTab, key);
  }

  /**
   * 通知外壳系统主题变化。
   * @param theme 界面主题。
   */
  notifyThemeChanged(theme: ShellTheme): void {
    this.transport.send(SHELL_CHANNELS.themeChanged, theme);
  }

  /** 订阅用户在外壳中关闭标签的事件。 */
  onTabClosed(listener: (key: string) => void): void {
    this.tabClosedListeners.push(listener);
  }

  /**
   * 外壳回报用户关闭了标签。
   * @param key 被关闭的标签键。
   */
  handleTabClosed(key: string): void {
    this.tabClosedListeners.forEach((listener) => listener(key));
  }
}
