// ------------------------------------------------------------------------
// 名称：generation-planning.ts
// 说明：按镜头组规划视频生成请求：校验时长与参数、解析首帧来源与出场实体的参考素材、编译请求快照、用模型适配器校验；不通过时返回全部阻断问题。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：只读、不写任务；是否入队、如何汇总预览由 generation-submission.ts 决定；模型调用信息由 resolveModelContext 解析，同一次提交里按模型缓存。
// ------------------------------------------------------------------------

import { ProviderError } from '../../domain/errors';
import { GenerationParams, JobSnapshot } from '../../domain/models/generation';
import { VideoCapability } from '../../domain/models/model-capability';
import { EntityKind } from '../../domain/models/screenplay';
import { StageRun } from '../../domain/models/stage-run';
import { ShotGroup, ShotRecord } from '../../domain/models/storyboard';
import { AssetRepository } from '../../domain/ports/asset-repository';
import { BindingRepository } from '../../domain/ports/binding-repository';
import { JobMediaReader } from '../../domain/ports/generation-repository';
import { ResolvedVideoCall } from '../../domain/ports/provider-adapters';
import { ScreenplayRepository } from '../../domain/ports/screenplay-repository';
import { maxGroupSeconds, validateGroupParams } from '../../domain/rules/group-duration-rules';
import { EntityReferences, planGroupRequest } from '../../domain/rules/group-request-planner';
import { PLACEHOLDER_FIRST_FRAME, buildVideoRequest } from '../queue/video-request';
import { FirstFrameLink, FirstFrameResolver, ResolvedFirstFrameImage } from './generation-first-frame';
import { ProviderService } from './provider-service';
import { readStoryboardStyle } from './storyboard-service';

/** 一个视频模型的调用信息。 */
export interface ModelContext {
  readonly usable: Awaited<ReturnType<ProviderService['listUsableModels']>>[number];
  readonly call: ResolvedVideoCall;
  readonly capability: VideoCapability;
  /** 模型单次最长时长（秒）；没有上限信息时为 null。 */
  readonly modelMax: number | null;
}

/** 规划一个镜头组所需的输入。 */
export interface GroupPlanContext {
  readonly workId: number;
  readonly episodeId: number;
  readonly run: StageRun;
  /** 组内镜头，按顺序。 */
  readonly members: readonly ShotRecord[];
  readonly totalSeconds: number;
  /** 上一镜头组；第一组为 undefined。 */
  readonly previousGroup: ShotGroup | undefined;
  /** 镜头组覆盖合并后的本组生成参数。 */
  readonly params: GenerationParams;
  readonly model: ModelContext;
  /** 本次提交里已建任务的镜头组标识与任务标识。 */
  readonly createdJobIds: ReadonlyMap<number, number>;
}

/** 规划通过的镜头组：请求快照，以及首帧的来源。 */
export interface PlannedGroup {
  readonly snapshot: JobSnapshot;
  /** 接在上一组尾帧之后时的依赖；否则为 undefined。 */
  readonly link: FirstFrameLink | undefined;
  /** 指定图片作首帧时的图片引用；否则为 null。 */
  readonly firstFrameImage: ResolvedFirstFrameImage | null;
}

/** 规划结果：通过时带规划内容，否则带全部阻断问题。 */
export type GroupPlanOutcome = { readonly ok: true; readonly plan: PlannedGroup } | { readonly ok: false; readonly issues: readonly string[] };

/** 按镜头组规划请求的依赖。 */
export interface GroupRequestPlannerDependencies {
  readonly screenplays: ScreenplayRepository;
  readonly bindings: BindingRepository;
  readonly assets: Pick<AssetRepository, 'listReferenceFiles'>;
  readonly media: JobMediaReader;
}

/**
 * 解析一个视频模型的调用信息。
 * @param providers 提供可用模型列表和视频调用解析的服务商服务。
 * @param modelId 模型标识。
 * @returns 调用信息；模型不可用时返回说明原因的文字。
 */
export async function resolveModelContext(providers: Pick<ProviderService, 'listUsableModels' | 'resolveVideoCall'>, modelId: number): Promise<ModelContext | string> {
  const usable = (await providers.listUsableModels('video')).find((candidate) => candidate.model.id === modelId);
  if (usable === undefined) {
    return '所选模型不可用，请检查“设置 > 模型”里的启用状态和访问密钥。';
  }
  let call: ResolvedVideoCall;
  try {
    call = await providers.resolveVideoCall(usable.model.id);
  } catch (error) {
    return error instanceof ProviderError ? error.message : '所选模型不可用。';
  }
  const capability = call.adapter.getCapability(call.modelCode);
  if (capability === undefined) {
    return '所选模型不可用。';
  }
  return { usable, call, capability, modelMax: maxGroupSeconds(capability.duration) };
}

/** 按镜头组规划视频生成请求。 */
export class GroupRequestPlanner {
  constructor(
    private readonly dependencies: GroupRequestPlannerDependencies,
    private readonly firstFrames: FirstFrameResolver
  ) {}

