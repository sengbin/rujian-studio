// ------------------------------------------------------------------------
// 名称：stage-run-params.ts
// 说明：从阶段生成记录的输入快照中取出生成参数，创意、节拍表、剧本、分镜四个阶段共用。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：快照由各阶段启动时在校验通过后写入，这里只判断 params 是不是对象，不再逐字段校验，调用方按阶段指定参数类型。
// ------------------------------------------------------------------------

import { StageRun } from '../../domain/models/stage-run';

/**
 * 取出输入快照中的 params 对象，类型由调用方按阶段指定。
 * @param run 阶段生成记录。
 * @returns 快照中没有对象类型的 params 时为 null；对象内的字段不做校验。
 */
export function readRunParams<T>(run: StageRun): T | null {
  const params = (run.input as { params?: unknown }).params;
  return typeof params === 'object' && params !== null ? (params as T) : null;
}
