// ------------------------------------------------------------------------
// 名称：main.ts
// 说明：如见 Studio 主进程入口：单实例、注册协议与 IPC、创建窗口、装配应用，并在退出前执行收尾序列。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：入口只做装配，业务逻辑位于 app、domain、infra 目录；单窗口应用，窗口全部关闭即退出。
// ------------------------------------------------------------------------

import { BrowserWindow, app, dialog, nativeTheme, safeStorage } from 'electron';
import started from 'electron-squirrel-startup';
import * as path from 'node:path';
import { PanelManager } from './app/panels/panel-manager';
import { ShellBridge } from './app/shell/shell-bridge';
import { SIDEBAR_FRAME_ID } from './app/shell/shell-channels';
import { ElectronSecretStore } from './infra/secrets/electron-secret-store';
import { Application, createApplication } from './desktop/application';
import { createAppWindow, getCurrentTheme } from './desktop/app-window';
import { handleAppProtocol, registerAppProtocolScheme } from './desktop/app-protocol';
import { createBackupHost, createDesktopNotifier, createWorkbenchHost, focusWindow } from './desktop/desktop-hosts';
import { registerShellIpc } from './desktop/shell-ipc';

/** 数据目录在 userData 下的子目录名。 */
const DATA_DIRECTORY_NAME = 'rujian';

/** 保存加密后密钥的文件名，位于数据目录。 */
const SECRET_FILE_NAME = 'secrets.json';

/** 错误对话框标题。 */
const ERROR_TITLE = '如见 Studio';

// 自定义协议必须在 app ready 之前声明。
registerAppProtocolScheme();

if (started || !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  run();
}

/** 启动应用。 */
function run(): void {
  // 开发运行时没有安装信息，需要显式设置应用标识，系统通知才能显示。
  if (!app.isPackaged) {
    app.setAppUserModelId(process.execPath);
  }
  // 应用资源根目录：开发时是项目根目录，打包后是 resources 目录（resources 与 ui-kit 由打包配置复制到其下）。
  const resourceRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
  let mainWindow: BrowserWindow | undefined;
  let application: Application | undefined;
  let shuttingDown = false;
  // 窗口关闭后进入收尾阶段时引用已销毁，返回 undefined，避免对已销毁窗口调用方法。
  const getWindow = (): BrowserWindow | undefined => (mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined);

  const bridge = new ShellBridge({
    send: (channel, payload) => {
      getWindow()?.webContents.send(channel, payload);
    }
  });

  app.on('second-instance', () => focusWindow(getWindow()));

  // 退出前先执行收尾序列（等待阶段生成、停止队列、关闭数据库），完成后再真正退出。
  app.on('before-quit', (event) => {
    const shutdown = application?.shutdown;
    if (shuttingDown || shutdown === undefined) {
      return;
    }
    shuttingDown = true;
    event.preventDefault();
    void shutdown.run().finally(() => app.quit());
  });

  app.on('window-all-closed', () => app.quit());

  void app
    .whenReady()
    .then(() => startApplication())
    .catch((error: unknown) => {
      // 装配失败时没有窗口也不会有人退出，必须提示并退出，不能留下占着单实例锁的空进程。
      dialog.showErrorBox(ERROR_TITLE, `启动失败：${error instanceof Error ? error.message : String(error)}`);
      app.quit();
    });

  /** 装配应用并创建主窗口。 */
  function startApplication(): void {
    const notify = createDesktopNotifier();
    const dataRoot = path.join(app.getPath('userData'), DATA_DIRECTORY_NAME);
    const panels = new PanelManager(bridge, getCurrentTheme);
    application = createApplication({
      dataRoot,
      resourceRoot,
      version: app.getVersion(),
      getTheme: getCurrentTheme,
      panels,
      secrets: new ElectronSecretStore(path.join(dataRoot, SECRET_FILE_NAME), safeStorage),
      workbenchHost: createWorkbenchHost(getWindow, notify),
      backupHost: createBackupHost(getWindow),
      notify,
      focusWindow: () => focusWindow(getWindow()),
      postSidebarEvent: (name) => bridge.postEvent(SIDEBAR_FRAME_ID, name),
      reportError: (message) => dialog.showErrorBox(ERROR_TITLE, message)
    });
    bridge.registerFrame(SIDEBAR_FRAME_ID, { router: application.sidebar.router, html: application.sidebar.html });

    handleAppProtocol(bridge, resourceRoot);
    registerShellIpc(bridge, getWindow, getCurrentTheme);
    nativeTheme.on('updated', () => bridge.notifyThemeChanged(getCurrentTheme()));

    mainWindow = createAppWindow(resourceRoot, path.join(__dirname, 'preload.cjs'));
    const loading = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
      : mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
    loading.catch((error: unknown) => {
      dialog.showErrorBox(ERROR_TITLE, `界面加载失败：${error instanceof Error ? error.message : String(error)}`);
      app.quit();
    });
  }
}
