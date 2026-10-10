// ------------------------------------------------------------------------
// 名称：screenplay-views.ts
// 说明：剧本阶段产出页的视图类型（集、实体、改编清单、操作许可、完整页面视图）与视图装配：读取版本、剧本包、集与实体、改编清单，整理成页面视图。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：只读；合并之前集与实体来自剧本包上的抽取结果（ref 为位置），合并之后来自作品（ref 为数据库标识）；编辑见 merged-screenplay-editor.ts 与 package-screenplay-editor.ts。
// ------------------------------------------------------------------------

import { NotFoundError } from '../../domain/errors';
import { AdaptationChecklist, AdaptationOption } from '../../domain/models/adaptation-checklist';
import { BeatSheet } from '../../domain/models/beat-sheet';
import { ENTITY_ATTRIBUTES, ENTITY_KIND_LABELS, EntityKind, ScreenplayFidelity, ScreenplayParams, ScreenplayStructure, TextSegment } from '../../domain/models/screenplay';
import { ProductionFormatType } from '../../domain/models/production-profile';
import { StageRun, StageTarget } from '../../domain/models/stage-run';
import { WorkSourceType } from '../../domain/models/work';
import { AdaptationChecklistRepository } from '../../domain/ports/adaptation-checklist-repository';
import { ScreenplayRepository } from '../../domain/ports/screenplay-repository';
import { StageRunRepository } from '../../domain/ports/stage-run-repository';
import { EstimatedTotal, computeEstimatedTotal } from '../../domain/rules/adaptation-checklist-rules';
import { readBeatSheetSnapshot } from '../../domain/rules/beat-sheet-rules';
import { isMultiEpisode } from '../../domain/rules/production-profile-rules';
import { countSpokenWords } from '../../domain/rules/screenplay-rules';
import { canApprove, canCancel, canRetry, isStale } from '../../domain/rules/stage-review-rules';
import { evaluateCalibration } from '../../domain/rules/timing-calibration-rules';
import { WORK_KIND_LABELS } from '../../domain/rules/work-rules';
import { readRunParams } from './stage-run-params';
import { StageActions, StageRunView, StageVersionItem, toRunView, toVersionItem } from './stage-service';
import { WorkService } from './work-service';

/** 实体类型与设定字段的说明，内容固定，每次视图共用。 */
const ENTITY_KIND_VIEWS: EntityKindView[] = (Object.keys(ENTITY_KIND_LABELS) as EntityKind[]).map((kind) => ({
  kind,
  label: ENTITY_KIND_LABELS[kind],
  attributes: ENTITY_ATTRIBUTES[kind]
}));

/** 阶段产出页展示的一集；ref 是编辑时回传的定位值（合并前为抽取结果中的位置，合并后为集的标识）。 */
export interface ScreenplayEpisodeView {
  readonly ref: number;
  readonly seq: number;
  readonly title: string;
  readonly synopsis: string;
  readonly screenplayText: string;
  readonly targetDurationSeconds: number | null;
  /** 正文的结构标注；没有标注时缺省。 */
  readonly segments?: readonly TextSegment[];
  /** 有已确认节拍表时，本集正文的参考目标、实测值与偏差；没有节拍表时缺省。 */
  readonly reference?: EpisodeReference;
}

/** 一集正文的参考时长与实测时长（按语速换算）的对比。 */
export interface EpisodeReference {
  readonly targetSeconds: number;
  readonly actualSeconds: number;
  /** (实测 - 目标) / 目标。 */
  readonly deviationRatio: number;
  readonly withinTolerance: boolean;
}

/** 结构性改编清单的视图：页面按勾选在本地重算预计总时长（公式见 computeEstimatedTotal），不向宿主发请求。 */
export interface AdaptationView {
  readonly baselineWords: number;
  readonly baselineSeconds: number;
  readonly targetSeconds: number;
  readonly wordsPerSecond: number;
  readonly toleranceRatio: number;
  /** 已确认的清单只读。 */
  readonly confirmed: boolean;
  readonly options: readonly AdaptationOption[];
  /** 按当前勾选的预计总量，页面勾选变化后自行重算。 */
  readonly estimate: EstimatedTotal;
}

/** 阶段产出页展示的一个实体；ref 含义同集。 */
export interface ScreenplayEntityView {
  readonly ref: number;
  readonly kind: EntityKind;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly isActive: boolean;
}

/** 剧本阶段允许的操作：在通用操作之上多一个重新抽取。 */
export interface ScreenplayActions extends StageActions {
  /** 只有最新版本、生成成功、尚未合并时才能重新抽取。 */
  readonly canReextract: boolean;
  /** 保真模式下，条件与重新抽取相同时可以只重新标注：保留已抽取的集和实体，重做所有集的结构标注。 */
  readonly canReannotate: boolean;
  /** 改编清单待确认时可以确认取舍并继续生成正文。 */
  readonly canConfirmAdaptation: boolean;
}

