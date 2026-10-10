// ------------------------------------------------------------------------
// 名称：asset-file-cleanup.ts
// 说明：本地文件的清理辅助：收集资产或版本引用的文件路径，在记录删除后删除不再被任何记录引用的磁盘文件，并在级联删除（项目、作品、集、镜头、生成结果）之后清理全部孤儿文件。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：文件路径由内容哈希决定，资产文件、版本文件、作品素材、镜头首帧、尾帧和多个记录可能共用同一个文件，所以必须先确认没有引用才能删除；清理在事务提交之后进行，删除失败只会留下一个无人引用的文件，不影响已提交的数据；所有清理同步完成，写入文件与写入记录之间没有其他操作穿插，不会误删刚写入、尚未登记的文件。
// ------------------------------------------------------------------------

import type { DatabaseSync } from 'node:sqlite';
import { AssetFileStore } from '../../domain/ports/asset-file-store';

/** 查询结果中只含文件路径的一行。 */
interface PathRow {
  readonly file_path: string;
}

/** 记录了本地文件路径的全部表；新增这类表时必须加到这里，否则文件会被当成孤儿清理。 */
export const FILE_REFERENCE_TABLES = ['asset_files', 'asset_version_files', 'work_sources', 'result_frames', 'shot_first_frames'] as const;

/**
 * 收集一个资产引用的全部文件路径：资产自己的文件（上传与采用）和它所有版本的结果文件、缩略图。
 * @param assetId 资产标识。
 */
export function collectAssetFilePaths(database: DatabaseSync, assetId: number): string[] {
  const rows = database
    .prepare(
      `SELECT file_path FROM asset_files WHERE asset_id = ?
       UNION
       SELECT f.file_path FROM asset_version_files f JOIN asset_versions v ON v.id = f.version_id WHERE v.asset_id = ?`
    )
    .all(assetId, assetId) as unknown as PathRow[];
  return rows.map((row) => row.file_path);
}

/**
 * 收集一个版本引用的全部文件路径。
 * @param versionId 版本标识。
 */
export function collectVersionFilePaths(database: DatabaseSync, versionId: number): string[] {
  const rows = database
    .prepare('SELECT file_path FROM asset_version_files WHERE version_id = ?')
    .all(versionId) as unknown as PathRow[];
  return rows.map((row) => row.file_path);
}

/**
 * 删除不再被任何记录引用的文件；仍被引用的保留。应在删除记录的事务提交之后调用。
 * @param paths 可能已失去引用的文件路径，允许重复。
 */
export function removeUnreferencedFiles(database: DatabaseSync, store: AssetFileStore, paths: readonly string[]): void {
  const isReferenced = database.prepare(
    `${FILE_REFERENCE_TABLES.map((table) => `SELECT 1 AS found FROM ${table} WHERE file_path = ?`).join('\nUNION ALL\n')}\nLIMIT 1`
  );
  for (const filePath of new Set(paths)) {
    if (isReferenced.get(...FILE_REFERENCE_TABLES.map(() => filePath)) !== undefined) {
      continue;
    }
    try {
      store.remove(filePath);
    } catch {
      // 记录已经提交，删不掉磁盘文件（如被其他程序占用）只会留下一个无人引用的文件，不能让整个操作失败。
    }
  }
}

/**
 * 删除存储里没有任何记录引用的文件：项目、作品、集、镜头、生成结果等级联删除之后调用，一次清理这些记录带走的全部文件。
 * @param database 数据库连接。
 * @param store 文件存储；未提供时什么也不做（测试里不需要磁盘文件的仓库不传存储）。
 */
export function sweepUnreferencedFiles(database: DatabaseSync, store: AssetFileStore | undefined): void {
  if (store === undefined) {
    return;
  }
  const referenced = new Set<string>();
  for (const table of FILE_REFERENCE_TABLES) {
    for (const row of database.prepare(`SELECT file_path FROM ${table}`).all() as unknown as PathRow[]) {
      referenced.add(row.file_path);
    }
  }
  removeUnreferencedFiles(
    database,
    store,
    store.list().filter((filePath) => !referenced.has(filePath))
  );
}
