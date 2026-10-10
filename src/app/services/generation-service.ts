// ------------------------------------------------------------------------
// 名称：generation-service.ts
// 说明：视频生成应用服务（门面）：把工作台的请求分派给各职责单元——视图读取、提交管线、镜头组编辑、尾帧接力、任务结果；自身只持有依赖、装配这些单元并委托。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：一个镜头组一次生成一个多镜头视频；只有已确认采用的分镜脚本才能生成；每次提交产生新任务，失败原因与历史都保留；已有生成记录的组不能拆分或合并；同一镜头组同时只有一个进行中的任务。各单元：workbench-view-reader（视图）、generation-submission 与 generation-planning（提交与按组规划）、generation-group-editor（分组编辑）、generation-tail-frame 与 generation-first-frame（尾帧与首帧）、generation-results（结果）。
// ------------------------------------------------------------------------

import { ProfileValues } from '../../domain/models/generation-profile';
import { AssetRepository } from '../../domain/ports/asset-repository';
import { BindingRepository } from '../../domain/ports/binding-repository';
import { GenerationProfileRepository } from '../../domain/ports/generation-profile-repository';
import { GenerationRepository, JobMediaReader, ResultStore } from '../../domain/ports/generation-repository';
import { ProviderRepository } from '../../domain/ports/provider-repository';
import { ScreenplayRepository } from '../../domain/ports/screenplay-repository';
import { StageRunRepository } from '../../domain/ports/stage-run-repository';
import { StoryboardRepository } from '../../domain/ports/storyboard-repository';
import { readEntityId, readRecord } from '../../domain/rules/field-readers';
import { JobCancelResult, JobChange, JobScheduler } from '../queue/job-queue';
import { ChangeNotifier } from './change-notifier';
import { FirstFrameResolver } from './generation-first-frame';
import { GroupRequestPlanner } from './generation-planning';
import { GenerationResults, FinishedJobNotice } from './generation-results';
import { ShotGroupEditor } from './generation-group-editor';
import { GenerationSubmission } from './generation-submission';
import { TailFrameRelay } from './generation-tail-frame';
import { EpisodeWorkbenchView, JobView, SubmitPreview, SubmitResult, WorkbenchCatalog } from './generation-views';
import { ProjectService } from './project-service';
import { ProviderService } from './provider-service';
import { StoryboardService } from './storyboard-service';
import { WorkbenchViewReader } from './workbench-view-reader';
import { WorkService } from './work-service';

/** 视频生成应用服务的依赖。 */
export interface GenerationServiceDependencies {
  readonly works: WorkService;
  readonly projects: ProjectService;
  readonly storyboardService: StoryboardService;
  readonly runs: StageRunRepository;
  readonly screenplays: ScreenplayRepository;
  readonly storyboards: StoryboardRepository;
  readonly bindings: BindingRepository;
  readonly assets: AssetRepository;
  readonly jobs: GenerationRepository;
  readonly media: JobMediaReader;
  readonly results: ResultStore;
  readonly models: Pick<ProviderRepository, 'findModelById'>;
  readonly providers: ProviderService;
  /** 镜头组级的生成参数覆盖。 */
  readonly profiles: GenerationProfileRepository;
  readonly scheduler: JobScheduler;
  readonly changes: ChangeNotifier<JobChange>;
  readonly now?: () => Date;
}

/** 视频生成应用服务。 */
export class GenerationService {
  private readonly views: WorkbenchViewReader;
  private readonly submission: GenerationSubmission;
  private readonly groups: ShotGroupEditor;
  private readonly tailFrames: TailFrameRelay;
  private readonly results: GenerationResults;

