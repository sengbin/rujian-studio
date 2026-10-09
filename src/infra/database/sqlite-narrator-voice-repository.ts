// ------------------------------------------------------------------------
// 名称：sqlite-narrator-voice-repository.ts
// 说明：作品旁白音色数据访问的 SQLite 实现。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：work_narrator_voices 以作品为主键，设置时直接替换。
// ------------------------------------------------------------------------

import type { DatabaseSync } from 'node:sqlite';
import { NarratorVoiceRecord, NarratorVoiceRepository } from '../../domain/ports/narrator-voice-repository';

/** 基于 SQLite 的作品旁白音色仓库。 */
export class SqliteNarratorVoiceRepository implements NarratorVoiceRepository {
  constructor(private readonly database: DatabaseSync) {}

  find(workId: number): NarratorVoiceRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT n.work_id, n.asset_id, a.name AS asset_name
           FROM work_narrator_voices n JOIN assets a ON a.id = n.asset_id
          WHERE n.work_id = ?`
      )
      .get(workId) as unknown as { work_id: number; asset_id: number; asset_name: string } | undefined;
    return row === undefined ? undefined : { workId: row.work_id, assetId: row.asset_id, assetName: row.asset_name };
  }

  set(workId: number, assetId: number, timestamp: string): void {
    this.database
      .prepare(
        `INSERT INTO work_narrator_voices (work_id, asset_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT (work_id) DO UPDATE SET asset_id = excluded.asset_id, created_at = excluded.created_at`
      )
      .run(workId, assetId, timestamp);
  }

  clear(workId: number): void {
    this.database.prepare('DELETE FROM work_narrator_voices WHERE work_id = ?').run(workId);
  }
}
