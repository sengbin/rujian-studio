// ------------------------------------------------------------------------
// 名称：generation-run.ts
// 说明：确定工作台对一集使用的分镜脚本版本：已确认采用的当前版本，没有时取最新版本（只读）。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：视图读取、提交管线、镜头组编辑共用；这一集还没有分镜脚本时报 NotFoundError。
// ------------------------------------------------------------------------

import { NotFoundError } from '../../domain/errors';
import { StageRun } from '../../domain/models/stage-run';
import { StageRunRepository } from '../../domain/ports/stage-run-repository';
import { readEntityId } from '../../domain/rules/field-readers';
import { storyboardTarget } from './storyboard-service';
import { WorkService } from './work-service';

/** 工作台使用的分镜脚本版本：已确认采用的当前版本，没有时取最新版本（只读）。 */
export interface WorkbenchRun {
  readonly run: StageRun;
  /** 是否为已确认采用的当前版本；只有当前版本才能生成。 */
  readonly isCurrent: boolean;
}

/**
 * 取得工作台使用的分镜脚本版本。
 * @throws NotFoundError 这一集还没有分镜脚本。
 */
export function resolveWorkbenchRun(runs: Pick<StageRunRepository, 'findCurrent' | 'listVersions'>, workId: number, episodeId: number): WorkbenchRun {
  const target = storyboardTarget(workId, episodeId);
  const current = runs.findCurrent(target);
  const run = current ?? runs.listVersions(target)[0];
  if (run === undefined) {
    throw new NotFoundError('这一集还没有分镜脚本。');
  }
  return { run, isCurrent: current !== undefined };
}

/**
 * 读取请求中的作品与集，返回对应的分镜脚本版本。
 * @param source 含 workId、episodeId 的请求内容。
 * @throws NotFoundError 作品不存在，或这一集还没有分镜脚本。
 */
export function resolveRequestedRun(works: Pick<WorkService, 'getWork'>, runs: Pick<StageRunRepository, 'findCurrent' | 'listVersions'>, source: Record<string, unknown>): WorkbenchRun {
  const workId = readEntityId({ id: source.workId }, '作品');
  const episodeId = readEntityId({ id: source.episodeId }, '集');
  works.getWork(workId);
  return resolveWorkbenchRun(runs, workId, episodeId);
}
