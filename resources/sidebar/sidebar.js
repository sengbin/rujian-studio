// ------------------------------------------------------------------------
// 名称：sidebar.js
// 说明：侧栏页面脚本：菜单按钮的按下视觉状态，把点击交给应用主进程，以及底部状态条的刷新。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：请求名称与 src/sidebar/sidebar-handlers.ts 一致；依赖 shared/host-bridge.js 与界面组件库。
// ------------------------------------------------------------------------

'use strict';

// 脚本执行时样式表已加载：解除 HTML 里的预加载隐藏（见 src/sidebar/sidebar-html.ts）。
document.documentElement.classList.add('is-ready');

const PRESSED_CLASS = 'is-pressed';
const REQUEST_OPEN = 'sidebar.open';
const REQUEST_READ_STATUS = 'sidebar.readStatus';
const NOTICE_TITLE = '提示';
const UNAVAILABLE_MESSAGE = '该功能尚未开放。';
const GENERIC_ERROR_MESSAGE = '操作失败，请重试。';

/**
 * 通知宿主某一菜单行的按钮被点击；宿主未处理（功能尚未开放）时用页内对话框提示。
 * @param {HTMLElement} row 按钮所在的菜单行。
 * @param {'main' | 'action'} target 点击的位置：主入口或尾部操作。
 */
async function notifyClick(row, target) {
  try {
    const result = await window.hostBridge.request(REQUEST_OPEN, { itemId: row.dataset.itemId, target });
    if (!result.handled) await aiUi.alert({ title: NOTICE_TITLE, message: UNAVAILABLE_MESSAGE });
  } catch (error) {
    await aiUi.alert({ title: NOTICE_TITLE, message: (error && error.message) || GENERIC_ERROR_MESSAGE });
  }
}

/**
 * 为按钮绑定按下状态；不捕获指针，松开或取消时由窗口级事件清除状态；
 * 指针离开页面或页面失去焦点后收不到松开事件，也一并清除。
 * @param {HTMLButtonElement} button 需要绑定的按钮。
 * @param {HTMLElement} row 按钮所在的菜单行。
 * @param {boolean} shouldPressRow 按下时是否同时高亮整行。
 */
function bindPressedState(button, row, shouldPressRow) {
  let activePointerId;
  const resetPressed = () => {
    activePointerId = undefined;
    if (shouldPressRow) row.classList.remove(PRESSED_CLASS);
    button.classList.remove(PRESSED_CLASS);
  };
  const clearPressed = (event) => {
    if (event.pointerId !== activePointerId) return;
    resetPressed();
  };
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    activePointerId = event.pointerId;
    if (shouldPressRow) row.classList.add(PRESSED_CLASS);
    button.classList.add(PRESSED_CLASS);
  });
  window.addEventListener('pointerup', clearPressed);
  window.addEventListener('pointercancel', clearPressed);
  window.addEventListener('blur', resetPressed);
  document.documentElement.addEventListener('pointerleave', resetPressed);
}

for (const row of document.querySelectorAll('.menu-row')) {
  const mainButton = row.querySelector('.menu-main');
  const actionButton = row.querySelector('.menu-action');
  if (mainButton) {
    bindPressedState(mainButton, row, true);
    mainButton.addEventListener('click', () => notifyClick(row, 'main'));
  }
  if (actionButton) {
    bindPressedState(actionButton, row, false);
    actionButton.addEventListener('click', () => notifyClick(row, 'action'));
  }
}

let statusRefreshing = false;

/**
 * 向宿主读取最新状态并更新底部状态条；页面载入和窗口重新获得焦点时调用。
 * 状态条只是辅助信息，读取失败时保留已显示的内容，不打断用户；刷新进行中时忽略重复触发。
 */
async function refreshStatus() {
  if (statusRefreshing) return;
  statusRefreshing = true;
  try {
    const result = await window.hostBridge.request(REQUEST_READ_STATUS, {});
    for (const entry of result.entries) {
      const item = document.querySelector('.status-item[data-status-id="' + entry.id + '"]');
      const value = item && item.querySelector('.status-value');
      if (!value) continue;
      value.textContent = entry.value;
      value.dataset.level = entry.level;
    }
  } catch {
    // 保留已显示的状态。
  } finally {
    statusRefreshing = false;
  }
}

if (document.querySelector('.status-bar')) {
  refreshStatus();
  window.addEventListener('focus', refreshStatus);
}
