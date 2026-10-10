// ------------------------------------------------------------------------
// 名称：sqlite-work-repository.ts
// 说明：作品仓库的 SQLite 实现：查询作品，在一个事务内创建作品、第 1 集与素材文件记录，修改作品名称与形态。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：素材文件内容保存在磁盘（AssetFileStore），work_sources 表只记录相对路径，sort_order 记录上传顺序；先写文件再在事务内写记录，写记录失败时清理刚写的文件；替换图片、删除作品后清理不再被引用的文件；删除作品由外键级联清除其下全部数据。
// ------------------------------------------------------------------------

import type { DatabaseSync } from 'node:sqlite';
import { ProductionFormatType } from '../../domain/models/production-profile';
import { NewWorkSource, Work, WorkInput, WorkSourceKind, WorkSourceType, WorkUpdate } from '../../domain/models/work';
import { AssetFileStore } from '../../domain/ports/asset-file-store';
import { WorkRepository } from '../../domain/ports/work-repository';
import { isMultiEpisode } from '../../domain/rules/production-profile-rules';
import { removeUnreferencedFiles, sweepUnreferencedFiles } from './asset-file-cleanup';
import { runInTransaction } from './transaction';

/** works 表的一行。 */
interface WorkRow {
  readonly id: number;
  readonly project_id: number;
  readonly name: string;
  readonly kind: ProductionFormatType;
  readonly source_type: WorkSourceType;
  readonly created_at: string;
  readonly updated_at: string;
}

/** 已写入磁盘的一个素材文件：元数据加相对路径。 */
interface StoredSource {
  readonly kind: WorkSourceKind;
  readonly fileName: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly filePath: string;
}

/** 基于 SQLite 的作品仓库。 */
export class SqliteWorkRepository implements WorkRepository {
  /**
   * @param database 数据库连接。
   * @param files 素材文件内容的存储。
   */
  constructor(
    private readonly database: DatabaseSync,
    private readonly files: AssetFileStore
  ) {}

  listByProject(projectId: number): Work[] {
    const rows = this.database
      .prepare('SELECT * FROM works WHERE project_id = ? ORDER BY created_at DESC, id DESC')
      .all(projectId) as unknown as WorkRow[];
    return rows.map(toWork);
  }

  listBySource(sourceType: WorkSourceType): Work[] {
    const rows = this.database
      .prepare('SELECT * FROM works WHERE source_type = ? ORDER BY created_at DESC, id DESC')
      .all(sourceType) as unknown as WorkRow[];
    return rows.map(toWork);
  }

  listAll(): Work[] {
    const rows = this.database.prepare('SELECT * FROM works ORDER BY created_at DESC, id DESC').all() as unknown as WorkRow[];
    return rows.map(toWork);
  }

  findById(id: number): Work | undefined {
    const row = this.database.prepare('SELECT * FROM works WHERE id = ?').get(id) as unknown as WorkRow | undefined;
    return row === undefined ? undefined : toWork(row);
  }

  findByName(projectId: number, name: string): Work | undefined {
    const row = this.database
      .prepare('SELECT * FROM works WHERE project_id = ? AND name = ?')
      .get(projectId, name) as unknown as WorkRow | undefined;
    return row === undefined ? undefined : toWork(row);
  }

