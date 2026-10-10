// ------------------------------------------------------------------------
// 名称：generation-results.ts
// 说明：任务结果的读取与使用：切换镜头组采用的结果版本、定位结果视频文件与导出文件名、生成任务完成后的通知内容。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：切换采用的版本只通知界面刷新，不弹任务完成的通知；任务所属的作品、集、组序号任何一项找不到（如作品已删除）时，通知退回通用说法、导出文件名退回“视频-结果标识”。
// ------------------------------------------------------------------------

import { NotFoundError } from '../../domain/errors';
import { VideoJobRecord } from '../../domain/models/generation';
import { GenerationRepository, ResultStore } from '../../domain/ports/generation-repository';
import { StoryboardRepository } from '../../domain/ports/storyboard-repository';
import { readEntityId, readRecord } from '../../domain/rules/field-readers';
import { describeJobFailure } from '../../domain/rules/generation-failure-copy';
import { JobChange } from '../queue/job-queue';
import { ChangeNotifier } from './change-notifier';
import { StoryboardService } from './storyboard-service';
import { WorkService } from './work-service';

/** 失败通知里最多引用平台原文的字数，完整原文在工作台查看。 */
const FAILURE_NOTICE_LENGTH = 100;

/** 任务完成后给用户的通知内容。 */
export interface FinishedJobNotice {
  readonly status: 'succeeded' | 'failed';
  readonly level: 'info' | 'warning';
  readonly message: string;
}

/** 任务所属的作品名、集序号与镜头组序号。 */
interface JobPlace {
  readonly workName: string;
  readonly episodeSeq: number;
  readonly groupSeq: number;
}

/** 任务结果的依赖。 */
export interface GenerationResultsDependencies {
  readonly works: Pick<WorkService, 'getWork'>;
  readonly storyboardService: Pick<StoryboardService, 'listEpisodeStatuses'>;
  readonly storyboards: StoryboardRepository;
  readonly jobs: GenerationRepository;
  readonly results: ResultStore;
  readonly changes: ChangeNotifier<JobChange>;
}

/** 把文字转成可用作文件名的形式：去掉 Windows 不允许的字符。 */
function toFileName(text: string): string {
  return text.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
}

/** 任务结果的读取与使用。 */
export class GenerationResults {
  constructor(private readonly dependencies: GenerationResultsDependencies) {}

  /**
   * 把某个结果视频设为所在镜头组采用的版本，原来采用的取消。
   * @param rawInput { resultId }。
   * @throws NotFoundError 结果不存在。
   */
  select(rawInput: unknown): { readonly selected: true } {
    const { jobs, changes } = this.dependencies;
    const result = jobs.findResult(readEntityId({ id: readRecord(rawInput).resultId }, '结果'));
    if (result === undefined) {
      throw new NotFoundError('结果视频不存在。');
    }
    if (!result.isSelected) {
      jobs.selectResult(result.id);
      changes.notify({ jobId: result.jobId, groupId: result.groupId, quiet: true });
    }
    return { selected: true };
  }

  /**
   * 取得结果视频的本机绝对路径，用于用系统播放器打开。
   * @param rawInput { resultId }。
   * @throws NotFoundError 结果不存在。
   */
  getPath(rawInput: unknown): string {
    const result = this.dependencies.jobs.findResult(readEntityId({ id: readRecord(rawInput).resultId }, '结果'));
    if (result === undefined) {
      throw new NotFoundError('结果视频不存在。');
    }
    return this.dependencies.results.resolvePath(result.filePath);
  }

  /**
   * 取得结果视频的本机路径和建议的导出文件名（“作品-第 N 集-第 M 组-第 K 次.mp4”），用于导出。
   * @param rawInput { resultId }。
   * @throws NotFoundError 结果不存在。
   */
  getFile(rawInput: unknown): { readonly path: string; readonly suggestedName: string } {
    const { jobs } = this.dependencies;
    const result = jobs.findResult(readEntityId({ id: readRecord(rawInput).resultId }, '结果'));
    if (result === undefined) {
      throw new NotFoundError('结果视频不存在。');
    }
    const job = jobs.findJob(result.jobId);
    const place = job === undefined ? undefined : this.locateJob(job);
    const stem = place === undefined ? `视频-${result.id}` : `${place.workName}-第${place.episodeSeq}集-第${place.groupSeq}组-第${job?.attempt}次`;
    return { path: this.dependencies.results.resolvePath(result.filePath), suggestedName: `${toFileName(stem)}.mp4` };
  }

  /**
   * 任务成功或失败后给用户的通知内容；任务还在进行、已取消或不存在时返回 undefined。
   * @param jobId 任务标识。
   */
  describeFinished(jobId: number): FinishedJobNotice | undefined {
    const job = this.dependencies.jobs.findJob(jobId);
    if (job === undefined || (job.status !== 'succeeded' && job.status !== 'failed')) {
      return undefined;
    }
    const place = this.locateJob(job);
    const label = place === undefined ? '镜头组' : `「${place.workName}」第 ${place.episodeSeq} 集第 ${place.groupSeq} 组`;
    if (job.status === 'succeeded' || job.failure === null) {
      return { status: 'succeeded', level: 'info', message: `${label}的视频已生成。` };
    }
    const detail = job.failure.message.length > FAILURE_NOTICE_LENGTH ? `${job.failure.message.slice(0, FAILURE_NOTICE_LENGTH)}…` : job.failure.message;
    return { status: 'failed', level: 'warning', message: `${label}生成失败：${describeJobFailure(job.failure).label}。${detail}` };
  }

  /** 任务所属的作品名、集序号和镜头组序号；任何一项找不到（如作品已删除）时返回 undefined。 */
  private locateJob(job: VideoJobRecord): JobPlace | undefined {
    const { jobs, works, storyboardService, storyboards } = this.dependencies;
    const location = jobs.getGroupLocation(job.groupId);
    if (location === undefined) {
      return undefined;
    }
    let workName: string;
    try {
      workName = works.getWork(location.workId).name;
    } catch {
      return undefined;
    }
    const episodeSeq = storyboardService.listEpisodeStatuses(location.workId).find((status) => status.episodeId === location.episodeId)?.seq;
    const groupSeq = storyboards.listGroups(job.snapshot.storyboardRunId).find((group) => group.id === job.groupId)?.seq;
    return episodeSeq === undefined || groupSeq === undefined ? undefined : { workName, episodeSeq, groupSeq };
  }
}
