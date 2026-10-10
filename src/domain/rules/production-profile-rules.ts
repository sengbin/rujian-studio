// ------------------------------------------------------------------------
// 名称：production-profile-rules.ts
// 说明：制作方案注册表：作品体量（制作方案）与节拍模板的内置定义和查询。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：设计见 private-docs/rujian-studio/开发文档-vscode/production-profile-design.md 第 5、11、15 节；新增体量只需在这里追加记录；电视剧、电影只占位（supported 为 false，没有节拍模板）。
// ------------------------------------------------------------------------

import { BeatTemplate, ProductionFormatType, ProductionProfile } from '../models/production-profile';
import { BEAT_TEMPLATES, DEFAULT_SHORT_DRAMA_TEMPLATE_ID, DEFAULT_SHORT_VIDEO_TEMPLATE_ID } from './beat-template-registry';
import { DEFAULT_MAX_CALIBRATION_ROUNDS, DEFAULT_TOLERANCE_RATIO } from './timing-calibration-rules';

/** 全部节拍模板，定义见 beat-template-registry.ts。 */
export { BEAT_TEMPLATES };

/** 体量特有的属性；换算系数与校准默认值各体量共用。 */
type ProfileTraits = Pick<ProductionProfile, 'label' | 'promptDescription' | 'multiEpisode' | 'durationScopeLabel'>;

/** 创建制作方案。 */
function createProfile(formatType: ProductionFormatType, traits: ProfileTraits, beatTemplateId: string | null): ProductionProfile {
  return {
    formatType,
    ...traits,
    beatTemplateId,
    wordsPerSecond: 4,
    avgShotSeconds: 5,
    toleranceRatio: DEFAULT_TOLERANCE_RATIO,
    maxCalibrationRounds: DEFAULT_MAX_CALIBRATION_ROUNDS,
    supported: beatTemplateId !== null
  };
}

/** 全部制作方案，顺序即界面选项顺序。 */
export const PRODUCTION_PROFILES: readonly ProductionProfile[] = [
  createProfile(
    'short_video',
    { label: '单个短视频', promptDescription: '单个短视频（只有 1 集）', multiEpisode: false, durationScopeLabel: '全片' },
    DEFAULT_SHORT_VIDEO_TEMPLATE_ID
  ),
  createProfile(
    'short_drama',
    { label: '多集短片', promptDescription: '多集短片（按剧情拆分为多集）', multiEpisode: true, durationScopeLabel: '单集' },
    DEFAULT_SHORT_DRAMA_TEMPLATE_ID
  ),
  createProfile('series', { label: '电视剧', promptDescription: '电视剧', multiEpisode: true, durationScopeLabel: '单集' }, null),
  createProfile('feature_film', { label: '电影/长片', promptDescription: '电影/长片', multiEpisode: false, durationScopeLabel: '全片' }, null)
];

/** 占位体量在界面选项上的后缀。 */
export const UNSUPPORTED_FORMAT_SUFFIX = '（即将推出）';

/**
 * 按体量取制作方案。
 * @throws Error 体量未注册。
 */
export function getProductionProfile(formatType: ProductionFormatType): ProductionProfile {
  const profile = PRODUCTION_PROFILES.find((candidate) => candidate.formatType === formatType);
  if (profile === undefined) {
    throw new Error(`未注册的作品体量：${formatType}。`);
  }
  return profile;
}

/** 体量是否按剧情拆分为多集。 */
export function isMultiEpisode(formatType: ProductionFormatType): boolean {
  return getProductionProfile(formatType).multiEpisode;
}

/** 已实现的体量，界面可选。 */
export function listSupportedFormats(): ProductionProfile[] {
  return PRODUCTION_PROFILES.filter((profile) => profile.supported);
}

/** 按标识取节拍模板；不存在时返回 undefined。 */
export function findBeatTemplate(id: string): BeatTemplate | undefined {
  return BEAT_TEMPLATES.find((template) => template.id === id);
}

/**
 * 按标识取节拍模板。
 * @throws Error 模板未注册。
 */
export function getBeatTemplate(id: string): BeatTemplate {
  const template = findBeatTemplate(id);
  if (template === undefined) {
    throw new Error(`未注册的节拍模板：${id}。`);
  }
  return template;
}

/** 某种体量可用的节拍模板。 */
export function listBeatTemplates(formatType: ProductionFormatType): BeatTemplate[] {
  return BEAT_TEMPLATES.filter((template) => template.formatType === formatType);
}
