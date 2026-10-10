// ------------------------------------------------------------------------
// 名称：generation-views.ts
// 说明：视频生成工作台的视图类型（作品与模型清单、集视图、镜头组视图、任务视图）、提交预览与提交结果类型，以及把任务记录整理成视图的纯函数。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：只有类型和不依赖仓库的纯函数；读取数据并组装视图见 workbench-view-reader.ts，提交预览与结果由 generation-submission.ts 产出。
// ------------------------------------------------------------------------

import { JOB_STATUS_LABELS, JobFailure, JobStatus, VideoJobRecord, VideoResultRecord } from '../../domain/models/generation';
import { ProfileValues } from '../../domain/models/generation-profile';
import { DurationCapability, VideoAudioElement, VideoAudioMode, VideoCapability } from '../../domain/models/model-capability';
import { StageDisplayStatus } from '../../domain/models/stage-run';
import { describeJobFailure } from '../../domain/rules/generation-failure-copy';
import { maxGroupSeconds } from '../../domain/rules/group-duration-rules';
import { describeDuration } from '../../domain/rules/model-capability-rules';
import { ProviderService } from './provider-service';

/** 每个镜头组在工作台视图中最多显示的任务数（最新的在前）；结果版本页另用 getGroupVersions 读取全部成功版本。 */
const MAX_JOBS_PER_GROUP = 10;

/** 工作台里的一集。 */
export interface WorkbenchEpisode {
  readonly episodeId: number;
  readonly seq: number;
  readonly title: string;
  readonly display: StageDisplayStatus | 'none';
  readonly shotCount: number;
}

/** 工作台里的一个作品：有分镜脚本记录的作品及其集。 */
export interface WorkbenchWork {
  readonly id: number;
  readonly name: string;
  readonly projectName: string;
  readonly episodes: readonly WorkbenchEpisode[];
}

/** 可选的视频模型及其可选参数。 */
export interface WorkbenchModel {
  readonly id: number;
  readonly displayName: string;
  readonly providerName: string;
  readonly aspectRatios: readonly string[];
  readonly resolutions: readonly string[];
  readonly audioModes: readonly VideoAudioMode[];
  /** 原生支持的声音内容。 */
  readonly audioElements: readonly VideoAudioElement[];
  /** 是否支持随机种子；不支持时参数页签的种子置灰。 */
  readonly supportsSeed: boolean;
  /** 是否支持提示词改写开关；不支持时参数页签的开关置灰。 */
  readonly supportsPromptExtend: boolean;
  /** 时长约束，页面据此检查本组指定的生成时长。 */
  readonly duration: DurationCapability;
  /** 时长约束的文字描述，如“2–30 秒，可由模型自动决定”。 */
  readonly durationText: string;
  /** 单次最多可生成的时长（秒）；没有上限信息时为 null。镜头组超过它就不能用该模型生成。 */
  readonly maxGroupSeconds: number | null;
}

/** 工作台的作品与模型清单。 */
export interface WorkbenchCatalog {
  readonly works: readonly WorkbenchWork[];
  readonly models: readonly WorkbenchModel[];
  /** 提示词相关的默认值，参数页签据此说明“当前生效”并提供常用项。 */
  readonly promptDefaults: { readonly negativeList: string; readonly negativePresets: readonly string[] };
}

/** 失败原因的界面视图。 */
export interface JobFailureView extends JobFailure {
  /** 分类的界面名称，如“内容审核未通过”。 */
  readonly label: string;
  /** 下一步怎么做的建议。 */
  readonly hint: string;
}

/** 结果视频的界面视图。 */
export interface JobResultView {
  readonly id: number;
  readonly durationSeconds: number | null;
  readonly sizeBytes: number;
  readonly hasAudio: boolean;
  readonly isSelected: boolean;
}

/** 任务提交时使用的生成参数（来自请求快照）。 */
export interface JobParamsView {
  readonly aspectRatio: string | null;
  readonly resolution: string | null;
  /** 整组视频的时长（秒）。 */
  readonly durationSeconds: number | null;
  readonly audioMode: VideoAudioMode | null;
  /** 实际传给模型的声音内容；声音模式不是原生生成时为 null。 */
  readonly audioElements: readonly VideoAudioElement[] | null;
  readonly seed: number | null;
}