  constructor(private readonly dependencies: GenerationServiceDependencies) {
    const { works, projects, storyboardService, runs, screenplays, storyboards, bindings, assets, jobs, media, models, providers, profiles, scheduler, changes } = dependencies;
    const timestamp = (): string => (dependencies.now?.() ?? new Date()).toISOString();
    this.views = new WorkbenchViewReader({ works, projects, storyboardService, providers, runs, screenplays, storyboards, bindings, jobs, profiles, models, timestamp });
    const firstFrames = new FirstFrameResolver({ assets, media, jobs });
    const planner = new GroupRequestPlanner({ screenplays, bindings, assets, media }, firstFrames);
    this.submission = new GenerationSubmission({ works, providers, runs, storyboards, jobs, profiles, scheduler, changes, planner, timestamp });
    this.groups = new ShotGroupEditor({ works, runs, storyboards, jobs, profiles, models, timestamp });
    this.tailFrames = new TailFrameRelay({ jobs, scheduler, changes, timestamp });
    this.results = new GenerationResults({ works, storyboardService, storyboards, jobs, results: dependencies.results, changes });
  }

  /** 订阅任务变化；返回取消订阅的函数。 */
  onDidChangeJobs(listener: (change: JobChange) => void): () => void {
    return this.dependencies.changes.subscribe(listener);
  }

  /** 列出工作台可选的作品（有分镜脚本记录的）与当前可用的视频模型。 */
  getCatalog(): Promise<WorkbenchCatalog> {
    return this.views.getCatalog();
  }

  /**
   * 读取一集的工作台视图：镜头组、组内镜头及任务历史。读取时会补全还没有分组的镜头。
   * @param workId 作品标识。
   * @param episodeId 集标识。
   * @throws NotFoundError 作品或集不存在，或这一集还没有分镜脚本。
   */
  getEpisode(workId: number, episodeId: number): EpisodeWorkbenchView {
    return this.views.getEpisode(workId, episodeId);
  }

  /**
   * 读取一个镜头组全部历史成功的版本（视图里每组只带最近若干条任务，版本页需要看到全部）。
   * @param rawInput { workId, episodeId, groupId }。
   * @returns 有结果视频的任务视图，最新的在前。
   * @throws NotFoundError 作品或集不存在、这一集还没有分镜脚本，或镜头组不属于这一集。
   */
  getGroupVersions(rawInput: unknown): JobView[] {
    return this.views.getGroupVersions(rawInput);
  }

  /**
   * 提交若干镜头组生成视频：逐组编译请求并按模型能力校验，通过的写入任务并入队，不通过的连同原因一起返回，不影响其他组。
   * @param rawInput 界面提交的原始内容。
   * @throws ValidationError 内容不合法、分镜脚本尚未确认采用，或所选模型不可用。
   * @throws NotFoundError 作品不存在。
   */
  submit(rawInput: unknown): Promise<SubmitResult> {
    return this.submission.submit(rawInput);
  }

  /**
   * 预览提交：与 submit 做同样的编译与校验，但不写任务、不入队；逐组汇总整组时长、首帧来源、参考素材数量与声音，以及阻断问题和提醒。
   * @param rawInput 与 submit 相同。
   * @throws ValidationError 内容不合法、分镜脚本尚未确认采用，或所选模型不可用。
   * @throws NotFoundError 作品不存在。
   */
  previewSubmit(rawInput: unknown): Promise<SubmitPreview> {
    return this.submission.preview(rawInput);
  }

  /**
   * 保存一个镜头组的参数覆盖：changes 里出现的字段被覆盖，值为 null（或空串）表示恢复继承。
   * @param rawInput `{ workId, episodeId, groupId, changes }`。
   * @returns 保存后这一组的覆盖。
   * @throws ValidationError 字段不合法、模型不是可用的视频模型，或镜头组不属于当前的分镜脚本。
   * @throws NotFoundError 作品不存在。
   */
  saveGroupProfile(rawInput: unknown): ProfileValues {
    return this.groups.saveProfile(rawInput);
  }

