// ------------------------------------------------------------------------
// 名称：sqlite-narrator-voice-repository.test.ts
// 说明：作品旁白音色仓库（含绑定仓库的同作品集列表）的自动化测试：读取、设置、替换、清除，随作品或资产删除而清除，集列表只含同作品的集。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：使用内存数据库，作品、集、资产用 SQL 直接写入。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IN_MEMORY_DATABASE_PATH, openDatabase } from './database-connection';
import { SqliteBindingRepository } from './sqlite-binding-repository';
import { SqliteNarratorVoiceRepository } from './sqlite-narrator-voice-repository';

/** 建库并写入一个项目、两个作品（甲有两集、乙有一集）与两个音频资产。 */
function createFixture() {
  const database = openDatabase(IN_MEMORY_DATABASE_PATH);
  const insert = (sql: string, ...params: Array<string | number>) => Number(database.prepare(sql).run(...params).lastInsertRowid);
  const project = insert("INSERT INTO projects (name, created_at, updated_at) VALUES ('项目甲', 't', 't')");
  const work = insert("INSERT INTO works (project_id, name, kind, created_at, updated_at) VALUES (?, '作品甲', 'short_drama', 't', 't')", project);
  const otherWork = insert("INSERT INTO works (project_id, name, kind, created_at, updated_at) VALUES (?, '作品乙', 'short_video', 't', 't')", project);
  const episode2 = insert("INSERT INTO episodes (work_id, seq, title, created_at, updated_at) VALUES (?, 2, '第二集', 't', 't')", work);
  const episode1 = insert("INSERT INTO episodes (work_id, seq, title, created_at, updated_at) VALUES (?, 1, '第一集', 't', 't')", work);
  const otherEpisode = insert("INSERT INTO episodes (work_id, seq, title, created_at, updated_at) VALUES (?, 1, '乙第一集', 't', 't')", otherWork);
  const asset = (name: string) => insert("INSERT INTO assets (kind, name, created_at, updated_at) VALUES ('audio', ?, 't', 't')", name);
  return { database, work, otherWork, episode1, episode2, otherEpisode, voiceA: asset('旁白甲'), voiceB: asset('旁白乙') };
}

test('旁白音色：没有时为空，设置后可读取，再设置替换，清除后为空；作品之间互不影响', () => {
  const { database, work, otherWork, voiceA, voiceB } = createFixture();
  try {
    const repository = new SqliteNarratorVoiceRepository(database);
    assert.equal(repository.find(work), undefined);

    repository.set(work, voiceA, 't1');
    assert.deepEqual(repository.find(work), { workId: work, assetId: voiceA, assetName: '旁白甲' });
    assert.equal(repository.find(otherWork), undefined);

    repository.set(work, voiceB, 't2');
    assert.deepEqual(repository.find(work), { workId: work, assetId: voiceB, assetName: '旁白乙' });
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM work_narrator_voices').get()?.n, 1, '替换而不是新增');

    repository.clear(work);
    assert.equal(repository.find(work), undefined);
    repository.clear(work);
  } finally {
    database.close();
  }
});

test('旁白音色随作品删除或资产删除而清除', () => {
  const { database, work, otherWork, voiceA, voiceB } = createFixture();
  try {
    const repository = new SqliteNarratorVoiceRepository(database);
    repository.set(work, voiceA, 't');
    repository.set(otherWork, voiceB, 't');

    database.prepare('DELETE FROM assets WHERE id = ?').run(voiceA);
    assert.equal(repository.find(work), undefined, '资产删除后级联清除');
    assert.ok(repository.find(otherWork));

    database.prepare('DELETE FROM works WHERE id = ?').run(otherWork);
    assert.equal(repository.find(otherWork), undefined, '作品删除后级联清除');
  } finally {
    database.close();
  }
});

test('同作品的集标识：按集序号排列，含自身，不含其他作品的集，集不存在时为空', () => {
  const { database, episode1, episode2, otherEpisode } = createFixture();
  try {
    const bindings = new SqliteBindingRepository(database);
    assert.deepEqual(bindings.listSiblingEpisodeIds(episode2), [episode1, episode2]);
    assert.deepEqual(bindings.listSiblingEpisodeIds(otherEpisode), [otherEpisode]);
    assert.deepEqual(bindings.listSiblingEpisodeIds(9999), []);
  } finally {
    database.close();
  }
});
