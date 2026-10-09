// ------------------------------------------------------------------------
// 名称：sqlite-storyboard-repository.ts
// 说明：分镜脚本、镜头、镜头出场实体、镜头声音与镜头首帧图片数据访问的 SQLite 实现。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：整份保存与单个镜头修改都在事务内完成，不能在已有事务中调用；首帧图片内容保存在本地文件（AssetFileStore），shot_first_frames 表只记路径，先写文件再在事务内写记录，替换、删除镜头或重写整份脚本后清理不再被引用的文件。
// ------------------------------------------------------------------------

import type { DatabaseSync } from 'node:sqlite';
import { FirstFrameMode, GroupLayoutEntry, NewShotFirstFrameImage, ShotDraft, ShotEdit, ShotFirstFrameImage, ShotGroup, ShotRecord, ShotStaging, SoundDraft, SoundKind, SoundRecord, StageDepth, StageFacing, StageX, StoryboardScript } from '../../domain/models/storyboard';
import { AssetFileStore } from '../../domain/ports/asset-file-store';
import { StoryboardRepository } from '../../domain/ports/storyboard-repository';
import { removeUnreferencedFiles, sweepUnreferencedFiles } from './asset-file-cleanup';
import { runInTransaction } from './transaction';

/** 重排序号时临时移出正常范围的偏移量。 */
const SEQ_SHIFT = 1000000;

/** storyboard_scripts 表的一行。 */
interface ScriptRow {
  readonly id: number;
  readonly run_id: number;
  readonly episode_id: number;
}

/** shots 表的一行。 */
interface ShotRow {
  readonly id: number;
  readonly seq: number;
  readonly scene_label: string;
  readonly shot_size: string;
  readonly camera_angle: string;
  readonly camera_movement: string;
  readonly duration_seconds: number;
  readonly transition: string;
  readonly continuity_note: string;
  readonly first_frame_mode: FirstFrameMode;
  readonly first_frame_asset_id: number | null;
  readonly prompt: string;
}

/** shot_entities 表的一行：出场实体与站位。 */
interface ShotEntityRow {
  readonly shot_id: number;
  readonly entity_id: number;
  readonly start_x: StageX | null;
  readonly start_depth: StageDepth | null;
  readonly end_x: StageX | null;
  readonly end_depth: StageDepth | null;
  readonly facing: StageFacing | null;
  readonly action: string;
}

/** shot_sounds 表的一行。 */
interface SoundRow {
  readonly id: number;
  readonly shot_id: number;
  readonly kind: SoundKind;
  readonly speaker_entity_id: number | null;
  readonly text: string;
  readonly delivery: string;
  readonly start_offset_seconds: number | null;
  readonly duration_seconds: number | null;
  readonly is_enabled: number;
}

/** shot_first_frames 表的一行。 */
interface FirstFrameRow {
  readonly id: number;
  readonly shot_id: number;
  readonly file_name: string;
  readonly file_path: string;
  readonly mime: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly size_bytes: number;
}

/** 已写入磁盘的首帧图片：元数据加相对路径。 */
interface StoredFirstFrame {
  readonly fileName: string;
  readonly mime: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly sizeBytes: number;
  readonly filePath: string;
}

function toSound(row: SoundRow): SoundRecord {
  return {
    id: row.id,
    kind: row.kind,
    speakerEntityId: row.speaker_entity_id,
    text: row.text,
    delivery: row.delivery,
    startOffsetSeconds: row.start_offset_seconds,
    durationSeconds: row.duration_seconds,
    isEnabled: row.is_enabled === 1
  };
}

/** 出场实体行转为站位；没有填写任何站位的实体不出现在站位里。 */
function toStaging(row: ShotEntityRow): ShotStaging[] {
  const isEmpty = row.start_x === null && row.start_depth === null && row.end_x === null && row.end_depth === null && row.facing === null && row.action === '';
  if (isEmpty) {
    return [];
  }
  return [{ entityId: row.entity_id, startX: row.start_x, startDepth: row.start_depth, endX: row.end_x, endDepth: row.end_depth, facing: row.facing, action: row.action }];
}

function toFirstFrameImage(row: FirstFrameRow): ShotFirstFrameImage {
  return { id: row.id, fileName: row.file_name, mime: row.mime, width: row.width, height: row.height, sizeBytes: row.size_bytes };
}

/** 基于 SQLite 的分镜脚本仓库。 */
export class SqliteStoryboardRepository implements StoryboardRepository {
  /**
   * @param database 数据库连接。
   * @param files 镜头首帧图片的本地文件存储。
   */
  constructor(
    private readonly database: DatabaseSync,
    private readonly files: AssetFileStore
  ) {}

