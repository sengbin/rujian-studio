// ------------------------------------------------------------------------
// 名称：provider-account-service.ts
// 说明：服务商账户应用服务：整理设置页“账户余额与用量”列表，保存与清除账户查询密钥，并按服务商的账户适配器查询余额和各模型用量。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：密钥只经 SecretStore 读写，不进入任何视图；查询失败（鉴权、网络等）不抛出，而是在结果里说明原因；没有账户适配器的服务商只显示说明。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, NotFoundError, ProviderError, ValidationError } from '../../domain/errors';
import { AccountEntry, AccountQueryResult, AccountView } from '../../domain/models/provider-account';
import { ProviderRecord } from '../../domain/models/model-provider';
import { AccountCallContext, ProviderAccountAdapter } from '../../domain/ports/provider-account-adapter';
import { ProviderRegistry } from '../../domain/ports/provider-registry';
import { ProviderRepository } from '../../domain/ports/provider-repository';
import { SecretStore } from '../../domain/ports/secret-store';
import { describeJobFailure } from '../../domain/rules/generation-failure-copy';
import { providerAccountSecretKeys, providerApiKeySecretKey, readAccountKeyInput, readProviderId } from '../../domain/rules/provider-rules';

/** 一次账户查询的总超时（毫秒）：账单明细可能要翻多页。 */
const QUERY_TIMEOUT_MS = 120_000;

/** 没有账户适配器的服务商的说明。 */
const NO_ACCOUNT_API_NOTE = '该平台暂无公开的余额与用量查询接口，请在平台控制台查看。';

/** 服务商账户应用服务的依赖。 */
export interface ProviderAccountServiceDependencies {
  readonly repository: ProviderRepository;
  readonly registry: ProviderRegistry;
  readonly secrets: SecretStore;
  readonly adapters: readonly ProviderAccountAdapter[];
}

/** 服务商账户应用服务。 */
export class ProviderAccountService {
  private readonly repository: ProviderRepository;
  private readonly registry: ProviderRegistry;
  private readonly secrets: SecretStore;
  private readonly adapters: ReadonlyMap<string, ProviderAccountAdapter>;

  constructor(dependencies: ProviderAccountServiceDependencies) {
    this.repository = dependencies.repository;
    this.registry = dependencies.registry;
    this.secrets = dependencies.secrets;
    this.adapters = new Map(dependencies.adapters.map((adapter) => [adapter.providerCode, adapter]));
  }

  /** 列出设置页“账户余额与用量”的全部行，每个有适配器的服务商一行。 */
  async listViews(): Promise<AccountView[]> {
    const views: AccountView[] = [];
    for (const provider of this.repository.listProviders()) {
      if (this.registry.findProvider(provider.code) !== undefined) {
        views.push(await this.buildView(provider));
      }
    }
    return views;
  }

  /**
   * 查询账户余额。
   * @param rawInput 界面提交的原始内容：providerId。
   * @throws ValidationError 标识不合法。
   * @throws NotFoundError 服务商不存在。
   */
  async queryBalance(rawInput: unknown): Promise<AccountQueryResult> {
    return this.query(rawInput, 'balance');
  }

  /** 查询各模型的用量，参数与错误同 queryBalance。 */
  async queryUsage(rawInput: unknown): Promise<AccountQueryResult> {
    return this.query(rawInput, 'usage');
  }

  /**
   * 保存账户查询密钥（AccessKey ID 与 SecretKey），返回修改后的行。
   * @param rawInput 界面提交的原始内容：providerId、accessKeyId、secretAccessKey。
   * @throws ValidationError 内容不合法，或该服务商的账户查询不使用 AccessKey。
   * @throws NotFoundError 服务商不存在。
   */
  async setAccountKey(rawInput: unknown): Promise<AccountView> {
    const { providerId, accessKeyId, secretAccessKey } = readAccountKeyInput(rawInput);
    const { provider, adapter } = this.requireAccessKeyProvider(providerId);
    const names = providerAccountSecretKeys(adapter.credentialOwnerCode ?? provider.code);
    await this.secrets.set(names.accessKeyId, accessKeyId);
    await this.secrets.set(names.secretAccessKey, secretAccessKey);
    return this.buildView(provider);
  }

