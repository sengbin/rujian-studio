// ------------------------------------------------------------------------
// 名称：workbench-view-reader.ts
// 说明：读取并组装视频生成工作台的视图：作品与模型清单、一集的镜头组与任务历史、一个镜头组的全部成功版本。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：只读，唯一的写入是读取一集时补全还没有分组的镜头；视图类型与纯函数见 generation-views.ts。
// ------------------------------------------------------------------------

import { NotFoundError } from '../../domain/errors';
import { VideoJobRecord, VideoResultRecord } from '../../domain/models/generation';
import { DEFAULT_NEGATIVE_LIST, EMPTY_PROFILE, NEGATIVE_LIST_PRESETS } from '../../domain/models/generation-profile';
import { ENTITY_KIND_LABELS } from '../../domain/models/screenplay';
import { BindingRepository } from '../../domain/ports/binding-repository';
import { GenerationProfileRepository } from '../../domain/ports/generation-profile-repository';
import { GenerationRepository } from '../../domain/ports/generation-repository';
import { ProviderRepository } from '../../domain/ports/provider-repository';
import { ScreenplayRepository } from '../../domain/ports/screenplay-repository';
import { StageRunRepository } from '../../domain/ports/stage-run-repository';
import { StoryboardRepository } from '../../domain/ports/storyboard-repository';
import { readEntityId, readRecord } from '../../domain/rules/field-readers';
import { groupMaxSecondsOf, sumSeconds } from '../../domain/rules/shot-group-rules';
import { resolveRequestedRun, resolveWorkbenchRun } from './generation-run';
import { EpisodeWorkbenchView, JobView, WorkbenchCatalog, WorkbenchWork, describeBlockReason, describeStaleTail, pickVisibleJobs, toJobView, toWorkbenchModel } from './generation-views';
import { ProjectService } from './project-service';
import { ProviderService } from './provider-service';
import { syncShotGroups } from './shot-grouping';
import { StoryboardService, readStoryboardParams } from './storyboard-service';
import { WorkService } from './work-service';

/** 工作台视图读取的依赖。 */
export interface WorkbenchViewReaderDependencies {
  readonly works: WorkService;
  readonly projects: ProjectService;
  readonly storyboardService: StoryboardService;
  readonly providers: ProviderService;
  readonly runs: StageRunRepository;
  readonly screenplays: ScreenplayRepository;
  readonly storyboards: StoryboardRepository;
  readonly bindings: BindingRepository;
  readonly jobs: GenerationRepository;
  readonly profiles: GenerationProfileRepository;
  readonly models: Pick<ProviderRepository, 'findModelById'>;
  /** 当前时间的 ISO 字符串。 */
  readonly timestamp: () => string;
}

/** 视频生成工作台的视图读取。 */
export class WorkbenchViewReader {
  constructor(private readonly dependencies: WorkbenchViewReaderDependencies) {}

  /** 列出工作台可选的作品（有分镜脚本记录的）与当前可用的视频模型。 */
  async getCatalog(): Promise<WorkbenchCatalog> {
    const { works, projects, storyboardService, providers } = this.dependencies;
    const projectNames = new Map(projects.listProjects().map((project) => [project.id, project.name]));
    const workItems: WorkbenchWork[] = [];
    for (const work of works.listAllWorks()) {
      const episodes = storyboardService
        .listEpisodeStatuses(work.id)
        .filter((status) => status.display !== 'none')
        .map(({ episodeId, seq, title, display, shotCount }) => ({ episodeId, seq, title, display, shotCount }));
      if (episodes.length > 0) {
        workItems.push({ id: work.id, name: work.name, projectName: projectNames.get(work.projectId) ?? '', episodes });
      }
    }
    const models = (await providers.listUsableModels('video')).map(toWorkbenchModel);
    return { works: workItems, models, promptDefaults: { negativeList: DEFAULT_NEGATIVE_LIST, negativePresets: NEGATIVE_LIST_PRESETS } };
  }

