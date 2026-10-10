// ------------------------------------------------------------------------
// 名称：generation-submission.ts
// 说明：提交管线：逐组规划视频生成请求，通过的在事务内写入任务并入队，不通过的连同原因返回；预览时做同样的编译与校验但不写任务、不入队。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：只有已确认采用的分镜脚本才能生成；按组序号依次处理，同一次提交里后一组能接在前一组刚建的任务之后；镜头组自己的参数覆盖优先于本次提交的参数；同一镜头组同时只有一个进行中的任务，冲突的组被拒绝。单组的校验与请求编译见 generation-planning.ts。
// ------------------------------------------------------------------------

import { ConflictError, FORM_LEVEL_ERROR_KEY, ValidationError } from '../../domain/errors';
import { GenerationParams } from '../../domain/models/generation';
import { ProfileValues } from '../../domain/models/generation-profile';
import { StageRun } from '../../domain/models/stage-run';
import { ShotGroup, ShotRecord } from '../../domain/models/storyboard';
import { GenerationProfileRepository } from '../../domain/ports/generation-profile-repository';
import { GenerationRepository } from '../../domain/ports/generation-repository';
import { StageRunRepository } from '../../domain/ports/stage-run-repository';
import { StoryboardRepository } from '../../domain/ports/storyboard-repository';
import { SubmitInput, readSubmitInput } from '../../domain/rules/generation-submit-input';
import { groupMaxSecondsOf, sumSeconds } from '../../domain/rules/shot-group-rules';
import { JobChange, JobScheduler } from '../queue/job-queue';
import { ChangeNotifier } from './change-notifier';
import { resolveWorkbenchRun } from './generation-run';
import { GroupPlanOutcome, GroupRequestPlanner, ModelContext, PlannedGroup, resolveModelContext } from './generation-planning';
import { GroupPreview, RejectedGroup, SubmitPreview, SubmitResult } from './generation-views';
import { ProviderService } from './provider-service';
import { syncShotGroups } from './shot-grouping';
import { readStoryboardParams } from './storyboard-service';
import { WorkService } from './work-service';

/** 预览时代替真实任务标识，让同一次预览里后一组能接在前一组之后。 */
const DRY_RUN_JOB_ID = -1;

/** 提交管线的依赖。 */
export interface GenerationSubmissionDependencies {
  readonly works: Pick<WorkService, 'getWork'>;
  readonly providers: Pick<ProviderService, 'listUsableModels' | 'resolveVideoCall'>;
  readonly runs: StageRunRepository;
  readonly storyboards: StoryboardRepository;
  readonly jobs: GenerationRepository;
  /** 镜头组级的生成参数覆盖。 */
  readonly profiles: GenerationProfileRepository;
  readonly scheduler: Pick<JobScheduler, 'pump'>;
  readonly changes: ChangeNotifier<JobChange>;
  readonly planner: GroupRequestPlanner;
  /** 当前时间的 ISO 字符串。 */
  readonly timestamp: () => string;
}

/** 一次提交的处理状态：已解析的输入与分镜脚本，以及逐组累积的结果。 */
interface SubmissionBatch {
  readonly input: SubmitInput;
  readonly run: StageRun;
  /** 只预览时不写任务、不通知、不唤醒队列。 */
  readonly dryRun: boolean;
  /** 解析一个视频模型的调用信息，同一次提交里每个模型只解析一次。 */
  readonly contextOf: (modelId: number) => Promise<ModelContext | string>;
  /** 本次提交的默认模型。 */
  readonly baseContext: ModelContext;
  readonly overrides: ReadonlyMap<number, ProfileValues>;
  readonly shotsById: ReadonlyMap<number, ShotRecord>;
  readonly groups: readonly ShotGroup[];
  readonly groupsById: ReadonlyMap<number, ShotGroup>;
  readonly orderOf: ReadonlyMap<number, number>;
  /** 本次提交里已建任务的镜头组标识与任务标识。 */
  readonly createdJobIds: Map<number, number>;
  readonly submitted: Array<SubmitResult['submitted'][number]>;
  readonly rejected: RejectedGroup[];
  readonly previews: GroupPreview[];
}

/** 用镜头组的覆盖替换本次提交的参数：覆盖里不为 null 的字段优先。 */
function mergeGroupParams(base: GenerationParams, override: ProfileValues | undefined): GenerationParams {
  if (override === undefined) return base;
  return {
    modelId: override.modelId ?? base.modelId,
    aspectRatio: override.aspectRatio ?? base.aspectRatio,
    resolution: override.resolution ?? base.resolution,
    audioMode: override.audioMode ?? base.audioMode,
    audioElements: override.audioElements ?? base.audioElements,
    seed: override.seed ?? base.seed,
    durationSeconds: override.durationSeconds ?? base.durationSeconds,
    negativeList: override.negativeList ?? base.negativeList,
    promptExtend: override.promptExtend ?? base.promptExtend
  };
}