  /**
   * 丢弃这一集现有的镜头组，按单组最长时长重新分组。已有的生成记录会随旧的组一起清除，已保存的视频文件不删除。
   * @param rawInput { workId, episodeId, maxSeconds? }，maxSeconds 缺省用分镜脚本生成时设定的值。
   * @throws ValidationError 内容不合法，或有正在生成的组。
   * @throws NotFoundError 作品、集不存在或还没有分镜脚本。
   */
  regroup(rawInput: unknown): void {
    this.groups.regroup(rawInput);
  }

  /**
   * 在某个镜头之前拆开所在的组（该镜头及后面的镜头成为新组）。
   * @param rawInput { workId, episodeId, shotId }。
   * @throws ValidationError 镜头已是组内第一个，或所在的组已有生成记录。
   */
  splitGroup(rawInput: unknown): void {
    this.groups.splitGroup(rawInput);
  }

  /**
   * 把一个组并入上一组。
   * @param rawInput { workId, episodeId, groupId }。
   * @throws ValidationError 已是第一组，或这两组有生成记录。
   */
  mergeGroup(rawInput: unknown): void {
    this.groups.mergeGroup(rawInput);
  }

  /**
   * 取消进行中的任务。
   * @param rawInput { jobId }。
   * @returns remoteCanceled 为 false 时，平台任务可能仍会继续并计费；remoteCancelError 有值表示通知平台取消失败（本地取消仍然成功），原因随结果返回给页面提示。
   * @throws NotFoundError 任务不存在或已经结束。
   */
  cancel(rawInput: unknown): Promise<JobCancelResult> {
    return this.dependencies.scheduler.cancel(readEntityId({ id: readRecord(rawInput).jobId }, '任务'));
  }

  /**
   * 把某个结果视频设为所在镜头组采用的版本，原来采用的取消。
   * @param rawInput { resultId }。
   * @throws NotFoundError 结果不存在。
   */
  selectResult(rawInput: unknown): { readonly selected: true } {
    return this.results.select(rawInput);
  }

  /**
   * 取得结果视频的本机绝对路径，用于用系统播放器打开。
   * @param rawInput { resultId }。
   * @throws NotFoundError 结果不存在。
   */
  getResultPath(rawInput: unknown): string {
    return this.results.getPath(rawInput);
  }

  /**
   * 取得结果视频的本机路径和建议的导出文件名（“作品-第 N 集-第 M 组-第 K 次.mp4”），用于导出。
   * @param rawInput { resultId }。
   * @throws NotFoundError 结果不存在。
   */
  getResultFile(rawInput: unknown): { readonly path: string; readonly suggestedName: string } {
    return this.results.getFile(rawInput);
  }

  /** 需要截取尾帧的结果视频：有等待它的任务、但还没有尾帧；工作台据此截取并上传。 */
  listPendingTailFrames(): Array<{ readonly resultId: number }> {
    return this.tailFrames.listPending();
  }

  /**
   * 保存工作台从结果视频截取的尾帧，并让等待它的任务继续。
   * @param rawInput { resultId, mimeType, width, height, data（Base64） }。
   * @throws ValidationError 内容不合法。
   * @throws NotFoundError 结果视频不存在。
   */
  saveTailFrame(rawInput: unknown): { readonly saved: true } {
    return this.tailFrames.save(rawInput);
  }

  /**
   * 工作台没能从结果视频截取尾帧时，让等待这个结果的任务失败，避免一直等下去。
   * @param rawInput { resultId, reason? }。
   * @returns 被置为失败的任务数。
   */
  reportTailFrameFailure(rawInput: unknown): { readonly failed: number } {
    return this.tailFrames.reportFailure(rawInput);
  }

  /**
   * 任务成功或失败后给用户的通知内容；任务还在进行、已取消或不存在时返回 undefined。
   * @param jobId 任务标识。
   */
  describeFinishedJob(jobId: number): FinishedJobNotice | undefined {
    return this.results.describeFinished(jobId);
  }
}
