// ------------------------------------------------------------------------
// 名称：settings-account.js
// 说明：模型设置页服务商列表里的账户部分：余额与用量的查询（点按钮查询，结果只在本页显示，重绘后仍保留上次结果）、每行的操作按钮（设置、查询余额、查询用量、账户密钥），以及需要单独账户密钥（AccessKey ID 与 SecretKey）的弹出页。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 settings.js 拆出；请求名称与 src/app/pages/settings-handlers.ts 一致；对外是 window.aiSettingsAccount.create(host)，返回 renderResultCell、renderActions、resetBoxes；必须晚于 settings-widgets.js 与 settings-secret-form.js、先于 settings.js 加载；账户密钥只发送给宿主，不回显。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_ACCOUNT_BALANCE = 'settings.accountBalance';
  const REQUEST_ACCOUNT_USAGE = 'settings.accountUsage';
  const REQUEST_ACCOUNT_SET_KEY = 'settings.accountSetKey';
  const REQUEST_ACCOUNT_CLEAR_KEY = 'settings.accountClearKey';

  const { errorText } = window.pageFormat;

  /** 账户查询结果的键。 */
  function accountKey(providerId, kind) {
    return `${providerId}:${kind}`;
  }

  /**
   * 创建账户区；只创建一个实例。
   * @param {{
   *   refreshPage: () => void,
   *   reloadPage: () => Promise<void>,
   *   openProvider: (providerId: number) => void
   * }} host 宿主页面提供的操作：refreshPage 在保存成功后后台刷新页面，reloadPage 在弹出页关闭后重新读取并重绘，openProvider 打开服务商设置页。
   * @returns {{ renderResultCell: (account: object, kind: string) => HTMLElement, renderActions: (provider: object, account: object|undefined) => HTMLElement, resetBoxes: () => void }}
   */
  function create(host) {
    /** 账户查询的结果、进行中的查询与当前页面上的结果容器；键为“服务商标识:balance|usage”，重绘页面后仍能显示上次的结果。 */
    const accountResults = new Map();
    const accountBusy = new Set();
    const accountBoxes = new Map();

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
      const sharedNote = account.sharedWith ? `与“${account.sharedWith}”共用同一份账户密钥，在任一行保存或清除对两者都生效。` : '';
      return aiSettingsSecretForm.create({
        fields: [
          {
            key: 'accessKeyId',
            label: 'AccessKey ID',
            ariaLabel: `${account.displayName}的 AccessKey ID`,
            description: sharedNote + '账户密钥只用于查询余额和账单，与调用模型的访问密钥不同；在平台控制台的“访问控制”中创建，建议用只有费用查看权限的子账号密钥。密钥经系统加密后保存在本机，不会写入数据库，也不会在页面上显示。'
          },
          { key: 'secretAccessKey', label: 'SecretKey', ariaLabel: `${account.displayName}的 SecretKey`, submitOnEnter: true }
        ],
        configured: account.credentialReady,
        payload: { providerId: account.providerId },
        saveRequest: REQUEST_ACCOUNT_SET_KEY,
        clearRequest: REQUEST_ACCOUNT_CLEAR_KEY,
        readConfigured: (result) => result.account.credentialReady,
        clearConfirm: { title: '清除账户密钥', message: `清除后将无法查询“${account.displayName}”的余额和用量，需要重新填写。` },
        onChanged: () => void host.refreshPage()
      }).element;
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
      void page.closed.then(() => host.reloadPage());
    }

    /** 账户查询结果单元格：显示该服务商某项查询的最近结果；不支持时显示“—”。 */
    function renderResultCell(account, kind) {
      const key = accountKey(account.providerId, kind);
      const box = aiUi.h('div', { class: 'account-result' });
      accountBoxes.set(key, box);
      paintAccountBox(key, (kind === 'balance' ? account.balanceSupported : account.usageSupported) ? '未查询' : '—');
      return box;
    }

    /** 服务商行的操作按钮：设置、查询余额、查询用量，以及需要单独账户密钥时的“账户密钥”。 */
    function renderActions(provider, account) {
      const settingsButton = aiUi.button({ text: '设置', compact: true, ariaLabel: `设置：${provider.displayName}`, onClick: () => host.openProvider(provider.id) });
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

    return {
      renderResultCell,
      renderActions,
      /** 页面重绘前丢弃旧的结果容器（查询结果本身保留）。 */
      resetBoxes() {
        accountBoxes.clear();
      }
    };
  }

  window.aiSettingsAccount = { create };
})();
