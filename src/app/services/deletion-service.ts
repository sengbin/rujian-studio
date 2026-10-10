// ------------------------------------------------------------------------
// 名称：deletion-service.ts
// 说明：作品与项目的删除编排：先取消并等待它们名下仍在进行的后台生成（阶段生成、视频任务），再删除数据。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：不先停掉后台任务就删数据，会让任务向已删除的记录写入，或让平台上的视频任务无人跟踪继续计费；资产不属于项目，不在此处理。
// ------------------------------------------------------------------------

import { NotFoundError } from '../../domain/errors';
import { GenerationRepository } from '../../domain/ports/generation-repository';
import { JobScheduler } from '../queue/job-queue';
import { ProjectService } from './project-service';
import { ResultFileCleanupDependencies, sweepUnreferencedResults } from './result-file-cleanup';
import { StageService } from './stage-service';
import { WorkService } from './work-service';

/** 删除编排的依赖。 */
export interface DeletionServiceDependencies {
  readonly projects: Pick<ProjectService, 'getProject' | 'deleteProject'>;
  readonly works: Pick<WorkService, 'getWork' | 'listWorks' | 'deleteWork'>;
  readonly stages: Pick<StageService, 'cancelRunningForWork'>;
  readonly jobs: Pick<GenerationRepository, 'listJobsByStatus' | 'getGroupLocation'> & ResultFileCleanupDependencies['jobs'];
  readonly results: ResultFileCleanupDependencies['results'];
  readonly scheduler: Pick<JobScheduler, 'cancel'>;
}

/** 删除作品与项目：先停掉后台任务，再删数据。 */
export class DeletionService {
  constructor(private readonly dependencies: DeletionServiceDependencies) {}

  /**
   * 取消作品名下进行中的生成并等待结束，然后删除作品及其下全部内容。
   * @throws NotFoundError 作品不存在。
   */
  async deleteWork(workId: number): Promise<void> {
    const { works } = this.dependencies;
    works.getWork(workId);
    await this.stopWorkTasks(workId);
    works.deleteWork(workId);
    await this.removeOrphanVideos();
  }

  /**
   * 取消项目下全部作品进行中的生成并等待结束，然后删除项目及其下全部内容。
   * @throws NotFoundError 项目不存在。
   */
  async deleteProject(projectId: number): Promise<void> {
    const { projects, works } = this.dependencies;
    projects.getProject(projectId);
    for (const work of works.listWorks(projectId)) {
      await this.stopWorkTasks(work.id);
    }
    projects.deleteProject(projectId);
    await this.removeOrphanVideos();
  }

  /** 删除记录之后清扫已无记录引用的视频文件；清扫失败不影响已完成的删除，下次启动会再清扫。 */
  private async removeOrphanVideos(): Promise<void> {
    try {
      await sweepUnreferencedResults(this.dependencies);
    } catch (error) {
      console.error('删除后清理视频文件失败：', error);
    }
  }

  /** 停掉作品的阶段生成与视频任务；视频任务通知平台取消失败时只记录，不阻止删除。 */
  private async stopWorkTasks(workId: number): Promise<void> {
    const { stages, jobs, scheduler } = this.dependencies;
    await stages.cancelRunningForWork(workId);
    const active = jobs.listJobsByStatus(['waiting', 'queued', 'running']).filter((job) => jobs.getGroupLocation(job.groupId)?.workId === workId);
    for (const job of active) {
      try {
        const result = await scheduler.cancel(job.id);
        if (result.remoteCancelError !== undefined) {
          console.error(`删除作品 ${workId} 时，取消平台上的视频任务（任务 ${job.id}）失败，平台上的任务可能仍会计费：${result.remoteCancelError}`);
        }
      } catch (error) {
        // 任务在取消前已经结束，无需再处理；其他错误照常抛出。
        if (!(error instanceof NotFoundError)) {
          throw error;
        }
      }
    }
  }
}
