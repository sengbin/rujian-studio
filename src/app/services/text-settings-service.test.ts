// ------------------------------------------------------------------------
// 名称：text-settings-service.test.ts
// 说明：文本模型设置服务的自动化测试：设置视图与可选模型列表、修改校验、作品单独选择文本模型的候选与保存。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-03
// 备注：使用内存中的设置存储、服务商文本模型与作品选择。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationError } from '../../domain/errors';
import { ModelRecord, UsableModel } from '../../domain/models/model-provider';
import { TextGenerationSettingsStore } from '../../domain/ports/text-generation-settings-store';
import { WorkTextModelRepository } from '../../domain/ports/work-text-model-repository';
import {
  SEGMENT_CHARS_MAX,
  SEGMENT_CHARS_MIN,
  TextGenerationSettings,
  TextGenerationSettingsPatch
} from '../../domain/rules/text-generation-settings';
import {
  DEFAULT_FALLBACK_HINT,
  MODEL_NOT_ENABLED_MESSAGE,
  NO_TEXT_MODEL_NOTE,
  TextModelSource,
  TextSettingsService,
  WORK_MODEL_UNAVAILABLE_HINT,
  WORK_MODEL_UNAVAILABLE_NO_FALLBACK_HINT
} from './text-settings-service';

const QIANWEN_KEY = 'model:fake/fake-text';
const QIANWEN_LABEL = '假服务商 · 假文本模型';

/** 内存中的设置存储。 */
class MemoryStore implements TextGenerationSettingsStore {
  settings: TextGenerationSettings = { defaultModel: '', novelSplit: { mode: 'chapter', maxSegmentChars: 20000 } };
  readonly writes: TextGenerationSettingsPatch[] = [];

  read(): TextGenerationSettings {
    return this.settings;
  }

  async write(patch: TextGenerationSettingsPatch): Promise<void> {
    this.writes.push(patch);
    this.settings = {
      defaultModel: patch.defaultModel ?? this.settings.defaultModel,
      novelSplit: {
        mode: patch.splitMode ?? this.settings.novelSplit.mode,
        maxSegmentChars: patch.maxSegmentChars ?? this.settings.novelSplit.maxSegmentChars
      }
    };
  }
}

/** 内存中的作品选择。 */
class MemoryWorkModels implements WorkTextModelRepository {
  readonly saved = new Map<number, string>();

  find(workId: number): string | null {
    return this.saved.get(workId) ?? null;
  }

  save(workId: number, modelKey: string | null): void {
    if (modelKey === null) this.saved.delete(workId);
    else this.saved.set(workId, modelKey);
  }
}

/** 服务商文本模型：可以切换是否已启用。 */
class MemoryModels implements TextModelSource {
  enabled = false;

  listSelectableTextModels(): UsableModel[] {
    const model = { code: 'fake-text', displayName: '假文本模型', kind: 'text' } as ModelRecord;
    return this.enabled ? [{ model, providerCode: 'fake', providerName: '假服务商' }] : [];
  }
}

function createService() {
  const store = new MemoryStore();
  const models = new MemoryModels();
  const workModels = new MemoryWorkModels();
  return { store, models, workModels, service: new TextSettingsService(store, models, workModels) };
}

test('设置视图：没有启用任何文本模型时列表为空并给出警告，字数范围随视图返回', async () => {
  const { service } = createService();
  assert.deepEqual(await service.getView(), {
    defaultModel: '',
    choices: [],
    splitMode: 'chapter',
    maxSegmentChars: 20000,
    segmentCharsRange: { min: SEGMENT_CHARS_MIN, max: SEGMENT_CHARS_MAX },
    modelNote: null,
    engineNote: NO_TEXT_MODEL_NOTE
  });
});

test('设置视图：已启用的服务商文本模型出现在列表中并作为默认，停用后不再出现', async () => {
  const { models, service } = createService();
  models.enabled = true;
  const view = await service.getView();
  assert.deepEqual(view.choices, [{ key: QIANWEN_KEY, label: QIANWEN_LABEL }]);
  assert.deepEqual([view.defaultModel, view.modelNote, view.engineNote], [QIANWEN_KEY, null, null]);

  models.enabled = false;
  assert.deepEqual((await service.getView()).choices, []);
});

test('设置视图：已保存的默认模型不可用时显示实际使用的模型并提示', async () => {
  const { store, models, service } = createService();
  store.settings = { ...store.settings, defaultModel: 'model:fake/gone' };
  models.enabled = true;
  const fallback = await service.getView();
  assert.deepEqual([fallback.defaultModel, fallback.modelNote], [QIANWEN_KEY, DEFAULT_FALLBACK_HINT(QIANWEN_LABEL)]);

  models.enabled = false;
  const none = await service.getView();
  assert.deepEqual([none.defaultModel, none.modelNote, none.engineNote], ['', null, NO_TEXT_MODEL_NOTE]);
});