  /**
   * 校验这一组并编译请求；任何一步不通过就返回阻断问题，不再继续后面的步骤。
   * @param context 这一组的规划上下文（镜头、模型、参数、素材等）。
   */
  plan(context: GroupPlanContext): GroupPlanOutcome {
    const { workId, episodeId, run, members, totalSeconds, params, model } = context;
    const { usable, call, capability, modelMax } = model;
    if (modelMax !== null && totalSeconds > modelMax) {
      return reject(`这一组共 ${totalSeconds} 秒，超过所选模型单次最长 ${modelMax} 秒。请拆分这一组、重新分组，或换一个支持更长时长的模型。`);
    }
    const paramIssues = validateGroupParams(capability, params, totalSeconds);
    if (paramIssues.length > 0) {
      return { ok: false, issues: paramIssues };
    }
    const firstFrameImage = this.resolveFirstFrameImage(members[0], capability);
    if (typeof firstFrameImage === 'string') {
      return reject(firstFrameImage);
    }
    const link = this.resolveFirstFrameLink(members[0], capability, context);
    if (typeof link === 'string') {
      return reject(link);
    }
    const snapshot = planGroupRequest({
      shots: members,
      storyboardRunId: run.id,
      providerCode: usable.providerCode,
      modelCode: call.modelCode,
      capability,
      params,
      entities: this.collectEntityReferences(workId, episodeId, [...new Set(members.flatMap((shot) => shot.entityIds))]),
      useFirstFrame: link !== undefined,
      firstFrameFileId: firstFrameImage === null ? null : firstFrameImage.fileId,
      firstFrameImageId: firstFrameImage === null ? null : firstFrameImage.imageId,
      firstFrameSize: firstFrameImage === null ? null : { width: firstFrameImage.width, height: firstFrameImage.height },
      style: readStoryboardStyle(run)
    });
    let issues: readonly string[];
    try {
      const request = buildVideoRequest(snapshot, null, this.dependencies.media, call.modelCode);
      issues = call.adapter.validate(link === undefined ? request : { ...request, firstFrame: PLACEHOLDER_FIRST_FRAME });
    } catch (error) {
      issues = [error instanceof Error ? error.message : String(error)];
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true, plan: { snapshot, link, firstFrameImage } };
  }

  /**
   * 组的第一个镜头指定图片作首帧（资产参考图的第一张，或镜头自己上传的图片）时解析图片。
   * @returns 图片引用；没有指定时为 null；模型不支持首帧或图片已不可用时返回说明原因的文字。
   */
  private resolveFirstFrameImage(firstShot: ShotRecord | undefined, capability: VideoCapability): ResolvedFirstFrameImage | null | string {
    if (firstShot?.firstFrameMode !== 'asset' && firstShot?.firstFrameMode !== 'image') {
      return null;
    }
    if (!capability.firstFrame) {
      return '所选模型不支持首帧输入，无法用指定图片作首帧。请换一个支持首帧的模型，或点“编辑镜头”把首帧来源改为“无”。';
    }
    return firstShot.firstFrameMode === 'asset' ? this.firstFrames.resolveAssetImage(firstShot.firstFrameAssetId) : this.firstFrames.resolveLocalImage(firstShot.firstFrameImage);
  }

  /**
   * 组的第一个镜头设为“上一镜头尾帧作首帧”时，这一组要接在上一组后面（第一组没有上一组，不适用）。
   * @returns 依赖；不需要接上一组时为 undefined；模型不支持首帧或上一组没有可用结果时返回说明原因的文字。
   */
  private resolveFirstFrameLink(firstShot: ShotRecord | undefined, capability: VideoCapability, context: GroupPlanContext): FirstFrameLink | undefined | string {
    if (firstShot?.firstFrameMode !== 'prev_tail' || context.previousGroup === undefined) {
      return undefined;
    }
    if (!capability.firstFrame) {
      return '所选模型不支持首帧输入，无法用上一组的尾帧作首帧。请换一个支持首帧的模型，或点“编辑镜头”把首帧来源改为“无”。';
    }
    return this.firstFrames.linkPreviousGroup(context.previousGroup, context.createdJobIds);
  }

  /** 收集出场实体的绑定：每个实体取形象主资产与音色主资产的第一个参考文件，顺序与给定的标识一致。 */
  private collectEntityReferences(workId: number, episodeId: number, entityIds: readonly number[]): EntityReferences[] {
    const { screenplays, bindings, assets } = this.dependencies;
    const entities = new Map(screenplays.listEntities(workId).map((entity) => [entity.id, entity]));
    const episodeBindings = bindings.listByEpisode(episodeId).filter((binding) => binding.isPrimary);
    const firstFileId = (assetId: number): number | null => assets.listReferenceFiles(assetId)[0]?.id ?? null;
    return entityIds.flatMap((entityId) => {
      const entity = entities.get(entityId);
      if (entity === undefined) return [];
      const visual = episodeBindings.find((binding) => binding.entityId === entityId && binding.purpose === 'visual');
      const voice = episodeBindings.find((binding) => binding.entityId === entityId && binding.purpose === 'voice');
      return [
        {
          entityId,
          name: entity.name,
          kind: entity.kind as EntityKind,
          visualFileId: visual === undefined ? null : firstFileId(visual.assetId),
          voiceFileId: voice === undefined ? null : firstFileId(voice.assetId)
        }
      ];
    });
  }
}

/** 单条阻断问题的规划结果。 */
function reject(issue: string): GroupPlanOutcome {
  return { ok: false, issues: [issue] };
}
