// ------------------------------------------------------------------------
// 名称：volcengine-account-adapter.ts
// 说明：火山引擎账户适配器：用费用中心接口查询账户余额（QueryBalanceAcct）和当月各计费项的用量与费用（ListBillDetail）。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：费用中心只认账户级的 AccessKey/SecretKey 签名，方舟的访问密钥（API Key）不能用；方舟与豆包语音是同一个火山账户，余额相同，用量按产品名过滤；账单按计费项汇总且有约一天的延迟；账单产品名的匹配规则（productPattern）未经真实账户核对，查不到时先看费用中心的产品名。
// ------------------------------------------------------------------------

import { ProviderError, ProviderFailure } from '../../../domain/errors';
import { AccountEntry } from '../../../domain/models/provider-account';
import { AccountCallContext, AccountUsage, ProviderAccountAdapter } from '../../../domain/ports/provider-account-adapter';
import { FetchFunction, ProviderHttpTransport } from '../shared/provider-http-transport';
import { readObject } from '../shared/provider-payload';
import { DEFAULT_VOLCENGINE_TIMEOUTS } from './volcengine-api-client';
import { signVolcengineRequest } from './volcengine-signature';

/** 费用中心接口的地址、服务名、地域与版本。 */
const BILLING_HOST = 'open.volcengineapi.com';
const BILLING_SERVICE = 'billing';
const BILLING_REGION = 'cn-north-1';
const BILLING_VERSION = '2022-01-01';

/** 账单明细每页条数上限与最多翻页数（接口限 5 QPS，逐页顺序请求）。 */
const BILL_PAGE_SIZE = 300;
const BILL_MAX_PAGES = 10;

/** 显示用的币种名称。 */
const CURRENCY_LABELS: Readonly<Record<string, string>> = { CNY: '元', USD: '美元' };

/** 账户余额接口返回的字段与显示名称，按显示顺序。 */
const BALANCE_FIELDS: ReadonlyArray<readonly [key: string, label: string]> = [
  ['AvailableBalance', '可用余额'],
  ['CashBalance', '现金余额'],
  ['FreezeAmount', '冻结金额'],
  ['ArrearsBalance', '欠费金额'],
  ['CreditLimit', '信控额度']
];

/** 签名或权限错误的错误码特征。 */
const AUTH_CODE_PATTERN = /Signature|AccessKey|AccessDenied|Forbidden|Unauthorized|InvalidCredential|NotAuthorized/i;

/** 适配器的构造选项。 */
export interface VolcengineAccountOptions {
  /** 账单中产品名（Product、ProductZh）的匹配规则，用于只统计该服务商相关的产品。 */
  readonly productPattern: RegExp;
  /** 共用密钥的服务商代码。 */
  readonly credentialOwnerCode?: string;
  readonly note: string;
  readonly fetchFunction?: FetchFunction;
  /** 当前时间，测试时可注入。 */
  readonly now?: () => Date;
}

/** 火山引擎账户适配器。 */
export class VolcengineAccountAdapter implements ProviderAccountAdapter {
  readonly credential = 'access-key';
  readonly credentialOwnerCode: string | undefined;
  readonly note: string;
  private readonly transport: ProviderHttpTransport;
  private readonly productPattern: RegExp;
  private readonly now: () => Date;

  /**
   * @param providerCode 服务商代码。
   * @param options 产品名匹配规则、共用密钥、说明与可注入的 fetch、时钟。
   */
  constructor(
    readonly providerCode: string,
    options: VolcengineAccountOptions
  ) {
    this.credentialOwnerCode = options.credentialOwnerCode;
    this.note = options.note;
    this.productPattern = options.productPattern;
    this.now = options.now ?? (() => new Date());
    this.transport = new ProviderHttpTransport(options.fetchFunction ?? fetch, {
      providerName: '火山引擎费用中心',
      timeouts: DEFAULT_VOLCENGINE_TIMEOUTS,
      buildHttpError
    });
  }

  async queryBalance(context: AccountCallContext): Promise<readonly AccountEntry[]> {
    const result = readObject((await this.call(context, 'GET', 'QueryBalanceAcct', '')).Result);
    const unit = CURRENCY_LABELS[String(result.Currency ?? 'CNY')] ?? String(result.Currency);
    const entries = BALANCE_FIELDS.flatMap(([key, label]) => (typeof result[key] === 'string' ? [{ name: label, text: `${result[key]} ${unit}` }] : []));
    if (entries.length === 0) {
      throw new ProviderError('server', '火山引擎费用中心没有返回余额。');
    }
    return entries;
  }

