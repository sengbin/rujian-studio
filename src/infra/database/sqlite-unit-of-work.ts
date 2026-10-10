// ------------------------------------------------------------------------
// 名称：sqlite-unit-of-work.ts
// 说明：SQLite 实现的工作单元：在同一个数据库连接上开启事务，供应用层把多步写入原子化。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：与各仓库方法内部的事务共用同一个可重入的事务函数，仓库方法嵌套在工作单元里时自动改用保存点。
// ------------------------------------------------------------------------

import type { DatabaseSync } from 'node:sqlite';
import { UnitOfWork } from '../../domain/ports/unit-of-work';
import { runInTransaction } from './transaction';

/** 基于 SQLite 连接的工作单元。 */
export class SqliteUnitOfWork implements UnitOfWork {
  constructor(private readonly database: DatabaseSync) {}

  runInTransaction<T>(work: () => T): T {
    return runInTransaction(this.database, work);
  }
}
