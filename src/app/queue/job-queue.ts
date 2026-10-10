// ------------------------------------------------------------------------
// 名称：job-queue.ts
// 说明：视频生成队列：按并发上限把排队的任务提交给模型服务商，轮询生成中的任务，成功时下载结果，失败时记录平台返回的具体原因，支持取消与重启恢复。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：提交、轮询、重试、取消等公共流程在 BaseRemoteJobQueue；本文件只保留视频特有的部分：等待前序的任务（上一组尾帧作首帧）在前序成功且尾帧入库后转为排队，前序失败或被取消时一并失败；结果视频的下载与保存。超时先查询再判定。
// ------------------------------------------------------------------------

import { ProviderError } from '../../domain/errors';
import { JobFailure, VideoJobRecord } from '../../domain/models/generation';
import { GenerationRepository, JobMediaReader, ResultStore } from '../../domain/ports/generation-repository';
import { RemoteJobState, ResolvedVideoCall, VideoJobResult } from '../../domain/ports/provider-adapters';
import { PREVIOUS_GROUP_UNAVAILABLE_CODE } from '../../domain/rules/generation-failure-copy';
import { BaseRemoteJobQueue, PreparedSubmission, RemoteCancelResult, RemoteCanceller, RemoteJobQueueOptions, RemoteJobQueueProfile, createRemoteCanceller } from './base-remote-job-queue';
import { buildVideoRequest } from './video-request';

/** 生成中的任务最长等待时间。 */
const DEFAULT_MAX_RUNNING_MS = 60 * 60 * 1000;

/** 视频队列的特征：默认超时与文案。 */
const VIDEO_QUEUE_PROFILE: RemoteJobQueueProfile = {
  defaultMaxRunningMs: DEFAULT_MAX_RUNNING_MS,
  queueName: '生成队列',
  subjectName: '任务',
  notFoundMessage: '任务不存在或已经结束。',
  missingResultMessage: '平台报告任务已完成，但没有返回结果视频，请重新生成。',
  expiredMessage: '平台已不再保留这个任务（通常保留 24 小时），请重新生成。'
};

/** 任务变化通知。 */
export interface JobChange {
  readonly jobId: number;
  readonly groupId: number;
  /** 为 true 时只要求界面刷新，不弹任务完成的通知（如切换采用的版本）。 */
  readonly quiet?: boolean;
}

/** 取消任务的结果。 */
export type JobCancelResult = RemoteCancelResult;

/** 提交后通知队列开始处理，以及取消任务；由 JobQueue 实现。 */
export interface JobScheduler {
  pump(): Promise<void>;
  cancel(jobId: number): Promise<JobCancelResult>;
}

/** 解析视频模型的调用凭据。 */
export interface VideoCallResolver {
  /** @throws ProviderError 模型不可用或没有配置密钥。 */
  resolveVideoCall(modelId: number): Promise<ResolvedVideoCall>;
}

/** 生成队列的依赖与可调参数。 */
export interface JobQueueDependencies extends RemoteJobQueueOptions {
  readonly jobs: GenerationRepository;
  readonly media: JobMediaReader;
  readonly calls: VideoCallResolver;
  readonly results: ResultStore;
  readonly notify: (change: JobChange) => void;
}

/** 视频生成队列。 */
export class JobQueue extends BaseRemoteJobQueue<VideoJobRecord, VideoJobResult> {
  constructor(private readonly dependencies: JobQueueDependencies) {
    super(dependencies, VIDEO_QUEUE_PROFILE);
  }

  protected listRunning(): readonly VideoJobRecord[] {
    return this.dependencies.jobs.listJobsByStatus(['running']);
  }

  protected listQueued(): readonly VideoJobRecord[] {
    return this.dependencies.jobs.listJobsByStatus(['queued']);
  }

  protected findCancelable(id: number): VideoJobRecord | undefined {
    const job = this.dependencies.jobs.findJob(id);
    return job !== undefined && (job.status === 'waiting' || job.status === 'queued' || job.status === 'running') ? job : undefined;
  }

