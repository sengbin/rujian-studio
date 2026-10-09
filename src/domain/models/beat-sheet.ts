// ------------------------------------------------------------------------
// 名称：beat-sheet.ts
// 说明：节拍表的领域模型：生成参数、单个节拍（程序计算的参考预算加模型分配的剧情内容）和节拍表。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：设计见 private-docs/rujian-studio/开发文档-vscode/production-profile-design.md 第 4.2 节；对应 beat_sheets、beat_items 表；预算只是参考基准，不是硬约束。
// ------------------------------------------------------------------------

import { ProductionFormatType } from './production-profile';

/** 节拍表的生成参数，已经过规范化。 */
export interface BeatSheetParams {
  readonly formatType: ProductionFormatType;
  readonly beatTemplateId: string;
  /** 单集（单条）目标时长（秒）。 */
  readonly targetDurationSeconds: number;
  /** 短视频固定为 1；短剧为用户填写的集数参考值。 */
  readonly episodeCount: number;
  /** 文稿字数换算系数（字/秒）。 */
  readonly wordsPerSecond: number;
  /** 校准容差。 */
  readonly toleranceRatio: number;
  /** 最大自动重写轮数。 */
  readonly maxCalibrationRounds: number;
  /** 文字灵感作品的创作主题或灵感；其他素材来源为 null。 */
  readonly idea: string | null;
  readonly extra: string | null;
}

/** 模型为一个节拍分配的内容。 */
export interface BeatAssignment {
  readonly seq: number;
  /** 本节拍对应的具体剧情内容梗概。 */
  readonly synopsis: string;
  /** 小说来源时依据的原文分段序号；其他素材为空数组。 */
  readonly sourceRefs: readonly number[];
}

/** 单个节拍：参考预算由程序计算，剧情内容由模型生成。 */
export interface BeatDraft extends BeatAssignment {
  readonly label: string;
  readonly purpose: string;
  readonly targetRatio: number;
  /** 参考时长（秒），各节拍四舍五入后总和等于目标时长；不要求内容精确等于它。 */
  readonly estimatedSeconds: number;
  /** 参考字数，各节拍总和等于目标时长乘语速。 */
  readonly estimatedWords: number;
}

/** 节拍表。 */
export interface BeatSheet {
  readonly runId: number;
  readonly params: BeatSheetParams;
  readonly beats: readonly BeatDraft[];
  readonly updatedAt: string;
}