/** 一条任务的界面视图。 */
export interface JobView {
  readonly id: number;
  readonly attempt: number;
  readonly status: JobStatus;
  readonly statusLabel: string;
  readonly modelName: string;
  readonly createdAt: string;
  readonly submittedAt: string | null;
  readonly finishedAt: string | null;
  /** 提交时使用的参数。 */
  readonly params: JobParamsView;
  /** 提交给模型的提示词全文。 */
  readonly prompt: string;
  readonly shotCount: number;
  readonly failure: JobFailureView | null;
  readonly warnings: readonly string[];
  /** 是否以上一组的尾帧作首帧。 */
  readonly usesPreviousTail: boolean;
  /** 是否以指定的图片作首帧。 */
  readonly usesFirstFrameImage: boolean;
  /** 提示词格式版本，用于区分不同写法编译出的提示词。 */
  readonly promptFormat: number;
  /** 等待前序时说明在等什么；其他状态为 null。 */
  readonly waitNote: string | null;
  readonly result: JobResultView | null;
}

/** 镜头出场实体的界面视图。 */
export interface ShotEntityView {
  readonly id: number;
  readonly name: string;
  readonly kindLabel: string;
  /** 是否已有形象绑定。 */
  readonly bound: boolean;
}

/** 组内一个镜头的界面视图。 */
export interface GroupShotView {
  readonly id: number;
  readonly seq: number;
  readonly sceneLabel: string;
  readonly shotSize: string;
  readonly prompt: string;
  readonly durationSeconds: number;
  readonly soundCount: number;
}

/** 一个镜头组的界面视图：组内镜头、出场实体与任务历史（最新的在前）。 */
export interface GroupView {
  readonly id: number;
  readonly seq: number;
  readonly shots: readonly GroupShotView[];
  /** 组内镜头时长之和（秒）。 */
  readonly totalSeconds: number;
  /** 组内出场的实体（去重）。 */
  readonly entities: readonly ShotEntityView[];
  readonly jobs: readonly JobView[];
  /** 这一组自己的参数覆盖；字段为 null 表示沿用本集、作品或项目的取值。 */
  readonly overrides: ProfileValues;
  /** 采用的结果视频；还没有成功的结果时为 null。 */
  readonly selectedResultId: number | null;
  /** 采用的视频接在上一组的旧尾帧之后（上一组后来改用了其他版本）时的说明；否则为 null。 */
  readonly staleNote: string | null;
}

/** 一集的工作台视图。 */
export interface EpisodeWorkbenchView {
  readonly workId: number;
  readonly episodeId: number;
  readonly episodeTitle: string;
  /** 能否生成：分镜脚本必须已确认采用。 */
  readonly canGenerate: boolean;
  /** 不能生成时的原因；能生成时为 null。 */
  readonly blockReason: string | null;
  /** 分镜脚本生成时设定的单组最长时长（秒）。 */
  readonly groupMaxSeconds: number;
  readonly groups: readonly GroupView[];
}

/** 一个被拒绝提交的镜头组及其原因。 */
export interface RejectedGroup {
  readonly groupId: number;
  readonly seq: number;
  readonly issues: readonly string[];
}

/** 提交结果：已入队的镜头组、被拒绝的镜头组与提醒。 */
export interface SubmitResult {
  readonly submitted: ReadonlyArray<{ readonly groupId: number; readonly seq: number; readonly jobId: number; readonly warnings: readonly string[] }>;
  readonly rejected: readonly RejectedGroup[];
}

/** 提交前预览中一个镜头组的汇总。 */
export interface GroupPreview {
  readonly groupId: number;
  readonly seq: number;
  readonly shotCount: number;
  /** 组内镜头时长之和（秒）。 */
  readonly totalSeconds: number;
  /** 按模型能力对齐后提交的整组时长（秒）；组不能提交时为 null。 */
  readonly durationSeconds: number | null;
  readonly firstFrame: 'none' | 'previous_tail' | 'image';
  /** 将要提交的完整提示词；组不能提交时为 null。 */
  readonly prompt: string | null;
  /** 实际写在提示词末尾的负向清单；没有或组不能提交时为 null。 */
  readonly negativeList: string | null;
  /** 提示词改写开关；null 表示不传，由平台用默认值。 */
  readonly promptExtend: boolean | null;
  readonly referenceImageCount: number;
  readonly referenceAudioCount: number;
  readonly audioMode: VideoAudioMode | null;
  /** 实际传给模型的声音内容；声音模式不是原生生成、或组不能提交时为 null。 */
  readonly audioElements: readonly VideoAudioElement[] | null;
  /** 本组使用的随机种子；为空表示随机。 */
  readonly seed: number | null;
  /** 阻断问题：有任何一条时这一组不能提交。 */
  readonly blocking: readonly string[];
  /** 提醒：不阻止提交。 */
  readonly warnings: readonly string[];
}

/** 提交预览：按组序号排列的各镜头组汇总。 */
export interface SubmitPreview {
  readonly groups: readonly GroupPreview[];
}

/** 一个可用的视频模型及其所属服务商。 */
type UsableVideoModel = Awaited<ReturnType<ProviderService['listUsableModels']>>[number];

