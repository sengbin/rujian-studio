// ------------------------------------------------------------------------
// 名称：text-generation-router.test.ts
// 说明：文本生成路由的自动化测试：本次指定、作品选择、全局默认的优先级，选择不可用时报错而不回退，没有可用模型时的错误，服务商失败转换为文本生成错误，不同作品互不影响。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-03
// 备注：使用假的文本适配器，不依赖网络。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError, TextGenerationError } from '../../domain/errors';
import { TextCapability } from '../../domain/models/model-capability';
import { ModelRecord, UsableModel } from '../../domain/models/model-provider';
import { ProviderCallContext, ResolvedTextCall, TextModelProvider } from '../../domain/ports/provider-adapters';
import { TextGenerationRequest } from '../../domain/ports/text-generation-port';
import { estimateTokens } from '../../domain/rules/token-estimate';
import {
  DEFAULT_MODEL_UNAVAILABLE_MESSAGE,
  NO_TEXT_ENGINE_MESSAGE,
  REQUESTED_MODEL_UNAVAILABLE_MESSAGE,
  TextGenerationRouter,
  WORK_MODEL_UNAVAILABLE_MESSAGE
} from './text-generation-router';

const CAPABILITY: TextCapability = { contextTokens: 1000, maxOutputTokens: 200, imageInput: true };
const REQUEST: TextGenerationRequest = { system: 's', user: 'u', tool: { name: 't', description: 'd', inputSchema: { type: 'object' } } };

/** 假文本适配器：返回预设结果或抛出预设错误，记录收到的上下文与模型代码。 */
class FakeTextAdapter implements TextModelProvider {
  readonly kind = 'text';
  readonly provider = { code: 'fake', displayName: '假服务商', settingFields: [] };
  readonly contexts: ProviderCallContext[] = [];
  readonly modelCodes: string[] = [];
  failure: unknown = undefined;

  listModels() {
    return [];
  }

  getCapability(modelCode: string): TextCapability | undefined {
    return modelCode === 'gone' ? undefined : CAPABILITY;
  }

  async generate(modelCode: string, _request: TextGenerationRequest, context: ProviderCallContext): Promise<unknown> {
    this.modelCodes.push(modelCode);
    this.contexts.push(context);
    if (this.failure !== undefined) throw this.failure;
    return { from: `provider:${modelCode}` };
  }
}

function usable(id: number, code: string): UsableModel {
  const model = { id, providerId: 1, code, displayName: code, kind: 'text', isEnabled: true, capability: CAPABILITY, createdAt: '' } as ModelRecord;
  return { model, providerCode: 'fake', providerName: '假服务商' };
}

interface Options {
  defaultModel?: string;
  models?: UsableModel[];
  workModels?: Record<number, string>;
  resolveFailure?: unknown;
}

function createRouter(options: Options = {}) {
  const adapter = new FakeTextAdapter();
  const settings = { defaultModel: options.defaultModel ?? '', novelSplit: { mode: 'chapter' as const, maxSegmentChars: 20000 } };
  const resolved: number[] = [];
  const models = options.models ?? [];
  const router = new TextGenerationRouter({
    settings: { read: () => settings },
    providers: {
      listSelectableTextModels: () => models,
      resolveTextCall: async (modelId): Promise<ResolvedTextCall> => {
        resolved.push(modelId);
        if (options.resolveFailure !== undefined) throw options.resolveFailure;
        const code = models.find((item) => item.model.id === modelId)?.model.code ?? 'm';
        return { adapter, modelCode: code, context: { apiKey: 'sk', settings: {} } };
      }
    },
    workModels: { find: (workId) => options.workModels?.[workId] ?? null }
  });
  return { router, adapter, settings, resolved };
}

async function rejectedWith(action: Promise<unknown>): Promise<TextGenerationError> {
  try {
    await action;
  } catch (error) {
    assert.ok(error instanceof TextGenerationError, '应抛出 TextGenerationError');
    return error;
  }
  assert.fail('应抛出错误');
}

test('默认是服务商文本模型：输入上限为上下文减去最大输出，token 数按字符估算，取消信号与密钥一并传给适配器', async () => {
  const { router, adapter } = createRouter({ defaultModel: 'model:fake/b', models: [usable(1, 'a'), usable(2, 'b')] });
  const port = router.forWork(null);
  assert.deepEqual(await port.resolveModel(), { id: 'fake/b', maxInputTokens: 800 });
  assert.equal(await port.countTokens('你好 hello'), estimateTokens('你好 hello'));

  const controller = new AbortController();
  assert.deepEqual(await port.generate(REQUEST, { signal: controller.signal }), { from: 'provider:b' });
  assert.equal(adapter.contexts[0].signal, controller.signal);
  assert.equal(adapter.contexts[0].apiKey, 'sk');
});

test('作品的选择优先于全局默认，不同作品互不影响，没有选择的作品和资产提示词用全局默认', async () => {
  const { router } = createRouter({
    defaultModel: 'model:fake/b',
    models: [usable(1, 'a'), usable(2, 'b')],
    workModels: { 1: 'model:fake/a' }
  });
  const ports = [router.forWork(1), router.forWork(2), router.forWork(null)];
  await Promise.all(ports.map((port) => port.resolveModel()));
  assert.deepEqual(await Promise.all(ports.map((port) => port.generate(REQUEST))), [{ from: 'provider:a' }, { from: 'provider:b' }, { from: 'provider:b' }]);
});

