// ------------------------------------------------------------------------
// 名称：sqlite-work-repository.test.ts
// 说明：作品仓库的自动化测试：素材（灵感图片、小说、原创文稿）保存为本地文件而不是数据库内容，读取还原，替换图片、删除作品、删除项目后清理不再被引用的文件，写入失败时不留文件，文件丢失时说明是哪个文件。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：使用内存数据库与内存文件存储。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NewWorkSource } from '../../domain/models/work';
import { MemoryAssetFileStore } from '../../domain/ports/testing/memory-asset-file-store';
import { IN_MEMORY_DATABASE_PATH, openDatabase } from './database-connection';
import { SqliteProjectRepository } from './sqlite-project-repository';
import { SqliteWorkRepository } from './sqlite-work-repository';

const NOW = '2026-10-06T00:00:00.000Z';

/** 创建内存库、文件存储和一个项目。 */
function createFixture() {
  const database = openDatabase(IN_MEMORY_DATABASE_PATH);
  const files = new MemoryAssetFileStore();
  const projects = new SqliteProjectRepository(database, files);
  const project = projects.insert({ name: '项目甲', description: '', visualStyle: null, defaultAspectRatio: null, defaultResolution: null }, NOW);
  const works = new SqliteWorkRepository(database, files);
  return { database, files, projects, works, project };
}

/** 一个图片素材。 */
function image(fileName: string, bytes: number[]): NewWorkSource {
  return { kind: 'image', fileName, mime: 'image/png', content: new Uint8Array(bytes) };
}

/** 一个文本素材。 */
function novel(fileName: string, text: string): NewWorkSource {
  return { kind: 'novel_text', fileName, mime: 'text/plain', content: new Uint8Array(Buffer.from(text, 'utf8')) };
}

test('创建作品：素材内容写入本地文件，表里只记路径、大小和顺序，读取按顺序还原', () => {
  const { database, files, works, project } = createFixture();
  try {
    const work = works.insert(project.id, { name: '作品甲', kind: 'short_video', sourceType: 'image' }, [image('b.png', [2, 2]), image('a.png', [1])], NOW);
    const rows = database.prepare('SELECT file_name, file_path, size_bytes, sort_order FROM work_sources WHERE work_id = ? ORDER BY sort_order').all(work.id) as unknown as Array<{
      file_name: string;
      file_path: string;
      size_bytes: number;
      sort_order: number;
    }>;
    assert.deepEqual(rows.map((row) => [row.file_name, row.size_bytes, row.sort_order]), [['b.png', 2, 0], ['a.png', 1, 1]]);
    assert.deepEqual([...files.files.keys()].sort(), rows.map((row) => row.file_path).sort());
    const columns = (database.prepare('PRAGMA table_info(work_sources)').all() as unknown as Array<{ name: string }>).map((column) => column.name);
    assert.ok(!columns.includes('content'), '数据库不保存素材内容');

    assert.deepEqual(works.listSources(work.id, 'image').map((source) => [source.fileName, [...source.content]]), [['b.png', [2, 2]], ['a.png', [1]]]);
    const text = works.insert(project.id, { name: '作品乙', kind: 'short_video', sourceType: 'novel' }, [novel('novel.txt', '第一章 灯塔\n守夜人。')], NOW);
    assert.equal(Buffer.from(works.listSources(text.id, 'novel_text')[0].content).toString('utf8'), '第一章 灯塔\n守夜人。');
  } finally {
    database.close();
  }
});

test('创建作品失败（名称重复）：刚写入的素材文件被清理，已有作品的文件保留', () => {
  const { database, files, works, project } = createFixture();
  try {
    works.insert(project.id, { name: '作品甲', kind: 'short_video', sourceType: 'image' }, [image('a.png', [1])], NOW);
    const before = [...files.files.keys()];
    assert.throws(() => works.insert(project.id, { name: '作品甲', kind: 'short_video', sourceType: 'image' }, [image('b.png', [9, 9, 9])], NOW));
    assert.deepEqual([...files.files.keys()], before);
  } finally {
    database.close();
  }
});

test('修改作品：替换灵感图片后旧文件被删除，仍被引用的同一张图保留', () => {
  const { database, files, works, project } = createFixture();
  try {
    const work = works.insert(project.id, { name: '作品甲', kind: 'short_video', sourceType: 'image' }, [image('a.png', [1]), image('b.png', [2])], NOW);
    assert.equal(files.files.size, 2);

    works.update(work.id, { name: '作品甲', kind: 'short_video', images: [image('b.png', [2]), image('c.png', [3])] }, NOW);
    assert.deepEqual(works.listSources(work.id, 'image').map((source) => [source.fileName, [...source.content]]), [['b.png', [2]], ['c.png', [3]]]);
    assert.equal(files.files.size, 2, 'a 被删除，b 保留，c 新增');

    works.update(work.id, { name: '作品乙', kind: 'short_video' }, NOW);
    assert.equal(files.files.size, 2, '没有提交图片时素材不变');
    works.update(work.id, { name: '作品乙', kind: 'short_video', images: [] }, NOW);
    assert.equal(files.files.size, 0);
  } finally {
    database.close();
  }
});

test('不同作品用到同一张图片时共用一个文件，删除其中一个作品不影响另一个', () => {
  const { database, files, works, project } = createFixture();
  try {
    const first = works.insert(project.id, { name: '作品甲', kind: 'short_video', sourceType: 'image' }, [image('a.png', [1])], NOW);
    const second = works.insert(project.id, { name: '作品乙', kind: 'short_video', sourceType: 'image' }, [image('same.png', [1])], NOW);
    assert.equal(files.files.size, 1);

    assert.equal(works.remove(first.id), true);
    assert.equal(files.files.size, 1);
    assert.deepEqual([...works.listSources(second.id, 'image')[0].content], [1]);

    assert.equal(works.remove(second.id), true);
    assert.equal(files.files.size, 0);
    assert.equal(works.remove(second.id), false);
  } finally {
    database.close();
  }
});

test('删除项目：项目下作品的素材文件一并清理；文件丢失时读取报出具体文件名', () => {
  const { database, files, projects, works, project } = createFixture();
  try {
    const work = works.insert(project.id, { name: '作品甲', kind: 'short_video', sourceType: 'novel' }, [novel('novel.txt', '正文')], NOW);
    assert.equal(files.files.size, 1);

    for (const path of files.list()) files.remove(path);
    assert.throws(() => works.listSources(work.id, 'novel_text'), /素材文件“novel\.txt”已丢失/);

    works.update(work.id, { name: '作品甲', kind: 'short_video' }, NOW);
    const other = works.insert(project.id, { name: '作品乙', kind: 'short_video', sourceType: 'image' }, [image('a.png', [1])], NOW);
    assert.ok(other.id > 0);
    assert.equal(files.files.size, 1);
    assert.equal(projects.remove(project.id), true);
    assert.equal(files.files.size, 0);
  } finally {
    database.close();
  }
});