/** 实体类型及其设定字段的界面说明，页面据此渲染实体编辑表单。 */
export interface EntityKindView {
  readonly kind: EntityKind;
  readonly label: string;
  readonly attributes: ReadonlyArray<{ readonly key: string; readonly label: string }>;
}

/** 剧本阶段产出页的完整视图。 */
export interface ScreenplayStageView {
  readonly work: {
    readonly id: number;
    readonly projectId: number;
    readonly name: string;
    readonly kind: ProductionFormatType;
    /** 作品形态的界面名称。 */
    readonly kindLabel: string;
    /** 体量是否按剧情拆分为多集；否则只有 1 集，不能增删集。 */
    readonly multiEpisode: boolean;
    readonly sourceType: WorkSourceType;
  };
  readonly versions: StageVersionItem[];
  readonly run: StageRunView;
  readonly params: ScreenplayParams | null;
  /** 改编强度：verbatim 表示原稿文字原样保留，集正文带结构标注。 */
  readonly fidelity: ScreenplayFidelity;
  /** 剧本包正文；还没有生成时为 null。 */
  readonly screenplay: { readonly title: string; readonly overview: string; readonly fullText: string } | null;
  /** 结构性改编清单；没有触发改编时为 null。清单待确认时还没有剧本正文。 */
  readonly adaptation: AdaptationView | null;
  /** 有已确认节拍表时的容差比例；没有为 null。 */
  readonly toleranceRatio: number | null;
  /** 有已确认节拍表时的自动重写轮数上限（达到上限仍超出容差才标红）；没有为 null。 */
  readonly maxCalibrationRounds: number | null;
  readonly episodes: ScreenplayEpisodeView[];
  readonly entities: ScreenplayEntityView[];
  readonly entityKinds: EntityKindView[];
  /** 集与实体是否来自作品（已合并到作品，编辑直接改作品的集和实体）。 */
  readonly merged: boolean;
  /** 上游创意已被修改或不再是已确认版本。 */
  readonly stale: boolean;
  /** 下游已有分镜脚本的集序号，确认采用新版本前提示用户它们可能过期。 */
  readonly downstreamEpisodes: number[];
  /** 确认采用这个版本时会被移除的旧集序号：新版本里已不存在、且没有下游数据；已合并的版本为空。 */
  readonly removedEpisodes: number[];
  /** 新版本里已不存在、但已有下游数据的旧集序号：它们存在时确认采用会被拒绝，需先在新版本中保留；已合并的版本为空。 */
  readonly blockedEpisodes: number[];
  readonly actions: ScreenplayActions;
}

/** 装配剧本阶段产出页视图所读取的数据来源。 */
export interface ScreenplayViewSources {
  readonly works: Pick<WorkService, 'getWork'>;
  readonly runs: Pick<StageRunRepository, 'listVersions' | 'findById'>;
  readonly screenplays: ScreenplayRepository;
  readonly checklists: Pick<AdaptationChecklistRepository, 'find'>;
}

/**
 * 作品剧本阶段的目标。
 * @param workId 作品标识。
 */
export function screenplayTarget(workId: number): StageTarget {
  return { workId, stage: 'screenplay', episodeId: null };
}

/**
 * 从记录的输入快照中取出改编强度；快照里没有该字段时为 adapted。
 * @param run 剧本阶段记录。
 */
export function readFidelity(run: StageRun): ScreenplayFidelity {
  return (run.input as { fidelity?: unknown }).fidelity === 'verbatim' ? 'verbatim' : 'adapted';
}

/**
 * 整理剧本阶段产出页的视图。
 * @param workId 作品标识。
 * @param runId 要查看的版本；缺省为最新版本。
 * @throws NotFoundError 作品或版本不存在，或还没有生成记录。
 */
