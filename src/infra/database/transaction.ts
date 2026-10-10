// ------------------------------------------------------------------------
// 名称：transaction.ts
// 说明：事务辅助函数：在一个事务中执行操作，成功提交，失败回滚；可重入，嵌套调用时内层用保存点，内层失败只回滚内层。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：迁移执行器、需要原子写入的仓库与应用层的工作单元共用；操作必须是同步的，不能在事务中等待异步结果。
// ------------------------------------------------------------------------

import type { DatabaseSync } from 'node:sqlite';

/** 各连接当前的事务嵌套深度；SQLite 同一连接上只有一个事务，嵌套的用保存点。 */
const transactionDepths = new WeakMap<DatabaseSync, number>();

/**
 * 在一个事务中执行操作：成功则提交，抛出异常则回滚并重新抛出。
 * 已在事务中时改用保存点：内层成功并入外层，内层失败只撤销内层的写入。
 * @param database 数据库连接。
 * @param operation 需要原子执行的同步操作。
 */
export function runInTransaction<T>(database: DatabaseSync, operation: () => T): T {
  const depth = transactionDepths.get(database) ?? 0;
  const savepoint = `rujian_savepoint_${depth}`;
  database.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
  transactionDepths.set(database, depth + 1);
  try {
    const result = operation();
    database.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    database.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    throw error;
  } finally {
    transactionDepths.set(database, depth);
  }
}
