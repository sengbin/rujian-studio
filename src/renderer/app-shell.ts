// ------------------------------------------------------------------------
// 名称：app-shell.ts
// 说明：外壳界面：左侧菜单区与右侧主内容区（标签栏 + 页面 iframe），在页面与主进程之间转发消息，响应打开、聚焦、关闭标签与快捷键命令。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：标签的打开与关闭由主进程的 PanelManager 驱动；用户关闭标签时回报主进程；同一页面键只有一个标签。
// ------------------------------------------------------------------------

import { RujianShellApi, SIDEBAR_FRAME_ID, ShellCommand, ShellTheme, TabDescriptor } from '../app/shell/shell-channels';
import { FrameHost } from './frame-host';
import { TabBar } from './tab-bar';
import { TabState } from './tab-state';

/** 外壳需要的页面元素。 */
export interface AppShellElements {
  readonly sidebarPane: HTMLElement;
  readonly tabBar: HTMLElement;
  readonly tabViews: HTMLElement;
  /** 没有标签时显示的提示。 */
  readonly emptyHint: HTMLElement;
}

/**
 * 启动外壳：读取初始状态，建立侧栏页面，并接通主进程与页面之间的消息。
 * @param api 预加载脚本暴露的外壳接口。
 * @param elements 外壳页面元素。
 */
export async function startAppShell(api: RujianShellApi, elements: AppShellElements): Promise<void> {
  const initial = await api.ready();
  applyShellTheme(initial.theme);

  const frames = new FrameHost(initial.theme);
  const state = new TabState();
  const tabBar = new TabBar(elements.tabBar, state, {
    onActivate: (key) => activate(key),
    onClose: (key) => closeTab(key, true)
  });

  /** 刷新标签栏、页面显示与空提示。 */
  const refresh = (): void => {
    tabBar.render();
    for (const tab of state.list()) {
      frames.find(tab.key)?.classList.toggle('is-active', tab.key === state.active);
    }
    elements.emptyHint.hidden = state.list().length > 0;
  };

  const activate = (key: string): void => {
    if (state.activate(key)) {
      refresh();
    }
  };

  const openTab = (tab: TabDescriptor): void => {
    if (state.open(tab)) {
      frames.create(tab.key, elements.tabViews, tab.title);
    }
    refresh();
  };

  /** 关闭标签；用户操作触发时回报主进程，主进程发起的关闭不再回报。 */
  const closeTab = (key: string, notifyMain: boolean): void => {
    if (!state.close(key)) {
      return;
    }
    frames.remove(key);
    refresh();
    if (notifyMain) {
      api.notifyTabClosed(key);
    }
  };

  const runCommand = (command: ShellCommand): void => {
    if (command === 'closeActiveTab') {
      if (state.active !== undefined) {
        closeTab(state.active, true);
      }
      return;
    }
    state.cycle(command === 'nextTab' ? 1 : -1);
    refresh();
  };

  frames.create(SIDEBAR_FRAME_ID, elements.sidebarPane, '菜单');

  // 页面发来的消息经外壳转交主进程；只接受自己创建的 iframe。
  window.addEventListener('message', (event) => {
    const frameId = frames.frameIdOf(event.source);
    if (frameId !== undefined) {
      api.sendFrameMessage(frameId, event.data);
    }
  });
  api.onFrameMessage((frameId, message) => frames.post(frameId, message));
  api.onOpenTab(openTab);
  api.onRevealTab(activate);
  api.onCloseTab((key) => closeTab(key, false));
  api.onCommand(runCommand);
  api.onThemeChanged((theme) => {
    applyShellTheme(theme);
    frames.setTheme(theme);
  });
  refresh();
}

/** 外壳自身的样式按 html 上的 data-theme 切换。 */
function applyShellTheme(theme: ShellTheme): void {
  document.documentElement.dataset.theme = theme;
}
