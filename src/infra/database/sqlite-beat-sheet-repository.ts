// ------------------------------------------------------------------------
// 名称：sqlite-beat-sheet-repository.ts
// 说明：节拍表数据访问的 SQLite 实现：beat_sheets 保存参数快照，beat_items 保存各节拍。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：保存时先清除旧节拍再写入，整体在一个事务内完成。
// ------------------------------------------------------------------------

import type { DatabaseSync } from 'node:sqlite';
import { BeatDraft, BeatSheet, BeatSheetParams } from '../../domain/models/beat-sheet';
import { ProductionFormatType } from '../../domain/models/production-profile';
import { BeatSheetRepository } from '../../domain/ports/beat-sheet-repository';
import { runInTransaction } from './transaction';

/** beat_sheets 表的一行。 */
interface BeatSheetRow {
  readonly id: number;
  readonly format_type: ProductionFormatType;
  readonly beat_template_id: string;
  readonly target_duration_seconds: number;
  readonly episode_count: number;
  readonly words_per_second: number;
  readonly tolerance_ratio: number;
  readonly max_calibration_rounds: number;
  readonly idea: string | null;
  readonly extra: string | null;
  readonly updated_at: string;
}

/** beat_items 表的一行。 */
interface BeatItemRow {
  readonly seq: number;
  readonly label: string;
  readonly purpose: string;
  readonly target_ratio: number;
  readonly estimated_seconds: number;
  readonly estimated_words: number;
  readonly synopsis: string;
  readonly source_refs_json: string;
}

/** 基于 SQLite 的节拍表仓库。 */
export class SqliteBeatSheetRepository implements BeatSheetRepository {
  constructor(private readonly database: DatabaseSync) {}

  find(runId: number): BeatSheet | undefined {
    const row = this.database.prepare('SELECT * FROM beat_sheets WHERE run_id = ?').get(runId) as unknown as BeatSheetRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    const items = this.database
      .prepare('SELECT seq, label, purpose, target_ratio, estimated_seconds, estimated_words, synopsis, source_refs_json FROM beat_items WHERE beat_sheet_id = ? ORDER BY seq')
      .all(row.id) as unknown as BeatItemRow[];
    return {
      runId,
      params: {
        formatType: row.format_type,
        beatTemplateId: row.beat_template_id,
        targetDurationSeconds: row.target_duration_seconds,
        episodeCount: row.episode_count,
        wordsPerSecond: row.words_per_second,
        toleranceRatio: row.tolerance_ratio,
        maxCalibrationRounds: row.max_calibration_rounds,
        idea: row.idea,
        extra: row.extra
      },
      beats: items.map((item) => ({
        seq: item.seq,
        label: item.label,
        purpose: item.purpose,
        targetRatio: item.target_ratio,
        estimatedSeconds: item.estimated_seconds,
        estimatedWords: item.estimated_words,
        synopsis: item.synopsis,
        sourceRefs: JSON.parse(item.source_refs_json) as number[]
      })),
      updatedAt: row.updated_at
    };
  }

  save(runId: number, params: BeatSheetParams, beats: readonly BeatDraft[], timestamp: string): void {
    runInTransaction(this.database, () => {
      this.database.prepare('DELETE FROM beat_sheets WHERE run_id = ?').run(runId);
      const result = this.database
        .prepare(
          `INSERT INTO beat_sheets
             (run_id, format_type, beat_template_id, target_duration_seconds, episode_count, words_per_second, tolerance_ratio, max_calibration_rounds, idea, extra, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          runId,
          params.formatType,
          params.beatTemplateId,
          params.targetDurationSeconds,
          params.episodeCount,
          params.wordsPerSecond,
          params.toleranceRatio,
          params.maxCalibrationRounds,
          params.idea,
          params.extra,
          timestamp
        );
      const sheetId = Number(result.lastInsertRowid);
      const insert = this.database.prepare(
        `INSERT INTO beat_items (beat_sheet_id, seq, label, purpose, target_ratio, estimated_seconds, estimated_words, synopsis, source_refs_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const beat of beats) {
        insert.run(sheetId, beat.seq, beat.label, beat.purpose, beat.targetRatio, beat.estimatedSeconds, beat.estimatedWords, beat.synopsis, JSON.stringify(beat.sourceRefs));
      }
    });
  }

  updateSynopsis(runId: number, seq: number, synopsis: string, timestamp: string): boolean {
    const result = this.database
      .prepare('UPDATE beat_items SET synopsis = ? WHERE seq = ? AND beat_sheet_id = (SELECT id FROM beat_sheets WHERE run_id = ?)')
      .run(synopsis, seq, runId);
    if (Number(result.changes) === 0) {
      return false;
    }
    this.database.prepare('UPDATE beat_sheets SET updated_at = ? WHERE run_id = ?').run(timestamp, runId);
    return true;
  }
}
