// ------------------------------------------------------------------------
// 名称：provider-account-service.test.ts
// 说明：服务商账户应用服务的自动化测试：账户行视图、余额与用量查询、密钥缺失与失败的说明、账户密钥的保存与清除、共用密钥。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：使用内存数据库、假服务商与假账户适配器，不访问网络。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundError, ProviderError, ValidationError } from '../../domain/errors';
import { AccountCallContext, ProviderAccountAdapter } from '../../domain/ports/provider-account-adapter';
import { ProviderRegistry } from '../../domain/ports/provider-registry';
import { FAKE_PROVIDER_CODE, FakeVideoProvider } from '../../domain/ports/testing/fake-model-providers';
import { MemorySecretStore } from '../../domain/ports/testing/memory-secret-store';
import { providerAccountSecretKeys, providerApiKeySecretKey } from '../../domain/rules/provider-rules';
import { IN_MEMORY_DATABASE_PATH, openDatabase } from '../../infra/database/database-connection';
import { SqliteProviderRepository } from '../../infra/database/sqlite-provider-repository';
import { ProviderAccountService } from './provider-account-service';
import { ProviderService } from './provider-service';

/** 记录收到的凭据的假账户适配器；credential 决定使用哪种密钥。 */
function createAdapter(credential: 'api-key' | 'access-key', overrides: Partial<ProviderAccountAdapter> = {}) {
  const contexts: AccountCallContext[] = [];
  const adapter: ProviderAccountAdapter = {
    providerCode: FAKE_PROVIDER_CODE,
    credential,
    note: '假说明',
    queryBalance: async (context) => {
      contexts.push(context);
      return [{ name: '可用余额', text: '1.00 元' }];
    },
    queryUsage: async (context) => {
      contexts.push(context);
      return { entries: [{ name: 'fake-video', text: '3 个' }], note: '本月' };
    },
    ...overrides
  };
  return { adapter, contexts };
}

function createService(adapters: readonly ProviderAccountAdapter[]) {
  const repository = new SqliteProviderRepository(openDatabase(IN_MEMORY_DATABASE_PATH));
  const registry = new ProviderRegistry().register(new FakeVideoProvider());
  const secrets = new MemorySecretStore();
  new ProviderService({ repository, registry, secrets }).syncCatalog();
  const service = new ProviderAccountService({ repository, registry, secrets, adapters });
  const providerId = repository.listProviders()[0].id;
  return { service, secrets, providerId };
}

test('账户行：没有账户适配器的服务商不支持查询并给出说明；有适配器的按密钥状态给出行', async () => {
  const none = createService([]);
  const [row] = await none.service.listViews();
  assert.deepEqual([row.credential, row.credentialReady, row.balanceSupported, row.usageSupported], ['none', true, false, false]);
  assert.match(row.note, /暂无公开/);
  assert.equal((await none.service.queryBalance({ providerId: none.providerId })).ok, false);

  const withKey = createService([createAdapter('access-key').adapter]);
  const [needKey] = await withKey.service.listViews();
  assert.deepEqual([needKey.credential, needKey.credentialReady, needKey.balanceSupported, needKey.usageSupported, needKey.note], ['access-key', false, true, true, '假说明']);
});

test('查询：访问密钥类适配器用服务商访问密钥，没有密钥时说明原因，不调用适配器', async () => {
  const { adapter, contexts } = createAdapter('api-key');
  const { service, secrets, providerId } = createService([adapter]);

  const missing = await service.queryBalance({ providerId });
  assert.deepEqual([missing.ok, missing.entries.length], [false, 0]);
  assert.match(missing.message, /访问密钥/);
  assert.equal(contexts.length, 0);

  await secrets.set(providerApiKeySecretKey(FAKE_PROVIDER_CODE), 'sk-1');
  const balance = await service.queryBalance({ providerId });
  assert.deepEqual([balance.ok, balance.entries], [true, [{ name: '可用余额', text: '1.00 元' }]]);
  const usage = await service.queryUsage({ providerId });
  assert.deepEqual([usage.ok, usage.message, usage.entries], [true, '本月', [{ name: 'fake-video', text: '3 个' }]]);
  assert.equal(contexts[0].apiKey, 'sk-1');
});