  find(runId: number): StoryboardScript | undefined {
    const row = this.database.prepare('SELECT id, run_id, episode_id FROM storyboard_scripts WHERE run_id = ?').get(runId) as unknown as
      | ScriptRow
      | undefined;
    return row === undefined ? undefined : { id: row.id, runId: row.run_id, episodeId: row.episode_id };
  }

  save(runId: number, episodeId: number, shots: readonly ShotDraft[], timestamp: string): void {
    runInTransaction(this.database, () => {
      this.database.prepare('DELETE FROM storyboard_scripts WHERE run_id = ?').run(runId);
      const script = this.database
        .prepare('INSERT INTO storyboard_scripts (episode_id, run_id, created_at) VALUES (?, ?, ?)')
        .run(episodeId, runId, timestamp);
      const scriptId = Number(script.lastInsertRowid);
      const insertShot = this.database.prepare(
        `INSERT INTO shots
           (storyboard_script_id, seq, scene_label, shot_size, camera_angle, camera_movement, duration_seconds,
            transition, continuity_note, first_frame_mode, first_frame_asset_id, prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const shot of shots) {
        const inserted = insertShot.run(
          scriptId,
          shot.seq,
          shot.sceneLabel,
          shot.shotSize,
          shot.cameraAngle,
          shot.cameraMovement,
          shot.durationSeconds,
          shot.transition,
          shot.continuityNote,
          shot.firstFrameMode,
          shot.firstFrameAssetId,
          shot.prompt,
          timestamp,
          timestamp
        );
        this.replaceRelations(Number(inserted.lastInsertRowid), shot.entityIds, shot.staging, shot.sounds);
      }
    });
    // 被覆盖的旧脚本带走的首帧图片、尾帧文件不再有人引用。
    sweepUnreferencedFiles(this.database, this.files);
  }

  listShots(runId: number): ShotRecord[] {
    const shotRows = this.database
      .prepare(
        `SELECT s.* FROM shots s JOIN storyboard_scripts ss ON ss.id = s.storyboard_script_id
         WHERE ss.run_id = ? ORDER BY s.seq`
      )
      .all(runId) as unknown as ShotRow[];
    if (shotRows.length === 0) {
      return [];
    }
    const entityRows = this.database
      .prepare(
        `SELECT se.* FROM shot_entities se
         JOIN shots s ON s.id = se.shot_id JOIN storyboard_scripts ss ON ss.id = s.storyboard_script_id
         WHERE ss.run_id = ? ORDER BY se.shot_id, se.rowid`
      )
      .all(runId) as unknown as ShotEntityRow[];
    const soundRows = this.database
      .prepare(
        `SELECT so.* FROM shot_sounds so
         JOIN shots s ON s.id = so.shot_id JOIN storyboard_scripts ss ON ss.id = s.storyboard_script_id
         WHERE ss.run_id = ? ORDER BY so.shot_id, so.seq`
      )
      .all(runId) as unknown as SoundRow[];
    const frameRows = this.database
      .prepare(
        `SELECT f.* FROM shot_first_frames f
         JOIN shots s ON s.id = f.shot_id JOIN storyboard_scripts ss ON ss.id = s.storyboard_script_id
         WHERE ss.run_id = ?`
      )
      .all(runId) as unknown as FirstFrameRow[];
    const frameByShot = new Map(frameRows.map((frame) => [frame.shot_id, toFirstFrameImage(frame)]));

    return shotRows.map((row) => ({
      id: row.id,
      seq: row.seq,
      sceneLabel: row.scene_label,
      shotSize: row.shot_size,
      cameraAngle: row.camera_angle,
      cameraMovement: row.camera_movement,
      durationSeconds: row.duration_seconds,
      transition: row.transition,
      continuityNote: row.continuity_note,
      firstFrameMode: row.first_frame_mode,
      firstFrameAssetId: row.first_frame_asset_id,
      entityIds: entityRows.filter((entity) => entity.shot_id === row.id).map((entity) => entity.entity_id),
      staging: entityRows.filter((entity) => entity.shot_id === row.id).flatMap(toStaging),
      sounds: soundRows.filter((sound) => sound.shot_id === row.id).map(toSound),
      firstFrameImage: frameByShot.get(row.id) ?? null,
      prompt: row.prompt
    }));
  }

  countShots(runId: number): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS total FROM shots s JOIN storyboard_scripts ss ON ss.id = s.storyboard_script_id WHERE ss.run_id = ?`
      )
      .get(runId) as unknown as { total: number };
    return row.total;
  }

  updateShot(runId: number, shotId: number, edit: ShotEdit, timestamp: string): boolean {
    const stored = this.storeFirstFrame(edit);
    let replacedPaths: string[] = [];
    try {
      const updated = runInTransaction(this.database, () => {
        const owned = this.database
          .prepare(
            `SELECT s.id FROM shots s JOIN storyboard_scripts ss ON ss.id = s.storyboard_script_id WHERE s.id = ? AND ss.run_id = ?`
          )
          .get(shotId, runId);
        if (owned === undefined) {
          return false;
        }
        this.database
          .prepare(
            `UPDATE shots SET scene_label = ?, shot_size = ?, camera_angle = ?, camera_movement = ?, duration_seconds = ?,
               transition = ?, continuity_note = ?, first_frame_mode = ?, first_frame_asset_id = ?, prompt = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            edit.sceneLabel,
            edit.shotSize,
            edit.cameraAngle,
            edit.cameraMovement,
            edit.durationSeconds,
            edit.transition,
            edit.continuityNote,
            edit.firstFrameMode,
            edit.firstFrameAssetId,
            edit.prompt,
            timestamp,
            shotId
          );
        this.database.prepare('DELETE FROM shot_entities WHERE shot_id = ?').run(shotId);
        this.database.prepare('DELETE FROM shot_sounds WHERE shot_id = ?').run(shotId);
        this.replaceRelations(shotId, edit.entityIds, edit.staging, edit.sounds);
        replacedPaths = this.applyFirstFrame(shotId, edit, stored, timestamp);
        return true;
      });
      // 被替换、删除的旧首帧图片（或因镜头不属于该记录而没有使用的新图片）不再有人引用时删除。
      removeUnreferencedFiles(this.database, this.files, [...replacedPaths, ...(updated || stored === undefined ? [] : [stored.filePath])]);
      return updated;
    } catch (error) {
      removeUnreferencedFiles(this.database, this.files, stored === undefined ? [] : [stored.filePath]);
      throw error;
    }
  }

  insertShot(runId: number, edit: ShotEdit, timestamp: string): number {
    const stored = this.storeFirstFrame(edit);
    try {
      return runInTransaction(this.database, () => {
        const script = this.find(runId);
        if (script === undefined) {
          throw new Error(`阶段记录 ${runId} 还没有分镜脚本。`);
        }
        const inserted = this.database
          .prepare(
            `INSERT INTO shots
               (storyboard_script_id, seq, scene_label, shot_size, camera_angle, camera_movement, duration_seconds,
                transition, continuity_note, first_frame_mode, first_frame_asset_id, prompt, created_at, updated_at)
             VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM shots WHERE storyboard_script_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            script.id,
            script.id,
            edit.sceneLabel,
            edit.shotSize,
            edit.cameraAngle,
            edit.cameraMovement,
            edit.durationSeconds,
            edit.transition,
            edit.continuityNote,
            edit.firstFrameMode,
            edit.firstFrameAssetId,
            edit.prompt,
            timestamp,
            timestamp
          );
        const shotId = Number(inserted.lastInsertRowid);
        this.replaceRelations(shotId, edit.entityIds, edit.staging, edit.sounds);
        this.applyFirstFrame(shotId, edit, stored, timestamp);
        return shotId;
      });
    } catch (error) {
      removeUnreferencedFiles(this.database, this.files, stored === undefined ? [] : [stored.filePath]);
      throw error;
    }
  }

  deleteShot(runId: number, shotId: number, timestamp: string): boolean {
    const deleted = runInTransaction(this.database, () => {
      const current = this.database
        .prepare(
          `SELECT s.seq, s.storyboard_script_id AS script_id FROM shots s JOIN storyboard_scripts ss ON ss.id = s.storyboard_script_id
           WHERE s.id = ? AND ss.run_id = ?`
        )
        .get(shotId, runId) as unknown as { seq: number; script_id: number } | undefined;
      if (current === undefined) {
        return false;
      }
      this.database.prepare('DELETE FROM shots WHERE id = ?').run(shotId);
      // 序号有唯一约束，先整体移出范围再前移，避免逐行更新时与未处理的行冲突。
      this.database
        .prepare('UPDATE shots SET seq = seq + ? WHERE storyboard_script_id = ? AND seq > ?')
        .run(SEQ_SHIFT, current.script_id, current.seq);
      this.database
        .prepare('UPDATE shots SET seq = seq - ? - 1 WHERE storyboard_script_id = ? AND seq > ?')
        .run(SEQ_SHIFT, current.script_id, SEQ_SHIFT);
      this.database
        .prepare(
          `UPDATE shots SET first_frame_mode = 'none', updated_at = ?
           WHERE storyboard_script_id = ? AND seq = 1 AND first_frame_mode = 'prev_tail'`
        )
        .run(timestamp, current.script_id);
      return true;
    });
    // 被删除镜头的首帧图片、尾帧文件不再有人引用。
    sweepUnreferencedFiles(this.database, this.files);
    return deleted;
  }

  swapShots(runId: number, shotId: number, otherShotId: number, timestamp: string): boolean {
    return runInTransaction(this.database, () => {
      const read = this.database.prepare(
        `SELECT s.seq, s.group_id, s.storyboard_script_id AS script_id FROM shots s JOIN storyboard_scripts ss ON ss.id = s.storyboard_script_id
         WHERE s.id = ? AND ss.run_id = ?`
      );
      type Slot = { seq: number; group_id: number | null; script_id: number };
      const first = read.get(shotId, runId) as unknown as Slot | undefined;
      const second = read.get(otherShotId, runId) as unknown as Slot | undefined;
      if (first === undefined || second === undefined) {
        return false;
      }
      // 序号有唯一约束，先把第一个移出范围，再互换。
      const update = this.database.prepare('UPDATE shots SET seq = ?, group_id = ?, updated_at = ? WHERE id = ?');
      update.run(SEQ_SHIFT, first.group_id, timestamp, shotId);
      update.run(first.seq, first.group_id, timestamp, otherShotId);
      update.run(second.seq, second.group_id, timestamp, shotId);
      this.database
        .prepare(
          `UPDATE shots SET first_frame_mode = 'none', updated_at = ?
           WHERE storyboard_script_id = ? AND seq = 1 AND first_frame_mode = 'prev_tail'`
        )
        .run(timestamp, first.script_id);
      return true;
    });
  }

  listGroups(runId: number): ShotGroup[] {
    const groupRows = this.database
      .prepare(
        `SELECT g.id, g.seq FROM shot_groups g JOIN storyboard_scripts ss ON ss.id = g.storyboard_script_id
         WHERE ss.run_id = ? ORDER BY g.seq`
      )
      .all(runId) as unknown as Array<{ id: number; seq: number }>;
    const shotRows = this.database
      .prepare(
        `SELECT s.id, s.group_id FROM shots s JOIN storyboard_scripts ss ON ss.id = s.storyboard_script_id
         WHERE ss.run_id = ? AND s.group_id IS NOT NULL ORDER BY s.seq`
      )
      .all(runId) as unknown as Array<{ id: number; group_id: number }>;
    return groupRows.map((group) => ({
      id: group.id,
      seq: group.seq,
      shotIds: shotRows.filter((shot) => shot.group_id === group.id).map((shot) => shot.id)
    }));
  }

  applyGroupLayout(runId: number, layout: readonly GroupLayoutEntry[], timestamp: string): void {
    runInTransaction(this.database, () => {
      const script = this.find(runId);
      if (script === undefined) {
        throw new Error(`阶段记录 ${runId} 还没有分镜脚本。`);
      }
      const existing = new Set(
        (this.database.prepare('SELECT id FROM shot_groups WHERE storyboard_script_id = ?').all(script.id) as unknown as Array<{ id: number }>).map(
          (row) => row.id
        )
      );
      const kept = new Set<number>();
      for (const entry of layout) {
        if (entry.groupId !== null) {
          if (!existing.has(entry.groupId)) {
            throw new Error(`镜头组 ${entry.groupId} 不属于阶段记录 ${runId}。`);
          }
          kept.add(entry.groupId);
        }
      }
      // 没有出现在布局里的组连同它的生成记录一起删除。
      for (const id of existing) {
        if (!kept.has(id)) {
          this.database.prepare('DELETE FROM shot_groups WHERE id = ?').run(id);
        }
      }
      // 序号有唯一约束，先整体移出范围，再按布局顺序重新编号。
      this.database.prepare('UPDATE shot_groups SET seq = seq + ? WHERE storyboard_script_id = ?').run(SEQ_SHIFT, script.id);
      this.database.prepare('UPDATE shots SET group_id = NULL WHERE storyboard_script_id = ?').run(script.id);
      layout.forEach((entry, index) => {
        let groupId = entry.groupId;
        if (groupId === null) {
          const inserted = this.database
            .prepare('INSERT INTO shot_groups (storyboard_script_id, seq, created_at) VALUES (?, ?, ?)')
            .run(script.id, index + 1, timestamp);
          groupId = Number(inserted.lastInsertRowid);
        } else {
          this.database.prepare('UPDATE shot_groups SET seq = ? WHERE id = ?').run(index + 1, groupId);
        }
        for (const shotId of entry.shotIds) {
          this.database.prepare('UPDATE shots SET group_id = ? WHERE id = ? AND storyboard_script_id = ?').run(groupId, shotId, script.id);
        }
      });
    });
    // 被删除的组连同生成记录一起删除，它们的尾帧文件不再有人引用。
    sweepUnreferencedFiles(this.database, this.files);
  }

  readFirstFrameImage(runId: number, shotId: number): NewShotFirstFrameImage | undefined {
    const row = this.database
      .prepare(
        `SELECT f.* FROM shot_first_frames f
         JOIN shots s ON s.id = f.shot_id JOIN storyboard_scripts ss ON ss.id = s.storyboard_script_id
         WHERE f.shot_id = ? AND ss.run_id = ?`
      )
      .get(shotId, runId) as unknown as FirstFrameRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    try {
      return { fileName: row.file_name, mime: row.mime, width: row.width, height: row.height, content: new Uint8Array(this.files.read(row.file_path)) };
    } catch {
      // 磁盘文件已丢失（如被外部删除），按没有图片处理，由调用方提示重新选择。
      return undefined;
    }
  }

  /** 先把新选择的首帧图片写入磁盘；没有新图片或首帧来源不是指定图片时返回 undefined。 */
  private storeFirstFrame(edit: ShotEdit): StoredFirstFrame | undefined {
    const image = edit.firstFrameMode === 'image' ? edit.firstFrameImage : undefined;
    if (image === undefined) {
      return undefined;
    }
    return {
      fileName: image.fileName,
      mime: image.mime,
      width: image.width,
      height: image.height,
      sizeBytes: image.content.length,
      filePath: this.files.write(Buffer.from(image.content), image.mime)
    };
  }

  /**
   * 在事务内按编辑结果更新镜头的首帧图片：换成新图片、保留已有的图片（首帧来源仍是指定图片且没选新图），或删除（换成其他首帧来源）。
   * @returns 被替换或删除的旧图片文件路径，供事务提交后清理。
   */
  private applyFirstFrame(shotId: number, edit: ShotEdit, stored: StoredFirstFrame | undefined, timestamp: string): string[] {
    if (edit.firstFrameMode === 'image' && stored === undefined) {
      return [];
    }
    const replaced = (this.database.prepare('SELECT file_path FROM shot_first_frames WHERE shot_id = ?').all(shotId) as unknown as Array<{ file_path: string }>).map(
      (row) => row.file_path
    );
    this.database.prepare('DELETE FROM shot_first_frames WHERE shot_id = ?').run(shotId);
    if (stored !== undefined) {
      this.database
        .prepare(
          `INSERT INTO shot_first_frames (shot_id, file_name, file_path, mime, width, height, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(shotId, stored.fileName, stored.filePath, stored.mime, stored.width, stored.height, stored.sizeBytes, timestamp);
    }
    return replaced;
  }

  /** 写入镜头的出场实体（含站位）与声音；调用前镜头下应没有旧记录。 */
  private replaceRelations(shotId: number, entityIds: readonly number[], staging: readonly ShotStaging[], sounds: readonly SoundDraft[]): void {
    const insertEntity = this.database.prepare(
      `INSERT INTO shot_entities (shot_id, entity_id, start_x, start_depth, end_x, end_depth, facing, action)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const stagingByEntity = new Map(staging.map((item) => [item.entityId, item]));
    for (const entityId of entityIds) {
      const item = stagingByEntity.get(entityId);
      insertEntity.run(shotId, entityId, item?.startX ?? null, item?.startDepth ?? null, item?.endX ?? null, item?.endDepth ?? null, item?.facing ?? null, item?.action ?? '');
    }
    const insertSound = this.database.prepare(
      `INSERT INTO shot_sounds
         (shot_id, seq, kind, speaker_entity_id, text, delivery, start_offset_seconds, duration_seconds, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    sounds.forEach((sound, index) => {
      insertSound.run(
        shotId,
        index + 1,
        sound.kind,
        sound.speakerEntityId,
        sound.text,
        sound.delivery,
        sound.startOffsetSeconds,
        sound.durationSeconds,
        sound.isEnabled ? 1 : 0
      );
    });
  }
}
