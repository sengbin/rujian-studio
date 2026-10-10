// ------------------------------------------------------------------------
// 名称：generation-group-editor.ts
// 说明：镜头组编辑：重新分组、在某个镜头前拆分组、把一组并入上一组，以及保存镜头组自己的生成参数覆盖。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：有生成记录的组不能拆分或合并，有进行中任务时不能重新分组；重新分组会连同旧组的生成记录一起清除，已保存的视频文件不删除；布局的计算在 domain/rules/shot-group-rules.ts，读取与写回在 shot-grouping.ts。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, ValidationError } from '../../domain/errors';
import { EMPTY_PROFILE, ProfileValues } from '../../domain/models/generation-profile';
import { GenerationProfileRepository } from '../../domain/ports/generation-profile-repository';
import { GenerationRepository } from '../../domain/ports/generation-repository';
import { ProviderRepository } from '../../domain/ports/provider-repository';
import { StageRunRepository } from '../../domain/ports/stage-run-repository';
import { StoryboardRepository } from '../../domain/ports/storyboard-repository';
import { FieldErrors, assertNoFieldErrors, readEntityId, readInteger, readRecord } from '../../domain/rules/field-readers';
import { applyProfileChanges, readProfileChanges } from '../../domain/rules/generation-profile-rules';
import { GROUP_SECONDS_MAX, GROUP_SECONDS_MIN, groupMaxSecondsOf, mergeLayoutIntoPrevious, splitLayoutBefore } from '../../domain/rules/shot-group-rules';
import { resolveRequestedRun, resolveWorkbenchRun } from './generation-run';
import { readGroupLayout, regroupShots } from './shot-grouping';
import { readStoryboardParams } from './storyboard-service';
import { WorkService } from './work-service';

/** 镜头组编辑的依赖。 */
export interface ShotGroupEditorDependencies {
  readonly works: Pick<WorkService, 'getWork'>;
  readonly runs: StageRunRepository;
  readonly storyboards: StoryboardRepository;
  readonly jobs: GenerationRepository;
  /** 镜头组级的生成参数覆盖。 */
  readonly profiles: GenerationProfileRepository;
  readonly models: Pick<ProviderRepository, 'findModelById'>;
  /** 当前时间的 ISO 字符串。 */
  readonly timestamp: () => string;
}

/** 镜头组编辑。 */
export class ShotGroupEditor {
  constructor(private readonly dependencies: ShotGroupEditorDependencies) {}

