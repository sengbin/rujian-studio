// ------------------------------------------------------------------------
// 名称：settings-widgets.js
// 说明：模型设置页各区域共用的小控件：保存状态文字（保存中、已保存、保存失败）、字段标签右侧的测试结果文字、带所属对象名称的开关、从错误载荷里取字段错误提示。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 settings.js 拆出；对外是 window.aiSettingsWidgets；必须先于 settings-secret-form.js、settings-text.js、settings-provider.js、settings-account.js 与 settings.js 加载。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const SAVING_TEXT = '保存中…';
  const SAVED_TEXT = '已保存';

  /** 取错误载荷中某个字段的错误提示；没有则返回空串。 */
  function fieldErrorOf(error, key) {
    return (error && error.fieldErrors && error.fieldErrors[key]) || '';
  }

  /**
   * 创建保存状态文字：显示在字段下方，随保存过程更新。
   * @returns {{ element: HTMLElement, show: (text: string, isError?: boolean) => void }}
   */
  function createSaveStatus() {
    const element = aiUi.h('p', { class: 'settings-status', hidden: true, attrs: { role: 'status' } });
    return {
      element,
      show(text, isError) {
        element.textContent = text;
        element.className = isError ? 'settings-status status-error' : 'settings-status status-success';
        element.hidden = text === '';
      }
    };
  }

  /** 创建字段标签右侧的测试结果文字。tone：'success'、'error' 或 'pending'（测试中）；空文字时隐藏。 */
  function createInlineResult() {
    const element = aiUi.h('span', { class: 'provider-setting-result', hidden: true, attrs: { role: 'status' } });
    const toneClass = { success: 'status-success', error: 'status-error', pending: 'description' };
    return {
      element,
      show(text, tone) {
        element.textContent = text;
        element.className = `provider-setting-result ${toneClass[tone] || ''}`.trim();
        element.hidden = text === '';
      }
    };
  }

  /**
   * 让开关的无障碍名称带上所属对象：表格行里的“启用”开关文字相同，读屏时无法区分。
   * @param {object} control 开关控件。
   * @param {string} name 无障碍名称。
   */
  function nameSwitch(control, name) {
    control.focusTarget.removeAttribute('aria-labelledby');
    control.focusTarget.setAttribute('aria-label', name);
  }

  window.aiSettingsWidgets = { SAVING_TEXT, SAVED_TEXT, fieldErrorOf, createSaveStatus, createInlineResult, nameSwitch };
})();
