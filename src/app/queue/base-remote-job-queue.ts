// ------------------------------------------------------------------------
// 名称：base-remote-job-queue.ts
// 说明：远端任务队列的公共基类：按并发上限提交排队的任务，轮询生成中的任务，处理失败重试、超时、取消与重启恢复；具体的仓库读写、模型调用与结果保存由子类实现。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：一轮处理由 pump() 完成，定时器由 start() 启动（返回的停止函数会等正在进行的一轮处理结束，停止后不再开始新的一轮），测试直接调用 pump()。限流、服务端、网络类的提交失败自动重试，其余失败直接记为失败。超时语义由 failTimeoutBeforeQuery() 决定，视频队列先查询、资产队列先判超时。
// ------------------------------------------------------------------------

import { INTERRUPTED_MESSAGE, NotFoundError, ProviderError } from '../../domain/errors';
import { JobFailure } from '../../domain/models/generation';
import { ProviderCallContext, RemoteJobRef, RemoteJobState } from '../../domain/ports/provider-adapters';

/** 同时处于生成中的任务数上限。 */
const DEFAULT_MAX_CONCURRENT = 3;
/** 可重试的提交失败最多尝试的次数。 */
const DEFAULT_MAX_SUBMIT_ATTEMPTS = 3;
/** 提交失败后再次尝试前的等待时间。 */
const DEFAULT_SUBMIT_RETRY_DELAY_MS = 15_000;
/** 轮询或下载连续出现暂时性失败的容忍次数。 */
const DEFAULT_MAX_TRANSIENT_FAILURES = 5;
/** 生成中的任务超过等待时间后记录的失败原因。 */
const TIMEOUT_FAILURE: JobFailure = { category: 'server', code: null, message: '等待生成结果超时，请重新生成。' };
/** 生成中但没有远端标识的任务（应用在提交途中退出）记录的失败原因。 */
const INTERRUPTED_FAILURE: JobFailure = { category: 'server', code: null, message: INTERRUPTED_MESSAGE };
/** 服务商没有给出失败原因时记录的说明。 */
const MISSING_FAILURE_MESSAGE = '平台没有返回失败原因。';

/** 队列要求任务记录具备的字段。 */
export interface RemoteJobRecord {
  readonly id: number;
  readonly remoteJobId: string | null;
  readonly submittedAt: string | null;
}

/** 队列可调参数，缺省时使用默认值。 */
export interface RemoteJobQueueOptions {
  /** 返回当前时间的函数，测试时可注入。 */
  readonly now?: () => Date;
  readonly maxConcurrent?: number;
  readonly maxSubmitAttempts?: number;
  readonly submitRetryDelayMs?: number;
  readonly maxTransientFailures?: number;
  readonly maxRunningMs?: number;
}

/** 子类给出的队列特征：默认超时与面向用户的文案。 */
export interface RemoteJobQueueProfile {
  /** 未指定 maxRunningMs 时，生成中的任务最长等待时间。 */
  readonly defaultMaxRunningMs: number;
  /** 日志里的队列名称，如“生成队列”。 */
  readonly queueName: string;
  /** 日志里的任务称呼，如“任务”“资产版本”。 */
  readonly subjectName: string;
  /** 取消时任务不存在或已结束的提示。 */
  readonly notFoundMessage: string;
  /** 平台报告完成却没有结果时的失败说明。 */
  readonly missingResultMessage: string;
  /** 平台已不再保留任务时的失败说明。 */
  readonly expiredMessage: string;
}

/** 取消任务的结果。 */
export interface RemoteCancelResult {
  /** 为 true 表示已通知服务商取消。 */
  readonly remoteCanceled: boolean;
  /** 通知服务商取消失败的原因；没有失败时缺省。此时本地取消仍然成功，但平台上的任务可能仍在继续并计费。 */
  readonly remoteCancelError?: string;
}

/** 按远端任务编号取消任务的函数。 */
export type RemoteCanceller = (remoteJobId: string) => Promise<void>;

/** 准备好的提交：发起提交的函数，以及按远端任务编号取消的函数（服务商不支持取消时为 undefined）。 */
export interface PreparedSubmission {
  submit(): Promise<{ readonly remoteJobId: string }>;
  readonly cancel: RemoteCanceller | undefined;
}

/** 能按远端任务编号取消的模型调用：适配器、凭据与服务商侧的模型代码。 */
interface CancelableCall {
  readonly adapter: { cancel?(ref: RemoteJobRef, context: ProviderCallContext): Promise<void> };
  readonly modelCode: string;
  readonly context: ProviderCallContext;
}

