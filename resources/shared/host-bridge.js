// ------------------------------------------------------------------------
// 名称：host-bridge.js
// 说明：页面与应用外壳的通信桥：封装请求/响应匹配与宿主事件订阅，并响应外壳发来的主题切换。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：信封格式与 src/app/messaging/envelope.ts 一致；页面运行在沙箱 iframe 中，只与父窗口（外壳）通信；本文件必须先于页面脚本加载。
// ------------------------------------------------------------------------

'use strict';

(function () {
  /** 等待响应的请求：requestId → { resolve, reject }。 */
  const pendingRequests = new Map();
  /** 事件订阅：事件名 → 处理函数数组。 */
  const eventHandlers = new Map();
  let nextRequestId = 1;

  /**
   * 请求宿主执行一个操作。
   * @param {string} name 请求名称。
   * @param {unknown} [payload] 请求载荷。
   * @returns {Promise<any>} 宿主返回的数据；失败时以宿主错误载荷（kind、message、fieldErrors）拒绝。
   */
  function request(name, payload) {
    return new Promise((resolve, reject) => {
      const requestId = nextRequestId++;
      pendingRequests.set(requestId, { resolve, reject });
      window.parent.postMessage({ type: 'request', requestId, name, payload }, '*');
    });
  }

  /**
   * 订阅宿主推送的事件。
   * @param {string} name 事件名称。
   * @param {(payload: any) => void} handler 处理函数。
   */
  function onEvent(name, handler) {
    const handlers = eventHandlers.get(name) || [];
    handlers.push(handler);
    eventHandlers.set(name, handlers);
  }

  /**
   * 切换页面主题：样式按 html 与 body 上的 theme-light、theme-dark 类区分亮暗。
   * @param {'light' | 'dark'} theme 目标主题。
   */
  function applyTheme(theme) {
    for (const element of [document.documentElement, document.body]) {
      if (!element) continue;
      element.classList.remove('theme-light', 'theme-dark');
      element.classList.add('theme-' + theme);
    }
  }

  window.addEventListener('message', (event) => {
    // 只接受外壳（父窗口）发来的消息。
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;

    if (message.type === 'response') {
      const pending = pendingRequests.get(message.requestId);
      if (!pending) return;
      pendingRequests.delete(message.requestId);
      if (message.ok) pending.resolve(message.data);
      else pending.reject(message.error);
    } else if (message.type === 'event') {
      for (const handler of eventHandlers.get(message.name) || []) handler(message.payload);
    } else if (message.type === 'theme' && (message.theme === 'light' || message.theme === 'dark')) {
      applyTheme(message.theme);
    }
  });

  window.hostBridge = { request, onEvent };
})();
