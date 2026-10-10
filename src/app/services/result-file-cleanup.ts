// ------------------------------------------------------------------------
// 名称：result-file-cleanup.ts
// 说明：结果视频文件的清理：删除存储里已没有结果记录引用的视频文件。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：删除项目、作品、集、镜头组或重写分镜脚本时记录被级联删除，但视频文件不会随之消失，需要在删除之后、应用启动时清扫；下载中的临时文件不在列举范围内，不会被误删。
// ------------------------------------------------------------------------

import { GenerationRepository, ResultStore } from '../../domain/ports/generation-repository';

/** 清理依赖：读取结果记录引用的路径，列举并删除存储里的结果文件。 */
export interface ResultFileCleanupDependencies {
  readonly jobs: Pick<GenerationRepository, 'listResultFilePaths'>;
  readonly results: Pick<ResultStore, 'listFiles' | 'remove'>;
}

/**
 * 删除没有结果记录引用的视频文件。
 * @param dependencies 视频任务仓库与结果文件存储。
 * @returns 删除的文件数。
 * @throws Error 列举或删除文件失败。
 */
export async function sweepUnreferencedResults({ jobs, results }: ResultFileCleanupDependencies): Promise<number> {
  const stored = await results.listFiles();
  // 先列文件、后查记录：刚下载完的文件在记录写入前只隔着几个微任务，不会被这里的读取插入其中，所以不会把它当成无引用文件。
  const referenced = new Set(jobs.listResultFilePaths());
  let removed = 0;
  for (const filePath of stored) {
    if (!referenced.has(filePath)) {
      await results.remove(filePath);
      removed += 1;
    }
  }
  return removed;
}
