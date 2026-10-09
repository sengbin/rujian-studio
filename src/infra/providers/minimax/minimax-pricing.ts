// ------------------------------------------------------------------------
// 名称：minimax-pricing.ts
// 说明：MiniMax 模型的价格说明：按量付费的官网公开价，键为模型代码。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：数据抄自 MiniMax 开放平台“按量计费”文档，价格会调整，仅供参考，以官网为准；M3 标注的是输入 512k 以内的价格；M2.5、M2.1、M2 的价格与 M2.7 相同，极速版同 M2.7 极速版（官网历史模型表）；M3.1 Flash 预览只在 M Plan 中提供。
// ------------------------------------------------------------------------

/** M2 系列标准版与极速版的价格说明。 */
const M2_STANDARD_PRICE = '输入 2.10 / 输出 8.40 元/百万 token';
const M2_HIGHSPEED_PRICE = '输入 4.20 / 输出 16.80 元/百万 token';

/** 语音合成按字符计价。 */
const SPEECH_HD_PRICE = '3.50 元/万字符';
const SPEECH_TURBO_PRICE = '2.00 元/万字符';

/** MiniMax 模型代码与价格说明。 */
export const MINIMAX_MODEL_PRICES: Readonly<Record<string, string>> = {
  'MiniMax-M3.1-Flash-Preview': '仅 M Plan 订阅额度，无按量价格',
  'MiniMax-M3': '输入 2.10 / 输出 8.40 元/百万 token（输入 512k 以内）',
  'MiniMax-M2.7': M2_STANDARD_PRICE,
  'MiniMax-M2.7-highspeed': M2_HIGHSPEED_PRICE,
  'MiniMax-M2.5': M2_STANDARD_PRICE,
  'MiniMax-M2.5-highspeed': M2_HIGHSPEED_PRICE,
  'MiniMax-M2.1': M2_STANDARD_PRICE,
  'MiniMax-M2.1-highspeed': M2_HIGHSPEED_PRICE,
  'MiniMax-M2': M2_STANDARD_PRICE,
  'speech-2.8-hd': SPEECH_HD_PRICE,
  'speech-2.8-turbo': SPEECH_TURBO_PRICE,
  'speech-2.6-hd': SPEECH_HD_PRICE,
  'speech-2.6-turbo': SPEECH_TURBO_PRICE,
  'speech-02-hd': SPEECH_HD_PRICE,
  'speech-02-turbo': SPEECH_TURBO_PRICE,
  'image-01': '0.025 元/张',
  'image-01-live': '0.025 元/张',
  'MiniMax-H3': '768P 0.50 元/秒，2K 0.80 元/秒（5 张以内参考图免费）',
  'MiniMax-H3-Max': '480P 0.33 元/秒，768P 0.50 元/秒（2 张以内参考图免费）'
};
