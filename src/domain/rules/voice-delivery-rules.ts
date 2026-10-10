// ------------------------------------------------------------------------
// 名称：voice-delivery-rules.ts
// 说明：把分镜脚本里对白的说话方式（情绪、语气、音量、语速的文字描述）换算成语音模型的语音指令与语速、音量数值。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：数值范围与豆包语音一致（-50 到 100，0 为不调整，100 为 2 倍，-50 为 0.5 倍）；说话方式里既出现“快”又出现“慢”（或“轻”又“响”）时互相矛盾，不调整。
// ------------------------------------------------------------------------

/** 语速、音量的调整范围，与豆包语音的 speech_rate、loudness_rate 一致。 */
export const DELIVERY_RATE_MIN = -50;
/** 语速、音量调整值的上限。 */
export const DELIVERY_RATE_MAX = 100;

/** 语速、音量的默认调整幅度与程度词（很、特别等）下的幅度。 */
const SPEECH_STEP = 20;
const SPEECH_STEP_STRONG = 40;
const LOUDNESS_SOFT_STEP = -30;
const LOUDNESS_SOFT_STEP_STRONG = -45;
const LOUDNESS_LOUD_STEP = 35;
const LOUDNESS_LOUD_STEP_STRONG = 60;

/** 语速：明确说“语速……”或常见的快慢说法；程度词出现时幅度加大。 */
const FAST_SPEECH = /语速(?:偏|较|很|极|特别|非常|太)?(?:快|急)|急促|急切|飞快|连珠炮|快速|说得快|语速加快|越说越快/;
const SLOW_SPEECH = /语速(?:偏|较|很|极|特别|非常|太)?(?:慢|缓)|缓慢|慢条斯理|一字一顿|放慢|慢悠悠|舒缓|语速放慢|越说越慢|拖长/;
const STRONG_SPEECH = /很快|极快|飞快|特别|非常|极其|极慢|很慢|太快|太慢|连珠炮|一字一顿/;

/** 音量：轻声类与大声类。 */
const SOFT_VOICE = /悄悄话|耳语|低语|轻声|低声|压低声音|小声|嘟囔|喃喃|气声|细声|声音越说越小/;
const LOUD_VOICE = /大喊|大声|喊叫|呐喊|呼喊|高声|怒吼|吼|咆哮|嘶吼|尖叫|提高音量|嗓门大|洪亮/;
const STRONG_SOFT = /悄悄话|耳语|气声|极小声|很小声/;
const STRONG_LOUD = /大喊|怒吼|咆哮|嘶吼|尖叫|呐喊|吼/;

/** 语速、音量的调整值。 */
export interface DeliveryRates {
  /** 语速调整，0 表示不调整。 */
  readonly speechRate: number;
  /** 音量调整，0 表示不调整。 */
  readonly loudnessRate: number;
}

/** 把调整值限制在允许范围内。 */
function clampRate(value: number): number {
  return Math.min(DELIVERY_RATE_MAX, Math.max(DELIVERY_RATE_MIN, value));
}

/**
 * 从说话方式的文字里读出语速与音量的调整值。
 * @param delivery 说话方式，如“压低声音的悄悄话、语速偏慢、带着紧张”。
 * @returns 调整值；没有提到或互相矛盾的项为 0。
 */
export function readDeliveryRates(delivery: string): DeliveryRates {
  const text = delivery.trim();
  if (text === '') {
    return { speechRate: 0, loudnessRate: 0 };
  }
  const fast = FAST_SPEECH.test(text);
  const slow = SLOW_SPEECH.test(text);
  const strongSpeech = STRONG_SPEECH.test(text);
  let speechRate = 0;
  if (fast !== slow) {
    const step = strongSpeech ? SPEECH_STEP_STRONG : SPEECH_STEP;
    speechRate = fast ? step : -step;
  }
  const soft = SOFT_VOICE.test(text);
  const loud = LOUD_VOICE.test(text);
  let loudnessRate = 0;
  if (soft !== loud) {
    loudnessRate = soft ? (STRONG_SOFT.test(text) ? LOUDNESS_SOFT_STEP_STRONG : LOUDNESS_SOFT_STEP) : STRONG_LOUD.test(text) ? LOUDNESS_LOUD_STEP_STRONG : LOUDNESS_LOUD_STEP;
  }
  return { speechRate: clampRate(speechRate), loudnessRate: clampRate(loudnessRate) };
}

/**
 * 把说话方式写成对语音模型说的一句话（语音指令），让模型按它调整情绪、语气、语速与音量。
 * @param delivery 说话方式。
 * @returns 语音指令；说话方式为空时为 null。
 */
export function buildDeliveryInstruction(delivery: string): string | null {
  const text = delivery.trim();
  return text === '' ? null : `你可以用${text}的方式说话吗？`;
}
