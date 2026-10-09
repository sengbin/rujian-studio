// ------------------------------------------------------------------------
// 名称：builtin-providers.test.ts
// 说明：内置适配器登记的自动化测试：千问AI平台与 MiniMax 登记了全部模型类型，火山引擎（方舟）与豆包语音是两个独立服务商（各自的密钥与接口地址），同一服务商的声明一致，模型标识在同类型内不重复。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：只检查登记结果，不访问网络。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MODEL_KINDS } from '../../domain/models/model-capability';
import { normalizeProviderSettings, resolveProviderSettings } from '../../domain/rules/provider-rules';
import { createBuiltinAccountAdapters, createBuiltinProviderRegistry } from './builtin-providers';

test('登记：服务商按千问AI平台、火山引擎、豆包语音、MiniMax 的顺序；千问与 MiniMax 登记文本、图像、音频、视频四类，火山引擎不含音频，豆包语音只登记音频', () => {
  const registry = createBuiltinProviderRegistry();
  assert.deepEqual(registry.listProviders().map((provider) => provider.code), ['qianwen', 'volcengine', 'volcengine-speech', 'minimax']);
  for (const kind of MODEL_KINDS) {
    assert.ok(registry.find(kind, 'qianwen') !== undefined, `qianwen 缺少 ${kind} 适配器`);
    assert.ok(registry.find(kind, 'minimax') !== undefined, `minimax 缺少 ${kind} 适配器`);
  }
  assert.deepEqual(registry.listAdapters('volcengine').map((adapter) => adapter.kind).sort(), ['image', 'text', 'video']);
  assert.deepEqual(registry.listAdapters('volcengine-speech').map((adapter) => adapter.kind), ['audio']);
});

test('火山引擎与豆包语音：火山引擎文本与图片、视频各有接口地址设置，豆包语音只有一个；模型标识在同类型内不重复，每个适配器至少有一个模型', () => {
  const registry = createBuiltinProviderRegistry();
  assert.deepEqual(registry.findProvider('volcengine')?.settingFields.map((field) => field.key), ['endpoint', 'textEndpoint']);
  assert.deepEqual(registry.findProvider('volcengine-speech')?.settingFields.map((field) => field.key), ['endpoint']);
  for (const code of ['volcengine', 'volcengine-speech']) {
    for (const adapter of registry.listAdapters(code)) {
      const codes = adapter.listModels().map((model) => model.code);
      assert.ok(codes.length > 0, `${code} 的 ${adapter.kind} 没有模型`);
      assert.equal(new Set(codes).size, codes.length, `${code} 的 ${adapter.kind} 模型标识重复`);
    }
  }
});

test('测试连接：火山引擎由方舟的视频与文本适配器承担，豆包语音由音频适配器承担，各用各的密钥', () => {
  const registry = createBuiltinProviderRegistry();
  const connectable = (code: string) =>
    registry.listAdapters(code).filter((adapter) => adapter.checkConnection !== undefined).map((adapter) => adapter.kind).sort();
  assert.deepEqual(connectable('volcengine'), ['text', 'video']);
  assert.deepEqual(connectable('volcengine-speech'), ['audio']);
});

test('测试连接：每个声明了测试方式的接口地址，都有对应类型的适配器实现测试', () => {
  const registry = createBuiltinProviderRegistry();
  const checked: Array<[string, string, string | undefined]> = [];
  for (const provider of registry.listProviders()) {
    for (const field of provider.settingFields) {
      const adapter = registry.listAdapters(provider.code).find((candidate) => candidate.kind === field.connectionCheckKind);
      assert.ok(adapter?.checkConnection !== undefined, `${provider.code}.${field.key} 没有可用的测试适配器`);
      checked.push([provider.code, field.key, field.connectionCheckKind]);
    }
  }
  assert.deepEqual(checked, [
    ['qianwen', 'endpoint', 'video'],
    ['qianwen', 'textEndpoint', 'text'],
    ['volcengine', 'endpoint', 'video'],
    ['volcengine', 'textEndpoint', 'text'],
    ['volcengine-speech', 'endpoint', 'audio'],
    ['minimax', 'endpoint', 'video']
  ]);
});

