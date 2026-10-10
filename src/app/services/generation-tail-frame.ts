// ------------------------------------------------------------------------
// 名称：generation-tail-frame.ts
// 说明：尾帧的接力：列出需要截取尾帧的结果视频、保存工作台截取的尾帧并唤醒等待它的任务、截取失败时让等待它的任务失败。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：组的第一个镜头设为“上一镜头尾帧作首帧”时，任务等待上一组；尾帧由工作台从结果视频截取后上传；上一组如何被依赖见 generation-first-frame.ts。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, NotFoundError, ValidationError } from '../../domain/errors';
import { GenerationRepository } from '../../domain/ports/generation-repository';
import { TAIL_FRAME_UNAVAILABLE_CODE, readTailFrameFailure, readTailFrameInput } from '../../domain/rules/tail-frame-rules';
import { IMAGE_FILE_MAX_BYTES } from '../../domain/rules/image-size';
import { JobChange, JobScheduler } from '../queue/job-queue';
import { ChangeNotifier } from './change-notifier';

/** 尾帧接力的依赖。 */
export interface TailFrameRelayDependencies {
  readonly jobs: GenerationRepository;
  readonly scheduler: Pick<JobScheduler, 'pump'>;
  readonly changes: ChangeNotifier<JobChange>;
  /** 当前时间的 ISO 字符串。 */
  readonly timestamp: () => string;
}

/** 尾帧接力：衔接“上一组的结果视频”与“等待它的下一组任务”。 */
export class TailFrameRelay {
  constructor(private readonly dependencies: TailFrameRelayDependencies) {}

  /** 需要截取尾帧的结果视频：有等待它的任务、但还没有尾帧；工作台据此截取并上传。 */
  listPending(): Array<{ readonly resultId: number }> {
    return this.dependencies.jobs.listResultsAwaitingFrame().map((result) => ({ resultId: result.id }));
  }

  /**
   * 保存工作台从结果视频截取的尾帧，并让等待它的任务继续。
   * @param rawInput { resultId, mimeType, width, height, data（Base64） }。
   * @throws ValidationError 内容不合法。
   * @throws NotFoundError 结果视频不存在。
   */
  save(rawInput: unknown): { readonly saved: true } {
    const { jobs, scheduler, timestamp } = this.dependencies;
    const input = readTailFrameInput(rawInput);
    const data = Buffer.from(input.dataBase64, 'base64');
    if (data.byteLength === 0 || data.byteLength > IMAGE_FILE_MAX_BYTES) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '尾帧图片内容不合法。' });
    }
    if (jobs.saveResultFrame(input.resultId, { mimeType: input.mimeType, width: input.width, height: input.height, data }, timestamp()) === undefined) {
      throw new NotFoundError('结果视频不存在。');
    }
    void scheduler.pump().catch((error: unknown) => console.error('处理生成队列时出现未预期的错误：', error));
    return { saved: true };
  }

  /**
   * 工作台没能从结果视频截取尾帧时，让等待这个结果的任务失败，避免一直等下去。
   * @param rawInput { resultId, reason? }。
   * @returns 被置为失败的任务数。
   */
  reportFailure(rawInput: unknown): { readonly failed: number } {
    const { jobs, changes, timestamp } = this.dependencies;
    const { resultId, reason } = readTailFrameFailure(rawInput);
    const result = jobs.findResult(resultId);
    if (result === undefined) {
      return { failed: 0 };
    }
    const message = reason === '' ? '无法从上一组的视频截取尾帧。' : `无法从上一组的视频截取尾帧：${reason}`;
    let failed = 0;
    for (const job of jobs.listJobsByStatus(['waiting']).filter((candidate) => candidate.prevJobId === result.jobId)) {
      if (jobs.markFailed(job.id, { category: 'invalid_request', code: TAIL_FRAME_UNAVAILABLE_CODE, message }, timestamp())) {
        failed += 1;
        changes.notify({ jobId: job.id, groupId: job.groupId });
      }
    }
    return { failed };
  }
}
