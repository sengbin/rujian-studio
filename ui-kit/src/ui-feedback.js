// ------------------------------------------------------------------------
// 名称：ui-feedback.js
// 说明：界面组件库的反馈组件：说明块（空状态、加载中、出错，可带一个按钮）与操作结果提示区（成功、失败，随内容显示或隐藏）。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：依赖 ui-core.js；样式见 ui-feedback.css；状态文字的颜色取页面基础样式的 status-success、status-error（theme.css）。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const aiUi = window.aiUi;

  const STATE_CLASS = 'ui-state';
  const MESSAGE_CLASS = 'ui-message';
  const MESSAGE_FLUSH_CLASS = 'ui-message--flush';
  const STATUS_ERROR_CLASS = 'status-error';
  const STATUS_SUCCESS_CLASS = 'status-success';

  /**
   * 说明块：列表等内容区在没有内容、加载中或出错时显示的一段说明，可带一个按钮。
   * @param {{ text: string, button?: { element: HTMLElement } }} options text 说明文字；button 为 aiUi.button 返回的控件，显示在文字下方。
   * @returns {HTMLElement}
   */
  aiUi.state = function (options) {
    const { text, button } = options;
    return aiUi.h('div', { class: STATE_CLASS }, aiUi.h('p', { class: 'description', text }), button && button.element);
  };

  /**
   * 操作结果提示区：默认隐藏，show 写入文字后显示；成功与失败用不同的状态颜色，读屏软件会朗读更新。
   * @param {{ flush?: boolean, role?: 'status'|'alert' }} [options] flush 为 true 时不带外边距（所在容器已用间隙排版）；role 默认 status。
   * @returns {{ element: HTMLElement, show: (text: string, isError?: boolean) => void }}
   *   show(text, isError) 显示文字，isError 为 true 时按失败着色；空串表示清除并隐藏。
   */
  aiUi.message = function (options) {
    const settings = options || {};
    const baseClass = settings.flush ? `${MESSAGE_CLASS} ${MESSAGE_FLUSH_CLASS}` : MESSAGE_CLASS;
    const element = aiUi.h('p', { class: baseClass, hidden: true, attrs: { role: settings.role || 'status' } });
    return {
      element,
      show(text, isError) {
        element.textContent = text;
        element.className = `${baseClass} ${isError ? STATUS_ERROR_CLASS : STATUS_SUCCESS_CLASS}`;
        element.hidden = text === '';
      }
    };
  };
})();
