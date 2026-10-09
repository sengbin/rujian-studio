// ------------------------------------------------------------------------
// 名称：local-asset-file-store.ts
// 说明：本地文件存储的实现：把资产图片与音频、作品素材、镜头首帧、尾帧保存在扩展存储目录下，路径由内容的 SHA-256 决定，相同内容只保存一份。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：路径形如 `ab/ab12….png`（前两位十六进制作子目录，避免单个目录文件过多）；先写临时文件再改名，避免留下写了一半的文件；所有读写都经过 resolveInsideRoot 校验，路径不会越出根目录。
// ------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { AssetFileStore } from '../../domain/ports/asset-file-store';
import { resolveInsideRoot } from './relative-path';

/** 本地文件在存储根目录下的子目录名；数据备份页据此告知用户这些文件不在数据库备份内。 */
export const ASSET_FILE_DIRECTORY_NAME = 'asset-files';

/** 写入中的临时文件后缀。 */
const PARTIAL_SUFFIX = '.part';

/** 各文件类型的扩展名：资产与首帧、尾帧的图片和音频，以及小说、原创文稿的文本。 */
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/mp4': '.m4a',
  'text/plain': '.txt',
  'text/markdown': '.md'
};

/** 子目录取哈希的前几位。 */
const SHARD_LENGTH = 2;

/** 把资产文件保存在本地目录的存储。 */
export class LocalAssetFileStore implements AssetFileStore {
  /**
   * @param rootDirectory 资产文件根目录的绝对路径。
   */
  constructor(private readonly rootDirectory: string) {}

  write(content: Buffer, mime: string): string {
    const extension = EXTENSION_BY_MIME[mime];
    if (extension === undefined) {
      throw new Error(`不支持保存这种文件类型：${mime}。`);
    }
    const hash = createHash('sha256').update(content).digest('hex');
    const filePath = `${hash.slice(0, SHARD_LENGTH)}/${hash}${extension}`;
    const absolutePath = resolveInsideRoot(this.rootDirectory, filePath);
    // 同样内容已经保存过就直接复用，路径即内容的指纹。
    if (existsSync(absolutePath)) {
      return filePath;
    }
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    const partialPath = `${absolutePath}${PARTIAL_SUFFIX}`;
    try {
      writeFileSync(partialPath, content);
      renameSync(partialPath, absolutePath);
    } catch (error) {
      rmSync(partialPath, { force: true });
      throw error;
    }
    return filePath;
  }

  read(filePath: string): Buffer {
    return readFileSync(resolveInsideRoot(this.rootDirectory, filePath));
  }

  remove(filePath: string): void {
    rmSync(resolveInsideRoot(this.rootDirectory, filePath), { force: true });
  }

  list(): string[] {
    if (!existsSync(this.rootDirectory)) {
      return [];
    }
    // 文件按哈希前缀分在一层子目录下；临时文件和不在子目录里的杂项不属于存储内容。
    return readdirSync(this.rootDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((directory) =>
        readdirSync(path.join(this.rootDirectory, directory.name), { withFileTypes: true })
          .filter((entry) => entry.isFile() && !entry.name.endsWith(PARTIAL_SUFFIX))
          .map((entry) => `${directory.name}/${entry.name}`)
      );
  }
}