/** 视频生成的提交管线。 */
export class GenerationSubmission {
  constructor(private readonly dependencies: GenerationSubmissionDependencies) {}

  /**
   * 提交若干镜头组生成视频：逐组编译请求并按模型能力校验，通过的写入任务并入队，不通过的连同原因一起返回，不影响其他组。
   * @param rawInput 界面提交的原始内容。
   * @throws ValidationError 内容不合法、分镜脚本尚未确认采用，或所选模型不可用。
   * @throws NotFoundError 作品不存在。
   */
  async submit(rawInput: unknown): Promise<SubmitResult> {
    const batch = await this.process(rawInput, false);
    return { submitted: batch.submitted, rejected: batch.rejected };
  }

  /**
   * 预览提交：与 submit 做同样的编译与校验，但不写任务、不入队；逐组汇总整组时长、首帧来源、参考素材数量与声音，以及阻断问题和提醒。
   * @param rawInput 与 submit 相同。
   * @throws ValidationError 内容不合法、分镜脚本尚未确认采用，或所选模型不可用。
   * @throws NotFoundError 作品不存在。
   */
  async preview(rawInput: unknown): Promise<SubmitPreview> {
    return { groups: (await this.process(rawInput, true)).previews };
  }

  /** submit 与 preview 共用的处理：按组序号依次处理每个镜头组，最后唤醒队列。 */
  private async process(rawInput: unknown, dryRun: boolean): Promise<SubmissionBatch> {
    const batch = await this.prepare(rawInput, dryRun);
    // 按组序号依次处理，这样同一次提交里后一组能接在前一组刚建的任务后面。
    const orderedGroupIds = [...batch.input.groupIds].sort(
      (left, right) => (batch.orderOf.get(left) ?? Number.MAX_SAFE_INTEGER) - (batch.orderOf.get(right) ?? Number.MAX_SAFE_INTEGER)
    );
    for (const groupId of orderedGroupIds) {
      await this.handleGroup(batch, groupId);
    }
    if (!dryRun && batch.submitted.length > 0) {
      void this.dependencies.scheduler.pump().catch((error: unknown) => console.error('处理生成队列时出现未预期的错误：', error));
    }
    return batch;
  }