  insert(projectId: number, input: WorkInput, sources: readonly NewWorkSource[], timestamp: string): Work {
    const stored = this.storeSources(sources);
    try {
      return runInTransaction(this.database, () => {
        const result = this.database
          .prepare('INSERT INTO works (project_id, name, kind, source_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(projectId, input.name, input.kind, input.sourceType, timestamp, timestamp);
        const workId = Number(result.lastInsertRowid);

        if (!isMultiEpisode(input.kind)) {
          this.database
            .prepare('INSERT INTO episodes (work_id, seq, title, created_at, updated_at) VALUES (?, 1, ?, ?, ?)')
            .run(workId, input.name, timestamp, timestamp);
        }

        this.insertSources(workId, stored, timestamp);

        const created = this.findById(workId);
        if (created === undefined) {
          throw new Error(`作品 ${workId} 写入后读取失败。`);
        }
        return created;
      });
    } catch (error) {
      // 记录没有写入（如名称重复）时，刚写的文件不再有人引用。
      removeUnreferencedFiles(this.database, this.files, stored.map((source) => source.filePath));
      throw error;
    }
  }

  update(id: number, input: WorkUpdate, timestamp: string): Work | undefined {
    const stored = input.images === undefined ? [] : this.storeSources(input.images);
    try {
      const updated = runInTransaction(this.database, () => {
        const current = this.findById(id);
        if (current === undefined) {
          return undefined;
        }
        this.database.prepare('UPDATE works SET name = ?, kind = ?, updated_at = ? WHERE id = ?').run(input.name, input.kind, timestamp, id);

        if (input.kind !== current.kind) {
          if (!isMultiEpisode(input.kind)) {
            this.database
              .prepare('INSERT INTO episodes (work_id, seq, title, created_at, updated_at) VALUES (?, 1, ?, ?, ?)')
              .run(id, input.name, timestamp, timestamp);
          } else {
            this.database.prepare('DELETE FROM episodes WHERE work_id = ? AND seq = 1').run(id);
          }
        } else if (!isMultiEpisode(input.kind) && input.name !== current.name) {
          // 只改还跟着作品名的集标题，用户自己改过的标题保持不变。
          this.database
            .prepare('UPDATE episodes SET title = ?, updated_at = ? WHERE work_id = ? AND seq = 1 AND title = ?')
            .run(input.name, timestamp, id, current.name);
        }

        if (input.images !== undefined) {
          this.database.prepare("DELETE FROM work_sources WHERE work_id = ? AND kind = 'image'").run(id);
          this.insertSources(id, stored, timestamp);
        }
        return this.findById(id);
      });
      // 被替换掉的旧图片，以及形态从多集改为单个短视频时随第 1 集一起删除的镜头首帧、尾帧，文件都不再有人引用（同一张图重新选择时路径相同，仍被引用的会保留）。
      sweepUnreferencedFiles(this.database, this.files);
      return updated;
    } catch (error) {
      removeUnreferencedFiles(this.database, this.files, stored.map((source) => source.filePath));
      throw error;
    }
  }

  listSources(workId: number, kind: WorkSourceKind): NewWorkSource[] {
    const rows = this.database
      .prepare('SELECT kind, file_name, mime, file_path FROM work_sources WHERE work_id = ? AND kind = ? ORDER BY sort_order, id')
      .all(workId, kind) as unknown as Array<{ kind: WorkSourceKind; file_name: string; mime: string; file_path: string }>;
    return rows.map((row) => ({ kind: row.kind, fileName: row.file_name, mime: row.mime, content: new Uint8Array(this.readFile(row.file_name, row.file_path)) }));
  }

  remove(id: number): boolean {
    const removed = Number(this.database.prepare('DELETE FROM works WHERE id = ?').run(id).changes) > 0;
    // 作品下的素材、镜头首帧、尾帧记录都已级联删除，清理它们的文件。
    sweepUnreferencedFiles(this.database, this.files);
    return removed;
  }

  /** 把素材内容写入磁盘，返回带路径的素材列表，顺序不变。 */
  private storeSources(sources: readonly NewWorkSource[]): StoredSource[] {
    return sources.map((source) => ({
      kind: source.kind,
      fileName: source.fileName,
      mime: source.mime,
      sizeBytes: source.content.length,
      filePath: this.files.write(Buffer.from(source.content), source.mime)
    }));
  }

  /** 读取素材文件内容；文件已丢失时说明是哪个文件。 */
  private readFile(fileName: string, filePath: string): Buffer {
    try {
      return this.files.read(filePath);
    } catch {
      throw new Error(`素材文件“${fileName}”已丢失，请重新上传。`);
    }
  }

  /** 按给定顺序写入素材记录，sort_order 从 0 开始。 */
  private insertSources(workId: number, sources: readonly StoredSource[], timestamp: string): void {
    const insertSource = this.database.prepare(
      `INSERT INTO work_sources (work_id, kind, file_name, file_path, mime, size_bytes, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    sources.forEach((source, index) => {
      insertSource.run(workId, source.kind, source.fileName, source.filePath, source.mime, source.sizeBytes, index, timestamp);
    });
  }
}

/** 数据库行转领域对象。 */
function toWork(row: WorkRow): Work {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    sourceType: row.source_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