/**
 * 可用的视频模型转工作台的模型选项。
 * @param usableModel 可用的视频模型及其服务商名称。
 */
export function toWorkbenchModel({ model, providerName }: UsableVideoModel): WorkbenchModel {
  const capability = model.capability as VideoCapability;
  return {
    id: model.id,
    displayName: model.displayName,
    providerName,
    aspectRatios: capability.aspectRatios,
    resolutions: capability.resolutions,
    audioModes: capability.audioModes,
    audioElements: capability.audioElements,
    supportsSeed: capability.seed,
    supportsPromptExtend: capability.promptExtend === true,
    duration: capability.duration,
    durationText: describeDuration(capability.duration),
    maxGroupSeconds: maxGroupSeconds(capability.duration)
  };
}

/**
 * 任务与结果记录转界面视图。
 * @param modelName 任务所用模型的显示名；模型已不存在时为空串。
 * @param waitNote 等待前序时的说明；其他状态为 null。
 */
export function toJobView(job: VideoJobRecord, result: VideoResultRecord | undefined, modelName: string, waitNote: string | null): JobView {
  return {
    id: job.id,
    attempt: job.attempt,
    status: job.status,
    statusLabel: JOB_STATUS_LABELS[job.status],
    modelName,
    createdAt: job.createdAt,
    submittedAt: job.submittedAt,
    finishedAt: job.finishedAt,
    params: {
      aspectRatio: job.snapshot.params.aspectRatio,
      resolution: job.snapshot.params.resolution,
      durationSeconds: job.snapshot.params.durationSeconds,
      audioMode: job.snapshot.params.audioMode,
      audioElements: job.snapshot.params.audioElements,
      seed: job.snapshot.params.seed
    },
    prompt: job.snapshot.prompt,
    shotCount: job.snapshot.shotIds.length,
    failure: job.failure === null ? null : { ...job.failure, ...describeJobFailure(job.failure) },
    warnings: job.snapshot.warnings,
    usesPreviousTail: job.prevJobId !== null || job.firstFrameId !== null,
    usesFirstFrameImage: job.snapshot.firstFrameFileId !== null || job.snapshot.firstFrameImageId !== null,
    promptFormat: job.snapshot.promptFormat,
    waitNote,
    result:
      result === undefined
        ? null
        : { id: result.id, durationSeconds: result.durationSeconds, sizeBytes: result.sizeBytes, hasAudio: result.hasAudio, isSelected: result.isSelected }
  };
}

/**
 * 一个镜头组显示的任务：最新的若干条，并始终包含采用的结果所属的任务（较早的采用版本不能被截断掉）。
 * @param groupJobs 镜头组的任务记录。
 * @param selectedJobId 采用的结果所属任务标识，没有时为 undefined。
 */
export function pickVisibleJobs(groupJobs: readonly VideoJobRecord[], selectedJobId: number | undefined): VideoJobRecord[] {
  const visible = groupJobs.slice(0, MAX_JOBS_PER_GROUP);
  const selectedJob = groupJobs.find((job) => job.id === selectedJobId);
  return selectedJob === undefined || visible.includes(selectedJob) ? visible : [...visible, selectedJob];
}

/**
 * 采用的视频是用上一组尾帧作首帧生成的，而上一组现在采用的是另一个版本时，返回说明。
 * @param groupJobs 这一组的全部任务。
 * @param selected 这一组采用的结果。
 * @param previousSelected 上一组采用的结果。
 */
export function describeStaleTail(groupJobs: readonly VideoJobRecord[], selected: VideoResultRecord | undefined, previousSelected: VideoResultRecord | undefined): string | null {
  const usedJobId = groupJobs.find((job) => job.id === selected?.jobId)?.prevJobId ?? null;
  if (usedJobId === null || previousSelected === undefined || previousSelected.jobId === usedJobId) {
    return null;
  }
  return '上一组后来改用了其他版本，本组采用的视频是接在上一组旧版本的尾帧之后生成的，画面可能不连贯，建议重新生成。';
}

/**
 * 没有已确认的分镜脚本时，说明为什么不能生成。
 * @param status 生成状态。
 * @param reviewStatus 审阅状态。
 */
export function describeBlockReason(status: string, reviewStatus: string): string {
  if (status === 'running') return '分镜脚本正在生成，完成并确认采用后才能生成视频。';
  if (status === 'failed' || status === 'canceled') return '分镜脚本没有生成成功，请先到“分镜”列表重新生成。';
  if (reviewStatus === 'pending') return '分镜脚本还没有确认采用（修改镜头后需要重新确认）。请点“查看分镜脚本”，确认采用后再生成。';
  return '分镜脚本尚未确认采用。';
}
