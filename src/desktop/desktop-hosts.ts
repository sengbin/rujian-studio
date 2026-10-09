// ------------------------------------------------------------------------
// 名称：desktop-hosts.ts
// 说明：桌面版的宿主能力：系统通知、工作台使用的打开与导出文件、数据备份使用的选择文件与重启应用。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：业务代码只依赖 WorkbenchHost、BackupHost 接口。
// ------------------------------------------------------------------------

import { BrowserWindow, Notification, app, dialog, shell } from 'electron';
import { copyFile, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorkbenchHost } from '../app/pages/workbench-handlers';
import { BackupHost } from '../app/services/backup-service';

/** 通知标题。 */
const NOTIFICATION_TITLE = '如见 Studio';

/** 一条系统通知。 */
export interface DesktopNotice {
  readonly body: string;
  /** 点击通知时执行；缺省只显示。 */
  readonly onClick?: () => void;
}

/** 系统通知。 */
export type DesktopNotifier = (notice: DesktopNotice) => void;

/** 读取当前应用窗口；窗口不存在时返回 undefined。 */
export type WindowGetter = () => BrowserWindow | undefined;

/** 创建系统通知函数；系统不支持通知时忽略。 */
export function createDesktopNotifier(): DesktopNotifier {
  return (notice) => {
    if (!Notification.isSupported()) {
      return;
    }
    const notification = new Notification({ title: NOTIFICATION_TITLE, body: notice.body });
    if (notice.onClick !== undefined) {
      notification.on('click', notice.onClick);
    }
    notification.show();
  };
}

/** 把窗口带到前台；窗口不存在或已销毁（关闭后正在收尾时再次启动）时什么都不做。 */
export function focusWindow(window: BrowserWindow | undefined): void {
  if (window === undefined || window.isDestroyed()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

/**
 * 创建工作台使用的宿主能力：用系统程序打开、导出到用户选择的位置、在文件夹中显示、读取结果视频（供页面截取尾帧）、通知。
 * @param getWindow 读取应用窗口，作为对话框的父窗口。
 * @param notify 系统通知。
 */
export function createWorkbenchHost(getWindow: WindowGetter, notify: DesktopNotifier): WorkbenchHost {
  return {
    openFile: async (absolutePath) => {
      const failure = await shell.openPath(absolutePath);
      if (failure !== '') {
        throw new Error(`无法打开文件：${failure}`);
      }
    },
    revealFile: async (absolutePath) => shell.showItemInFolder(absolutePath),
    readFile: (absolutePath) => readFile(absolutePath),
    exportFile: async (absolutePath, suggestedName) => {
      const options = {
        defaultPath: path.join(os.homedir(), suggestedName),
        filters: [{ name: '视频', extensions: ['mp4'] }],
        buttonLabel: '导出'
      };
      const window = getWindow();
      const result = window === undefined ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(window, options);
      if (result.canceled || result.filePath === undefined) {
        return false;
      }
      const target = result.filePath;
      await copyFile(absolutePath, target);
      notify({ body: `已导出到 ${target}，点击在文件夹中显示。`, onClick: () => shell.showItemInFolder(target) });
      return true;
    },
    notify: (_level, message) => notify({ body: message })
  };
}

/**
 * 创建数据备份使用的宿主能力：选择备份的保存位置、选择要恢复的备份文件、重启应用。
 * @param getWindow 读取应用窗口，作为对话框的父窗口。
 */
export function createBackupHost(getWindow: WindowGetter): BackupHost {
  return {
    pickBackupTarget: async (suggestedName) => {
      const options = {
        defaultPath: path.join(os.homedir(), suggestedName),
        filters: [{ name: 'SQLite 数据库', extensions: ['sqlite'] }],
        buttonLabel: '备份到此处'
      };
      const window = getWindow();
      const result = window === undefined ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(window, options);
      return result.canceled ? undefined : result.filePath;
    },
    pickRestoreSource: async () => {
      const options = {
        defaultPath: os.homedir(),
        properties: ['openFile' as const],
        filters: [
          { name: 'SQLite 数据库', extensions: ['sqlite', 'db'] },
          { name: '所有文件', extensions: ['*'] }
        ],
        buttonLabel: '选择备份文件'
      };
      const window = getWindow();
      const result = window === undefined ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
      return result.canceled ? undefined : result.filePaths[0];
    },
    // 经 quit 退出，让收尾序列先关闭数据库；下次启动时应用待恢复的备份。
    restartApp: async () => {
      app.relaunch();
      app.quit();
    }
  };
}