/** 由模型调用构造取消函数；服务商不支持取消时返回 undefined。 */
export function createRemoteCanceller(call: CancelableCall): RemoteCanceller | undefined {
  const { adapter, modelCode, context } = call;
  const cancel = adapter.cancel;
  if (cancel === undefined) {
    return undefined;
  }
  return (remoteJobId) => cancel.call(adapter, { modelCode, remoteJobId }, context);
}

/**
 * 远端任务队列基类。
 * @typeParam TRecord 任务记录类型。
 * @typeParam TResult 服务商查询成功时返回的结果类型。
 */
export abstract class BaseRemoteJobQueue<TRecord extends RemoteJobRecord, TResult> {
  private readonly now: () => Date;
  private readonly maxConcurrent: number;
  private readonly maxSubmitAttempts: number;
  private readonly submitRetryDelayMs: number;
  private readonly maxTransientFailures: number;
  private readonly maxRunningMs: number;
  /** 提交失败的次数与下次可尝试的时间。 */
  private readonly submitRetries = new Map<number, { count: number; nextAt: number }>();
  /** 轮询或下载连续失败的次数。 */
  private readonly transientFailures = new Map<number, number>();
  private pumping = false;
  private pumpAgain = false;
  /** 正在进行的一轮处理，停止定时处理时据此等待它结束。 */
  private activePump: Promise<void> | undefined;
  /** 已停止：为 true 时不再开始新的一轮处理，进行中的一轮在处理完当前任务后结束。 */
  private stopped = false;

  protected constructor(
    options: RemoteJobQueueOptions,
    private readonly profile: RemoteJobQueueProfile
  ) {
    this.now = options.now ?? (() => new Date());
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.maxSubmitAttempts = options.maxSubmitAttempts ?? DEFAULT_MAX_SUBMIT_ATTEMPTS;
    this.submitRetryDelayMs = options.submitRetryDelayMs ?? DEFAULT_SUBMIT_RETRY_DELAY_MS;
    this.maxTransientFailures = options.maxTransientFailures ?? DEFAULT_MAX_TRANSIENT_FAILURES;
    this.maxRunningMs = options.maxRunningMs ?? profile.defaultMaxRunningMs;
  }

  /** 列出生成中的任务。 */
  protected abstract listRunning(): readonly TRecord[];

  /** 列出排队中的任务，先提交的排在前面。 */
  protected abstract listQueued(): readonly TRecord[];

  /** 按编号查找仍可取消的任务；不存在或已结束时返回 undefined。 */
  protected abstract findCancelable(id: number): TRecord | undefined;

  /** 任务是否处于生成中（已提交到服务商）。 */
  protected abstract isRunning(record: TRecord): boolean;

  /** 解析模型并构造取消函数；服务商不支持取消时返回 undefined。 */
  protected abstract resolveCanceller(record: TRecord): Promise<RemoteCanceller | undefined>;

  /** 解析模型、构造并校验请求，返回发起提交与取消的函数；失败时抛出，由基类记为任务失败。 */
  protected abstract prepareSubmission(record: TRecord): Promise<PreparedSubmission>;

  /** 查询服务商侧的任务状态；查询失败时抛出，由基类按暂时性失败处理。 */
  protected abstract queryRemote(record: TRecord, remoteJobId: string): Promise<RemoteJobState<TResult>>;

  /** 保存查询成功的结果并把任务记为成功；失败时自行调用 fail 或 handleSaveFailure。 */
  protected abstract saveResult(record: TRecord, result: TResult): Promise<void>;

  /** 把任务记为已提交；任务已被取消或结束时返回 false。 */
  protected abstract markSubmitted(record: TRecord, remoteJobId: string, at: string): boolean;

  /** 把任务记为已取消；任务已结束时返回 false。 */
  protected abstract markCanceled(record: TRecord, at: string): boolean;

  /** 把任务记为失败；任务已被取消或结束时返回 false。 */
  protected abstract markFailed(record: TRecord, failure: JobFailure, at: string): boolean;

  /** 通知任务发生了变化。 */
  protected abstract notifyChange(record: TRecord): void;

  /** 每轮在轮询之后、提交之前调用，子类可在此处理提交前的其他状态；默认什么也不做。 */
  protected prepareQueued(): void {}

  /** 超时是否先于查询判定：为 true 时超过等待时间直接失败；为 false 时先查询，查询后仍未结束才记为超时。 */
  protected failTimeoutBeforeQuery(): boolean {
    return false;
  }

