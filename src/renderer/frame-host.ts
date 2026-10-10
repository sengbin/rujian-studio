// ------------------------------------------------------------------------
// 名称：frame-host.ts
// 说明：页面 iframe 管理：创建沙箱 iframe、识别消息来源、向页面转发响应与事件，并同步主题。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：iframe 只开放脚本与表单，不加 allow-same-origin，页面拿不到外壳与 Node 能力；页面消息只能经外壳转交主进程。
// ------------------------------------------------------------------------

import { ShellTheme, toFrameUrl } from '../app/shell/shell-channels';

/** iframe 的沙箱权限。 */
const FRAME_SANDBOX = 'allow-scripts allow-forms';

/** 页面 iframe 的管理器。 */
export class FrameHost {
  private readonly frames = new Map<string, HTMLIFrameElement>();

  /** @param theme 当前主题，页面加载完成后同步给页面。 */
  constructor(private theme: ShellTheme) {}

  /**
   * 创建页面 iframe 并挂到容器；同一标识已存在时返回已有的。
   * @param frameId 页面标识。
   * @param container 容器元素。
   * @param title iframe 的可访问名称。
   */
  create(frameId: string, container: HTMLElement, title: string): HTMLIFrameElement {
    const existing = this.frames.get(frameId);
    if (existing !== undefined) {
      return existing;
    }
    const frame = document.createElement('iframe');
    frame.className = 'page-frame';
    frame.title = title;
    frame.setAttribute('sandbox', FRAME_SANDBOX);
    frame.addEventListener('load', () => this.postTo(frame, { type: 'theme', theme: this.theme }));
    frame.src = toFrameUrl(frameId);
    container.append(frame);
    this.frames.set(frameId, frame);
    return frame;
  }

  find(frameId: string): HTMLIFrameElement | undefined {
    return this.frames.get(frameId);
  }

  /**
   * 移除页面 iframe。
   * @param frameId 页面标识。
   */
  remove(frameId: string): void {
    this.frames.get(frameId)?.remove();
    this.frames.delete(frameId);
  }

  /**
   * 根据消息来源找出对应的页面标识；不是自己创建的 iframe 时返回 undefined。
   * @param source 消息事件的来源窗口。
   */
  frameIdOf(source: MessageEventSource | null): string | undefined {
    for (const [frameId, frame] of this.frames) {
      if (source !== null && frame.contentWindow === source) {
        return frameId;
      }
    }
    return undefined;
  }

  /**
   * 向页面发送消息（响应、事件）；页面已移除时忽略。
   * @param frameId 页面标识。
   * @param message 要发送的响应或事件。
   */
  post(frameId: string, message: unknown): void {
    const frame = this.frames.get(frameId);
    if (frame !== undefined) {
      this.postTo(frame, message);
    }
  }

  /**
   * 切换主题并通知全部页面。
   * @param theme 新的界面主题。
   */
  setTheme(theme: ShellTheme): void {
    this.theme = theme;
    for (const frame of this.frames.values()) {
      this.postTo(frame, { type: 'theme', theme });
    }
  }

  /** 沙箱 iframe 的来源是不透明的，目标来源只能用 *；消息内容不含密钥，且只会发给自己创建的 iframe。 */
  private postTo(frame: HTMLIFrameElement, message: unknown): void {
    frame.contentWindow?.postMessage(message, '*');
  }
}
