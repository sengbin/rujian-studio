// ------------------------------------------------------------------------
// 名称：approved-beat-sheet.ts
// 说明：读取作品当前已确认的节拍表：创意、剧本、分镜阶段在启动生成时把它作为参考基准保存进输入快照。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：只读；没有已确认的版本或版本还没有产出时返回 undefined，此时下游阶段保持原有行为。
// ------------------------------------------------------------------------

import { BeatSheet } from '../../domain/models/beat-sheet';
import { BeatSheetRepository } from '../../domain/ports/beat-sheet-repository';
import { StageRunRepository } from '../../domain/ports/stage-run-repository';

/** 读取作品已确认节拍表的函数。 */
export type ApprovedBeatSheetReader = (workId: number) => BeatSheet | undefined;

/**
 * 创建已确认节拍表的读取函数。
 * @param runs 阶段记录仓库，用于找到当前已确认的节拍表版本。
 * @param beatSheets 节拍表仓库。
 */
export function createApprovedBeatSheetReader(runs: StageRunRepository, beatSheets: BeatSheetRepository): ApprovedBeatSheetReader {
  return (workId) => {
    const current = runs.findCurrent({ workId, stage: 'beat_sheet', episodeId: null });
    return current === undefined ? undefined : beatSheets.find(current.id);
  };
}
