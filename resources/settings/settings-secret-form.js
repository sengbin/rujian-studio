// ------------------------------------------------------------------------
// 名称：settings-secret-form.js
// 说明：模型设置页的密钥表单：一个或多个密码输入框，加“保存密钥”“清除密钥”按钮和“已配置/未配置”状态文字；保存后在原位更新状态，不重绘整个分区。服务商的访问密钥与账户查询用的 AccessKey/SecretKey 都用它构造。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 settings.js 里 renderApiKey 与 renderAccountKey 的重复部分抽出；对外是 window.aiSettingsSecretForm.create(options)；必须晚于 settings-widgets.js、先于 settings-provider.js 与 settings-account.js 加载；密钥只发送给宿主，不回显；保存或清除成功后调用 options.onChanged，由页面决定是否重绘。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const KEY_CONFIGURED_TEXT = '已配置';
  const KEY_MISSING_TEXT = '未配置';

  const { SAVING_TEXT, SAVED_TEXT, fieldErrorOf, createSaveStatus } = window.aiSettingsWidgets;
  const { errorText } = window.pageFormat;

  /**
   * 创建密钥表单。
   * @param {{
   *   fields: Array<{
   *     key: string,
   *     label: string,
   *     ariaLabel: string,
   *     description?: string,
   *     requiredMessage?: string,
   *     submitOnEnter?: boolean,
   *     placeholders?: { missing: string, configured: string }
   *   }>,
   *   configured: boolean,
   *   payload: object,
   *   saveRequest: string,
   *   clearRequest: string,
   *   readConfigured: (result: object) => boolean,
   *   clearConfirm: { title: string, message: string },
   *   onChanged: () => void,
   *   status?: { element: HTMLElement, show: (text: string, isError?: boolean) => void },
   *   extraActions?: HTMLElement[],
   *   onConfiguredChange?: (configured: boolean) => void
   * }} options fields 是密码输入框：key 既是提交给宿主的字段名，也是宿主返回字段错误时的键，requiredMessage 有值时空输入直接提示而不请求宿主，submitOnEnter 为 true 时回车保存，placeholders 按是否已配置切换占位文字；payload 是保存与清除请求都带的公共内容；readConfigured 从保存或清除的响应里读出是否已配置；status 可由调用方提供，用于让额外按钮共用同一处状态文字；extraActions 放在保存与清除按钮之间；onConfiguredChange 在每次刷新状态时调用。
   * @returns {{ element: HTMLElement, status: object, isConfigured: () => boolean }}
   */
  function create(options) {
    let configured = options.configured;
    let isSaving = false;
    const status = options.status || createSaveStatus();
    const keyState = aiUi.h('span', { class: 'provider-key-state' });
    const inputs = options.fields.map((field) => {
      const input = aiUi.textInput({ type: 'password', ariaLabel: field.ariaLabel, onEnter: field.submitOnEnter ? () => void save() : undefined });
      const control = aiUi.field({ label: field.label, description: field.description, control: input });
      return { field, input, control };
    });
    const saveButton = aiUi.button({ text: '保存密钥', variant: 'primary', onClick: () => void save() });
    const clearButton = aiUi.button({ text: '清除密钥', variant: 'danger', onClick: () => void clear() });

    /** 按是否已配置刷新状态文字、占位文字和按钮。 */
    function refresh() {
      keyState.textContent = configured ? KEY_CONFIGURED_TEXT : KEY_MISSING_TEXT;
      keyState.className = `provider-key-state ${configured ? 'status-success' : 'status-warning'}`;
      for (const { field, input } of inputs) {
        if (field.placeholders) input.focusTarget.placeholder = configured ? field.placeholders.configured : field.placeholders.missing;
      }
      saveButton.setText(configured ? '更换密钥' : '保存密钥');
      clearButton.element.hidden = !configured;
      if (options.onConfiguredChange) options.onConfiguredChange(configured);
    }

    /** 保存输入的密钥并显示保存结果。 */
    async function save() {
      // 回车触发不受按钮禁用的限制，保存中必须自己拒绝重入。
      if (isSaving) return;
      const values = inputs.map(({ input }) => input.getValue().trim());
      const missing = inputs.findIndex(({ field }, index) => field.requiredMessage && values[index] === '');
      if (missing !== -1) {
        inputs[missing].control.setError(inputs[missing].field.requiredMessage);
        return;
      }
      isSaving = true;
      inputs.forEach(({ control }) => control.setError(''));
      saveButton.setDisabled(true);
      status.show(SAVING_TEXT, false);
      try {
        const body = { ...options.payload };
        inputs.forEach(({ field }, index) => (body[field.key] = values[index]));
        const result = await window.hostBridge.request(options.saveRequest, body);
        inputs.forEach(({ input }) => input.setValue(''));
        configured = options.readConfigured(result);
        refresh();
        status.show(SAVED_TEXT, false);
        options.onChanged();
      } catch (error) {
        // 宿主指出了具体字段的错误时显示在字段下方，否则在状态文字里显示原因。
        let hasFieldError = false;
        for (const { field, control } of inputs) {
          const message = fieldErrorOf(error, field.key);
          control.setError(message);
          if (message) hasFieldError = true;
        }
        status.show(hasFieldError ? '' : `保存失败：${errorText(error)}`, !hasFieldError);
      } finally {
        isSaving = false;
        saveButton.setDisabled(false);
      }
    }

    /** 确认后清除已保存的密钥。 */
    async function clear() {
      const confirmed = await aiUi.confirm({
        title: options.clearConfirm.title,
        message: options.clearConfirm.message,
        confirmText: '清除',
        cancelText: '取消',
        variant: 'danger'
      });
      if (!confirmed) return;
      clearButton.setDisabled(true);
      status.show(SAVING_TEXT, false);
      try {
        const result = await window.hostBridge.request(options.clearRequest, { ...options.payload });
        configured = options.readConfigured(result);
        refresh();
        status.show(SAVED_TEXT, false);
        options.onChanged();
      } catch (error) {
        status.show(`清除失败：${errorText(error)}`, true);
      } finally {
        clearButton.setDisabled(false);
      }
    }

    refresh();
    const element = aiUi.h(
      'div',
      { class: 'provider-key' },
      inputs.map(({ control }) => control.element),
      aiUi.h('div', { class: 'provider-key-actions' }, saveButton.element, options.extraActions || [], clearButton.element, keyState),
      status.element
    );
    return { element, status, isConfigured: () => configured };
  }

  window.aiSettingsSecretForm = { create };
})();
