// ------------------------------------------------------------------------
// 名称：settings-provider.js
// 说明：模型设置页的服务商设置区（点服务商列表的“设置”弹出）：标题与启用开关、访问密钥（保存、清除、测试连接）、设置项（接口地址等，每个地址可单独显示测试结果）、按类型分页签的模型表（启用开关、价格、能力），全部即时保存。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 settings.js 拆出；请求名称与 src/app/pages/settings-handlers.ts 一致；对外是 window.aiSettingsProvider.create(host)，返回 render(provider)；必须晚于 settings-widgets.js 与 settings-secret-form.js、先于 settings.js 加载；“测试连接”用宿主已保存的密钥和设置发起，对每个接口地址各测一次，结果显示在该地址的标签右侧；访问密钥只发送给宿主，不回显。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_PROVIDER_UPDATE = 'settings.providerUpdate';
  const REQUEST_PROVIDER_SET_KEY = 'settings.providerSetKey';
  const REQUEST_PROVIDER_CLEAR_KEY = 'settings.providerClearKey';
  const REQUEST_PROVIDER_TEST_CONNECTION = 'settings.providerTestConnection';
  const REQUEST_MODEL_SET_ENABLED = 'settings.modelSetEnabled';

  const TESTING_TEXT = '正在测试连接…';
  const API_KEY_FIELD = 'apiKey';
  const KEY_PLACEHOLDER_NEW = '粘贴访问密钥';
  const KEY_PLACEHOLDER_REPLACE = '已配置，输入新密钥可更换';

  /** 模型类型标签的固定顺序；不在其中的类型排在最后。 */
  const KIND_LABEL_ORDER = ['文本', '图像', '音频', '视频'];

  const { SAVING_TEXT, SAVED_TEXT, fieldErrorOf, createSaveStatus, createInlineResult, nameSwitch } = window.aiSettingsWidgets;
  const { errorText } = window.pageFormat;

  /** 类型标签的排序值。 */
  function kindOrder(label) {
    const index = KIND_LABEL_ORDER.indexOf(label);
    return index === -1 ? KIND_LABEL_ORDER.length : index;
  }

  /**
   * 创建服务商设置区；只创建一个实例。
   * @param {{ refreshPage: () => void }} host 宿主页面提供的操作：refreshPage 在保存成功后重新读取并重绘弹出页后面的页面。
   * @returns {{ render: (provider: object) => HTMLElement }}
   */
  function create(host) {
    /** 各服务商设置页当前选中的模型类型标签，重新打开时沿用。 */
    const activeKindByProvider = new Map();

    /**
     * 访问密钥区：输入框、保存与清除按钮、配置状态，另有“测试连接”按钮。
     * @param {object} provider 服务商视图。
     * @param {Map<string, { show: (text: string, tone: string) => void }>} resultSlots “测试连接”结果的显示位置，键为设置项的键。
     */
    function renderApiKey(provider, resultSlots) {
      const status = createSaveStatus();
      const testButton = aiUi.button({ text: '测试连接', onClick: () => void testConnection() });
      const form = aiSettingsSecretForm.create({
        fields: [
          {
            key: API_KEY_FIELD,
            label: '访问密钥',
            ariaLabel: `${provider.displayName}访问密钥`,
            description: '密钥经系统加密后保存在本机，不会写入数据库，也不会在页面上显示。',
            requiredMessage: '访问密钥不能为空。',
            submitOnEnter: true,
            placeholders: { missing: KEY_PLACEHOLDER_NEW, configured: KEY_PLACEHOLDER_REPLACE }
          }
        ],
        configured: provider.apiKeyConfigured,
        payload: { providerId: provider.id },
        saveRequest: REQUEST_PROVIDER_SET_KEY,
        clearRequest: REQUEST_PROVIDER_CLEAR_KEY,
        readConfigured: (result) => result.provider.apiKeyConfigured,
        clearConfirm: { title: '清除访问密钥', message: `清除后将无法使用“${provider.displayName}”的模型，需要重新填写密钥。` },
        onChanged: () => void host.refreshPage(),
        status,
        extraActions: [testButton.element],
        onConfiguredChange: (configured) => testButton.setDisabled(!configured)
      });

      /** 用已保存的密钥和设置测试连接：每个接口地址的结果显示在其标签右侧，无法测试的原因（如没有密钥）显示在状态文字里。 */
      async function testConnection() {
        testButton.setDisabled(true);
        status.show('', false);
        for (const slot of resultSlots.values()) slot.show(TESTING_TEXT, 'pending');
        try {
          const result = await window.hostBridge.request(REQUEST_PROVIDER_TEST_CONNECTION, { providerId: provider.id });
          if (result.notice) status.show(result.notice, true);
          for (const [key, slot] of resultSlots) {
            const item = result.results.find((entry) => entry.settingKey === key);
            if (item) slot.show(item.message, item.ok ? 'success' : 'error');
            else slot.show('', 'success');
          }
        } catch (error) {
          for (const slot of resultSlots.values()) slot.show('', 'success');
          status.show(`测试失败：${errorText(error)}`, true);
        } finally {
          testButton.setDisabled(!form.isConfigured());
        }
      }

      return form.element;
    }

    /**
     * 服务商的一个设置项：下拉选择后立即保存，文本在失去焦点且有变化时保存；校验错误显示在字段下方。
     * 声明了测试方式的地址，标签右侧留出位置显示“测试连接”的结果，地址修改保存后清除旧结果。
     */
    function renderProviderSetting(provider, setting, resultSlots) {
      const status = createSaveStatus();
      let saved = setting.value;
      let field;

      /** 保存一项服务商设置，并在状态行显示保存中、已保存或失败原因。 */
      async function save(value) {
        status.show(SAVING_TEXT, false);
        try {
          const result = await window.hostBridge.request(REQUEST_PROVIDER_UPDATE, { providerId: provider.id, settings: { [setting.key]: value } });
          const current = result.provider.settings.find((item) => item.key === setting.key);
          saved = current ? current.value : value;
          field.setError('');
          const slot = resultSlots.get(setting.key);
          if (slot) slot.show('', 'success');
          status.show(SAVED_TEXT, false);
          void host.refreshPage();
          return saved;
        } catch (error) {
          const message = fieldErrorOf(error, setting.key);
          if (message) {
            field.setError(message);
            status.show('', false);
          } else {
            status.show(`保存失败：${errorText(error)}`, true);
          }
          return null;
        }
      }

      let control;
      if (setting.control === 'select') {
        control = aiUi.select({
          options: setting.options.map((option) => ({ value: option.value, label: option.label })),
          value: setting.value,
          allowEmpty: false,
          ariaLabel: setting.label,
          onChange: (value) => void save(value)
        });
      } else {
        control = aiUi.textInput({ value: setting.value, ariaLabel: setting.label });
        control.focusTarget.addEventListener('change', () => {
          const text = control.getValue().trim();
          if (text === saved) {
            field.setError('');
            return;
          }
          void save(text).then((normalized) => {
            if (normalized !== null) control.setValue(normalized);
          });
        });
      }
      field = aiUi.field({ label: setting.label, description: setting.description, control });
      if (setting.connectionCheckKind) {
        const result = createInlineResult();
        const label = field.element.querySelector('.ui-field__label');
        const head = aiUi.h('div', { class: 'provider-setting-head' });
        label.replaceWith(head);
        head.append(label, result.element);
        resultSlots.set(setting.key, result);
      }
      return aiUi.h('div', { class: 'provider-setting' }, field.element, status.element);
    }

    /** 服务商的模型表：名称与代码、类型、启用开关、能力摘要。 */
    function renderModelTable(provider, status) {
      const columns = [
        { title: '模型', minWidth: 180, render: (model) => aiUi.tableMainCell({ text: model.displayName, description: model.code }) },
        {
          title: '启用',
          width: 120,
          nowrap: true,
          render: (model) => {
            const control = aiUi.switchControl({ label: '启用', checked: model.isEnabled });
            nameSwitch(control, `启用模型 ${model.displayName}`);
            control.onChange(async (checked) => {
              status.show(SAVING_TEXT, false);
              try {
                await window.hostBridge.request(REQUEST_MODEL_SET_ENABLED, { modelId: model.id, isEnabled: checked });
                status.show(SAVED_TEXT, false);
                void host.refreshPage();
              } catch (error) {
                control.setValue(!checked);
                status.show(`保存失败：${errorText(error)}`, true);
              }
            });
            return control.element;
          }
        },
        {
          title: '价格',
          minWidth: 160,
          render: (model) => aiUi.h('div', { class: 'provider-capability', text: model.pricing || '—' })
        },
        {
          title: '能力',
          minWidth: 220,
          render: (model) => aiUi.h('div', { class: 'provider-capability' }, model.capabilitySummary.map((line) => aiUi.h('div', { text: line })))
        }
      ];
      return aiUi.table({ columns, rows: provider.models, ariaLabel: `${provider.displayName}的模型` }).element;
    }

    /** 模型按类型分页签：有几种类型就显示几个标签，点标签切换；同类型的模型显示在同一张表里。 */
    function renderModelTabs(provider, status) {
      const labels = [...new Set(provider.models.map((model) => model.kindLabel))];
      labels.sort((a, b) => kindOrder(a) - kindOrder(b));
      const items = labels.map((label) => {
        const models = provider.models.filter((model) => model.kindLabel === label);
        return {
          id: label,
          label,
          count: aiUi.h('span', { class: 'ui-tab__count', text: `${models.filter((model) => model.isEnabled).length}/${models.length}` }),
          content: renderModelTable({ ...provider, models }, status)
        };
      });
      const tabs = aiUi.tabs({
        items,
        activeId: activeKindByProvider.get(provider.id),
        ariaLabel: `${provider.displayName}的模型类型`,
        className: 'provider-tabs',
        onSelect: (id) => activeKindByProvider.set(provider.id, id)
      });
      return aiUi.h('div', { class: 'provider-models' }, tabs.element, tabs.panels);
    }

    /** 一个服务商的设置区：标题与启用开关、访问密钥、设置项、模型表。 */
    function render(provider) {
      const status = createSaveStatus();
      const enabledSwitch = aiUi.switchControl({ label: '启用', checked: provider.isEnabled });
      nameSwitch(enabledSwitch, `启用服务商 ${provider.displayName}`);
      enabledSwitch.onChange(async (checked) => {
        status.show(SAVING_TEXT, false);
        try {
          await window.hostBridge.request(REQUEST_PROVIDER_UPDATE, { providerId: provider.id, isEnabled: checked });
          status.show(SAVED_TEXT, false);
          void host.refreshPage();
        } catch (error) {
          enabledSwitch.setValue(!checked);
          status.show(`保存失败：${errorText(error)}`, true);
        }
      });

      const resultSlots = new Map();
      // 先生成设置项，让各地址的测试结位置登记进 resultSlots，再把它交给访问密钥区的“测试连接”按钮。
      const settingElements = provider.settings.map((setting) => renderProviderSetting(provider, setting, resultSlots));

      return aiUi.h(
        'section',
        { class: 'settings-section settings-section--wide' },
        aiUi.h('div', { class: 'provider-header' }, aiUi.h('h2', { class: 'ui-title', text: provider.displayName }), enabledSwitch.element),
        status.element,
        renderApiKey(provider, resultSlots),
        settingElements,
        aiUi.h('h3', { class: 'ui-heading provider-models-title', text: '模型' }),
        provider.models.length === 0 ? aiUi.h('p', { class: 'description', text: '该服务商没有提供模型。' }) : renderModelTabs(provider, status)
      );
    }

    return { render };
  }

  window.aiSettingsProvider = { create };
})();