  /**
   * 应用启动时调用：生成中但没有远端标识的任务无法继续查询，记为失败；有远端标识的继续轮询，排队中的继续提交。
   * @returns 被置为失败的任务数。
   */
  recover(): number {
    let failed = 0;
    for (const record of this.listRunning()) {
      if (record.remoteJobId === null && this.fail(record, INTERRUPTED_FAILURE)) {
        failed += 1;
      }
    }
    return failed;
  }

  /**
   * 启动定时处理：立即处理一轮，之后每隔 intervalMs 处理一轮。
   * @returns 停止函数：停止定时器、不再开始新的一轮处理，并等待正在进行的一轮处理结束。
   */
  start(intervalMs: number): () => Promise<void> {
    this.stopped = false;
    const run = (): void => {
      this.pump().catch((error: unknown) => console.error(`处理${this.profile.queueName}时出现未预期的错误：`, error));
    };
    run();
    const timer = setInterval(run, intervalMs);
    return async () => {
      this.stopped = true;
      clearInterval(timer);
      // 进行中的一轮出错时已由发起方记录日志，这里只等它结束。
      await this.activePump?.then(undefined, () => undefined);
    };
  }

  /** 处理一轮：先轮询生成中的任务，再处理子类的提交前状态，最后提交排队中的任务。正在处理时只登记再来一轮，不并发处理；已停止时什么也不做。 */
  async pump(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    const round = this.runRounds();
    this.activePump = round;
    try {
      await round;
    } finally {
      this.pumping = false;
      this.activePump = undefined;
    }
  }

  /**
   * 取消进行中的任务：生成中的任务若服务商支持取消则同时取消远端任务；不支持时只停止本地跟踪，远端任务可能仍会继续并计费。
   * @returns remoteCanceled 为 true 表示已通知服务商取消；通知失败时本地取消仍然成功，失败原因放在 remoteCancelError 里。
   * @throws NotFoundError 任务不存在，或已经结束。
   */
  async cancel(id: number): Promise<RemoteCancelResult> {
    const record = this.findCancelable(id);
    if (record === undefined) {
      throw new NotFoundError(this.profile.notFoundMessage);
    }
    let remoteCanceled = false;
    let remoteCancelError: string | undefined;
    if (this.isRunning(record) && record.remoteJobId !== null) {
      try {
        const cancel = await this.resolveCanceller(record);
        if (cancel !== undefined) {
          await cancel(record.remoteJobId);
          remoteCanceled = true;
        }
      } catch (error) {
        // 通知服务商取消失败不影响本地取消，但要把原因带给调用方，让用户知道平台上的任务可能仍在计费。
        remoteCancelError = error instanceof Error ? error.message : String(error);
      }
    }
    this.cancelLocally(record);
    return remoteCancelError === undefined ? { remoteCanceled } : { remoteCanceled, remoteCancelError };
  }

  /** 把任务记为失败并通知；返回是否真正写入（任务已被取消或结束时不覆盖）。 */
  protected fail(record: TRecord, failure: JobFailure): boolean {
    const written = this.markFailed(record, failure, this.timestamp());
    this.forget(record.id);
    if (written) {
      this.notifyChange(record);
    }
    return written;
  }

