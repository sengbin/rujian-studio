// ------------------------------------------------------------------------
// 名称：adaptation-checklist.ts
// 说明：结构性改编清单的领域模型：模型分析出的可取舍项（支线、人物合并、场次跳过等）和用户的勾选状态。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：设计见 private-docs/rujian-studio/开发文档/production-profile-design.md 第 4.3 节；对应 adaptation_checklists、adaptation_options 表；勾选只触发本地重算，不调用模型。
// ------------------------------------------------------------------------

/** 取舍项类型：支线、人物合并、场次跳过、其他。 */
export type AdaptationOptionKind = 'subplot' | 'character_merge' | 'scene_skip' | 'other';

/** 一条取舍建议：由模型分析得出，供用户勾选确认。 */
export interface AdaptationOption {
  readonly id: string;
  readonly kind: AdaptationOptionKind;
  /** 简述，如“配角 A 感情线”。 */
  readonly label: string;
  /** 模型给出的取舍理由。 */
  readonly reason: string;
  /** 关联的章节、场景或人物标识，供界面定位。 */
  readonly affectedRefs: readonly string[];
  /** 模型按原文该部分篇幅估算的节省字数。 */
  readonly estimatedWordsSaved: number;
  /** 节省的秒数，由程序按语速换算。 */
  readonly estimatedSecondsSaved: number;
  /** 模型建议的默认勾选状态。 */
  readonly recommended: boolean;
  /** 用户当前的勾选状态，初始等于 recommended。 */
  readonly selected: boolean;
}

/** 结构性改编清单。 */
export interface AdaptationChecklist {
  readonly runId: number;
  /** 改编前已确认章节的全文字数，程序统计。 */
  readonly baselineWords: number;
  readonly baselineSeconds: number;
  /** 目标时长（秒），来自已确认的节拍表。 */
  readonly targetSeconds: number;
  /** 换算用的语速（字/秒）。 */
  readonly wordsPerSecond: number;
  readonly toleranceRatio: number;
  readonly options: readonly AdaptationOption[];
  /** 用户确认采用的时间；未确认为 null，确认后才能生成剧本正文。 */
  readonly confirmedAt: string | null;
  readonly updatedAt: string;
}
