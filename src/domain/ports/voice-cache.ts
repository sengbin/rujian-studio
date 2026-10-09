// ------------------------------------------------------------------------
// 名称：voice-cache.ts
// 说明：台词配音的本地缓存端口：把模型合成的语音按内容键保存到本地，下次打开分镜动画时直接取用，不再重新调用模型。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：同步调用；键是调用方算出的十六进制哈希（模型、提示词、音色、语言、说话方式、参考音频内容），内容变化键就变化；缓存只是为了省钱，丢了不影响正确性；实现位于 infra/storage/local-voice-cache.ts。
// ------------------------------------------------------------------------

/** 一条缓存的语音。 */
export interface VoiceCacheEntry {
  /** 音频的 MIME 类型。 */
  readonly mime: string;
  /** 音频内容。 */
  readonly content: Buffer;
}

/** 台词配音的本地缓存。 */
export interface VoiceCache {
  /**
   * 按键读取；不存在或读取失败时返回 undefined。
   * @param key 十六进制哈希键。
   */
  get(key: string): VoiceCacheEntry | undefined;

  /**
   * 保存一条语音，同一个键已有内容时替换；写入失败时抛出错误。
   * @param key 十六进制哈希键。
   * @param mime 音频的 MIME 类型。
   * @param content 音频内容。
   */
  put(key: string, mime: string, content: Buffer): void;
}
