// ------------------------------------------------------------------------
// 名称：preload.ts
// 说明：预加载脚本：把外壳与主进程之间的通道以受限接口（window.rujianShell）暴露给外壳界面。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：只暴露具名方法，不暴露 ipcRenderer 本身；通道名见 app/shell/shell-channels.ts。
// ------------------------------------------------------------------------

import { contextBridge, ipcRenderer } from 'electron';
import { RujianShellApi, SHELL_CHANNELS } from './app/shell/shell-channels';

/** 订阅主进程推送到指定通道的消息。 */
function subscribe<T>(channel: string, listener: (payload: T) => void): void {
  ipcRenderer.on(channel, (_event, payload: T) => listener(payload));
}

const api: RujianShellApi = {
  ready: () => ipcRenderer.invoke(SHELL_CHANNELS.ready),
  sendFrameMessage: (frameId, message) => ipcRenderer.send(SHELL_CHANNELS.fromFrame, { frameId, message }),
  notifyTabClosed: (key) => ipcRenderer.send(SHELL_CHANNELS.tabClosed, key),
  onFrameMessage: (listener) => subscribe<{ frameId: string; message: unknown }>(SHELL_CHANNELS.toFrame, (payload) => listener(payload.frameId, payload.message)),
  onOpenTab: (listener) => subscribe(SHELL_CHANNELS.openTab, listener),
  onRevealTab: (listener) => subscribe(SHELL_CHANNELS.revealTab, listener),
  onCloseTab: (listener) => subscribe(SHELL_CHANNELS.closeTab, listener),
  onThemeChanged: (listener) => subscribe(SHELL_CHANNELS.themeChanged, listener),
  onCommand: (listener) => subscribe(SHELL_CHANNELS.command, listener)
};

contextBridge.exposeInMainWorld('rujianShell', api);
