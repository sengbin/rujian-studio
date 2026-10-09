// ------------------------------------------------------------------------
// 名称：json-file.ts
// 说明：JSON 文件的读写：读取为对象（缺失或损坏按空对象处理），写入时先写临时文件再改名。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：设置文件与密钥文件共用；同步读写，调用方在单线程内完成“读—改—写”不会交错。
// ------------------------------------------------------------------------

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * 读取 JSON 文件中的顶层对象。
 * @param filePath 文件的绝对路径。
 * @returns 顶层对象的副本；文件不存在、内容损坏或顶层不是对象时返回空对象。
 */
export function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>) } : {};
  } catch {
    return {};
  }
}

/**
 * 把对象写入 JSON 文件；先写临时文件再改名，避免留下写了一半的文件，必要时创建目录。
 * @param filePath 文件的绝对路径。
 * @param content 要写入的对象。
 */
export function writeJsonObject(filePath: string, content: Record<string, unknown>): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(content, null, 2), 'utf8');
  renameSync(temporaryPath, filePath);
}
