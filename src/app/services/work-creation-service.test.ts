// ------------------------------------------------------------------------
// 名称：work-creation-service.test.ts
// 说明：新建作品并开始生成服务的自动化测试：创建并启动、保存文本模型失败时事务回滚、启动失败时撤销作品、撤销失败不掩盖原错误、原创文稿导入、参考节拍表在写库前被拒绝。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：使用内存数据库、真实的执行器与脚本化的假文本生成端口。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TextGenerationError, ValidationError } from '../../domain/errors';
import { normalizeWorkCreation } from '../../domain/rules/work-rules';
import { WorkCreationService } from './work-creation-service';
import { createServiceFixture } from './testing/service-fixture';

const PARAMS = { idea: '一个关于灯塔的故事', chapterMinWords: 100, chapterMaxWords: 200, maxChapters: 3 };
const MODEL_KEY = 'model:fake/fake-text';

/** 创建夹具与服务；textModels 记录保存的模型，可让保存失败。 */
function createFixture(options: { readonly deleteFails?: boolean; readonly importFails?: boolean } = {}) {
  const fixture = createServiceFixture();
  const saved = new Map<number, string | null>();
  const state = { saveFailure: null as Error | null };
  const service = new WorkCreationService({
    works: {
      createWork: (projectId, creation) => fixture.works.createWork(projectId, creation),
      deleteWork: (id) => {
        if (options.deleteFails === true) {
          throw new Error('删除失败');
        }
        fixture.works.deleteWork(id);
      }
    },
    stages: {
      startCreative: (workId, params) => fixture.stages.startCreative(workId, params),
      importOriginal: (workId) => {
        if (options.importFails === true) {
          throw new ValidationError({ '': '没有找到原稿。' });
        }
        return fixture.stages.importOriginal(workId);
      }
    },
    textModels: {
      setWorkModel: (workId, key) => {
        if (state.saveFailure !== null) {
          throw state.saveFailure;
        }
        saved.set(workId, key);
      }
    },
    transaction: fixture.transaction
  });
  const creation = (sourceType: 'text' | 'original' = 'text') =>
    normalizeWorkCreation(sourceType === 'text' ? { workName: '雨夜来客', kind: '单个短视频' } : { workName: '雨夜来客', kind: '单个短视频', manuscriptText: '第一章\n夜里下雨。' }, sourceType);
  const countWorks = (): number => Number(fixture.database.prepare('SELECT COUNT(*) AS n FROM works').get()?.n);
  return { ...fixture, service, saved, state, creation, countWorks };
}

test('创建并启动：作品与文本模型保存，创意生成已启动', async () => {
  const { database, service, saved, creation, project, runner, runs } = createFixture();
  try {
    const work = await service.createAndStart({ projectId: project.id, creation: creation(), textModelKey: MODEL_KEY, params: PARAMS });
    await runner.whenIdle();
    assert.equal(saved.get(work.id), MODEL_KEY);
    assert.equal(runs.listVersions({ workId: work.id, stage: 'creative', episodeId: null }).length, 1);
  } finally {
    database.close();
  }
});

test('保存文本模型失败：创建作品的事务整体回滚，不启动生成', async () => {
  const { database, service, state, creation, project, countWorks, text } = createFixture();
  try {
    state.saveFailure = new ValidationError({ textModel: '所选文本模型没有启用，请从列表中选择。' });
    await assert.rejects(
      () => service.createAndStart({ projectId: project.id, creation: creation(), textModelKey: MODEL_KEY, params: PARAMS }),
      (error) => error === state.saveFailure
    );
    assert.equal(countWorks(), 0);
    assert.equal(Number(database.prepare('SELECT COUNT(*) AS n FROM episodes').get()?.n), 0);
    assert.equal(text.requests.length, 0);
  } finally {
    database.close();
  }
});

test('启动失败：撤销刚创建的作品，修正后可以直接重新提交', async () => {
  const { database, service, creation, project, countWorks, text, runner } = createFixture();
  try {
    text.unavailable = true;
    await assert.rejects(() => service.createAndStart({ projectId: project.id, creation: creation(), textModelKey: null, params: PARAMS }), TextGenerationError);
    assert.equal(countWorks(), 0);

    text.unavailable = false;
    await service.createAndStart({ projectId: project.id, creation: creation(), textModelKey: null, params: PARAMS });
    await runner.whenIdle();
    assert.equal(countWorks(), 1);
  } finally {
    database.close();
  }
});

test('撤销作品失败：只记录日志，仍抛出启动的原始错误', async () => {
  const { database, service, creation, project, text } = createFixture({ deleteFails: true });
  const logged: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    text.unavailable = true;
    await assert.rejects(() => service.createAndStart({ projectId: project.id, creation: creation(), textModelKey: null, params: PARAMS }), TextGenerationError);
    assert.equal(logged.length, 1);
    assert.match(String(logged[0][0]), /撤销刚创建的作品失败/);
    assert.equal((logged[0][1] as Error).message, '删除失败');
  } finally {
    console.error = originalConsoleError;
    database.close();
  }
});

test('原创文稿：创建后直接导入原稿章节，不启动生成；导入失败时撤销作品', async () => {
  const ok = createFixture();
  try {
    const work = await ok.service.createAndStart({ projectId: ok.project.id, creation: ok.creation('original'), textModelKey: null });
    const [run] = ok.runs.listVersions({ workId: work.id, stage: 'creative', episodeId: null });
    assert.equal(run.status, 'succeeded');
    assert.ok(run.approvedAt !== null);
    assert.equal(ok.text.requests.length, 0);
  } finally {
    ok.database.close();
  }

  const failing = createFixture({ importFails: true });
  try {
    await assert.rejects(() => failing.service.createAndStart({ projectId: failing.project.id, creation: failing.creation('original'), textModelKey: null }), ValidationError);
    assert.equal(failing.countWorks(), 0);
  } finally {
    failing.database.close();
  }
});

test('参考节拍表：新作品不可能有已确认的节拍表，在写库之前就被拒绝', async () => {
  const { database, service, creation, project, countWorks } = createFixture();
  try {
    await assert.rejects(
      () => service.createAndStart({ projectId: project.id, creation: creation(), textModelKey: null, params: { ...PARAMS, beatReferenceMode: 'reference' } }),
      (error) => error instanceof ValidationError && 'beatReferenceMode' in error.fieldErrors
    );
    assert.equal(countWorks(), 0);
  } finally {
    database.close();
  }
});