export function buildScreenplayStageView(sources: ScreenplayViewSources, workId: number, runId?: number): ScreenplayStageView {
  const { works, runs, screenplays, checklists } = sources;
  const work = works.getWork(workId);
  const versions = runs.listVersions(screenplayTarget(workId));
  const latest = versions[0];
  if (latest === undefined) {
    throw new NotFoundError('该作品还没有剧本生成记录。');
  }
  const run = runId === undefined ? latest : versions.find((candidate) => candidate.id === runId);
  if (run === undefined) {
    throw new NotFoundError('版本不存在。');
  }

  const screenplay = screenplays.find(run.id);
  const merged = run.id === latest.id && run.appliedAt !== null;
  const beatSheet = readBeatSheetSnapshot((run.input as { beatSheet?: unknown }).beatSheet);
  const { episodes: rawEpisodes, entities } = merged ? readMergedContent(screenplays, workId) : readPackageContent(screenplay?.structure ?? null);
  const episodes = beatSheet === undefined ? rawEpisodes : rawEpisodes.map((episode) => ({ ...episode, reference: toEpisodeReference(episode.screenplayText, beatSheet) }));
  const checklist = checklists.find(run.id);
  const source = run.sourceRunId === null ? undefined : runs.findById(run.sourceRunId);
  // 改编清单待确认时还没有剧本正文，不能编辑或确认采用。
  const hasText = screenplay !== undefined && screenplay.structure !== null;
  const canEdit = run.id === latest.id && run.status === 'succeeded' && screenplay !== undefined;
  const removal = run.appliedAt === null ? screenplays.listEpisodesRemovedByMerge(run.id) : [];
  return {
    work: { id: work.id, projectId: work.projectId, name: work.name, kind: work.kind, kindLabel: WORK_KIND_LABELS[work.kind], multiEpisode: isMultiEpisode(work.kind), sourceType: work.sourceType },
    versions: versions.map(toVersionItem),
    run: toRunView(run),
    params: readRunParams<ScreenplayParams>(run),
    fidelity: readFidelity(run),
    screenplay: screenplay === undefined ? null : { title: screenplay.title, overview: screenplay.overview, fullText: screenplay.fullText },
    adaptation: checklist === undefined ? null : toAdaptationView(checklist),
    toleranceRatio: beatSheet?.params.toleranceRatio ?? null,
    maxCalibrationRounds: beatSheet?.params.maxCalibrationRounds ?? null,
    episodes,
    entities,
    entityKinds: ENTITY_KIND_VIEWS,
    merged,
    stale: run.status === 'succeeded' && isStale(run, source),
    downstreamEpisodes: screenplays
      .listEpisodes(workId)
      .filter((episode) => runs.listVersions({ workId, stage: 'storyboard_script', episodeId: episode.id }).length > 0)
      .map((episode) => episode.seq),
    removedEpisodes: removal.filter((episode) => !episode.hasDownstream).map((episode) => episode.seq),
    blockedEpisodes: removal.filter((episode) => episode.hasDownstream).map((episode) => episode.seq),
    actions: {
      canApprove: canApprove(run) && hasText,
      canCancel: canCancel(run),
      canRetry: canRetry(run),
      canEdit,
      editNeedsConfirm: run.reviewStatus === 'approved',
      canReextract: canEdit && run.appliedAt === null,
      canReannotate: canEdit && run.appliedAt === null && readFidelity(run) === 'verbatim' && (screenplay?.structure ?? null) !== null,
      canConfirmAdaptation: run.id === latest.id && run.status === 'succeeded' && screenplay === undefined && checklist !== undefined && checklist.confirmedAt === null
    }
  };
}

/** 读取作品已合并的集和实体，ref 为数据库标识。 */
function readMergedContent(screenplays: ScreenplayRepository, workId: number): { episodes: ScreenplayEpisodeView[]; entities: ScreenplayEntityView[] } {
  return {
    episodes: screenplays.listEpisodes(workId).map((episode) => ({ ref: episode.id, ...episode })),
    entities: screenplays.listEntities(workId).map((entity) => ({ ref: entity.id, ...entity }))
  };
}

/** 剧本包上的抽取结果转视图，ref 为在抽取结果中的位置；没有抽取结果时为空。 */
function readPackageContent(structure: ScreenplayStructure | null): { episodes: ScreenplayEpisodeView[]; entities: ScreenplayEntityView[] } {
  return {
    episodes: (structure?.episodes ?? []).map((episode, index) => ({ ref: index, ...episode })),
    entities: (structure?.entities ?? []).map((entity, index) => ({ ref: index, ...entity }))
  };
}

/** 一集正文相对节拍表目标时长的对比：按节拍表的语速把口播字数（台词与旁白）换算为秒。 */
function toEpisodeReference(text: string, beatSheet: BeatSheet): EpisodeReference {
  const { targetDurationSeconds, wordsPerSecond, toleranceRatio } = beatSheet.params;
  const actualSeconds = Math.round((countSpokenWords(text) / wordsPerSecond) * 10) / 10;
  const result = evaluateCalibration(actualSeconds, targetDurationSeconds, toleranceRatio);
  return { targetSeconds: targetDurationSeconds, actualSeconds, deviationRatio: result.deviationRatio, withinTolerance: result.withinTolerance };
}

/** 改编清单转视图，附带按当前勾选的预计总量。 */
function toAdaptationView(checklist: AdaptationChecklist): AdaptationView {
  return {
    baselineWords: checklist.baselineWords,
    baselineSeconds: checklist.baselineSeconds,
    targetSeconds: checklist.targetSeconds,
    wordsPerSecond: checklist.wordsPerSecond,
    toleranceRatio: checklist.toleranceRatio,
    confirmed: checklist.confirmedAt !== null,
    options: checklist.options,
    estimate: computeEstimatedTotal(checklist)
  };
}
