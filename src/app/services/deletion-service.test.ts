// ------------------------------------------------------------------------
// 名称：deletion-service.test.ts
// 说明：删除编排的自动化测试：删除作品、项目前先取消并等待阶段生成结束，并取消作品名下进行中的视频任务，再删除数据。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：阶段生成使用永不返回的假文本端口，视频任务用内存数据库与记录取消请求的假调度器。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundError } from '../../domain/errors';
import { JobSnapshot } from '../../domain/models/generation';
import { MemoryAssetFileStore } from '../../domain/ports/testing/memory-asset-file-store';
import { normalizeWorkCreation } from '../../domain/rules/work-rules';
import { IN_MEMORY_DATABASE_PATH, openDatabase } from '../../infra/database/database-connection';
import { SqliteGenerationRepository } from '../../infra/database/sqlite-generation-repository';
import { seedGeneration } from '../../infra/database/testing/seed-generation';
import { DeletionService } from './deletion-service';
import { createServiceFixture } from './testing/service-fixture';

const PARAMS = { chapterMinWords: 100, chapterMaxWords: 200, maxChapters: 3 };

const SNAPSHOT: JobSnapshot = {
  storyboardRunId: 1,
  shotIds: [1],
  providerCode: 'fake',
  modelCode: 'fake-video',
  prompt: '提示词',
  params: { aspectRatio: '16:9', resolution: '720P', durationSeconds: 4, audioMode: 'native', seed: null, extraParams: {} },
  referenceImageFileIds: [],
  referenceAudioFileIds: [],
  warnings: []
};

/** 创建夹具：生成永不返回的假文本端口，项目内有一个文字灵感作品。 */
function createFixture() {
  const fixture = createServiceFixture(() => new Promise<string>(() => undefined));
  const work = fixture.works.createWork(fixture.project.id, normalizeWorkCreation({ workName: '作品甲', kind: '单个短视频' }, 'text'));
  return { ...fixture, work };
}

test('删除作品：先取消并等到正在进行的阶段生成结束，再删除作品', async () => {
  const { database, stages, works, runs, runner, deletion, work } = createFixture();
  try {
    const run = await stages.startCreative(work.id, PARAMS);
    assert.equal(runs.findById(run.id)?.status, 'running');

    await deletion.deleteWork(work.id);
    assert.equal(works.findWork(work.id), undefined);
    assert.equal(runs.findById(run.id), undefined, '作品下的记录随作品删除');
    assert.equal(runner.cancel(run.id), false, '生成已经结束，不再登记为进行中');
    await assert.rejects(deletion.deleteWork(work.id), NotFoundError);
  } finally {
    database.close();
  }
});

test('删除项目：取消项目下全部作品的阶段生成后再删除项目，其他项目的作品不受影响', async () => {
  const { database, projects, stages, works, runs, runner, deletion, work } = createFixture();
  try {
    const other = projects.createProject({ name: '项目乙' });
    const otherWork = works.createWork(other.id, normalizeWorkCreation({ workName: '作品乙', kind: '单个短视频' }, 'text'));
    const run = await stages.startCreative(work.id, PARAMS);
    const otherRun = await stages.startCreative(otherWork.id, PARAMS);

    await deletion.deleteProject(work.projectId);
    assert.equal(works.findWork(work.id), undefined);
    assert.equal(runs.findById(run.id), undefined);
    assert.equal(runner.cancel(run.id), false);
    assert.equal(works.findWork(otherWork.id)?.name, '作品乙');
    assert.equal(runs.findById(otherRun.id)?.status, 'running', '其他项目的生成不受影响');
    await runner.cancelAndWait(otherRun.id);
  } finally {
    database.close();
  }
});

test('删除作品：作品名下进行中的视频任务都要取消，已结束的任务和其他作品的任务不处理', async () => {
  const database = openDatabase(IN_MEMORY_DATABASE_PATH);
  try {
    const seed = seedGeneration(database, 3);
    const jobs = new SqliteGenerationRepository(database, new MemoryAssetFileStore());
    const insert = (groupIndex: number) =>
      jobs.insertJob({ groupId: seed.groupIds[groupIndex], modelId: seed.modelId, status: 'queued', snapshot: SNAPSHOT, prevJobId: null, firstFrameId: null }, 't');
    const queued = insert(0);
    const running = insert(1);
    jobs.markSubmitted(running.id, 'remote-1', 't');
    const ended = insert(2);
    jobs.markSubmitted(ended.id, 'remote-2', 't');
    jobs.markSucceeded(
      ended.id,
      { filePath: 'videos/kept.mp4', remoteUrl: null, durationSeconds: 4, width: null, height: null, sizeBytes: 1, hasAudio: false },
      't'
    );

    const canceled: number[] = [];
    const deleted: number[] = [];
    // 存储里有一个已有记录引用的视频和一个没有引用的视频。
    const stored = ['videos/kept.mp4', 'videos/orphan.mp4'];
    const removedFiles: string[] = [];
    const deletion = new DeletionService({
      projects: { getProject: () => assert.fail('不应读取项目'), deleteProject: () => assert.fail('不应删除项目') },
      works: { getWork: () => ({}) as never, listWorks: () => [], deleteWork: (id) => deleted.push(id) },
      stages: { cancelRunningForWork: async () => undefined },
      jobs,
      results: { listFiles: async () => stored, remove: async (filePath) => void removedFiles.push(filePath) },
      scheduler: {
        cancel: async (jobId) => {
          canceled.push(jobId);
          return { remoteCanceled: true };
        }
      }
    });

    await deletion.deleteWork(seed.workId);
    assert.deepEqual(canceled, [queued.id, running.id]);
    assert.deepEqual(deleted, [seed.workId], '取消之后才删除作品');
    assert.deepEqual(removedFiles, ['videos/orphan.mp4'], '删除后清扫没有记录引用的视频文件');
  } finally {
    database.close();
  }
});
