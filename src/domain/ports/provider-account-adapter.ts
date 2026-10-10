// ------------------------------------------------------------------------
// 名称：provider-account-adapter.ts
// 说明：服务商账户适配器的端口接口：查询账户余额与各模型的用量，由各服务商按自己的账户接口实现。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：与模型适配器分开：账户接口常常用另一套密钥与地址；不支持的查询不实现对应方法；失败一律抛出 ProviderError。
// ------------------------------------------------------------------------

import { AccountCredentialKind, AccountEntry } from '../models/provider-account';
import { ProviderSettings } from '../models/model-provider';

/** 账户查询使用的凭据：api-key 类型只有 apiKey，access-key 类型只有 accessKeyId 与 secretAccessKey。 */
export interface AccountCallContext {
  readonly apiKey?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly settings: ProviderSettings;
  readonly signal?: AbortSignal;
}

/** 用量查询的结果：按模型（或计费项）列出，note 说明统计范围。 */
export interface AccountUsage {
  readonly entries: readonly AccountEntry[];
  readonly note: string;
}

/** 服务商账户适配器。 */
export interface ProviderAccountAdapter {
  /** 对应的服务商代码。 */
  readonly providerCode: string;
  readonly credential: Exclude<AccountCredentialKind, 'none'>;
  /** 与哪个服务商共用密钥（填其代码）；独立使用自己的密钥时不填。 */
  readonly credentialOwnerCode?: string;
  /** 不支持的查询或使用限制的说明，显示在列表里。 */
  readonly note: string;

  /** 查询账户余额；不支持时不实现。 */
  queryBalance?(context: AccountCallContext): Promise<readonly AccountEntry[]>;

  /** 查询各模型的用量；不支持时不实现。 */
  queryUsage?(context: AccountCallContext): Promise<AccountUsage>;
}
