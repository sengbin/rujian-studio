// ------------------------------------------------------------------------
// 名称：production-profile.ts
// 说明：制作方案的领域模型：作品体量类型、节拍模板、制作方案（语速与镜头换算系数、校准默认值）。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：设计见 docs/production-profile-design.md 第 4.1 节；新增体量只需在注册表追加记录，不在工作流里写分支。
// ------------------------------------------------------------------------

/** 作品体量/制作方案类型；series、feature_film 目前只注册占位。 */
export type ProductionFormatType = 'short_video' | 'short_drama' | 'series' | 'feature_film';

/** 节拍模板中的单个节拍定义。 */
export interface BeatTemplateItem {
  readonly seq: number;
  /** 节拍名称，如“钩子”“冲突推进”。 */
  readonly label: string;
  /** 戏剧目的，写入提示词指导模型分配内容。 */
  readonly purpose: string;
  /** 占总时长的比例（0 到 1），同一模板内所有项之和为 1。 */
  readonly targetRatio: number;
}

/** 节拍模板：某种体量下的固定叙事结构。 */
export interface BeatTemplate {
  readonly id: string;
  readonly formatType: ProductionFormatType;
  readonly label: string;
  /** 一句话说明适用的内容类型与结构特点，显示在选择模板的字段说明里。 */
  readonly summary: string;
  /** 模板适用的单集目标时长范围（秒）。 */
  readonly minSeconds: number;
  readonly maxSeconds: number;
  /** 表单里的默认目标时长（秒）。 */
  readonly defaultSeconds: number;
  readonly items: readonly BeatTemplateItem[];
}

/** 制作方案：体量与默认节拍模板、语速与镜头换算系数、校准默认值。 */
export interface ProductionProfile {
  readonly formatType: ProductionFormatType;
  readonly label: string;
  /** 提示词里对该体量的说明。 */
  readonly promptDescription: string;
  /** 是否按剧情拆分为多集；false 时整部作品固定 1 集。 */
  readonly multiEpisode: boolean;
  /** 目标时长所指范围的称呼：多集为“单集”，单集为“全片”。 */
  readonly durationScopeLabel: string;
  /** 默认节拍模板；占位体量为 null。 */
  readonly beatTemplateId: string | null;
  /** 文稿字数换算系数（字/秒）。 */
  readonly wordsPerSecond: number;
  /** 建议的单镜头时长（秒），用于推导镜头数参考值。 */
  readonly avgShotSeconds: number;
  /** 校准容差，如 0.15 表示 ±15%。 */
  readonly toleranceRatio: number;
  /** 最大自动重写轮数。 */
  readonly maxCalibrationRounds: number;
  /** 当前是否已实现；占位体量为 false，界面显示但禁用。 */
  readonly supported: boolean;
}
