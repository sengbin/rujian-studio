// ------------------------------------------------------------------------
// 名称：provider-account.ts
// 说明：服务商账户查询的领域模型：账户查询所需的密钥类型、设置页展示的账户行，以及余额、用量的查询结果。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：余额与用量来自服务商的账户接口，与生成用的访问密钥是两回事：有的平台只认账户级密钥（AccessKey/SecretKey）；密钥本身不会出现在任何视图里。
// ------------------------------------------------------------------------

/** 账户查询使用的密钥类型：none 没有可用接口，api-key 复用服务商访问密钥，access-key 需要单独的 AccessKey/SecretKey。 */
export type AccountCredentialKind = 'none' | 'api-key' | 'access-key';

/** 查询结果中的一项：名称与说明，如“可用余额”“12.34 元”。 */
export interface AccountEntry {
  readonly name: string;
  readonly text: string;
}

/** 一次余额或用量查询的结果：失败也是正常结果，message 说明原因。 */
export interface AccountQueryResult {
  readonly ok: boolean;
  /** 成功时的补充说明（如统计范围），失败时为原因。 */
  readonly message: string;
  readonly entries: readonly AccountEntry[];
}

/** 设置页“账户余额与用量”表的一行。 */
export interface AccountView {
  readonly providerId: number;
  readonly displayName: string;
  readonly credential: AccountCredentialKind;
  /** 账户查询所需的密钥是否已配置；不需要单独密钥时为 true。 */
  readonly credentialReady: boolean;
  /** 与其他服务商共用密钥时，该服务商的名称；否则为 null。 */
  readonly sharedWith: string | null;
  readonly balanceSupported: boolean;
  readonly usageSupported: boolean;
  /** 不支持查询或有使用限制时的说明。 */
  readonly note: string;
}