test('MiniMax：只有一个接口地址设置，模型标识在同类型内不重复，测试连接由视频适配器承担', () => {
  const registry = createBuiltinProviderRegistry();
  assert.deepEqual(registry.findProvider('minimax')?.settingFields.map((field) => field.key), ['endpoint']);
  for (const adapter of registry.listAdapters('minimax')) {
    const codes = adapter.listModels().map((model) => model.code);
    assert.ok(codes.length > 0, `minimax 的 ${adapter.kind} 没有模型`);
    assert.equal(new Set(codes).size, codes.length, `minimax 的 ${adapter.kind} 模型标识重复`);
  }
  assert.deepEqual(registry.listAdapters('minimax').filter((adapter) => adapter.checkConnection !== undefined).map((adapter) => adapter.kind), ['video']);
});

test('接口地址：千问AI平台的文本与图片、视频、音频各有接口地址设置，默认值不同', () => {
  const fields = createBuiltinProviderRegistry().findProvider('qianwen')?.settingFields ?? [];
  assert.deepEqual(fields.map((field) => field.key), ['endpoint', 'textEndpoint']);
  assert.notEqual(fields[0].defaultValue, fields[1].defaultValue);
});

test('接口地址：各内置服务商的默认值通过设置页规则，用户填写的地址原样保存，不校验格式', () => {
  const registry = createBuiltinProviderRegistry();
  for (const provider of registry.listProviders()) {
    const fields = provider.settingFields;
    const defaults = resolveProviderSettings(fields, {});
    assert.deepEqual(normalizeProviderSettings(defaults, fields), defaults, provider.code);
    for (const field of fields) {
      assert.deepEqual(normalizeProviderSettings({ [field.key]: '' }, fields), { [field.key]: field.defaultValue }, `${provider.code}.${field.key}`);
      assert.deepEqual(normalizeProviderSettings({ [field.key]: 'https://proxy.test/api/coding/v3' }, fields), { [field.key]: 'https://proxy.test/api/coding/v3' }, `${provider.code}.${field.key}`);
    }
  }
});

test('模型价格：价格表里的每个模型代码都对应该服务商登记的模型，避免模型改名后价格悬空', () => {
  const registry = createBuiltinProviderRegistry();
  for (const provider of registry.listProviders()) {
    const codes = new Set(registry.listAdapters(provider.code).flatMap((adapter) => adapter.listModels().map((model) => model.code)));
    for (const code of Object.keys(provider.modelPrices ?? {})) {
      assert.ok(codes.has(code), `${provider.code} 的价格表里有未登记的模型 ${code}`);
    }
  }
  assert.ok(Object.keys(registry.findProvider('volcengine')?.modelPrices ?? {}).length > 0);
  assert.ok(Object.keys(registry.findProvider('minimax')?.modelPrices ?? {}).length > 0);
  assert.ok(Object.keys(registry.findProvider('qianwen')?.modelPrices ?? {}).length > 0);
  assert.ok(Object.keys(registry.findProvider('volcengine-speech')?.modelPrices ?? {}).length > 0);
});

test('账户适配器：火山引擎与豆包语音共用火山的账户密钥，千问AI平台与 MiniMax 没有适配器', () => {
  const adapters = createBuiltinAccountAdapters();
  const byCode = new Map(adapters.map((adapter) => [adapter.providerCode, adapter]));
  assert.deepEqual([...byCode.keys()], ['volcengine', 'volcengine-speech']);
  assert.deepEqual([byCode.get('volcengine')?.credential, byCode.get('volcengine')?.credentialOwnerCode], ['access-key', undefined]);
  assert.deepEqual([byCode.get('volcengine-speech')?.credential, byCode.get('volcengine-speech')?.credentialOwnerCode], ['access-key', 'volcengine']);
  assert.ok(adapters.every((adapter) => adapter.queryBalance !== undefined));
});