// ------------------------------------------------------------------------
// 名称：settings.js
// 说明：模型设置页脚本：顶部是文本生成设置（全局默认文本模型、小说分段方式、每段字数上限），下面是服务商列表，点“设置”弹出该服务商的设置页（启用、访问密钥、设置项、模型开关、价格与能力），服务商列表的每一行还带账户余额与用量（点按钮查询），全部即时保存。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-03
// 备注：请求名称与 src/app/pages/settings-handlers.ts 一致；每个字段旁显示“保存中…”“已保存”“保存失败”；访问密钥只发送给宿主，不回显；“测试连接”用宿主已保存的密钥和设置发起，对每个接口地址各测一次，结果显示在该地址的标签右侧。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_LOAD = 'settings.load';
  const REQUEST_UPDATE = 'settings.update';
  const REQUEST_PROVIDER_UPDATE = 'settings.providerUpdate';
  const REQUEST_PROVIDER_SET_KEY = 'settings.providerSetKey';
  const REQUEST_PROVIDER_CLEAR_KEY = 'settings.providerClearKey';
  const REQUEST_PROVIDER_TEST_CONNECTION = 'settings.providerTestConnection';
  const REQUEST_MODEL_SET_ENABLED = 'settings.modelSetEnabled';
  const REQUEST_ACCOUNT_BALANCE = 'settings.accountBalance';
  const REQUEST_ACCOUNT_USAGE = 'settings.accountUsage';
  const REQUEST_ACCOUNT_SET_KEY = 'settings.accountSetKey';
  const REQUEST_ACCOUNT_CLEAR_KEY = 'settings.accountClearKey';

  const SAVING_TEXT = '保存中…';
  const SAVED_TEXT = '已保存';
  const TESTING_TEXT = '正在测试连接…';
  const GENERIC_ERROR_TEXT = '操作失败，请重试。';
  const API_KEY_FIELD = 'apiKey';
  const KEY_CONFIGURED_TEXT = '已配置';
  const KEY_MISSING_TEXT = '未配置';
  const KEY_PLACEHOLDER_NEW = '粘贴访问密钥';
  const KEY_PLACEHOLDER_REPLACE = '已配置，输入新密钥可更换';
  const SPLIT_MODE_OPTIONS = [
    { value: 'chapter', label: '按章节' },
    { value: 'length', label: '按字数' }
  ];

  /** 模型类型标签的固定顺序；不在其中的类型排在最后。 */
  const KIND_LABEL_ORDER = ['文本', '图像', '音频', '视频'];

  const root = document.getElementById('app');

  /** 各服务商设置页当前选中的模型类型标签，重新打开时沿用。 */
  const activeKindByProvider = new Map();

  /** 账户查询的结果、进行中的查询与当前页面上的结果容器；键为“服务商标识:balance|usage”，重绘页面后仍能显示上次的结果。 */
  const accountResults = new Map();
  const accountBusy = new Set();
  const accountBoxes = new Map();

  /** 类型标签的排序值。 */
  function kindOrder(label) {
    const index = KIND_LABEL_ORDER.indexOf(label);
    return index === -1 ? KIND_LABEL_ORDER.length : index;
  }

  /** 取错误载荷中的说明文字。 */
  function errorText(error) {
    return (error && error.message) || GENERIC_ERROR_TEXT;
  }

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

  /** 最近一次后台刷新的序号，只采用最后发起的那次结果。 */
  let refreshSerial = 0;

  /** 服务商设置弹出页中保存成功后调用：重新读取并重绘弹出页后面的页面，让文本模型、启用数量等立即更新。 */
  async function refreshPageInBackground() {
    const serial = ++refreshSerial;
    try {
      const latest = await window.hostBridge.request(REQUEST_LOAD);
      if (serial !== refreshSerial) return;
      data = latest;
      renderPage();
    } catch {
      // 读取失败时保留当前页面，关闭弹出页时会再读取一次。
    }
  }

  /** 保存一项文本生成设置，并在状态文字中反馈结果。 */
  async function saveSetting(patch, status) {
    status.show(SAVING_TEXT, false);
    try {
      await window.hostBridge.request(REQUEST_UPDATE, patch);
      status.show(SAVED_TEXT, false);
    } catch (error) {
      status.show(`保存失败：${errorText(error)}`, true);
    }
  }

  /** 文本模型区：全局默认文本模型；文本模型在服务商设置页中启用。 */
  function renderEngineSettings(view) {
    const elements = [];
    if (view.choices.length > 0) {
      const modelStatus = createSaveStatus();
      const modelSelect = aiUi.select({
        options: view.choices.map((choice) => ({ value: choice.key, label: choice.label })),
        value: view.defaultModel,
        allowEmpty: false,
        ariaLabel: '默认文本模型',
        onChange: (value) => void saveSetting({ defaultModel: value }, modelStatus)
      });
      const modelField = aiUi.field({
        label: '默认文本模型',
        description: '生成创意、剧本、分镜脚本和资产提示词时使用；作品可以在“编辑作品”中单独选择，不选则沿用这里。',
        control: modelSelect
      });
      elements.push(modelField.element);
      if (view.modelNote) elements.push(aiUi.h('p', { class: 'status-warning settings-note', text: view.modelNote }));
      elements.push(modelStatus.element);
    }
    if (view.engineNote) elements.push(aiUi.h('p', { class: 'status-warning settings-note', text: view.engineNote }));
    return elements;
  }

  /** 文本生成设置区：先设置文本模型，再设置对所有文本模型通用的小说分段。 */
  function renderTextSettings(view) {
    const splitStatus = createSaveStatus();
    const splitRadio = aiUi.radioGroup({
      options: SPLIT_MODE_OPTIONS,
      value: view.splitMode,
      direction: 'horizontal',
      ariaLabel: '小说分段方式',
      onChange: (value) => {
        updateCharsDescription(value);
        void saveSetting({ splitMode: value }, splitStatus);
      }
    });
    const splitField = aiUi.field({
      label: '小说分段方式',
      description: '按章节时识别不到章节标题，会自动改为按字数。',
      control: splitRadio
    });

    const { min, max } = view.segmentCharsRange;
    const charsStatus = createSaveStatus();
    const charsInput = aiUi.textInput({ value: String(view.maxSegmentChars), ariaLabel: '每段字数上限' });
    const charsField = aiUi.field({
      label: '每段字数上限',
      description: charsDescription(view.splitMode),
      control: charsInput
    });
    /** 说明文字随分段方式切换：两种方式下这个值都会用，作用不同。 */
    function charsDescription(mode) {
      const effect = mode === 'chapter' ? '按章节时，单章超过此值会在段落处再切分。' : '按字数时，每段按此字数切分。';
      return `${min} 至 ${max} 的整数；${effect}`;
    }
    function updateCharsDescription(mode) {
      charsField.element.querySelector('.ui-field__description').textContent = charsDescription(mode);
    }
    // 输入框失去焦点且内容有变化时才保存；格式不对时不请求宿主，直接在字段下方提示。
    let savedChars = String(view.maxSegmentChars);
    charsInput.focusTarget.addEventListener('change', () => {
      const text = charsInput.getValue().trim();
      if (text === savedChars) return;
      const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
      if (!Number.isInteger(value) || value < min || value > max) {
        charsField.setError(`必须是 ${min} 到 ${max} 之间的整数。`);
        charsStatus.show('', false);
        return;
      }
      charsField.setError('');
      savedChars = text;
      void saveSetting({ maxSegmentChars: value }, charsStatus);
    });

    return aiUi.h(
      'section',
      { class: 'settings-section' },
      aiUi.h('h2', { class: 'ui-title', text: '文本生成' }),
      renderEngineSettings(view),
      aiUi.h('h3', { class: 'ui-heading settings-subtitle', text: '小说分段（所有文本模型通用）' }),
      splitField.element,
      splitStatus.element,
      charsField.element,
      charsStatus.element
    );
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

  /**
   * 访问密钥区：输入框、保存与清除按钮、配置状态；保存后在原位更新，不重绘整个分区。
   * @param {object} provider 服务商视图。
   * @param {Map<string, { show: (text: string, tone: string) => void }>} resultSlots “测试连接”结果的显示位置，键为设置项的键。
   */
  function renderApiKey(provider, resultSlots) {
    let configured = provider.apiKeyConfigured;
    const status = createSaveStatus();
    const keyState = aiUi.h('span', { class: 'provider-key-state' });
    const keyInput = aiUi.textInput({ type: 'password', ariaLabel: `${provider.displayName}访问密钥`, onEnter: () => void saveKey() });
    const keyField = aiUi.field({
      label: '访问密钥',
      description: '密钥经系统加密后保存在本机，不会写入数据库，也不会在页面上显示。',
      control: keyInput
    });
    const saveButton = aiUi.button({ text: '保存密钥', variant: 'primary', onClick: () => void saveKey() });
    const clearButton = aiUi.button({ text: '清除密钥', variant: 'danger', onClick: () => void clearKey() });
    const testButton = aiUi.button({ text: '测试连接', onClick: () => void testConnection() });

    /** 按是否已配置刷新状态文字、占位文字和按钮。 */
    function refresh() {
      keyState.textContent = configured ? KEY_CONFIGURED_TEXT : KEY_MISSING_TEXT;
      keyState.className = `provider-key-state ${configured ? 'status-success' : 'status-warning'}`;
      keyInput.focusTarget.placeholder = configured ? KEY_PLACEHOLDER_REPLACE : KEY_PLACEHOLDER_NEW;
      saveButton.setText(configured ? '更换密钥' : '保存密钥');
      clearButton.element.hidden = !configured;
      testButton.setDisabled(!configured);
    }

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
        testButton.setDisabled(!configured);
      }
    }

    async function saveKey() {
      const apiKey = keyInput.getValue().trim();
      if (apiKey === '') {
        keyField.setError('访问密钥不能为空。');
        return;
      }
      keyField.setError('');
      saveButton.setDisabled(true);
      status.show(SAVING_TEXT, false);
      try {
        const result = await window.hostBridge.request(REQUEST_PROVIDER_SET_KEY, { providerId: provider.id, apiKey });
        keyInput.setValue('');
        configured = result.provider.apiKeyConfigured;
        refresh();
        status.show(SAVED_TEXT, false);
        void refreshPageInBackground();
      } catch (error) {
        const message = fieldErrorOf(error, API_KEY_FIELD);
        if (message) {
          keyField.setError(message);
          status.show('', false);
        } else {
          status.show(`保存失败：${errorText(error)}`, true);
        }
      } finally {
        saveButton.setDisabled(false);
      }
    }

    async function clearKey() {
      const confirmed = await aiUi.confirm({
        title: '清除访问密钥',
        message: `清除后将无法使用“${provider.displayName}”的模型，需要重新填写密钥。`,
        confirmText: '清除',
        cancelText: '取消',
        variant: 'danger'
      });
      if (!confirmed) return;
      clearButton.setDisabled(true);
      status.show(SAVING_TEXT, false);
      try {
        const result = await window.hostBridge.request(REQUEST_PROVIDER_CLEAR_KEY, { providerId: provider.id });
        configured = result.provider.apiKeyConfigured;
        refresh();
        status.show(SAVED_TEXT, false);
        void refreshPageInBackground();
      } catch (error) {
        status.show(`清除失败：${errorText(error)}`, true);
      } finally {
        clearButton.setDisabled(false);
      }
    }

    refresh();
    return aiUi.h(
      'div',
      { class: 'provider-key' },
      keyField.element,
      aiUi.h('div', { class: 'provider-key-actions' }, saveButton.element, testButton.element, clearButton.element, keyState),
      status.element
    );
  }

  /**
   * 服务商的一个设置项：下拉选择后立即保存，文本在失去焦点且有变化时保存；校验错误显示在字段下方。
   * 声明了测试方式的地址，标签右侧留出位置显示“测试连接”的结果，地址修改保存后清除旧结果。
   */
  function renderProviderSetting(provider, setting, resultSlots) {
    const status = createSaveStatus();
    let saved = setting.value;
    let field;

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
        void refreshPageInBackground();
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
              void refreshPageInBackground();
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
  function renderProvider(provider) {
    const status = createSaveStatus();
    const enabledSwitch = aiUi.switchControl({ label: '启用', checked: provider.isEnabled });
    nameSwitch(enabledSwitch, `启用服务商 ${provider.displayName}`);
    enabledSwitch.onChange(async (checked) => {
      status.show(SAVING_TEXT, false);
      try {
        await window.hostBridge.request(REQUEST_PROVIDER_UPDATE, { providerId: provider.id, isEnabled: checked });
        status.show(SAVED_TEXT, false);
        void refreshPageInBackground();
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

  /** 服务商列表中的状态文字：已启用/已停用、密钥是否已配置。 */
  function renderProviderStatus(provider) {
    return aiUi.h(
      'div',
      { class: 'provider-status' },
      aiUi.h('span', { class: provider.isEnabled ? 'status-success' : 'description', text: provider.isEnabled ? '已启用' : '已停用' }),
      aiUi.h('span', { class: provider.apiKeyConfigured ? 'status-success' : 'status-warning', text: provider.apiKeyConfigured ? '密钥已配置' : '密钥未配置' })
    );
  }

  /** 服务商列表：每个服务商一行，带账户余额与用量的查询；点“设置”进入它的详情。 */
  function renderProviderList(providers, accounts) {
    if (providers.length === 0) {
      return aiUi.h(
        'section',
        { class: 'settings-section' },
        aiUi.h('h2', { class: 'ui-title', text: '模型服务商' }),
        aiUi.h('p', { class: 'description', text: '尚未接入模型。' })
      );
    }
    const accountOf = (provider) => accounts.find((account) => account.providerId === provider.id);
    const columns = [
      { title: '服务商', width: 150, nowrap: true, render: (provider) => aiUi.tableMainCell({ text: provider.displayName, description: provider.code || '' }) },
      {
        title: '模型类型',
        width: 220,
        minWidth: 220,
        render: (provider) => aiUi.h('div', { class: 'provider-chips' }, [...new Set(provider.models.map((model) => model.kindLabel))].map((text) => aiUi.chip({ text })))
      },
      { title: '状态', width: 120, nowrap: true, render: renderProviderStatus },
      {
        title: '模型',
        width: 100,
        nowrap: true,
        render: (provider) => `启用 ${provider.models.filter((model) => model.isEnabled).length} / ${provider.models.length}`
      },
      {
        title: '余额',
        width: 130,
        minWidth: 110,
        render: (provider) => {
          const account = accountOf(provider);
          return account ? renderAccountResultCell(account, 'balance') : aiUi.h('span', { class: 'description', text: '—' });
        }
      },
      {
        title: '用量',
        minWidth: 110,
        render: (provider) => {
          const account = accountOf(provider);
          return account ? renderAccountResultCell(account, 'usage') : aiUi.h('span', { class: 'description', text: '—' });
        }
      },
      {
        title: '操作',
        type: 'actions',
        render: (provider) => renderProviderActions(provider, accountOf(provider))
      }
    ];
    const notes = accounts.filter((account) => account.note);
    return aiUi.h(
      'section',
      { class: 'settings-section settings-section--wide' },
      aiUi.h('h2', { class: 'ui-title', text: '模型服务商' }),
      aiUi.table({ columns, rows: providers, ariaLabel: '模型服务商' }).element,
      aiUi.h(
        'div',
        { class: 'description account-notes' },
        aiUi.h('div', { text: '余额与用量由各平台的账户接口提供，结果只在本页显示，不保存；模型价格见服务商设置里的模型表。' }),
        notes.map((account) => aiUi.h('div', { text: `${account.displayName}：${account.note}` }))
      )
    );
  }

  /** 当前加载的设置数据；尚未加载成功时为 null。 */
  let data = null;

  /** 账户查询结果的键。 */
  function accountKey(providerId, kind) {
    return `${providerId}:${kind}`;
  }

  /** 按最近一次结果（或“查询中…”）重绘某个结果容器；没有结果时显示 emptyText。 */
  function paintAccountBox(key, emptyText) {
    const box = accountBoxes.get(key);
    if (!box) return;
    box.textContent = '';
    if (accountBusy.has(key)) {
      box.append(aiUi.h('span', { class: 'description', text: '查询中…' }));
      return;
    }
    const result = accountResults.get(key);
    if (!result) {
      box.append(aiUi.h('span', { class: 'description', text: emptyText }));
      return;
    }
    if (!result.ok) {
      box.append(aiUi.h('span', { class: 'status-error', text: result.message }));
      return;
    }
    if (result.entries.length === 0) {
      box.append(aiUi.h('span', { class: 'description', text: '没有数据。' }));
    }
    for (const entry of result.entries) {
      box.append(
        aiUi.h('div', { class: 'ui-wrap account-entry' }, aiUi.h('span', { class: 'account-entry__name', text: entry.name }), aiUi.h('span', { text: entry.text }))
      );
    }
    if (result.message) box.append(aiUi.h('div', { class: 'description account-note', text: result.message }));
  }

  /** 发起一次余额或用量查询，期间禁用按钮；失败原因显示在结果容器里。 */
  async function runAccountQuery(account, kind, button) {
    const key = accountKey(account.providerId, kind);
    const emptyText = '未查询';
    accountBusy.add(key);
    button.setDisabled(true);
    paintAccountBox(key, emptyText);
    try {
      const result = await window.hostBridge.request(kind === 'balance' ? REQUEST_ACCOUNT_BALANCE : REQUEST_ACCOUNT_USAGE, { providerId: account.providerId });
      accountResults.set(key, result);
    } catch (error) {
      accountResults.set(key, { ok: false, message: `查询失败：${errorText(error)}`, entries: [] });
    } finally {
      accountBusy.delete(key);
      button.setDisabled(false);
      paintAccountBox(key, emptyText);
    }
  }

  /** 账户密钥弹出页的内容：AccessKey ID 与 SecretKey 输入、保存与清除；保存后在原位更新状态。 */
  function renderAccountKey(account) {
    let ready = account.credentialReady;
    const status = createSaveStatus();
    const keyState = aiUi.h('span', { class: 'provider-key-state' });
    const idInput = aiUi.textInput({ type: 'password', ariaLabel: `${account.displayName}的 AccessKey ID` });
    const secretInput = aiUi.textInput({ type: 'password', ariaLabel: `${account.displayName}的 SecretKey`, onEnter: () => void save() });
    const sharedNote = account.sharedWith ? `与“${account.sharedWith}”共用同一份账户密钥，在任一行保存或清除对两者都生效。` : '';
    const idField = aiUi.field({
      label: 'AccessKey ID',
      description: sharedNote + '账户密钥只用于查询余额和账单，与调用模型的访问密钥不同；在平台控制台的“访问控制”中创建，建议用只有费用查看权限的子账号密钥。密钥经系统加密后保存在本机，不会写入数据库，也不会在页面上显示。',
      control: idInput
    });
    const secretField = aiUi.field({ label: 'SecretKey', control: secretInput });
    const saveButton = aiUi.button({ text: '保存密钥', variant: 'primary', onClick: () => void save() });
    const clearButton = aiUi.button({ text: '清除密钥', variant: 'danger', onClick: () => void clear() });

    function refresh() {
      keyState.textContent = ready ? KEY_CONFIGURED_TEXT : KEY_MISSING_TEXT;
      keyState.className = `provider-key-state ${ready ? 'status-success' : 'status-warning'}`;
      saveButton.setText(ready ? '更换密钥' : '保存密钥');
      clearButton.element.hidden = !ready;
    }

    async function save() {
      idField.setError('');
      secretField.setError('');
      saveButton.setDisabled(true);
      status.show(SAVING_TEXT, false);
      try {
        const result = await window.hostBridge.request(REQUEST_ACCOUNT_SET_KEY, {
          providerId: account.providerId,
          accessKeyId: idInput.getValue().trim(),
          secretAccessKey: secretInput.getValue().trim()
        });
        idInput.setValue('');
        secretInput.setValue('');
        ready = result.account.credentialReady;
        refresh();
        status.show(SAVED_TEXT, false);
        void refreshPageInBackground();
      } catch (error) {
        const idMessage = fieldErrorOf(error, 'accessKeyId');
        const secretMessage = fieldErrorOf(error, 'secretAccessKey');
        idField.setError(idMessage);
        secretField.setError(secretMessage);
        status.show(idMessage || secretMessage ? '' : `保存失败：${errorText(error)}`, !(idMessage || secretMessage));
      } finally {
        saveButton.setDisabled(false);
      }
    }

    async function clear() {
      const confirmed = await aiUi.confirm({
        title: '清除账户密钥',
        message: `清除后将无法查询“${account.displayName}”的余额和用量，需要重新填写。`,
        confirmText: '清除',
        cancelText: '取消',
        variant: 'danger'
      });
      if (!confirmed) return;
      clearButton.setDisabled(true);
      status.show(SAVING_TEXT, false);
      try {
        const result = await window.hostBridge.request(REQUEST_ACCOUNT_CLEAR_KEY, { providerId: account.providerId });
        ready = result.account.credentialReady;
        refresh();
        status.show(SAVED_TEXT, false);
        void refreshPageInBackground();
      } catch (error) {
        status.show(`清除失败：${errorText(error)}`, true);
      } finally {
        clearButton.setDisabled(false);
      }
    }

    refresh();
    return aiUi.h(
      'div',
      { class: 'provider-key' },
      idField.element,
      secretField.element,
      aiUi.h('div', { class: 'provider-key-actions' }, saveButton.element, clearButton.element, keyState),
      status.element
    );
  }

  /** 弹出账户密钥页；关闭后重新读取并重绘，让“账户密钥”状态是最新的。 */
  function openAccountKey(account) {
    const page = aiUi.openPage({
      title: `${account.displayName}账户密钥`,
      content: renderAccountKey(account),
      width: 520,
      height: 380,
      minWidth: 360,
      minHeight: 260,
      buttons: [{ id: 'close', text: '关闭', isCancel: true }]
    });
    void page.closed.then(async () => {
      try {
        data = await window.hostBridge.request(REQUEST_LOAD);
      } catch {
        // 沿用旧数据。
      }
      renderPage();
    });
  }

  /** 账户查询结果单元格：显示该服务商某项查询的最近结果；不支持时显示“—”。 */
  function renderAccountResultCell(account, kind) {
    const key = accountKey(account.providerId, kind);
    const box = aiUi.h('div', { class: 'account-result' });
    accountBoxes.set(key, box);
    paintAccountBox(key, (kind === 'balance' ? account.balanceSupported : account.usageSupported) ? '未查询' : '—');
    return box;
  }

  /** 服务商行的操作按钮：设置、查询余额、查询用量，以及需要单独账户密钥时的“账户密钥”。 */
  function renderProviderActions(provider, account) {
    const settingsButton = aiUi.button({ text: '设置', compact: true, ariaLabel: `设置：${provider.displayName}`, onClick: () => openProvider(provider.id) });
    const queryButtons = [];
    const settingsRow = [settingsButton.element];
    if (account) {
      const balanceButton = aiUi.button({
        text: '查询余额',
        compact: true,
        ariaLabel: `查询余额：${provider.displayName}`,
        onClick: () => void runAccountQuery(account, 'balance', balanceButton)
      });
      const usageButton = aiUi.button({
        text: '查询用量',
        compact: true,
        ariaLabel: `查询用量：${provider.displayName}`,
        onClick: () => void runAccountQuery(account, 'usage', usageButton)
      });
      balanceButton.setDisabled(!account.balanceSupported || accountBusy.has(accountKey(account.providerId, 'balance')));
      usageButton.setDisabled(!account.usageSupported || accountBusy.has(accountKey(account.providerId, 'usage')));
      queryButtons.push(balanceButton.element, usageButton.element);
      if (account.credential === 'access-key') {
        settingsRow.push(
          aiUi.button({
            text: account.credentialReady ? '账户密钥 ✓' : '账户密钥',
            compact: true,
            ariaLabel: `账户密钥：${provider.displayName}`,
            onClick: () => openAccountKey(account)
          }).element
        );
      }
    }
    return aiUi.h(
      'div',
      { class: 'account-actions' },
      queryButtons.length > 0 ? aiUi.h('div', { class: 'account-actions__row' }, queryButtons) : null,
      aiUi.h('div', { class: 'account-actions__row' }, settingsRow)
    );
  }

  /** 渲染页面：文本生成设置与带账户查询的服务商列表。 */
  function renderPage() {
    root.textContent = '';
    accountBoxes.clear();
    root.append(renderTextSettings(data.text), renderProviderList(data.providers, data.accounts || []));
  }

  /** 弹出服务商的设置页；关闭后重新读取，让列表里的启用、密钥、模型数量等状态是最新的（读取失败时沿用之前的数据）。 */
  function openProvider(providerId) {
    const provider = data.providers.find((item) => item.id === providerId);
    if (!provider) return;
    const page = aiUi.openPage({
      title: `${provider.displayName}设置`,
      content: renderProvider(provider),
      width: 900,
      height: 640,
      minWidth: 480,
      minHeight: 320,
      buttons: [{ id: 'close', text: '关闭', isCancel: true }]
    });
    void page.closed.then(async () => {
      try {
        data = await window.hostBridge.request(REQUEST_LOAD);
      } catch {
        // 沿用旧数据，列表状态可能稍有滞后。
      }
      renderPage();
    });
  }

  /** 加载设置并渲染页面；失败时显示原因和“重试”。 */
  async function load() {
    root.textContent = '';
    root.append(aiUi.h('p', { class: 'description', text: '加载中…' }));
    try {
      data = await window.hostBridge.request(REQUEST_LOAD);
      renderPage();
    } catch (error) {
      root.textContent = '';
      root.append(
        aiUi.h('p', { class: 'status-error', text: errorText(error) }),
        aiUi.button({ text: '重试', onClick: () => void load() }).element
      );
    }
  }

  void load();
})();