  /**
   * 清除账户查询密钥，返回修改后的行。
   * @param rawInput 界面提交的原始内容：providerId。
   * @throws ValidationError 该服务商的账户查询不使用 AccessKey。
   * @throws NotFoundError 服务商不存在。
   */
  async clearAccountKey(rawInput: unknown): Promise<AccountView> {
    const { provider, adapter } = this.requireAccessKeyProvider(readProviderId(rawInput));
    const names = providerAccountSecretKeys(adapter.credentialOwnerCode ?? provider.code);
    await this.secrets.delete(names.accessKeyId);
    await this.secrets.delete(names.secretAccessKey);
    return this.buildView(provider);
  }

  private async query(rawInput: unknown, kind: 'balance' | 'usage'): Promise<AccountQueryResult> {
    const provider = this.requireProvider(readProviderId(rawInput));
    const adapter = this.adapters.get(provider.code);
    const supported = kind === 'balance' ? adapter?.queryBalance !== undefined : adapter?.queryUsage !== undefined;
    if (adapter === undefined || !supported) {
      return failure(adapter?.note ?? NO_ACCOUNT_API_NOTE);
    }
    const credentials = await this.readCredentials(adapter, provider.code);
    if (credentials === null) {
      return failure(adapter.credential === 'access-key' ? '尚未配置账户密钥（AccessKey/SecretKey），请先点“账户密钥”填写。' : '尚未配置访问密钥，请先在服务商设置里填写。');
    }
    const context: AccountCallContext = { ...credentials, settings: provider.settings, signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) };
    try {
      if (kind === 'balance') {
        return { ok: true, message: '', entries: (await adapter.queryBalance?.(context)) ?? [] };
      }
      const usage = await adapter.queryUsage?.(context);
      return { ok: true, message: usage?.note ?? '', entries: usage?.entries ?? [] };
    } catch (error) {
      if (error instanceof ProviderError) {
        return failure(`${describeJobFailure({ category: error.category, code: error.code, message: error.message }).label}：${error.message}`);
      }
      throw error;
    }
  }

  /** 读取适配器需要的密钥；没有配置返回 null。 */
  private async readCredentials(adapter: ProviderAccountAdapter, providerCode: string): Promise<Pick<AccountCallContext, 'apiKey' | 'accessKeyId' | 'secretAccessKey'> | null> {
    const ownerCode = adapter.credentialOwnerCode ?? providerCode;
    if (adapter.credential === 'api-key') {
      const apiKey = await this.secrets.get(providerApiKeySecretKey(ownerCode));
      return apiKey === undefined || apiKey === '' ? null : { apiKey };
    }
    const names = providerAccountSecretKeys(ownerCode);
    const accessKeyId = await this.secrets.get(names.accessKeyId);
    const secretAccessKey = await this.secrets.get(names.secretAccessKey);
    return accessKeyId === undefined || accessKeyId === '' || secretAccessKey === undefined || secretAccessKey === '' ? null : { accessKeyId, secretAccessKey };
  }

  private requireProvider(providerId: number): ProviderRecord {
    const provider = this.repository.findProviderById(providerId);
    if (provider === undefined || this.registry.findProvider(provider.code) === undefined) {
      throw new NotFoundError(`服务商 ${providerId} 不存在。`);
    }
    return provider;
  }

  private requireAccessKeyProvider(providerId: number): { provider: ProviderRecord; adapter: ProviderAccountAdapter } {
    const provider = this.requireProvider(providerId);
    const adapter = this.adapters.get(provider.code);
    if (adapter === undefined || adapter.credential !== 'access-key') {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: `“${provider.displayName}”的账户查询不需要单独的账户密钥。` });
    }
    return { provider, adapter };
  }

  private async buildView(provider: ProviderRecord): Promise<AccountView> {
    const adapter = this.adapters.get(provider.code);
    if (adapter === undefined) {
      return { providerId: provider.id, displayName: provider.displayName, credential: 'none', credentialReady: true, sharedWith: null, balanceSupported: false, usageSupported: false, note: NO_ACCOUNT_API_NOTE };
    }
    const owner = adapter.credentialOwnerCode === undefined ? undefined : this.repository.findProviderByCode(adapter.credentialOwnerCode);
    return {
      providerId: provider.id,
      displayName: provider.displayName,
      credential: adapter.credential,
      credentialReady: (await this.readCredentials(adapter, provider.code)) !== null,
      sharedWith: owner?.displayName ?? null,
      balanceSupported: adapter.queryBalance !== undefined,
      usageSupported: adapter.queryUsage !== undefined,
      note: adapter.note
    };
  }
}

/** 构造失败的查询结果。 */
function failure(message: string): AccountQueryResult {
  return { ok: false, message, entries: [] as readonly AccountEntry[] };
}
