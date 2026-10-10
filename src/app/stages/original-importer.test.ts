// ------------------------------------------------------------------------
// 名称：original-importer.test.ts
// 说明：原创文稿导入器的事务测试：导入成功得到已确认记录与章节；写入章节中途失败、确认采用没有返回记录时，整个导入回滚，不留下运行中的记录和半截章节，也不返回未确认的记录。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：使用内存数据库、真实的仓库与工作单元；章节仓库与阶段记录仓库用包装对象注入失败。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteChapterRepository } from '../../infra/database/sqlite-stage-run-repository';
import { ChapterRepository } from '../../domain/ports/chapter-repository';
import { StageRunRepository } from '../../domain/ports/stage-run-repository';
import { normalizeWorkCreation } from '../../domain/rules/work-rules';
import { createServiceFixture } from '../services/testing/service-fixture';
import { OriginalImporter } from './original-importer';

const TEXT = '夜里下起了雨。\n“今晚会下雨。”老陈说。\n灯塔亮了。';

/** 创建夹具、一个原创文稿作品和导入器；hooks 可让章节保存或确认采用出问题。 */
function createFixture(hooks: { readonly saveFails?: boolean; readonly approveReturnsNothing?: boolean } = {}) {
  const fixture = createServiceFixture();
  const work = fixture.works.createWork(fixture.project.id, normalizeWorkCreation({ workName: '作品甲', kind: '单个短视频', manuscriptText: TEXT }, 'original'));
  const chapters = new SqliteChapterRepository(fixture.database);
  const runs: Pick<StageRunRepository, 'create' | 'markSucceeded' | 'approve'> = {
    create: (input, timestamp) => fixture.runs.create(input, timestamp),
    markSucceeded: (id, timestamp) => fixture.runs.markSucceeded(id, timestamp),
    approve: (id, patch) => (hooks.approveReturnsNothing === true ? undefined : fixture.runs.approve(id, patch))
  };
  const chapterWrites: Pick<ChapterRepository, 'save'> = {
    save: (runId, chapter, timestamp) => {
      if (hooks.saveFails === true) {
        throw new Error('保存章节失败');
      }
      chapters.save(runId, chapter, timestamp);
    }
  };
  const importer = new OriginalImporter({
    runs: runs as StageRunRepository,
    chapters: chapterWrites as ChapterRepository,
    sources: { readNovelText: () => TEXT, readImages: () => [] },
    transaction: fixture.transaction,
    getSplitSettings: () => ({ mode: 'chapter', maxSegmentChars: 1000 })
  });
  const count = (table: string): number => Number(fixture.database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
  return { ...fixture, work, importer, count };
}

test('导入成功：得到已确认的创意记录与章节', () => {
  const { database, importer, work, count } = createFixture();
  try {
    const run = importer.importOriginal(work.id);
    assert.equal(run.status, 'succeeded');
    assert.ok(run.approvedAt !== null);
    assert.ok(count('chapters') > 0);
  } finally {
    database.close();
  }
});

test('写入章节中途失败：整个导入回滚，不留下运行中的记录和半截章节', () => {
  const { database, importer, work, count } = createFixture({ saveFails: true });
  try {
    assert.throws(() => importer.importOriginal(work.id), /保存章节失败/);
    assert.equal(count('stage_runs'), 0);
    assert.equal(count('chapters'), 0);
  } finally {
    database.close();
  }
});

test('确认采用没有返回记录：抛错并整体回滚，不静默返回未确认的记录', () => {
  const { database, importer, work, count } = createFixture({ approveReturnsNothing: true });
  try {
    assert.throws(() => importer.importOriginal(work.id), /确认采用后读取失败/);
    assert.equal(count('stage_runs'), 0);
    assert.equal(count('chapters'), 0);
  } finally {
    database.close();
  }
});
