// ------------------------------------------------------------------------
// 名称：stage-start-service.test.ts
// 说明：已有作品的阶段生成启动服务的自动化测试：保存文本模型后启动、启动失败时恢复原选择、恢复失败不掩盖原错误、文本模型不可选时不启动、分镜脚本启动成功后才保存作品默认参数。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：用桩的阶段、节拍表、剧本、分镜与文本模型，记录调用顺序，不依赖数据库。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TextGenerationError, ValidationError } from '../../domain/errors';
import { StageRun } from '../../domain/models/stage-run';
import { StageStartService } from './stage-start-service';

const WORK_ID = 3;
const PREVIOUS_KEY = 'model:fake/fake-text-2';
const CHOSEN_KEY = 'model:fake/fake-text';
const RUN = { id: 1 } as StageRun;

/** 创建服务与桩；calls 按顺序记录发生的事，startFailure 非空时各启动方法抛出它。 */
function createFixture(options: { readonly setFailsOn?: (key: string | null, count: number) => Error | undefined } = {}) {
  const calls: string[] = [];
  const state = { startFailure: null as Error | null, selected: PREVIOUS_KEY as string | null, setCount: 0 };
  const start = async (name: string): Promise<StageRun> => {
    calls.push(`start:${name}`);
    if (state.startFailure !== null) {
      throw state.startFailure;
    }
    return RUN;
  };
  const service = new StageStartService({
    textModels: {
      getWorkState: async () => ({ choices: [], defaultLabel: null, selectedKey: state.selected, unavailableHint: null }),
      setWorkModel: (_workId, key) => {
        state.setCount += 1;
        const failure = options.setFailsOn?.(key, state.setCount);
        if (failure !== undefined) {
          throw failure;
        }
        calls.push(`model:${key}`);
        state.selected = key;
      }
    },
    stages: { startCreative: () => start('creative') },
    beatSheets: { start: () => start('beatSheet') },
    screenplays: { start: () => start('screenplay') },
    storyboards: {
      start: async () => {
        await start('storyboard');
        return [RUN];
      }
    },
    profiles: { saveWorkDefaults: (_workId, changes) => void calls.push(`defaults:${JSON.stringify(changes)}`) }
  });
  return { service, calls, state };
}

test('保存文本模型后启动：先保存所选模型，再启动对应阶段的生成', async () => {
  const { service, calls, state } = createFixture();
  await service.startCreative(WORK_ID, CHOSEN_KEY, {});
  await service.startBeatSheet(WORK_ID, null, {});
  await service.startScreenplay(WORK_ID, CHOSEN_KEY, {});
  assert.deepEqual(calls, [`model:${CHOSEN_KEY}`, 'start:creative', 'model:null', 'start:beatSheet', `model:${CHOSEN_KEY}`, 'start:screenplay']);
  assert.equal(state.selected, CHOSEN_KEY);
});

test('启动失败：恢复作品原来的文本模型选择，抛出启动的错误', async () => {
  const { service, calls, state } = createFixture();
  state.startFailure = new TextGenerationError('unavailable', '没有可用的文本模型。');
  await assert.rejects(() => service.startBeatSheet(WORK_ID, CHOSEN_KEY, {}), (error) => error === state.startFailure);
  assert.deepEqual(calls, [`model:${CHOSEN_KEY}`, 'start:beatSheet', `model:${PREVIOUS_KEY}`]);
  assert.equal(state.selected, PREVIOUS_KEY);
});

test('恢复原选择失败：只记录日志，仍抛出启动的原始错误', async () => {
  const { service, state } = createFixture({ setFailsOn: (_key, count) => (count === 2 ? new Error('保存失败') : undefined) });
  state.startFailure = new TextGenerationError('unavailable', '没有可用的文本模型。');
  const logged: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    await assert.rejects(() => service.startScreenplay(WORK_ID, CHOSEN_KEY, {}), (error) => error === state.startFailure);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][0]), /恢复作品 3 原来的文本模型选择失败/);
});

test('所选文本模型不可选：保存时就被拒绝，不启动生成', async () => {
  const rejection = new ValidationError({ textModel: '所选文本模型没有启用，请从列表中选择。' });
  const { service, calls } = createFixture({ setFailsOn: () => rejection });
  await assert.rejects(() => service.startCreative(WORK_ID, CHOSEN_KEY, {}), (error) => error === rejection);
  assert.deepEqual(calls, []);
});

test('分镜脚本：启动成功后才保存作品默认参数，没有改动时不保存，启动失败时不改动默认', async () => {
  const { service, calls, state } = createFixture();
  const request = { workId: WORK_ID, episodeIds: [5], params: {}, aspectRatio: '16:9', defaultChanges: { aspectRatio: '16:9' } };
  await service.startStoryboard(request, CHOSEN_KEY);
  assert.deepEqual(calls, [`model:${CHOSEN_KEY}`, 'start:storyboard', 'defaults:{"aspectRatio":"16:9"}']);

  calls.length = 0;
  await service.startStoryboard({ ...request, defaultChanges: {} }, null);
  assert.deepEqual(calls, ['model:null', 'start:storyboard']);

  calls.length = 0;
  state.startFailure = new TextGenerationError('unavailable', '没有可用的文本模型。');
  await assert.rejects(() => service.startStoryboard(request, CHOSEN_KEY), (error) => error === state.startFailure);
  assert.equal(calls.some((call) => call.startsWith('defaults:')), false);
});
