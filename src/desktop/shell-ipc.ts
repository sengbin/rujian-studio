// ------------------------------------------------------------------------
// 名称：shell-ipc.ts
// 说明：主进程端的外壳 IPC：接收外壳转发的页面消息与标签关闭通知，返回初始状态。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：只接受来自应用窗口的消息；页面本身运行在沙箱 iframe 中，拿不到 IPC，只能经外壳中转。
// ------------------------------------------------------------------------

import { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, ipcMain } from 'electron';
import { ShellBridge } from '../app/shell/shell-bridge';
import { SHELL_CHANNELS, ShellInitialState, ShellTheme } from '../app/shell/shell-channels';

/**
 * 注册外壳 IPC 处理。
 * @param bridge 外壳桥。
 * @param getWindow 读取应用窗口。
 * @param getTheme 读取当前界面主题。
 */
export function registerShellIpc(bridge: ShellBridge, getWindow: () => BrowserWindow | undefined, getTheme: () => ShellTheme): void {
  const isFromAppWindow = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const window = getWindow();
    return window !== undefined && !window.isDestroyed() && event.sender === window.webContents;
  };

  ipcMain.on(SHELL_CHANNELS.fromFrame, (event, payload: unknown) => {
    if (!isFromAppWindow(event) || typeof payload !== 'object' || payload === null) {
      return;
    }
    const { frameId, message } = payload as { frameId?: unknown; message?: unknown };
    if (typeof frameId === 'string') {
      void bridge.handleFrameMessage(frameId, message);
    }
  });

  ipcMain.on(SHELL_CHANNELS.tabClosed, (event, key: unknown) => {
    if (isFromAppWindow(event) && typeof key === 'string') {
      bridge.handleTabClosed(key);
    }
  });

  ipcMain.handle(SHELL_CHANNELS.ready, (event): ShellInitialState => {
    if (!isFromAppWindow(event)) {
      throw new Error('只有应用窗口可以调用。');
    }
    return { theme: getTheme() };
  });
}
