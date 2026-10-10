// ------------------------------------------------------------------------
// 名称：app-window.ts
// 说明：应用主窗口：创建窗口、限制导航、把快捷键交给外壳，并提供当前系统主题。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：使用系统原生标题栏，不设应用菜单；快捷键在主进程拦截，页面 iframe 获得焦点时同样有效。
// ------------------------------------------------------------------------

import { BrowserWindow, Input, Menu, app, dialog, nativeTheme, shell } from 'electron';
import * as path from 'node:path';
import { SHELL_CHANNELS, ShellCommand, ShellTheme } from '../app/shell/shell-channels';

/** 窗口标题。 */
const WINDOW_TITLE = '如见 Studio';

/** 读取当前界面主题。 */
export function getCurrentTheme(): ShellTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

/**
 * 创建应用主窗口（尚未加载界面）。
 * @param resourceRoot 应用资源根目录，窗口图标位于其 resources 下。
 * @param preloadPath 预加载脚本的绝对路径。
 */
export function createAppWindow(resourceRoot: string, preloadPath: string): BrowserWindow {
  Menu.setApplicationMenu(null);
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: WINDOW_TITLE,
    icon: path.join(resourceRoot, 'resources', 'logo.png'),
    backgroundColor: getCurrentTheme() === 'dark' ? '#181818' : '#f8f8f8',
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  // 页面里的外部链接交给系统浏览器，窗口本身不允许导航或新开窗口。
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  // 界面进程崩溃后窗口只剩白屏且面板状态已失效：提示后重启应用（经 quit 退出，收尾序列会先关闭数据库）。
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') {
      return;
    }
    dialog.showErrorBox(WINDOW_TITLE, `界面进程意外退出（${details.reason}），应用将重新启动。`);
    app.relaunch();
    app.quit();
  });
  window.webContents.on('before-input-event', (event, input) => {
    const command = toShellCommand(input);
    if (command !== undefined) {
      event.preventDefault();
      window.webContents.send(SHELL_CHANNELS.command, command);
    } else if (!app.isPackaged && input.type === 'keyDown' && input.key === 'F12') {
      window.webContents.toggleDevTools();
    }
  });
  return window;
}

/** 把按键转换为外壳命令：Ctrl+W 关闭当前标签，Ctrl+Tab、Ctrl+Shift+Tab 切换标签。 */
function toShellCommand(input: Input): ShellCommand | undefined {
  if (input.type !== 'keyDown' || !input.control || input.alt) {
    return undefined;
  }
  if (input.key.toLowerCase() === 'w' && !input.shift) {
    return 'closeActiveTab';
  }
  if (input.key === 'Tab') {
    return input.shift ? 'previousTab' : 'nextTab';
  }
  return undefined;
}
