// ------------------------------------------------------------------------
// 名称：local-voice-cache.ts
// 说明：台词配音本地缓存的实现：把模型合成的语音按内容键保存为扩展存储目录下的文件，超过条数或总大小上限时淘汰最久没用的。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：文件名为“键 + 扩展名”，键必须是 64 位十六进制哈希（不合法的键直接拒绝，不会越出目录）；读取时刷新修改时间，淘汰按修改时间从旧到新；先写临时文件再改名；缓存不在数据备份内，丢失后重新合成即可。
// ------------------------------------------------------------------------

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { VoiceCache, VoiceCacheEntry } from '../../domain/ports/voice-cache';

/** 缓存在扩展存储根目录下的子目录名。 */
export const VOICE_CACHE_DIRECTORY_NAME = 'voice-cache';

/** 默认保留的条数与总大小上限。 */
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

const KEY_PATTERN = /^[0-9a-f]{64}$/;
const PARTIAL_SUFFIX = '.part';

/** 支持保存的音频类型与扩展名。 */
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/mp4': '.m4a'
};

/** 缓存大小上限。 */
export interface LocalVoiceCacheLimits {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
}

/** 把语音保存在本地目录的缓存。 */
export class LocalVoiceCache implements VoiceCache {
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  /**
   * @param rootDirectory 缓存目录的绝对路径。
   * @param limits 条数与总大小上限，缺省为 500 条、1 GB。
   */
  constructor(
    private readonly rootDirectory: string,
    limits: LocalVoiceCacheLimits = {}
  ) {
    this.maxEntries = limits.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  get(key: string): VoiceCacheEntry | undefined {
    if (!KEY_PATTERN.test(key)) {
      return undefined;
    }
    for (const [mime, extension] of Object.entries(EXTENSION_BY_MIME)) {
      const filePath = path.join(this.rootDirectory, `${key}${extension}`);
      if (!existsSync(filePath)) {
        continue;
      }
      try {
        const content = readFileSync(filePath);
        const now = new Date();
        utimesSync(filePath, now, now);
        return { mime, content };
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  put(key: string, mime: string, content: Buffer): void {
    const extension = EXTENSION_BY_MIME[mime];
    if (!KEY_PATTERN.test(key) || extension === undefined) {
      throw new Error('不能缓存这条语音：键或类型不合法。');
    }
    mkdirSync(this.rootDirectory, { recursive: true });
    // 同一个键换了格式时，先清掉旧格式的文件，避免读到过期内容。
    for (const other of Object.values(EXTENSION_BY_MIME)) {
      if (other !== extension) {
        rmSync(path.join(this.rootDirectory, `${key}${other}`), { force: true });
      }
    }
    const filePath = path.join(this.rootDirectory, `${key}${extension}`);
    const partialPath = `${filePath}${PARTIAL_SUFFIX}`;
    try {
      writeFileSync(partialPath, content);
      renameSync(partialPath, filePath);
    } catch (error) {
      rmSync(partialPath, { force: true });
      throw error;
    }
    this.prune();
  }

  /** 超过条数或总大小上限时，按修改时间从旧到新删除，直到不再超限。 */
  private prune(): void {
    const files = readdirSync(this.rootDirectory)
      .filter((name) => !name.endsWith(PARTIAL_SUFFIX))
      .map((name) => {
        const stats = statSync(path.join(this.rootDirectory, name));
        return { name, size: stats.size, modified: stats.mtimeMs };
      })
      .sort((a, b) => a.modified - b.modified);
    let count = files.length;
    let bytes = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files) {
      if (count <= this.maxEntries && bytes <= this.maxBytes) {
        return;
      }
      rmSync(path.join(this.rootDirectory, file.name), { force: true });
      count -= 1;
      bytes -= file.size;
    }
  }
}
