// ------------------------------------------------------------------------
// 名称：sync-result-store.ts
// 说明：同步生成接口的结果暂存：接口在提交时直接返回完整结果，适配器把结果暂存在内存里，以短的任务编号交给队列，之后的查询凭编号取回。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：任务编号会写进数据库，不能把音频等大内容编码进去；暂存只在本次运行有效，应用重启后查不到，由查询方报错，用户重新生成；容量有限，超出时丢弃最早的，容量应不小于队列的并发上限。
// ------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

/** 任务编号前缀，区别于平台返回的真实任务编号。 */
const SYNC_JOB_ID_PREFIX = 'sync-';

/** 按任务编号暂存同步生成结果的有限容量存储。 */
export class SyncResultStore<T> {
  private readonly items = new Map<string, T>();

  /**
   * @param capacity 最多暂存的结果数；超过时丢弃最早的。
   */
  constructor(private readonly capacity: number) {}

  /**
   * 暂存一个结果。
   * @param result 要暂存的同步生成结果。
   * @returns 用于之后取回的短任务编号。
   */
  put(result: T): string {
    const id = `${SYNC_JOB_ID_PREFIX}${randomUUID()}`;
    this.items.set(id, result);
    while (this.items.size > this.capacity) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.items.delete(oldest);
    }
    return id;
  }

  /**
   * 按任务编号取回结果；不存在（编号未知，或已被丢弃、应用已重启）返回 undefined。
   * @param id 任务编号。
   */
  find(id: string): T | undefined {
    return this.items.get(id);
  }
}
