// ------------------------------------------------------------------------
// 名称：asset-creation-service.test.ts
// 说明：新建资产并继续服务的自动化测试：只创建、从实体新建时创建与绑定同属一个事务（绑定失败不留资产）、直接出图、提示词生成与自动出图、后续步骤失败时删除资产、删除失败不掩盖原错误。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：资产使用内存数据库与真实的资产服务、工作单元；绑定、提示词生成与出图提交用桩，记录调用。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictError, ValidationError } from '../../domain/errors';
import { MemoryAssetFileStore } from '../../domain/ports/testing/memory-asset-file-store';
import { IN_MEMORY_DATABASE_PATH, openDatabase } from '../../infra/database/database-connection';
import { SqliteAssetRepository } from '../../infra/database/sqlite-asset-repository';
import { SqliteUnitOfWork } from '../../infra/database/sqlite-unit-of-work';
import { AssetCreationService } from './asset-creation-service';
import { AssetService } from './asset-service';

const ENTITY = { episodeId: 2, entityId: 9 };
const RUN_REQUEST = { modelId: 7, count: 1 };

/** 创建服务与桩；各桩的失败由 state 控制。 */
function createFixture(options: { readonly deleteFails?: boolean } = {}) {
  const database = openDatabase(IN_MEMORY_DATABASE_PATH);
  const assets = new AssetService(new SqliteAssetRepository(database, new MemoryAssetFileStore()));
  const state = { bindFailure: null as Error | null, submitFailure: null as Error | null, promptFailure: null as Error | null };
  const bound: unknown[] = [];
  const submitted: Array<Record<string, unknown>> = [];
  const prompts: Array<{ assetId: number; textModelKey: string | null; followUp: boolean }> = [];
  const service = new AssetCreationService({
    assets: {
      createAsset: (kind, rawInput, createOptions) => assets.createAsset(kind, rawInput, createOptions),
      deleteAsset: (id) => {
        if (options.deleteFails === true) {
          throw new Error('删除失败');
        }
        assets.deleteAsset(id);
      }
    },
    bindings: {
      bind: (rawInput) => {
        if (state.bindFailure !== null) {
          throw state.bindFailure;
        }
        bound.push(rawInput);
        return {} as never;
      }
    },
    prompts: {
      start: (assetId, textModelKey = null, followUp) => {
        if (state.promptFailure !== null) {
          throw state.promptFailure;
        }
        prompts.push({ assetId, textModelKey, followUp: followUp !== undefined });
        return { done: followUp === undefined ? Promise.resolve() : followUp() };
      }
    },
    generation: {
      submit: async (rawInput) => {
        if (state.submitFailure !== null) {
          throw state.submitFailure;
        }
        submitted.push(rawInput as Record<string, unknown>);
        return {};
      }
    },
    transaction: new SqliteUnitOfWork(database)
  });
  const count = (): number => assets.listAssets('prop').length;
  return { database, service, assets, state, bound, submitted, prompts, count };
}

const request = { kind: 'prop', rawInput: { name: '钥匙', appearance: '黄铜' }, options: {} } as const;

test('只创建：写入资产，不绑定也不继续', async () => {
  const { database, service, count, bound, submitted, prompts } = createFixture();
  try {
    const asset = await service.createAndContinue(request);
    assert.equal(asset.name, '钥匙');
    assert.equal(count(), 1);
    assert.deepEqual([bound, submitted, prompts], [[], [], []]);
  } finally {
    database.close();
  }
});

test('从实体新建：创建并绑定为该实体的形象；绑定失败时事务回滚，不留下没人用的资产', async () => {
  const { database, service, state, count, bound } = createFixture();
  try {
    const asset = await service.createAndContinue({ ...request, entity: ENTITY });
    assert.deepEqual(bound, [{ ...ENTITY, assetId: asset.id, purpose: 'visual' }]);

    state.bindFailure = new ConflictError('assetId', '这个实体在本集已经绑定过该资产。');
    await assert.rejects(
      () => service.createAndContinue({ ...request, rawInput: { name: '锁' }, entity: ENTITY }),
      (error) => error === state.bindFailure
    );
    assert.equal(count(), 1, '只剩第一个资产');
  } finally {
    database.close();
  }
});

test('直接出图：创建后提交生成；提交失败时删除资产，修改后可以重新提交', async () => {
  const { database, service, state, count, submitted } = createFixture();
  try {
    const asset = await service.createAndContinue({ ...request, followUp: { mode: 'direct', runRequest: RUN_REQUEST } });
    assert.deepEqual(submitted, [{ assetId: asset.id, ...RUN_REQUEST }]);

    state.submitFailure = new ValidationError({ modelId: '请选择可用的模型。' });
    await assert.rejects(
      () => service.createAndContinue({ ...request, rawInput: { name: '锁' }, followUp: { mode: 'direct', runRequest: RUN_REQUEST } }),
      (error) => error === state.submitFailure
    );
    assert.equal(count(), 1);

    state.submitFailure = null;
    await service.createAndContinue({ ...request, rawInput: { name: '锁' }, followUp: { mode: 'direct', runRequest: RUN_REQUEST } });
    assert.equal(count(), 2);
  } finally {
    database.close();
  }
});

test('生成提示词：只生成时不出图，生成并出图时把出图作为后续动作；启动失败时删除资产', async () => {
  const { database, service, state, count, prompts, submitted } = createFixture();
  try {
    const first = await service.createAndContinue({ ...request, followUp: { mode: 'prompt', textModelKey: 'model:fake/fake-text' } });
    assert.deepEqual(prompts, [{ assetId: first.id, textModelKey: 'model:fake/fake-text', followUp: false }]);
    assert.deepEqual(submitted, []);

    const second = await service.createAndContinue({ ...request, rawInput: { name: '锁' }, followUp: { mode: 'promptAndRun', textModelKey: null, runRequest: RUN_REQUEST } });
    assert.equal(prompts[1].followUp, true);
    assert.deepEqual(submitted, [{ assetId: second.id, ...RUN_REQUEST }]);

    state.promptFailure = new ValidationError({ '': '请先填写名称。' });
    await assert.rejects(
      () => service.createAndContinue({ ...request, rawInput: { name: '灯' }, followUp: { mode: 'prompt', textModelKey: null } }),
      (error) => error === state.promptFailure
    );
    assert.equal(count(), 2);
  } finally {
    database.close();
  }
});

test('删除资产失败：只记录日志，仍抛出后续步骤的原始错误', async () => {
  const { database, service, state, count } = createFixture({ deleteFails: true });
  const logged: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    state.submitFailure = new ValidationError({ modelId: '请选择可用的模型。' });
    await assert.rejects(() => service.createAndContinue({ ...request, followUp: { mode: 'direct', runRequest: RUN_REQUEST } }), (error) => error === state.submitFailure);
    assert.equal(count(), 1, '资产残留，但已记录日志');
    assert.equal(logged.length, 1);
    assert.match(String(logged[0][0]), /删除刚创建的资产失败/);
  } finally {
    console.error = originalConsoleError;
    database.close();
  }
});