test('本次指定的模型优先于作品的选择与全局默认', async () => {
  const { router } = createRouter({ defaultModel: 'model:fake/c', models: [usable(1, 'a'), usable(2, 'b'), usable(3, 'c')], workModels: { 1: 'model:fake/b' } });
  assert.deepEqual(await router.forWork(1, 'model:fake/a').generate(REQUEST), { from: 'provider:a' });
  assert.deepEqual(await router.forWork(1, null).generate(REQUEST), { from: 'provider:b' });
  assert.deepEqual(await router.forWork(null, null).generate(REQUEST), { from: 'provider:c' });
});

test('选择的模型已不可用：直接报错，不回退到低优先级的选择或第一个可用模型（价格不同）', async () => {
  const models = [usable(1, 'a'), usable(2, 'b')];
  const requested = createRouter({ defaultModel: 'model:fake/b', models, workModels: { 1: 'model:fake/a' } });
  assert.equal((await rejectedWith(requested.router.forWork(1, 'model:fake/gone').generate(REQUEST))).message, REQUESTED_MODEL_UNAVAILABLE_MESSAGE);

  const work = createRouter({ defaultModel: 'model:fake/b', models, workModels: { 1: 'model:fake/gone' } });
  assert.equal((await rejectedWith(work.router.forWork(1).generate(REQUEST))).message, WORK_MODEL_UNAVAILABLE_MESSAGE);

  const stoppedDefault = createRouter({ defaultModel: 'model:fake/gone', models });
  assert.equal((await rejectedWith(stoppedDefault.router.forWork(null).generate(REQUEST))).message, DEFAULT_MODEL_UNAVAILABLE_MESSAGE);
  // 无法识别的旧键同样视为不可用。
  const legacy = createRouter({ defaultModel: 'other:gpt-4o', models });
  assert.equal((await rejectedWith(legacy.router.forWork(null).generate(REQUEST))).category, 'unavailable');
  assert.deepEqual([requested.resolved, work.resolved, stoppedDefault.resolved], [[], [], []]);
});

test('从未设置过全局默认时使用第一个可用的文本模型', async () => {
  const unset = createRouter({ models: [usable(1, 'a'), usable(2, 'b')] });
  assert.deepEqual(await unset.router.forWork(null).generate(REQUEST), { from: 'provider:a' });
});

test('每次 resolveModel 按当时的设置重新选择，没有解析过时 generate 会先选择', async () => {
  const { router, settings } = createRouter({ defaultModel: 'model:fake/a', models: [usable(1, 'a'), usable(2, 'b')] });
  const port = router.forWork(null);
  assert.deepEqual(await port.generate(REQUEST), { from: 'provider:a' });

  settings.defaultModel = 'model:fake/b';
  await port.resolveModel();
  assert.deepEqual(await port.generate(REQUEST), { from: 'provider:b' });
});

test('没有可用模型：没有启用的文本模型、服务商拒绝或模型已不存在时给出原因', async () => {
  const none = createRouter({ models: [] });
  const unavailable = await rejectedWith(none.router.forWork(null).resolveModel());
  assert.deepEqual([unavailable.category, unavailable.message], ['unavailable', NO_TEXT_ENGINE_MESSAGE]);
  assert.deepEqual(none.resolved, []);

  const noKey = createRouter({ defaultModel: 'model:fake/a', models: [usable(1, 'a')], resolveFailure: new ProviderError('auth', '尚未配置访问密钥。') });
  const auth = await rejectedWith(noKey.router.forWork(null).resolveModel());
  assert.deepEqual([auth.category, auth.message], ['not_authorized', '尚未配置访问密钥。']);

  const gone = createRouter({ defaultModel: 'model:fake/gone', models: [usable(1, 'gone')] });
  assert.equal((await rejectedWith(gone.router.forWork(null).resolveModel())).category, 'unavailable');
});

test('服务商调用失败转换为文本生成错误，保留可读原因；取消转换为已取消', async () => {
  const cases: Array<[unknown, string]> = [
    [new ProviderError('auth', 'a'), 'not_authorized'],
    [new ProviderError('rate_limited', 'r'), 'rate_limited'],
    [new ProviderError('content_rejected', 'c'), 'refused'],
    [new ProviderError('invalid_request', 'i'), 'failed'],
    [new ProviderError('server', 's'), 'unavailable'],
    [new ProviderError('network', 'n'), 'unavailable'],
    [Object.assign(new Error('aborted'), { name: 'AbortError' }), 'canceled'],
    [new Error('boom'), 'failed']
  ];
  for (const [failure, category] of cases) {
    const { router, adapter } = createRouter({ defaultModel: 'model:fake/a', models: [usable(1, 'a')] });
    adapter.failure = failure;
    const error = await rejectedWith(router.forWork(null).generate(REQUEST));
    assert.equal(error.category, category);
    if (failure instanceof ProviderError) {
      assert.equal(error.message, failure.message);
    }
  }
});
