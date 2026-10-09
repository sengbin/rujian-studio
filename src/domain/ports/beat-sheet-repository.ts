// ------------------------------------------------------------------------
// 名称：beat-sheet-repository.ts
// 说明：节拍表数据访问的端口接口：节拍表阶段保存生成的节拍表，确认前后编辑节拍的剧情内容。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：同步调用；节拍表挂在阶段记录下，随阶段记录一并删除。
// ------------------------------------------------------------------------

import { BeatDraft, BeatSheet, BeatSheetParams } from '../models/beat-sheet';

/** 节拍表的数据访问接口。 */
export interface BeatSheetRepository {
  /** 读取阶段记录的节拍表；还没有生成时返回 undefined。 */
  find(runId: number): BeatSheet | undefined;
  /** 保存生成的节拍表；已存在时整体覆盖。 */
  save(runId: number, params: BeatSheetParams, beats: readonly BeatDraft[], timestamp: string): void;
  /** 修改一个节拍的剧情内容；节拍不存在时返回 false。 */
  updateSynopsis(runId: number, seq: number, synopsis: string, timestamp: string): boolean;
}