test('保存设置：只写出现的项，默认模型去除空白，下次读取即为新值', async () => {
  const { store, models, service } = createService();
  models.enabled = true;
  await service.update({ defaultModel: ` ${QIANWEN_KEY} ` });
  await service.update({ splitMode: 'length', maxSegmentChars: 30000 });
  assert.deepEqual(store.writes, [{ defaultModel: QIANWEN_KEY }, { splitMode: 'length', maxSegmentChars: 30000 }]);
  const view = await service.getView();
  assert.deepEqual([view.defaultModel, view.splitMode, view.maxSegmentChars], [QIANWEN_KEY, 'length', 30000]);
});

test('保存设置：通知订阅者，取消订阅后不再通知；被拒绝的修改不通知', async () => {
  const { models, service } = createService();
  models.enabled = true;
  let count = 0;
  const unsubscribe = service.onDidChangeSettings(() => (count += 1));
  await service.update({ defaultModel: QIANWEN_KEY });
  assert.equal(count, 1);
  await assert.rejects(() => service.update({ splitMode: 'paragraph' }), ValidationError);
  assert.equal(count, 1);
  unsubscribe();
  await service.update({ splitMode: 'length' });
  assert.equal(count, 1);
});

test('保存设置：不合法的值、未启用的模型被拒绝且不写入', async () => {
  const { store, service } = createService();
  const rejected = async (patch: unknown, message?: string) =>
    assert.rejects(
      () => service.update(patch),
      (error) => error instanceof ValidationError && (message === undefined || Object.values(error.fieldErrors).includes(message))
    );

  await rejected({ splitMode: 'paragraph' });
  await rejected({ maxSegmentChars: SEGMENT_CHARS_MIN - 1 });
  await rejected({ maxSegmentChars: '20000' });
  await rejected({ defaultModel: 'gpt-4o' });
  await rejected({ defaultModel: 'other:gpt-4o' });
  await rejected({ defaultModel: QIANWEN_KEY }, MODEL_NOT_ENABLED_MESSAGE);
  await rejected({});
  await rejected(null);
  assert.equal(store.writes.length, 0);
});

test('作品的文本模型：候选与默认名称随设置变化，选择只在仍可用时生效', async () => {
  const { models, workModels, service } = createService();
  models.enabled = true;

  const fresh = await service.getWorkState(null);
  assert.deepEqual([fresh.defaultLabel, fresh.selectedKey, fresh.choices.map((choice) => choice.key)], [QIANWEN_LABEL, null, [QIANWEN_KEY]]);

  service.setWorkModel(7, QIANWEN_KEY);
  assert.equal(workModels.find(7), QIANWEN_KEY);
  assert.equal((await service.getWorkState(7)).selectedKey, QIANWEN_KEY);
  assert.equal((await service.getWorkState(8)).selectedKey, null);

  // 模型被停用后作品的选择不再出现在候选中，没有任何可用模型时提示生成会失败；记录保留，重新启用后恢复。
  models.enabled = false;
  const stopped = await service.getWorkState(7);
  assert.deepEqual([stopped.selectedKey, stopped.unavailableHint], [null, WORK_MODEL_UNAVAILABLE_NO_FALLBACK_HINT]);
  assert.equal((await service.getWorkState(8)).unavailableHint, null, '没有单独选择不提示');
  assert.equal((await service.getWorkState(null)).unavailableHint, null);
  models.enabled = true;
  const restored = await service.getWorkState(7);
  assert.deepEqual([restored.selectedKey, restored.unavailableHint], [QIANWEN_KEY, null]);

  service.setWorkModel(7, null);
  assert.equal(workModels.find(7), null);
});

test('作品的文本模型：原选择失效后提示改用当前默认的文本模型；无法识别的旧选择视为失效', async () => {
  const { models, workModels, service } = createService();
  models.enabled = true;
  workModels.save(7, 'other:gpt-4o');
  const state = await service.getWorkState(7);
  assert.deepEqual([state.selectedKey, state.defaultLabel], [null, QIANWEN_LABEL]);
  assert.equal(state.unavailableHint, WORK_MODEL_UNAVAILABLE_HINT(QIANWEN_LABEL));
});

test('作品的文本模型：选用不可用的模型被拒绝', async () => {
  const { workModels, service } = createService();
  assert.throws(() => service.setWorkModel(1, QIANWEN_KEY), (error) => error instanceof ValidationError && error.fieldErrors.textModel === MODEL_NOT_ENABLED_MESSAGE);
  assert.throws(() => service.setWorkModel(1, 'bad'), ValidationError);
  assert.throws(() => service.setWorkModel(1, 'other:gpt-4o'), ValidationError);
  assert.equal(workModels.find(1), null);
});
