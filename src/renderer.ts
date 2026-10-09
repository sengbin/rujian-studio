// ------------------------------------------------------------------------
// 名称：renderer.ts
// 说明：外壳界面入口：取得页面元素并启动外壳。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：渲染进程不启用 Node 集成，只通过预加载脚本暴露的 window.rujianShell 与主进程通信。
// ------------------------------------------------------------------------

import './index.css';
import { startAppShell } from './renderer/app-shell';

/** 读取必需的页面元素；缺失说明 index.html 与脚本不一致。 */
function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`index.html 缺少元素 #${id}`);
  }
  return element;
}

startAppShell(window.rujianShell, {
  sidebarPane: requireElement('sidebar-pane'),
  tabBar: requireElement('tab-bar'),
  tabViews: requireElement('tab-views'),
  emptyHint: requireElement('empty-hint')
}).catch((error: unknown) => {
  console.error('外壳启动失败：', error);
});
