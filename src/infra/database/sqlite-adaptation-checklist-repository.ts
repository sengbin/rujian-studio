// ------------------------------------------------------------------------
// 名称：sqlite-adaptation-checklist-repository.ts
// 说明：结构性改编清单数据访问的 SQLite 实现：adaptation_checklists 保存基线与确认状态，adaptation_options 保存取舍项与勾选状态。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：保存时整体覆盖（先删清单，取舍项随外键级联删除，再写入）。
// ------------------------------------------------------------------------

import type { DatabaseSync } from 'node:sqlite';
import { AdaptationChecklist, AdaptationOption, AdaptationOptionKind } from '../../domain/models/adaptation-checklist';
import { AdaptationChecklistRepository } from '../../domain/ports/adaptation-checklist-repository';
import { runInTransaction } from './transaction';

/** adaptation_checklists 表的一行。 */
interface ChecklistRow {
  readonly id: number;
  readonly baseline_words: number;
  readonly baseline_seconds: number;
  readonly target_seconds: number;
  readonly words_per_second: number;
  readonly tolerance_ratio: number;
  readonly confirmed_at: string | null;
  readonly updated_at: string;
}

/** adaptation_options 表的一行。 */
interface OptionRow {
  readonly option_key: string;
  readonly kind: AdaptationOptionKind;
  readonly label: string;
  readonly reason: string;
  readonly affected_refs_json: string;
  readonly estimated_words_saved: number;
  readonly estimated_seconds_saved: number;
  readonly recommended: number;
  readonly selected: number;
}

/** 基于 SQLite 的改编清单仓库。 */
export class SqliteAdaptationChecklistRepository implements AdaptationChecklistRepository {
  constructor(private readonly database: DatabaseSync) {}

  find(runId: number): AdaptationChecklist | undefined {
    const row = this.database.prepare('SELECT * FROM adaptation_checklists WHERE run_id = ?').get(runId) as unknown as ChecklistRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    const options = this.database
      .prepare(
        `SELECT option_key, kind, label, reason, affected_refs_json, estimated_words_saved, estimated_seconds_saved, recommended, selected
         FROM adaptation_options WHERE checklist_id = ? ORDER BY seq`
      )
      .all(row.id) as unknown as OptionRow[];
    return {
      runId,
      baselineWords: row.baseline_words,
      baselineSeconds: row.baseline_seconds,
      targetSeconds: row.target_seconds,
      wordsPerSecond: row.words_per_second,
      toleranceRatio: row.tolerance_ratio,
      options: options.map(toOption),
      confirmedAt: row.confirmed_at,
      updatedAt: row.updated_at
    };
  }

  save(checklist: AdaptationChecklist): void {
    runInTransaction(this.database, () => {
      this.database.prepare('DELETE FROM adaptation_checklists WHERE run_id = ?').run(checklist.runId);
      const result = this.database
        .prepare(
          `INSERT INTO adaptation_checklists
             (run_id, baseline_words, baseline_seconds, target_seconds, words_per_second, tolerance_ratio, confirmed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          checklist.runId,
          checklist.baselineWords,
          checklist.baselineSeconds,
          checklist.targetSeconds,
          checklist.wordsPerSecond,
          checklist.toleranceRatio,
          checklist.confirmedAt,
          checklist.updatedAt
        );
      const checklistId = Number(result.lastInsertRowid);
      const insert = this.database.prepare(
        `INSERT INTO adaptation_options
           (checklist_id, option_key, seq, kind, label, reason, affected_refs_json, estimated_words_saved, estimated_seconds_saved, recommended, selected)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      checklist.options.forEach((option, index) => {
        insert.run(
          checklistId,
          option.id,
          index + 1,
          option.kind,
          option.label,
          option.reason,
          JSON.stringify(option.affectedRefs),
          option.estimatedWordsSaved,
          option.estimatedSecondsSaved,
          option.recommended ? 1 : 0,
          option.selected ? 1 : 0
        );
      });
    });
  }

  updateSelection(runId: number, selectedIds: ReadonlySet<string>, timestamp: string): boolean {
    const row = this.database.prepare('SELECT id FROM adaptation_checklists WHERE run_id = ?').get(runId) as unknown as { id: number } | undefined;
    if (row === undefined) {
      return false;
    }
    runInTransaction(this.database, () => {
      const update = this.database.prepare('UPDATE adaptation_options SET selected = ? WHERE checklist_id = ? AND option_key = ?');
      const keys = this.database.prepare('SELECT option_key FROM adaptation_options WHERE checklist_id = ?').all(row.id) as unknown as Array<{ option_key: string }>;
      for (const { option_key: key } of keys) {
        update.run(selectedIds.has(key) ? 1 : 0, row.id, key);
      }
      this.database.prepare('UPDATE adaptation_checklists SET updated_at = ? WHERE id = ?').run(timestamp, row.id);
    });
    return true;
  }

  confirm(runId: number, timestamp: string): boolean {
    const result = this.database
      .prepare('UPDATE adaptation_checklists SET confirmed_at = ?, updated_at = ? WHERE run_id = ?')
      .run(timestamp, timestamp, runId);
    return Number(result.changes) > 0;
  }
}

/** 把数据库行转换为取舍项。 */
function toOption(row: OptionRow): AdaptationOption {
  return {
    id: row.option_key,
    kind: row.kind,
    label: row.label,
    reason: row.reason,
    affectedRefs: JSON.parse(row.affected_refs_json) as string[],
    estimatedWordsSaved: row.estimated_words_saved,
    estimatedSecondsSaved: row.estimated_seconds_saved,
    recommended: row.recommended === 1,
    selected: row.selected === 1
  };
}
