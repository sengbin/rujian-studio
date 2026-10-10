// ------------------------------------------------------------------------
// 名称：sqlite-work-source-reader.ts
// 说明：作品素材读取的 SQLite 实现：读取小说原文与灵感图片，供创意阶段使用。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：素材内容保存在磁盘，表里只记录相对路径；小说原文按 UTF-8 解码；图片按 sort_order 排序，影响“按上传顺序”的处理。
// ------------------------------------------------------------------------

import type { DatabaseSync } from 'node:sqlite';
import { CreativeSourceReader } from '../../domain/ports/creative-source-reader';
import { AssetFileStore } from '../../domain/ports/asset-file-store';
import { ImageInput } from '../../domain/ports/text-generation-port';

/** work_sources 表中读取内容所需的列。 */
interface SourceRow {
  readonly mime: string;
  readonly file_name: string;
  readonly file_path: string;
}

/** 基于 SQLite 的作品素材读取器。 */
export class SqliteWorkSourceReader implements CreativeSourceReader {
  /**
   * @param database 数据库连接。
   * @param files 素材文件内容的存储。
   */
  constructor(
    private readonly database: DatabaseSync,
    private readonly files: AssetFileStore
  ) {}

  readNovelText(workId: number): string | undefined {
    const row = this.database
      .prepare("SELECT mime, file_name, file_path FROM work_sources WHERE work_id = ? AND kind = 'novel_text' ORDER BY sort_order, id LIMIT 1")
      .get(workId) as unknown as SourceRow | undefined;
    return row === undefined ? undefined : this.readFile(row).toString('utf8');
  }

  readImages(workId: number): ImageInput[] {
    const rows = this.database
      .prepare("SELECT mime, file_name, file_path FROM work_sources WHERE work_id = ? AND kind = 'image' ORDER BY sort_order, id")
      .all(workId) as unknown as SourceRow[];
    return rows.map((row) => ({ mimeType: row.mime, data: new Uint8Array(this.readFile(row)) }));
  }

  /** 读取素材文件内容；文件已丢失时说明是哪个文件。 */
  private readFile(row: SourceRow): Buffer {
    try {
      return this.files.read(row.file_path);
    } catch (error) {
      throw new Error(`素材文件“${row.file_name}”已丢失，请到作品列表里重新上传。`, { cause: error });
    }
  }
}
