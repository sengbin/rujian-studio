// ------------------------------------------------------------------------
// 名称：volcengine-pricing.ts
// 说明：火山方舟与豆包语音模型的价格说明：官网在线推理（后付费）公开价，键为模型代码。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：数据抄自火山方舟“模型价格”与豆包语音“计费说明”文档，价格会调整，仅供参考，以官网为准；文本阶梯价按输入长度分档，这里只写档位范围；Seedance 按 token 计价，视频总价与时长、分辨率有关；语音取按调用后付费单价，资源包更便宜。
// ------------------------------------------------------------------------

/** 火山方舟模型代码与价格说明。 */
export const VOLCENGINE_MODEL_PRICES: Readonly<Record<string, string>> = {
  'doubao-seed-2-1-pro-260915': '输入 6.00 / 输出 30.00 元/百万 token',
  'doubao-seed-2-1-lite-260915': '输入 0.80 / 输出 2.70 元/百万 token',
  'doubao-seed-2-1-turbo-260628': '输入 3.00 / 输出 15.00 元/百万 token',
  'doubao-seed-evolving': '输入 6.00 / 输出 30.00 元/百万 token',
  'doubao-seed-2-0-lite-260428': '输入 0.6~1.8 / 输出 3.6~10.8 元/百万 token（按输入长度分档）',
  'doubao-seed-2-0-mini-260428': '输入 0.2~0.8 / 输出 2.0~8.0 元/百万 token（按输入长度分档）',
  'doubao-seedream-5-0-pro-260628': '单图生成 0.30 元/张（1.5K 以内），更高分辨率 0.60 元/张',
  'doubao-seedream-5-0-flash-260915': '0.12 元/张',
  'doubao-seedream-5-0-260128': '0.22 元/张',
  'doubao-seedream-4-5-251128': '0.25 元/张',
  'doubao-seedance-2-5-260628': '480p/720p 70.00、1080p 77.00 元/百万 token（输入含视频更低）',
  'doubao-seedance-2-0-260128': '480p/720p 46.00、1080p 51.00 元/百万 token（输入含视频更低）',
  'doubao-seedance-2-0-fast-260128': '480p/720p 37.00 元/百万 token（输入含视频更低）',
  'doubao-seedance-2-0-mini-260615': '480p/720p 23.00 元/百万 token（输入含视频更低）'
};

/** 豆包语音模型代码与价格说明。 */
export const VOLCENGINE_SPEECH_MODEL_PRICES: Readonly<Record<string, string>> = {
  'doubao-seed-tts-2.0': '3 元/万字符（后付费；资源包最低 2.1 元/万字符）'
};