test('查询：不支持的查询返回说明；适配器抛出的服务商错误转换为失败结果，其他错误原样抛出', async () => {
  const balanceOnly = createAdapter('api-key', { queryUsage: undefined });
  const first = createService([balanceOnly.adapter]);
  await first.secrets.set(providerApiKeySecretKey(FAKE_PROVIDER_CODE), 'sk-1');
  assert.deepEqual([(await first.service.queryUsage({ providerId: first.providerId })).ok, (await first.service.listViews())[0].usageSupported], [false, false]);

  const failing = createAdapter('api-key', {
    queryBalance: async () => {
      throw new ProviderError('auth', '密钥无效');
    }
  });
  const second = createService([failing.adapter]);
  await second.secrets.set(providerApiKeySecretKey(FAKE_PROVIDER_CODE), 'sk-1');
  const result = await second.service.queryBalance({ providerId: second.providerId });
  assert.equal(result.ok, false);
  assert.match(result.message, /密钥无效/);

  const crashing = createAdapter('api-key', {
    queryBalance: async () => {
      throw new Error('bug');
    }
  });
  const third = createService([crashing.adapter]);
  await third.secrets.set(providerApiKeySecretKey(FAKE_PROVIDER_CODE), 'sk-1');
  await assert.rejects(third.service.queryBalance({ providerId: third.providerId }), /bug/);

  await assert.rejects(third.service.queryBalance({ providerId: 999 }), NotFoundError);
});

test('账户密钥：保存后可查询并显示已配置，清除后回到未配置；内容不合法、不需要账户密钥的服务商被拒绝', async () => {
  const { adapter, contexts } = createAdapter('access-key');
  const { service, secrets, providerId } = createService([adapter]);

  const missing = await service.queryBalance({ providerId });
  assert.match(missing.message, /账户密钥/);

  await assert.rejects(service.setAccountKey({ providerId, accessKeyId: '', secretAccessKey: 'a b' }), (error: unknown) => {
    return error instanceof ValidationError && 'accessKeyId' in error.fieldErrors && 'secretAccessKey' in error.fieldErrors;
  });

  const saved = await service.setAccountKey({ providerId, accessKeyId: ' AK1 ', secretAccessKey: 'SK1' });
  assert.equal(saved.credentialReady, true);
  assert.equal((await service.queryBalance({ providerId })).ok, true);
  assert.deepEqual([contexts[0].accessKeyId, contexts[0].secretAccessKey, contexts[0].apiKey], ['AK1', 'SK1', undefined]);

  const cleared = await service.clearAccountKey({ providerId });
  assert.equal(cleared.credentialReady, false);
  assert.equal(await secrets.get(providerAccountSecretKeys(FAKE_PROVIDER_CODE).secretAccessKey), undefined);

  const apiKeyOnly = createService([createAdapter('api-key').adapter]);
  await assert.rejects(apiKeyOnly.service.setAccountKey({ providerId: apiKeyOnly.providerId, accessKeyId: 'a', secretAccessKey: 'b' }), ValidationError);
});

test('共用密钥：适配器声明共用其他服务商的密钥时，读取该服务商保存的账户密钥，行里显示共用对象', async () => {
  const repository = new SqliteProviderRepository(openDatabase(IN_MEMORY_DATABASE_PATH));
  const registry = new ProviderRegistry().register(new FakeVideoProvider());
  const secrets = new MemorySecretStore();
  new ProviderService({ repository, registry, secrets }).syncCatalog();
  const { adapter, contexts } = createAdapter('access-key', { credentialOwnerCode: 'owner' });
  repository.insertProvider({ code: 'owner', displayName: '主账户', settings: {} }, '2026-10-09T00:00:00.000Z');
  const service = new ProviderAccountService({ repository, registry, secrets, adapters: [adapter] });
  const providerId = repository.findProviderByCode(FAKE_PROVIDER_CODE)!.id;

  const names = providerAccountSecretKeys('owner');
  await secrets.set(names.accessKeyId, 'OWNER-AK');
  await secrets.set(names.secretAccessKey, 'OWNER-SK');
  const [row] = await service.listViews();
  assert.deepEqual([row.sharedWith, row.credentialReady], ['主账户', true]);
  await service.queryBalance({ providerId });
  assert.equal(contexts[0].accessKeyId, 'OWNER-AK');

  // 在共用方的行保存密钥，写入的是主账户的密钥。
  await service.setAccountKey({ providerId, accessKeyId: 'NEW-AK', secretAccessKey: 'NEW-SK' });
  assert.equal(await secrets.get(names.accessKeyId), 'NEW-AK');
});
