// ------------------------------------------------------------------------
// 名称：local-result-store.ts
// 说明：结果文件存储的本地实现：把服务商返回的临时地址下载到数据目录，路径由项目、作品、集、镜头组和任务标识决定。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：路径只由整数标识拼成，不含外部输入，公开的 resolvePath 仍会校验结果位于存储根目录内；只允许 https 地址；先写临时文件再改名，避免留下写了一半的文件；fetch 可注入以便测试。
// ------------------------------------------------------------------------

import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { GroupLocation } from '../../domain/models/generation';
import { ResultStore, SavedResultFile } from '../../domain/ports/generation-repository';
import { RESULT_VIDEO_MAX_BYTES } from '../../domain/rules/tail-frame-rules';
import { replaceFileAtomicallyAsync } from './atomic-file';
import { resolveInsideRoot } from './relative-path';
import { PARTIAL_SUFFIX } from './storage-file-types';

/** 结果视频在存储根目录下的子目录名；数据备份页据此告知用户这些文件不在数据库备份内。 */
export const RESULT_VIDEO_DIRECTORY_NAME = 'videos';

/** 把结果视频保存在本地目录的存储。 */
export class LocalResultStore implements ResultStore {
  /**
   * @param rootDirectory 存储根目录的绝对路径。
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   */
  constructor(
    private readonly rootDirectory: string,
    private readonly fetchFunction: typeof fetch = fetch
  ) {}

  async save(location: GroupLocation, groupId: number, jobId: number, url: string, signal?: AbortSignal): Promise<SavedResultFile> {
    if (!url.startsWith('https://')) {
      throw new Error('结果地址必须是 https 地址。');
    }
    const filePath = `${RESULT_VIDEO_DIRECTORY_NAME}/${location.projectId}/${location.workId}/${location.episodeId}/${groupId}-${jobId}.mp4`;
    const absolutePath = this.resolvePath(filePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });

    const response = await this.fetchFunction(url, { signal });
    if (!response.ok || response.body === null) {
      throw new Error(`下载结果视频失败（HTTP ${response.status}）。`);
    }
    let sizeBytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.length;
        callback(sizeBytes > RESULT_VIDEO_MAX_BYTES ? new Error('结果视频超过大小上限。') : null, chunk);
      }
    });
    await replaceFileAtomicallyAsync(absolutePath, (partialPath) =>
      pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream), counter, createWriteStream(partialPath))
    );
    return { filePath, sizeBytes };
  }

  /**
   * 把保存时返回的相对路径解析为存储根目录下的绝对路径。
   * @param filePath 相对存储根目录、使用 `/` 分隔的路径。
   * @throws Error 路径是绝对路径，或解析后不在存储根目录之内（含 `..` 越界、指向根目录本身）。
   */
  resolvePath(filePath: string): string {
    return resolveInsideRoot(this.rootDirectory, filePath);
  }

  async listFiles(): Promise<string[]> {
    const files: string[] = [];
    await collectFiles(this.resolvePath(RESULT_VIDEO_DIRECTORY_NAME), RESULT_VIDEO_DIRECTORY_NAME, files);
    return files;
  }

  async remove(filePath: string): Promise<void> {
    await rm(this.resolvePath(filePath), { force: true });
  }
}

/** 递归收集目录下的文件（相对存储根目录的路径），跳过下载中的临时文件；目录不存在时什么都不收集。 */
async function collectFiles(directory: string, relativeDirectory: string, files: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectFiles(path.join(directory, entry.name), relativePath, files);
    } else if (!entry.name.endsWith(PARTIAL_SUFFIX)) {
      files.push(relativePath);
    }
  }
}