  /** 保存结果时出错：按网络类的暂时性失败处理，说明里带上 prefix 与原始错误。 */
  protected handleSaveFailure(record: TRecord, error: unknown, prefix: string): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.handleTransient(record, new ProviderError('network', `${prefix}${detail}`, { cause: error }));
  }

  /** 清除任务的重试与失败计数。 */
  protected forget(id: number): void {
    this.submitRetries.delete(id);
    this.transientFailures.delete(id);
  }

  /** 当前时间的 ISO 字符串。 */
  protected timestamp(): string {
    return this.now().toISOString();
  }

  /** 连续处理，直到没有人登记再来一轮或队列已停止。 */
  private async runRounds(): Promise<void> {
    do {
      this.pumpAgain = false;
      await this.pollRunning();
      this.prepareQueued();
      await this.submitQueued();
    } while (this.pumpAgain && !this.stopped);
  }

  /** 轮询全部生成中的任务。 */
  private async pollRunning(): Promise<void> {
    for (const record of this.listRunning()) {
      if (this.stopped) return;
      await this.pollOne(record);
    }
  }

  /** 在并发上限内提交排队中的任务，先提交的先处理。 */
  private async submitQueued(): Promise<void> {
    let running = this.listRunning().length;
    for (const record of this.listQueued()) {
      if (running >= this.maxConcurrent || this.stopped) {
        return;
      }
      const retry = this.submitRetries.get(record.id);
      if (retry !== undefined && retry.nextAt > this.now().getTime()) {
        continue;
      }
      if (await this.submitOne(record)) {
        running += 1;
      }
    }
  }

  /** 提交一个任务；成功变为生成中并返回 true，可重试的失败保持排队，其他失败记为失败。 */
  private async submitOne(record: TRecord): Promise<boolean> {
    let prepared: PreparedSubmission;
    try {
      prepared = await this.prepareSubmission(record);
    } catch (error) {
      this.fail(record, toFailure(error));
      return false;
    }
    try {
      const ref = await prepared.submit();
      if (this.markSubmitted(record, ref.remoteJobId, this.timestamp())) {
        this.submitRetries.delete(record.id);
        this.notifyChange(record);
      } else {
        // 提交期间任务已被取消或结束，平台上刚创建的任务没有人跟踪，必须取消以免继续计费。
        await this.cancelUntracked(prepared, ref.remoteJobId);
      }
      return true;
    } catch (error) {
      const attempts = (this.submitRetries.get(record.id)?.count ?? 0) + 1;
      if (error instanceof ProviderError && error.retryable && attempts < this.maxSubmitAttempts) {
        this.submitRetries.set(record.id, { count: attempts, nextAt: this.now().getTime() + this.submitRetryDelayMs });
        return false;
      }
      this.fail(record, toFailure(error));
      return false;
    }
  }

  /** 取消平台上已创建、本地却不再跟踪的任务；服务商不支持取消或取消失败时只能记录日志。 */
  private async cancelUntracked(prepared: PreparedSubmission, remoteJobId: string): Promise<void> {
    const subject = this.profile.subjectName;
    if (prepared.cancel === undefined) {
      console.error(`${subject}在提交期间已被取消，但服务商不支持取消远端任务（${remoteJobId}），平台上的任务可能仍会计费。`);
      return;
    }
    try {
      await prepared.cancel(remoteJobId);
    } catch (error) {
      console.error(`${subject}在提交期间已被取消，取消远端任务（${remoteJobId}）失败，平台上的任务可能仍会计费：`, error);
    }
  }

  /** 查询一个生成中的任务并处理结果。 */
  private async pollOne(record: TRecord): Promise<void> {
    const remoteJobId = record.remoteJobId;
    if (remoteJobId === null) {
      this.fail(record, INTERRUPTED_FAILURE);
      return;
    }
    const timedOut = record.submittedAt !== null && this.now().getTime() - Date.parse(record.submittedAt) > this.maxRunningMs;
    if (timedOut && this.failTimeoutBeforeQuery()) {
      this.fail(record, TIMEOUT_FAILURE);
      return;
    }
    try {
      const state = await this.queryRemote(record, remoteJobId);
      // 查询成功即清零；结果下载失败的次数要跨轮累计，所以成功态不在此清零
      if (state.status !== 'succeeded') this.transientFailures.delete(record.id);
      switch (state.status) {
        case 'succeeded':
          if (state.result === null) {
            this.fail(record, { category: 'server', code: null, message: this.profile.missingResultMessage });
          } else {
            await this.saveResult(record, state.result);
          }
          return;
        case 'failed':
          this.fail(record, {
            category: state.errorCategory ?? 'server',
            code: state.errorCode,
            message: state.errorMessage ?? MISSING_FAILURE_MESSAGE
          });
          return;
        case 'canceled':
          this.cancelLocally(record);
          return;
        case 'expired':
          this.fail(record, { category: 'server', code: null, message: this.profile.expiredMessage });
          return;
        default:
          if (timedOut) this.fail(record, TIMEOUT_FAILURE);
          return;
      }
    } catch (error) {
      this.handleTransient(record, error);
    }
  }

  /** 把任务记为已取消并通知；任务已结束时不覆盖。 */
  private cancelLocally(record: TRecord): void {
    if (this.markCanceled(record, this.timestamp())) {
      this.forget(record.id);
      this.notifyChange(record);
    }
  }

  /** 轮询或下载出错：可重试的分类在容忍次数内等下一轮，否则记为失败。 */
  private handleTransient(record: TRecord, error: unknown): void {
    const failures = (this.transientFailures.get(record.id) ?? 0) + 1;
    if (error instanceof ProviderError && error.retryable && failures <= this.maxTransientFailures) {
      this.transientFailures.set(record.id, failures);
      return;
    }
    this.fail(record, toFailure(error));
  }
}

/** 把任意错误转换为任务失败原因：服务商错误保留分类与错误码，其他错误按服务端错误记录。 */
function toFailure(error: unknown): JobFailure {
  if (error instanceof ProviderError) {
    return { category: error.category, code: error.code, message: error.message };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { category: 'server', code: null, message: `内部错误：${detail}` };
}
