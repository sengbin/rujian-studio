// ------------------------------------------------------------------------
// 名称：asset-file-cleanup.test.ts
// 说明：本地文件清理的自动化测试：清理孤儿文件时，被任何一张文件引用表（资产文件、版本文件、作品素材、尾帧、镜头首帧）引用的文件都保留，没有存储时什么也不做。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：使用内存数据库与内存文件存储；只检查文件清单，所以暂时关闭外键写入引用记录。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryAssetFileStore } from '../../domain/ports/testing/memory-asset-file-store';
import { FILE_REFERENCE_TABLES, removeUnreferencedFiles, sweepUnreferencedFiles } from './asset-file-cleanup';
import { IN_MEMORY_DATABASE_PATH, openDatabase } from './database-connection';

/** 各引用表登记一个文件路径所需的插入语句。 */
const INSERTS: Readonly<Record<(typeof FILE_REFERENCE_TABLES)[number], string>> = {
  asset_files: "INSERT INTO asset_files (asset_id, file_name, file_path, mime, size_bytes, created_at) VALUES (1, 'a.png', ?, 'image/png', 1, 't')",
  asset_version_files: "INSERT INTO asset_version_files (version_id, file_name, file_path, mime, size_bytes, created_at) VALUES (1, 'a.png', ?, 'image/png', 1, 't')",
  work_sources: "INSERT INTO work_sources (work_id, kind, file_name, file_path, mime, size_bytes, created_at) VALUES (1, 'image', 'a.png', ?, 'image/png', 1, 't')",
  result_frames: "INSERT INTO result_frames (result_id, kind, mime, width, height, file_path, size_bytes, created_at) VALUES (1, 'tail', 'image/png', 1, 1, ?, 1, 't')",
  shot_first_frames: "INSERT INTO shot_first_frames (shot_id, file_name, file_path, mime, size_bytes, created_at) VALUES (1, 'a.png', ?, 'image/png', 1, 't')"
};

test('清理孤儿文件：每张引用表引用的文件都保留，只删除没有任何记录引用的文件', () => {
  const database = openDatabase(IN_MEMORY_DATABASE_PATH);
  try {
    const files = new MemoryAssetFileStore();
    database.exec('PRAGMA foreign_keys = OFF');
    const kept = FILE_REFERENCE_TABLES.map((table) => {
      const filePath = files.write(Buffer.from(table), 'image/png');
      database.prepare(INSERTS[table]).run(filePath);
      return filePath;
    });
    const orphan = files.write(Buffer.from('orphan'), 'image/png');

    sweepUnreferencedFiles(database, files);
    assert.deepEqual([...files.files.keys()].sort(), [...kept].sort());
    assert.ok(!files.files.has(orphan));
  } finally {
    database.close();
  }
});

test('删除指定文件：仍被引用的保留；没有提供存储时清理什么也不做', () => {
  const database = openDatabase(IN_MEMORY_DATABASE_PATH);
  try {
    const files = new MemoryAssetFileStore();
    database.exec('PRAGMA foreign_keys = OFF');
    const referenced = files.write(Buffer.from('referenced'), 'image/png');
    const orphan = files.write(Buffer.from('orphan'), 'image/png');
    database.prepare(INSERTS.shot_first_frames).run(referenced);

    removeUnreferencedFiles(database, files, [referenced, orphan, orphan]);
    assert.deepEqual([...files.files.keys()], [referenced]);

    assert.doesNotThrow(() => sweepUnreferencedFiles(database, undefined));
    assert.deepEqual([...files.files.keys()], [referenced]);
  } finally {
    database.close();
  }
});
