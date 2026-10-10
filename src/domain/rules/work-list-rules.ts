// ------------------------------------------------------------------------
// 名称：work-list-rules.ts
// 说明：作品列表页视图的规则：视图的种类（按素材来源，或跨来源的剧本、分镜脚本视图），以及作品在剧本视图、分镜脚本视图中是否列出。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯函数，不依赖存储；剧本视图只列创意已确认或已有剧本记录的作品，分镜脚本视图只列剧本已确认或已有分镜脚本记录的作品。
// ------------------------------------------------------------------------

import { WorkSourceType } from '../models/work';

/** 剧本视图的标识。 */
export const SCREENPLAY_VIEW = 'screenplay';

/** 分镜脚本视图的标识。 */
export const STORYBOARD_VIEW = 'storyboard';

/** 作品列表页的视图：某种素材来源的作品，或跨素材来源、以剧本或分镜脚本为中心的列表。 */
export type WorkListView = WorkSourceType | typeof SCREENPLAY_VIEW | typeof STORYBOARD_VIEW;

/**
 * 作品是否列在剧本视图：创意已确认（可以生成剧本），或已有剧本记录。
 * @param work 作品列表项中与剧本相关的状态。
 */
export function isListedInScreenplayView(work: { readonly canStartScreenplay: boolean; readonly screenplay: { readonly runId: number | null } }): boolean {
  return work.canStartScreenplay || work.screenplay.runId !== null;
}

/**
 * 作品是否列在分镜脚本视图：剧本已确认（可以开始生成），或已有分镜脚本记录。
 * @param summary 作品的分镜脚本汇总。
 */
export function isListedInStoryboardView(summary: { readonly canStart: boolean; readonly started: number }): boolean {
  return summary.canStart || summary.started > 0;
}
