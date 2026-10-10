// ------------------------------------------------------------------------
// 名称：settings-handlers.ts
// 说明：模型设置页（P6）的请求处理：读取文本生成设置与服务商视图，即时保存文本生成设置、服务商启用与设置、访问密钥和模型开关，按需测试服务商连接，并查询各服务商的账户余额与用量。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：修改服务商相关内容的请求返回该服务商修改后的视图，页面据此局部刷新。
// ------------------------------------------------------------------------

import { MessageRouter } from '../messaging/message-router';
import { ProviderAccountService } from '../services/provider-account-service';
import { ProviderService } from '../services/provider-service';
import { TextSettingsService } from '../services/text-settings-service';

/** 设置页使用的请求名称，需与 resources/settings/settings.js 一致。 */
export const SETTINGS_REQUESTS = {
  load: 'settings.load',
  update: 'settings.update',
  providerUpdate: 'settings.providerUpdate',
  providerSetKey: 'settings.providerSetKey',
  providerClearKey: 'settings.providerClearKey',
  providerTestConnection: 'settings.providerTestConnection',
  modelSetEnabled: 'settings.modelSetEnabled',
  accountBalance: 'settings.accountBalance',
  accountUsage: 'settings.accountUsage',
  accountSetKey: 'settings.accountSetKey',
  accountClearKey: 'settings.accountClearKey'
} as const;

/** 设置页依赖的服务。 */
export interface SettingsServices {
  readonly text: TextSettingsService;
  readonly providers: ProviderService;
  readonly accounts: ProviderAccountService;
}

/**
 * 在路由器上注册设置页的请求处理函数。
 * @param router 面板的请求路由器。
 * @param services 设置页依赖的服务。
 */
export function registerSettingsHandlers(router: MessageRouter, services: SettingsServices): void {
  router.register(SETTINGS_REQUESTS.load, async () => ({
    text: await services.text.getView(),
    providers: await services.providers.listViews(),
    accounts: await services.accounts.listViews()
  }));

  router.register(SETTINGS_REQUESTS.update, async (payload) => {
    await services.text.update(payload);
    return { saved: true };
  });

  router.register(SETTINGS_REQUESTS.providerUpdate, async (payload) => ({ provider: await services.providers.updateProvider(payload) }));
  router.register(SETTINGS_REQUESTS.providerSetKey, async (payload) => ({ provider: await services.providers.setApiKey(payload) }));
  router.register(SETTINGS_REQUESTS.providerClearKey, async (payload) => ({ provider: await services.providers.clearApiKey(payload) }));
  router.register(SETTINGS_REQUESTS.providerTestConnection, (payload) => services.providers.testConnection(payload));
  router.register(SETTINGS_REQUESTS.modelSetEnabled, async (payload) => ({ provider: await services.providers.setModelEnabled(payload) }));

  router.register(SETTINGS_REQUESTS.accountBalance, (payload) => services.accounts.queryBalance(payload));
  router.register(SETTINGS_REQUESTS.accountUsage, (payload) => services.accounts.queryUsage(payload));
  router.register(SETTINGS_REQUESTS.accountSetKey, async (payload) => ({ account: await services.accounts.setAccountKey(payload) }));
  router.register(SETTINGS_REQUESTS.accountClearKey, async (payload) => ({ account: await services.accounts.clearAccountKey(payload) }));
}