  protected isRunning(job: VideoJobRecord): boolean {
    return job.status === 'running';
  }

  protected async resolveCanceller(job: VideoJobRecord): Promise<RemoteCanceller | undefined> {
    return createRemoteCanceller(await this.dependencies.calls.resolveVideoCall(job.modelId));
  }

  protected async prepareSubmission(job: VideoJobRecord): Promise<PreparedSubmission> {
    const call = await this.dependencies.calls.resolveVideoCall(job.modelId);
    const request = buildVideoRequest(job.snapshot, job.firstFrameId, this.dependencies.media, call.modelCode);
    const issues = call.adapter.validate(request);
    if (issues.length > 0) {
      throw new ProviderError('invalid_request', issues.join('；'));
    }
    return { submit: () => call.adapter.submit(request, call.context), cancel: createRemoteCanceller(call) };
  }

  protected async queryRemote(job: VideoJobRecord, remoteJobId: string): Promise<RemoteJobState<VideoJobResult>> {
    const call = await this.dependencies.calls.resolveVideoCall(job.modelId);
    return call.adapter.query({ modelCode: call.modelCode, remoteJobId }, call.context);
  }

  protected markSubmitted(job: VideoJobRecord, remoteJobId: string, at: string): boolean {
    return this.dependencies.jobs.markSubmitted(job.id, remoteJobId, at);
  }

  protected markCanceled(job: VideoJobRecord, at: string): boolean {
    return this.dependencies.jobs.markCanceled(job.id, at);
  }

  protected markFailed(job: VideoJobRecord, failure: JobFailure, at: string): boolean {
    return this.dependencies.jobs.markFailed(job.id, failure, at);
  }

  protected notifyChange(job: VideoJobRecord): void {
    this.dependencies.notify({ jobId: job.id, groupId: job.groupId });
  }

  /** 处理等待前序的任务：前序成功且尾帧已入库则转为排队；前序仍在进行或尾帧还没截取则继续等；前序失败、被取消或已不存在则这些任务一并失败。 */
  protected override prepareQueued(): void {
    const { jobs } = this.dependencies;
    for (const job of jobs.listJobsByStatus(['waiting'])) {
      const previous = job.prevJobId === null ? undefined : jobs.findJob(job.prevJobId);
      if (previous !== undefined && (previous.status === 'waiting' || previous.status === 'queued' || previous.status === 'running')) {
        continue;
      }
      const result = previous !== undefined && previous.status === 'succeeded' ? jobs.findResultByJob(previous.id) : undefined;
      if (previous === undefined || previous.status !== 'succeeded' || result === undefined) {
        this.fail(job, { category: 'invalid_request', code: PREVIOUS_GROUP_UNAVAILABLE_CODE, message: '上一组的任务失败、被取消或已不存在，没有可用的尾帧。' });
        continue;
      }
      const frameId = jobs.findResultFrameId(result.id);
      if (frameId !== undefined && jobs.releaseWaitingJob(job.id, frameId)) {
        this.notifyChange(job);
      }
    }
  }

  /** 下载结果视频并保存；下载失败按暂时性失败处理。 */
  protected async saveResult(job: VideoJobRecord, result: VideoJobResult): Promise<void> {
    const { jobs, results } = this.dependencies;
    const location = jobs.getGroupLocation(job.groupId);
    if (location === undefined) {
      this.fail(job, { category: 'server', code: null, message: '这个任务所在的镜头组已不存在（可能已被删除或重新分组），无法保存结果视频。' });
      return;
    }
    try {
      const saved = await results.save(location, job.groupId, job.id, result.videoUrl);
      const record = jobs.markSucceeded(
        job.id,
        { filePath: saved.filePath, remoteUrl: null, durationSeconds: result.durationSeconds, width: null, height: null, sizeBytes: saved.sizeBytes, hasAudio: job.snapshot.params.audioMode === 'native' },
        this.timestamp()
      );
      if (record !== undefined) {
        this.forget(job.id);
        this.notifyChange(job);
      }
    } catch (error) {
      this.handleSaveFailure(job, error, '保存结果视频失败：');
    }
  }
}