  /**
   * 读取并校验请求，确定分镜脚本版本与默认模型，补全分组并载入镜头与镜头组覆盖。
   * @throws ValidationError 内容不合法、分镜脚本尚未确认采用，或默认模型不可用。
   */
  private async prepare(rawInput: unknown, dryRun: boolean): Promise<SubmissionBatch> {
    const { works, runs, providers, storyboards, profiles, timestamp } = this.dependencies;
    const input = readSubmitInput(rawInput);
    works.getWork(input.workId);
    const { run, isCurrent } = resolveWorkbenchRun(runs, input.workId, input.episodeId);
    if (!isCurrent) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '分镜脚本还没有确认采用，请先确认后再生成。' });
    }

    // 每个模型只解析一次：本次提交的默认模型必须可用，镜头组单独指定的模型不可用时只拒绝那一组。
    const contexts = new Map<number, ModelContext | string>();
    const contextOf = async (modelId: number): Promise<ModelContext | string> => {
      const cached = contexts.get(modelId);
      if (cached !== undefined) return cached;
      const resolved = await resolveModelContext(providers, modelId);
      contexts.set(modelId, resolved);
      return resolved;
    };
    const baseContext = await contextOf(input.params.modelId);
    if (typeof baseContext === 'string') {
      throw new ValidationError({ modelId: baseContext });
    }

    syncShotGroups(storyboards, run.id, groupMaxSecondsOf(readStoryboardParams(run)), timestamp());
    const groups = storyboards.listGroups(run.id);
    return {
      input,
      run,
      dryRun,
      contextOf,
      baseContext,
      overrides: profiles.listByGroups(input.groupIds),
      shotsById: new Map(storyboards.listShots(run.id).map((shot) => [shot.id, shot])),
      groups,
      groupsById: new Map(groups.map((group) => [group.id, group])),
      orderOf: new Map(groups.map((group, index) => [group.id, index])),
      createdJobIds: new Map(),
      submitted: [],
      rejected: [],
      previews: []
    };
  }

  /** 处理一个镜头组：检查、规划，通过后（非预览时）写入任务；结果累积到 batch。 */
  private async handleGroup(batch: SubmissionBatch, groupId: number): Promise<void> {
    const { jobs } = this.dependencies;
    const { input, run, groups, groupsById, orderOf, overrides, createdJobIds } = batch;
    const group = groupsById.get(groupId);
    if (group === undefined) {
      this.reject(batch, groupId, undefined, ['镜头组不属于当前已确认的分镜脚本。']);
      return;
    }
    if (jobs.hasActiveJob(group.id)) {
      this.reject(batch, groupId, group, ['这一组正在生成，完成或取消后才能再次提交。']);
      return;
    }
    const members = this.memberShots(batch, group);
    const totalSeconds = sumSeconds(members);
    // 这一组自己的覆盖优先于本次提交的参数；覆盖了模型时按那个模型校验。
    const params = mergeGroupParams(input.params, overrides.get(group.id));
    const model = params.modelId === input.params.modelId ? batch.baseContext : await batch.contextOf(params.modelId);
    if (typeof model === 'string') {
      this.reject(batch, groupId, group, [`这一组指定的视频模型不可用：${model}`]);
      return;
    }
    const outcome: GroupPlanOutcome = this.dependencies.planner.plan({
      workId: input.workId,
      episodeId: input.episodeId,
      run,
      members,
      totalSeconds,
      previousGroup: groups[(orderOf.get(group.id) ?? 0) - 1] as ShotGroup | undefined,
      params,
      model,
      createdJobIds
    });
    if (!outcome.ok) {
      this.reject(batch, groupId, group, outcome.issues);
      return;
    }
    let jobId = DRY_RUN_JOB_ID;
    if (!batch.dryRun) {
      const inserted = this.insertJob(group, model.usable.model.id, outcome.plan);
      if (typeof inserted === 'string') {
        this.reject(batch, groupId, group, [inserted]);
        return;
      }
      jobId = inserted;
      this.dependencies.changes.notify({ jobId, groupId });
    }
    createdJobIds.set(group.id, jobId);
    this.accept(batch, group, members.length, totalSeconds, outcome.plan, jobId);
  }

  /**
   * 写入任务。仓库在同一个事务里检查并插入；前面的检查之后又有别的提交抢先时，会因“同一组只能有一个进行中的任务”冲突。
   * @returns 新任务的标识；冲突时返回冲突原因。
   */
  private insertJob(group: ShotGroup, modelId: number, { snapshot, link }: PlannedGroup): number | string {
    try {
      return this.dependencies.jobs.insertJob(
        {
          groupId: group.id,
          modelId,
          status: link === undefined || link.firstFrameId !== null ? 'queued' : 'waiting',
          snapshot,
          prevJobId: link === undefined ? null : link.prevJobId,
          firstFrameId: link === undefined ? null : link.firstFrameId
        },
        this.dependencies.timestamp()
      ).id;
    } catch (error) {
      if (error instanceof ConflictError) {
        return error.message;
      }
      throw error;
    }
  }

  /** 记录通过的组：入队结果与预览汇总。 */
  private accept(batch: SubmissionBatch, group: ShotGroup, shotCount: number, totalSeconds: number, { snapshot, link, firstFrameImage }: PlannedGroup, jobId: number): void {
    batch.submitted.push({ groupId: group.id, seq: group.seq, jobId, warnings: snapshot.warnings });
    batch.previews.push({
      groupId: group.id,
      seq: group.seq,
      shotCount,
      totalSeconds,
      durationSeconds: snapshot.params.durationSeconds,
      firstFrame: link === undefined ? (firstFrameImage === null ? 'none' : 'image') : 'previous_tail',
      prompt: snapshot.prompt,
      negativeList: snapshot.params.negativeList,
      promptExtend: snapshot.params.extraParams.promptExtend === undefined ? null : snapshot.params.extraParams.promptExtend === true,
      referenceImageCount: snapshot.referenceImageFileIds.length,
      referenceAudioCount: snapshot.referenceAudioFileIds.length,
      audioMode: snapshot.params.audioMode,
      audioElements: snapshot.params.audioElements,
      seed: snapshot.params.seed,
      blocking: [],
      warnings: this.dependencies.jobs.listResultsByGroups([group.id]).length > 0 ? [...snapshot.warnings, '这一组已有成功的结果，本次会产生新的版本，不会覆盖已有视频。'] : snapshot.warnings
    });
  }

  /** 记录被拒绝的组：同时产生一条只有阻断问题的预览。 */
  private reject(batch: SubmissionBatch, groupId: number, group: ShotGroup | undefined, issues: readonly string[]): void {
    const { params } = batch.input;
    const members = this.memberShots(batch, group);
    batch.rejected.push({ groupId, seq: group?.seq ?? 0, issues });
    batch.previews.push({
      groupId,
      seq: group?.seq ?? 0,
      shotCount: members.length,
      totalSeconds: sumSeconds(members),
      durationSeconds: null,
      firstFrame: 'none',
      prompt: null,
      negativeList: null,
      promptExtend: params.promptExtend,
      referenceImageCount: 0,
      referenceAudioCount: 0,
      audioMode: params.audioMode,
      audioElements: null,
      seed: params.seed,
      blocking: issues,
      warnings: []
    });
  }

  /** 组内的镜头，按顺序；组不存在时为空。 */
  private memberShots(batch: SubmissionBatch, group: ShotGroup | undefined): ShotRecord[] {
    return group === undefined ? [] : group.shotIds.flatMap((id) => batch.shotsById.get(id) ?? []);
  }
}
