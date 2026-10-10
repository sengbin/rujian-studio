// ------------------------------------------------------------------------
// 名称：atomic-file.ts
// 说明：原子写文件：先写到同目录的临时文件，成功后改名为目标文件；写入失败时清理临时文件，已有的目标文件保持不变。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：同步版供配置、缓存与快照使用，异步版供流式下载使用；调用方负责先创建目标目录；临时文件后缀见 storage-file-types.ts。
// ------------------------------------------------------------------------

import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { PARTIAL_SUFFIX } from './storage-file-types';

/**
 * 由 produce 把内容写到临时文件，成功后改名为目标文件；失败时清理临时文件并抛出原错误。
 * @param filePath 目标文件的绝对路径。
 * @param produce 把内容写入给定临时路径的函数，写入前该路径上不存在旧的临时文件。
 */
export function replaceFileAtomically(filePath: string, produce: (partialPath: string) => void): void {
  const partialPath = `${filePath}${PARTIAL_SUFFIX}`;
  rmSync(partialPath, { force: true });
  try {
    produce(partialPath);
    renameSync(partialPath, filePath);
  } catch (error) {
    rmSync(partialPath, { force: true });
    throw error;
  }
}

/**
 * 把内容原子地写入文件。
 * @param filePath 目标文件的绝对路径。
 * @param content 文本（按 UTF-8 写入）或二进制内容。
 */
export function writeFileAtomically(filePath: string, content: string | Uint8Array): void {
  replaceFileAtomically(filePath, (partialPath) => writeFileSync(partialPath, content));
}

/**
 * 异步版 replaceFileAtomically：produce 可以把流写到临时文件。
 * @param filePath 目标文件的绝对路径。
 * @param produce 把内容写入给定临时路径的异步函数。
 */
export async function replaceFileAtomicallyAsync(filePath: string, produce: (partialPath: string) => Promise<void>): Promise<void> {
  const partialPath = `${filePath}${PARTIAL_SUFFIX}`;
  await rm(partialPath, { force: true });
  try {
    await produce(partialPath);
    await rename(partialPath, filePath);
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }
}
