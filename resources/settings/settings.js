// ------------------------------------------------------------------------
// 名称：settings.js
// 说明：模型设置页脚本：顶部是文本生成设置（全局默认文本模型、小说分段方式、每段字数上限），下面是服务商列表，点“设置”弹出该服务商的设置页（启用、访问密钥、设置项、模型开关、价格与能力），服务商列表的每一行还带账户余额与用量（点按钮查询），全部即时保存。本文件只保存页面数据并装配各区域，各区域的绘制在下面列出的子脚本里。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-03
// 备注：请求名称与 src/app/pages/settings-handlers.ts 一致；依赖 shared/page-format.js（pageFormat）；每个字段旁显示“保存中…”“已保存”“保存失败”；访问密钥只发送给宿主，不回显；“测试连接”用宿主已保存的密钥和设置发起，对每个接口地址各测一次，结果显示在该地址的标签右侧；共用的状态文字与开关命名由 settings/settings-widgets.js（aiSettingsWidgets）提供，访问密钥与账户密钥的表单由 settings/settings-secret-form.js（aiSettingsSecretForm）提供，“文本生成”区由 settings/settings-text.js（aiSettingsText）提供，服务商设置页由 settings/settings-provider.js（aiSettingsProvider）提供，账户余额、用量与账户密钥由 settings/settings-account.js（aiSettingsAccount）提供，这些脚本都必须先于本文件加载（按 widgets、secret-form、text、provider、account 的顺序）。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_LOAD = 'settings.load';

  const root = document.getElementById('app');
  const { errorText } = window.pageFormat;

  /** 当前加载的设置数据；尚未加载成功时为 null。 */
  let data = null;

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

  /** 弹出页关闭后重新读取，让列表里的启用、密钥、模型数量等状态是最新的（读取失败时沿用之前的数据）。 */
  async function reloadPage() {
    try {
      data = await window.hostBridge.request(REQUEST_LOAD);
    } catch {
      // 沿用旧数据，列表状态可能稍有滞后。
    }
    renderPage();
  }

  const providerPanel = aiSettingsProvider.create({ refreshPage: refreshPageInBackground });
  const accountPanel = aiSettingsAccount.create({ refreshPage: refreshPageInBackground, reloadPage, openProvider });

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
          return account ? accountPanel.renderResultCell(account, 'balance') : aiUi.h('span', { class: 'description', text: '—' });
        }
      },
      {
        title: '用量',
        minWidth: 110,
        render: (provider) => {
          const account = accountOf(provider);
          return account ? accountPanel.renderResultCell(account, 'usage') : aiUi.h('span', { class: 'description', text: '—' });
        }
      },
      {
        title: '操作',
        type: 'actions',
        render: (provider) => accountPanel.renderActions(provider, accountOf(provider))
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

  /** 渲染页面：文本生成设置与带账户查询的服务商列表。 */
  function renderPage() {
    root.textContent = '';
    accountPanel.resetBoxes();
    root.append(aiSettingsText.render(data.text), renderProviderList(data.providers, data.accounts || []));
  }

  /** 弹出服务商的设置页；关闭后重新读取并重绘。 */
  function openProvider(providerId) {
    const provider = data.providers.find((item) => item.id === providerId);
    if (!provider) return;
    const page = aiUi.openPage({
      title: `${provider.displayName}设置`,
      content: providerPanel.render(provider),
      width: 900,
      height: 640,
      minWidth: 480,
      minHeight: 320,
      buttons: [{ id: 'close', text: '关闭', isCancel: true }]
    });
    void page.closed.then(reloadPage);
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