  async queryUsage(context: AccountCallContext): Promise<AccountUsage> {
    const period = this.now().toISOString().slice(0, 7);
    const groups = new Map<string, { name: string; unit: string; count: number; amount: number }>();
    for (let page = 0; page < BILL_MAX_PAGES; page += 1) {
      const body = JSON.stringify({ BillPeriod: period, Limit: BILL_PAGE_SIZE, Offset: page * BILL_PAGE_SIZE, NeedRecordNum: 0, IgnoreZero: 1 });
      const list = readObject((await this.call(context, 'POST', 'ListBillDetail', body)).Result).List;
      const rows = Array.isArray(list) ? list.map(readObject) : [];
      for (const row of rows) {
        if (this.productPattern.test(`${String(row.Product ?? '')} ${String(row.ProductZh ?? '')}`)) {
          addToGroups(groups, row);
        }
      }
      if (rows.length < BILL_PAGE_SIZE) {
        break;
      }
    }
    const entries = [...groups.values()]
      .sort((first, second) => second.amount - first.amount)
      .map((group) => ({ name: group.name, text: `${formatNumber(group.count)}${group.unit === '' ? '' : ` ${group.unit}`} · ${group.amount.toFixed(2)} 元` }));
    return { entries, note: `${period} 月账单，按计费项汇总，约有一天延迟${entries.length === 0 ? '；本月没有该产品的账单记录' : ''}。` };
  }

  /** 签名并调用费用中心接口；响应里带 ResponseMetadata.Error 时按错误抛出。 */
  private async call(context: AccountCallContext, method: 'GET' | 'POST', action: string, body: string): Promise<Record<string, unknown>> {
    const signed = signVolcengineRequest({
      method,
      host: BILLING_HOST,
      query: { Action: action, Version: BILLING_VERSION },
      body,
      region: BILLING_REGION,
      service: BILLING_SERVICE,
      accessKeyId: context.accessKeyId ?? '',
      secretAccessKey: context.secretAccessKey ?? '',
      now: this.now()
    });
    const payload = await this.transport.requestJson(signed.url, { method, headers: signed.headers, body: body === '' ? undefined : body, signal: context.signal });
    const error = readObject(readObject(payload.ResponseMetadata).Error);
    if (typeof error.Code === 'string') {
      throw buildHttpError(200, payload);
    }
    return payload;
  }
}

/** 把一行账单累加进按计费项（名称加单位）汇总的结果。 */
function addToGroups(groups: Map<string, { name: string; unit: string; count: number; amount: number }>, row: Record<string, unknown>): void {
  const name = [row.ConfigName, row.Element, row.InstanceName].map((value) => (typeof value === 'string' ? value.trim() : '')).find((value) => value !== '') ?? '其他';
  const unit = typeof row.Unit === 'string' ? row.Unit : '';
  const key = `${name}|${unit}`;
  const group = groups.get(key) ?? { name, unit, count: 0, amount: 0 };
  group.count += Number.parseFloat(String(row.Count ?? '0')) || 0;
  group.amount += Number.parseFloat(String(row.PayableAmount ?? '0')) || 0;
  groups.set(key, group);
}

/** 数量显示：整数不带小数，其余最多保留两位。 */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** 把非 2xx 响应（或带错误的 200 响应）转换为带分类的错误；错误放在 ResponseMetadata.Error 里。 */
function buildHttpError(status: number, payload: Record<string, unknown>): ProviderError {
  const error = readObject(readObject(payload.ResponseMetadata).Error);
  const code = typeof error.Code === 'string' && error.Code !== '' ? error.Code : null;
  const message = typeof error.Message === 'string' && error.Message !== '' ? error.Message : `HTTP ${status}`;
  let category: ProviderFailure = status >= 500 ? 'server' : 'invalid_request';
  if (status === 401 || status === 403 || (code !== null && AUTH_CODE_PATTERN.test(code))) category = 'auth';
  else if (status === 429) category = 'rate_limited';
  return new ProviderError(category, `火山引擎费用中心返回错误${code === null ? '' : `（${code}）`}：${message}`, { code });
}