  /**
   * 保存一个镜头组的参数覆盖：changes 里出现的字段被覆盖，值为 null（或空串）表示恢复继承。
   * @param rawInput `{ workId, episodeId, groupId, changes }`。
   * @returns 保存后这一组的覆盖。
   * @throws ValidationError 字段不合法、模型不是可用的视频模型，或镜头组不属于当前的分镜脚本。
   * @throws NotFoundError 作品不存在。
   */
  saveProfile(rawInput: unknown): ProfileValues {
    const { works, runs, storyboards, profiles, models, timestamp } = this.dependencies;
    const source = readRecord(rawInput);
    const workId = readEntityId({ id: source.workId }, '作品');
    const episodeId = readEntityId({ id: source.episodeId }, '集');
    const groupId = readEntityId({ id: source.groupId }, '镜头组');
    const changes = readProfileChanges(source.changes);
    works.getWork(workId);
    const { run } = resolveWorkbenchRun(runs, workId, episodeId);
    if (!storyboards.listGroups(run.id).some((group) => group.id === groupId)) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '镜头组不属于这一集当前的分镜脚本。' });
    }
    if (changes.modelId !== undefined && changes.modelId !== null) {
      const model = models.findModelById(changes.modelId);
      if (model === undefined || model.kind !== 'video') {
        throw new ValidationError({ modelId: '所选模型不存在或不是视频模型。' });
      }
    }
    const target = { scope: 'group', groupId } as const;
    const next = applyProfileChanges(profiles.find(target) ?? EMPTY_PROFILE, changes);
    profiles.save(target, next, timestamp());
    return next;
  }

  /**
   * 丢弃这一集现有的镜头组，按单组最长时长重新分组。已有的生成记录会随旧的组一起清除，已保存的视频文件不删除。
   * @param rawInput { workId, episodeId, maxSeconds? }，maxSeconds 缺省用分镜脚本生成时设定的值。
   * @throws ValidationError 内容不合法，或有正在生成的组。
   * @throws NotFoundError 作品、集不存在或还没有分镜脚本。
   */
  regroup(rawInput: unknown): void {
    const { storyboards, jobs, timestamp } = this.dependencies;
    const source = readRecord(rawInput);
    const { run } = this.resolveRun(source);
    let maxSeconds = groupMaxSecondsOf(readStoryboardParams(run));
    if (source.maxSeconds !== undefined && source.maxSeconds !== null) {
      const errors: FieldErrors = {};
      maxSeconds = readInteger(source, { key: 'maxSeconds', label: '单组最长时长', required: true, min: GROUP_SECONDS_MIN, max: GROUP_SECONDS_MAX }, errors);
      assertNoFieldErrors(errors);
    }
    const groups = storyboards.listGroups(run.id);
    if (groups.some((group) => jobs.hasActiveJob(group.id))) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '有镜头组正在生成，完成或取消后才能重新分组。' });
    }
    regroupShots(storyboards, run.id, maxSeconds, timestamp());
  }

  /**
   * 在某个镜头之前拆开所在的组（该镜头及后面的镜头成为新组）。
   * @param rawInput { workId, episodeId, shotId }。
   * @throws ValidationError 镜头已是组内第一个，或所在的组已有生成记录。
   */
  splitGroup(rawInput: unknown): void {
    const { storyboards, timestamp } = this.dependencies;
    const source = readRecord(rawInput);
    const { run } = this.resolveRun(source);
    const shotId = readEntityId({ id: source.shotId }, '镜头');
    const layout = readGroupLayout(storyboards, run.id);
    const next = splitLayoutBefore(layout, shotId);
    const affected = layout.find((entry) => entry.shotIds.includes(shotId))?.groupId;
    this.assertNoJobs(affected === undefined || affected === null ? [] : [affected]);
    storyboards.applyGroupLayout(run.id, next, timestamp());
  }

  /**
   * 把一个组并入上一组。
   * @param rawInput { workId, episodeId, groupId }。
   * @throws ValidationError 已是第一组，或这两组有生成记录。
   */
  mergeGroup(rawInput: unknown): void {
    const { storyboards, timestamp } = this.dependencies;
    const source = readRecord(rawInput);
    const { run } = this.resolveRun(source);
    const groupId = readEntityId({ id: source.groupId }, '镜头组');
    const layout = readGroupLayout(storyboards, run.id);
    const next = mergeLayoutIntoPrevious(layout, groupId);
    const index = layout.findIndex((entry) => entry.groupId === groupId);
    this.assertNoJobs([groupId, layout[index - 1].groupId as number]);
    storyboards.applyGroupLayout(run.id, next, timestamp());
  }

  /** 读取请求中的作品与集，返回对应的分镜脚本版本。 */
  private resolveRun(source: Record<string, unknown>) {
    return resolveRequestedRun(this.dependencies.works, this.dependencies.runs, source);
  }

  /** 这些镜头组已有生成记录时不能调整成员。 */
  private assertNoJobs(groupIds: readonly number[]): void {
    if (this.dependencies.jobs.listJobsByGroups(groupIds).length > 0) {
      throw new ValidationError({
        [FORM_LEVEL_ERROR_KEY]: '这一组已经有生成记录，不能拆分或合并。需要调整时请使用“重新分组”（会清除本集已有的生成记录）。'
      });
    }
  }
}
