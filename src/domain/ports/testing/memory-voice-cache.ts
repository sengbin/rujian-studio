// ------------------------------------------------------------------------
// 名称：memory-voice-cache.ts
// 说明：台词配音本地缓存的内存实现，供测试使用。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：只在测试里使用；暴露 entries 便于断言保存了什么。
// ------------------------------------------------------------------------

import { VoiceCache, VoiceCacheEntry } from '../voice-cache';

/** 把语音放在内存里的缓存。 */
export class MemoryVoiceCache implements VoiceCache {
  readonly entries = new Map<string, VoiceCacheEntry>();

  get(key: string): VoiceCacheEntry | undefined {
    return this.entries.get(key);
  }

  put(key: string, mime: string, content: Buffer): void {
    this.entries.set(key, { mime, content });
  }
}