  /**
   * 读取一集的工作台视图：镜头组、组内镜头及任务历史。读取时会补全还没有分组的镜头。
   * @param workId 作品标识。
   * @param episodeId 集标识。
   * @throws NotFoundError 作品或集不存在，或这一集还没有分镜脚本。
   */
  getEpisode(workId: number, episodeId: number): EpisodeWorkbenchView {
    const { works, runs, storyboardService, screenplays, storyboards, bindings, jobs, profiles } = this.dependencies;
    works.getWork(workId);
    const episode = storyboardService.listEpisodeStatuses(workId).find((status) => status.episodeId === episodeId);
    if (episode === undefined) {
      throw new NotFoundError('集不存在。');
    }
    const { run, isCurrent } = resolveWorkbenchRun(runs, workId, episodeId);
    const groupMax = groupMaxSecondsOf(readStoryboardParams(run));
    syncShotGroups(storyboards, run.id, groupMax, this.dependencies.timestamp());

    const entities = new Map(screenplays.listEntities(workId).map((entity) => [entity.id, entity]));
    const visualBound = new Set(
      bindings
        .listByEpisode(episodeId)
        .filter((binding) => binding.purpose === 'visual' && binding.isPrimary)
        .map((binding) => binding.entityId)
    );
    const shots = new Map(storyboards.listShots(run.id).map((shot) => [shot.id, shot]));
    const groups = storyboards.listGroups(run.id);
    const groupIds = groups.map((group) => group.id);
    const groupOverrides = profiles.listByGroups(groupIds);
    const resultList = jobs.listResultsByGroups(groupIds);
    const results = new Map<number, VideoResultRecord>(resultList.map((result) => [result.jobId, result]));
    const selectedByGroup = new Map<number, VideoResultRecord>(resultList.filter((result) => result.isSelected).map((result) => [result.groupId, result]));
    const jobsByGroup = new Map<number, VideoJobRecord[]>();
    for (const job of jobs.listJobsByGroups(groupIds)) {
      jobsByGroup.set(job.groupId, [...(jobsByGroup.get(job.groupId) ?? []), job]);
    }

    return {
      workId,
      episodeId,
      episodeTitle: episode.title,
      canGenerate: isCurrent,
      blockReason: isCurrent ? null : describeBlockReason(run.status, run.reviewStatus),
      groupMaxSeconds: groupMax,
      groups: groups.map((group, index) => {
        const members = group.shotIds.flatMap((id) => shots.get(id) ?? []);
        const groupJobs = jobsByGroup.get(group.id) ?? [];
        const selected = selectedByGroup.get(group.id);
        const entityIds = [...new Set(members.flatMap((shot) => shot.entityIds))];
        return {
          id: group.id,
          seq: group.seq,
          shots: members.map((shot) => ({
            id: shot.id,
            seq: shot.seq,
            sceneLabel: shot.sceneLabel,
            shotSize: shot.shotSize,
            prompt: shot.prompt,
            durationSeconds: shot.durationSeconds,
            soundCount: shot.sounds.filter((sound) => sound.isEnabled).length
          })),
          totalSeconds: sumSeconds(members),
          entities: entityIds.flatMap((id) => {
            const entity = entities.get(id);
            return entity === undefined ? [] : [{ id, name: entity.name, kindLabel: ENTITY_KIND_LABELS[entity.kind], bound: visualBound.has(id) }];
          }),
          overrides: groupOverrides.get(group.id) ?? EMPTY_PROFILE,
          jobs: pickVisibleJobs(groupJobs, selected?.jobId).map((job) => this.viewOf(job, results.get(job.id))),
          selectedResultId: selected?.id ?? null,
          staleNote: describeStaleTail(groupJobs, selected, groups[index - 1] === undefined ? undefined : selectedByGroup.get(groups[index - 1].id))
        };
      })
    };
  }

  /**
   * 读取一个镜头组全部历史成功的版本（视图里每组只带最近若干条任务，版本页需要看到全部）。
   * @param rawInput { workId, episodeId, groupId }。
   * @returns 有结果视频的任务视图，最新的在前。
   * @throws NotFoundError 作品或集不存在、这一集还没有分镜脚本，或镜头组不属于这一集。
   */
  getGroupVersions(rawInput: unknown): JobView[] {
    const { works, runs, jobs, storyboards } = this.dependencies;
    const source = readRecord(rawInput);
    const groupId = readEntityId({ id: source.groupId }, '镜头组');
    const { run } = resolveRequestedRun(works, runs, source);
    if (!storyboards.listGroups(run.id).some((group) => group.id === groupId)) {
      throw new NotFoundError('镜头组不存在，可能已被重新分组。');
    }
    const results = new Map(jobs.listResultsByGroups([groupId]).map((result) => [result.jobId, result]));
    return jobs
      .listJobsByGroups([groupId])
      .filter((job) => results.has(job.id))
      .map((job) => this.viewOf(job, results.get(job.id)));
  }

  /** 任务转视图：补上模型显示名，以及等待前序的说明。 */
  private viewOf(job: VideoJobRecord, result: VideoResultRecord | undefined): JobView {
    const model = this.dependencies.models.findModelById(job.modelId);
    return toJobView(job, result, model?.displayName ?? '', job.status === 'waiting' ? this.describeWaiting(job) : null);
  }

  /** 等待前序的任务在等什么：前序还在生成，或前序已完成、等工作台截取尾帧。 */
  private describeWaiting(job: VideoJobRecord): string {
    const previous = job.prevJobId === null ? undefined : this.dependencies.jobs.findJob(job.prevJobId);
    return previous?.status === 'succeeded'
      ? '上一组已生成，正在从视频截取尾帧作首帧（需要保持工作台打开）。'
      : '等待上一组生成完成，再用它的尾帧作首帧。';
  }
}
