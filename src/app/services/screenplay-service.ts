// ------------------------------------------------------------------------
// 名称：screenplay-service.ts
// 说明：剧本阶段应用服务：启动剧本生成、整理阶段产出页的视图、保存人工编辑的正文、集（含结构标注）与实体，调整集的顺序、重新抽取、重新标注。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：确认采用时才把抽取结果合并到集和实体（见 StageService.approve）；合并之前编辑的是剧本包上的抽取结果，合并之后编辑的是作品的集和实体本身；集的正文被修改后结构标注即失效并清除，只修改标注则保留片段原文。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, NotFoundError, ValidationError } from '../../domain/errors';
import { AdaptationChecklist, AdaptationOption } from '../../domain/models/adaptation-checklist';
import { BeatSheet } from '../../domain/models/beat-sheet';
import {
  ENTITY_ATTRIBUTES,
  ENTITY_KIND_LABELS,
  EntityKind,
  EpisodeDraft,
  EpisodeRecord,
  ScreenplayFidelity,
  ScreenplayParams,
  ScreenplayStructure,
  TextSegment
} from '../../domain/models/screenplay';
import { ProductionFormatType } from '../../domain/models/production-profile';
import { StageRun, StageTarget } from '../../domain/models/stage-run';
import { WorkSourceType } from '../../domain/models/work';
import { AdaptationChecklistRepository } from '../../domain/ports/adaptation-checklist-repository';
import { ScreenplayRepository } from '../../domain/ports/screenplay-repository';
import { StageRunRepository } from '../../domain/ports/stage-run-repository';
import { EstimatedTotal, computeEstimatedTotal, normalizeSelection } from '../../domain/rules/adaptation-checklist-rules';
import { readBeatSheetSnapshot } from '../../domain/rules/beat-sheet-rules';
import { readMoveStep, readRecord } from '../../domain/rules/field-readers';
import { isMultiEpisode } from '../../domain/rules/production-profile-rules';
import { applySegmentLabelEdits } from '../../domain/rules/segment-rules';
import {
  EPISODE_DURATION_MAX_SECONDS,
  MAX_ENTITIES,
  MAX_EPISODES_LIMIT,
  countSpokenWords,
  normalizeEntityEdit,
  normalizeEpisodeEdit,
  normalizeScreenplayTextEdit
} from '../../domain/rules/screenplay-rules';
import { canApprove, canCancel, canRetry, createEditPatch, isStale } from '../../domain/rules/stage-review-rules';
import { evaluateCalibration } from '../../domain/rules/timing-calibration-rules';
import { WORK_KIND_LABELS } from '../../domain/rules/work-rules';import { ApprovedBeatSheetReader } from '../stages/approved-beat-sheet';
import { StageRunner } from '../stages/stage-runner';
import { StageActions, StageRunView, StageService, StageVersionItem, toRunView, toVersionItem } from './stage-service';
import { WorkService } from './work-service';

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

/** 剧本阶段应用服务的依赖。 */
export interface ScreenplayServiceDependencies {
  readonly works: WorkService;
  readonly runs: StageRunRepository;
  readonly screenplays: ScreenplayRepository;
  readonly checklists: AdaptationChecklistRepository;
  /** 读取作品当前已确认的节拍表：生成剧本时把它存进输入快照。 */
  readonly approvedBeatSheet: ApprovedBeatSheetReader;
  readonly runner: StageRunner;
  /** 阶段服务：提供确认、编辑的通用流程与变化通知。 */
  readonly stages: StageService;
  readonly now?: () => Date;
}

/** 实体类型与设定字段的说明，内容固定，每次视图共用。 */
const ENTITY_KIND_VIEWS: EntityKindView[] = (Object.keys(ENTITY_KIND_LABELS) as EntityKind[]).map((kind) => ({
  kind,
  label: ENTITY_KIND_LABELS[kind],
  attributes: ENTITY_ATTRIBUTES[kind]
}));

/** 剧本阶段应用服务。 */
export class ScreenplayService {
  constructor(private readonly dependencies: ScreenplayServiceDependencies) {}

  /**
   * 检查作品能否开始生成剧本：创意必须已确认。表单打开时先检查，避免用户填完才报错。
   * @throws NotFoundError 作品不存在。
   * @throws ValidationError 创意还没有已确认的版本。
   */
  assertCanStart(workId: number): void {
    this.dependencies.works.getWork(workId);
    if (this.dependencies.runs.findCurrent({ workId, stage: 'creative', episodeId: null }) === undefined) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '请先确认创意。' });
    }
  }

  /**
   * 启动作品的剧本生成：新建一个版本，生成在后台执行。
   * @param workId 作品标识。
   * @param rawParams 表单提交的生成参数。
   * @throws NotFoundError 作品不存在。
   * @throws ValidationError 参数不合法、创意未确认或该作品正在生成剧本。
   * @throws TextGenerationError 没有可用的文本模型。
   */
  async start(workId: number, rawParams: unknown): Promise<StageRun> {
    const work = this.dependencies.works.getWork(workId);
    const verbatim = work.sourceType === 'original';
    // 原稿保真模式不改写正文，没有改编清单与校准，不需要节拍表。
    const beatSheet = verbatim ? undefined : this.dependencies.approvedBeatSheet(workId);
    const run = await this.dependencies.runner.start({
      target: screenplayTarget(workId),
      input: {
        formatType: work.kind,
        workName: work.name,
        fidelity: verbatim ? 'verbatim' : 'adapted',
        params: rawParams,
        ...(beatSheet === undefined ? {} : { beatSheet })
      }
    });
    this.dependencies.stages.notifyChanged(run);
    return run;
  }

  /**
   * 读取最近一次剧本生成使用的参数，作为“重新生成”表单的初始值。
   * @returns 参数；没有生成记录时为 undefined。
   */
  getLastParams(workId: number): ScreenplayParams | undefined {
    const [latest] = this.dependencies.runs.listVersions(screenplayTarget(workId));
    return latest === undefined ? undefined : (readParams(latest) ?? undefined);
  }

  /**
   * 统计最新剧本版本的集数与实体数，用于作品列表；合并后按作品的集和实体统计，否则按抽取结果统计。
   * @returns 数量；没有生成成功的剧本或还没有抽取结果时为 null。
   */
  getContentCounts(workId: number): { readonly episodes: number; readonly entities: number } | null {
    const { runs, screenplays } = this.dependencies;
    const [latest] = runs.listVersions(screenplayTarget(workId));
    if (latest === undefined || latest.status !== 'succeeded') {
      return null;
    }
    if (latest.appliedAt !== null) {
      return { episodes: screenplays.listEpisodes(workId).length, entities: screenplays.listEntities(workId).length };
    }
    const structure = screenplays.find(latest.id)?.structure;
    return structure === null || structure === undefined ? null : { episodes: structure.episodes.length, entities: structure.entities.length };
  }

  /**
   * 整理剧本阶段产出页的视图。
   * @param workId 作品标识。
   * @param runId 要查看的版本；缺省为最新版本。
   * @throws NotFoundError 作品或版本不存在，或还没有生成记录。
   */
  getView(workId: number, runId?: number): ScreenplayStageView {
    const { works, runs, screenplays } = this.dependencies;
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
    const { episodes: rawEpisodes, entities } = merged ? this.readMerged(workId) : readStructure(screenplay?.structure ?? null);
    const episodes = beatSheet === undefined ? rawEpisodes : rawEpisodes.map((episode) => ({ ...episode, reference: toEpisodeReference(episode.screenplayText, beatSheet) }));
    const checklist = this.dependencies.checklists.find(run.id);
    const source = run.sourceRunId === null ? undefined : runs.findById(run.sourceRunId);
    // 改编清单待确认时还没有剧本正文，不能编辑或确认采用。
    const hasText = screenplay !== undefined && screenplay.structure !== null;
    const canEdit = run.id === latest.id && run.status === 'succeeded' && screenplay !== undefined;
    const removal = run.appliedAt === null ? screenplays.listEpisodesRemovedByMerge(run.id) : [];
    return {
      work: { id: work.id, projectId: work.projectId, name: work.name, kind: work.kind, kindLabel: WORK_KIND_LABELS[work.kind], multiEpisode: isMultiEpisode(work.kind), sourceType: work.sourceType },
      versions: versions.map(toVersionItem),
      run: toRunView(run),
      params: readParams(run),
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

  /**
   * 按已确认的节拍表建议生成参数，作为“生成剧本”表单的初始值：单集最大时长取目标时长加容差，集数上限取节拍表的参考集数。
   * @returns 建议值；作品没有已确认的节拍表时为 undefined。
   */
  suggestParams(workId: number): { readonly maxEpisodeDurationSeconds: number; readonly maxEpisodes: number } | undefined {
    const beatSheet = this.dependencies.approvedBeatSheet(workId);
    if (beatSheet === undefined) {
      return undefined;
    }
    const { targetDurationSeconds, toleranceRatio, episodeCount } = beatSheet.params;
    return {
      maxEpisodeDurationSeconds: Math.min(EPISODE_DURATION_MAX_SECONDS, Math.ceil(targetDurationSeconds * (1 + toleranceRatio))),
      maxEpisodes: episodeCount
    };
  }

  /**
   * 保存用户对改编取舍项的勾选（不改变确认状态），页面每次勾选变化后调用，刷新后勾选不丢失。
   * @param rawInput { selected: string[] }，被勾选的取舍项标识。
   * @throws NotFoundError 记录或清单不存在。
   * @throws ValidationError 不是最新版本、清单已确认或勾选内容不合法。
   */
  saveAdaptationSelection(runId: number, rawInput: unknown): void {
    const checklist = this.requireOpenChecklist(runId);
    const selected = normalizeSelection(rawInput, checklist);
    this.dependencies.checklists.updateSelection(runId, selected, this.timestamp());
    this.dependencies.stages.notifyChanged(this.dependencies.stages.requireRun(runId));
  }

  /**
   * 确认改编取舍：保存最终勾选并确认清单，随后在后台继续生成剧本正文（按已确认的取舍改编）；进度通过阶段事件推送。
   * @param rawInput { selected: string[] }。
   * @throws NotFoundError 记录或清单不存在。
   * @throws ValidationError 不是最新版本、清单已确认、已有剧本正文或勾选内容不合法。
   * @throws TextGenerationError 没有可用的文本模型。
   */
  async confirmAdaptation(runId: number, rawInput: unknown): Promise<void> {
    const { checklists, runner } = this.dependencies;
    const checklist = this.requireOpenChecklist(runId);
    const selected = normalizeSelection(rawInput, checklist);
    await runner.reextract(runId, () => {
      checklists.updateSelection(runId, selected, this.timestamp());
      checklists.confirm(runId, this.timestamp());
    });
  }

  /** 读取最新版本上尚未确认的改编清单，并确认还没有生成正文。 */
  private requireOpenChecklist(runId: number) {
    const { runs, screenplays, checklists, stages } = this.dependencies;
    const run = stages.requireRun(runId);
    const [latest] = runs.listVersions(run);
    if (latest === undefined || latest.id !== run.id) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '只能处理最新版本的改编取舍，请先切换到最新版本。' });
    }
    const checklist = checklists.find(runId);
    if (checklist === undefined) {
      throw new NotFoundError('这个版本没有改编取舍清单。');
    }
    if (checklist.confirmedAt !== null || screenplays.find(runId) !== undefined) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '改编取舍已经确认，不能再修改。' });
    }
    return checklist;
  }

  /**
   * 保存人工编辑的剧本包正文，并让该版本回到待确认。已抽取的集和实体不会随正文自动更新，需要时点“重新抽取”。
   * @throws ValidationError 内容不合法、不是最新版本或生成尚未成功。
   * @throws NotFoundError 记录不存在或还没有剧本包。
   */
  saveText(runId: number, rawInput: unknown): void {
    const { screenplays } = this.dependencies;
    this.dependencies.stages.editLatest(runId, (run) => {
      const fullText = normalizeScreenplayTextEdit(rawInput);
      if (screenplays.find(run.id) === undefined) {
        throw new NotFoundError('剧本包还没有生成。');
      }
      screenplays.updateFullText(run.id, fullText, this.timestamp());
    });
  }

  /**
   * 保存人工编辑的一集，并让该版本回到待确认。正文被修改时该集的结构标注失效并清除；正文未变时，提交的 segments（按片段顺序的 [{ kind, speaker }]）会合并为新标注。
   * @param rawInput { ref, title, synopsis, screenplayText, targetDurationSeconds, segments? }，ref 取自视图。
   * @throws ValidationError 内容不合法、不是最新版本或生成尚未成功。
   * @throws NotFoundError 记录或集不存在。
   */
  saveEpisode(runId: number, rawInput: unknown): void {
    const { screenplays } = this.dependencies;
    this.dependencies.stages.editLatest(runId, (run) => {
      const ref = readRef(rawInput);
      const edit = normalizeEpisodeEdit(rawInput);
      if (run.appliedAt !== null) {
        const current = screenplays.listEpisodes(run.workId).find((episode) => episode.id === ref);
        if (current === undefined) {
          throw new NotFoundError('集不存在。');
        }
        const segments = resolveSegments(current, edit.screenplayText, rawInput);
        screenplays.updateEpisode(run.workId, ref, edit, this.timestamp());
        if (segments !== current.segments) {
          screenplays.updateEpisodeSegments(run.workId, ref, segments ?? null, this.timestamp());
        }
        return;
      }
      const structure = this.requireStructure(run.id);
      const target = structure.episodes[ref];
      if (target === undefined) {
        throw new NotFoundError('集不存在。');
      }
      const segments = resolveSegments(target, edit.screenplayText, rawInput);
      // segments 为空时写入 JSON 会自动省略该字段。
      const episodes = structure.episodes.map((episode, index) => (index === ref ? { ...episode, ...edit, segments } : episode));
      screenplays.saveStructure(run.id, { ...structure, episodes }, this.timestamp());
    });
  }

  /**
   * 保存人工编辑的一个实体，并让该版本回到待确认。
   * @param rawInput { ref, name, aliases, description, attributes, isActive }，ref 取自视图。
   * @throws ValidationError 内容不合法、同类型名称重复、不是最新版本或生成尚未成功。
   * @throws NotFoundError 记录或实体不存在。
   */
  saveEntity(runId: number, rawInput: unknown): void {
    const { screenplays } = this.dependencies;
    this.dependencies.stages.editLatest(runId, (run) => {
      const ref = readRef(rawInput);
      if (run.appliedAt !== null) {
        const current = screenplays.listEntities(run.workId).find((entity) => entity.id === ref);
        if (current === undefined) {
          throw new NotFoundError('实体不存在。');
        }
        screenplays.updateEntity(run.workId, ref, normalizeEntityEdit(rawInput, current.kind), this.timestamp());
        return;
      }

      const structure = this.requireStructure(run.id);
      const target = structure.entities[ref];
      if (target === undefined) {
        throw new NotFoundError('实体不存在。');
      }
      const edit = normalizeEntityEdit(rawInput, target.kind);
      if (structure.entities.some((entity, index) => index !== ref && entity.kind === target.kind && entity.name === edit.name)) {
        throw new ValidationError({ name: '同类型下已有同名实体，请换一个名称。' });
      }
      const entities = structure.entities.map((entity, index) => (index === ref ? { ...entity, ...edit } : entity));
      screenplays.saveStructure(run.id, { ...structure, entities }, this.timestamp());
    });
  }

  /**
   * 在末尾新增一集，并让该版本回到待确认；单个短视频只有 1 集，不能新增。
   * @param rawInput { title, synopsis, screenplayText, targetDurationSeconds }。
   * @returns 新集的定位值（视图中的 ref）。
   * @throws ValidationError 内容不合法、单个短视频、集数已达上限、不是最新版本或生成尚未成功。
   */
  addEpisode(runId: number, rawInput: unknown): number {
    const { screenplays } = this.dependencies;
    let ref = -1;
    this.dependencies.stages.editLatest(runId, (run) => {
      this.assertSeries(run.workId, '新增');
      const edit = normalizeEpisodeEdit(rawInput);
      if (run.appliedAt !== null) {
        this.assertBelowLimit(screenplays.listEpisodes(run.workId).length, MAX_EPISODES_LIMIT, '集');
        ref = screenplays.insertEpisode(run.workId, edit, this.timestamp());
        return;
      }
      const structure = this.requireStructure(run.id);
      this.assertBelowLimit(structure.episodes.length, MAX_EPISODES_LIMIT, '集');
      ref = structure.episodes.length;
      const episodes = [...structure.episodes, { seq: ref + 1, ...edit }];
      screenplays.saveStructure(run.id, { ...structure, episodes }, this.timestamp());
    });
    return ref;
  }

  /**
   * 删除一集，并让该版本回到待确认；后面的集序号依次前移。已合并的集连同它的分镜脚本一起删除。
   * @param rawInput { ref }，ref 取自视图。
   * @throws ValidationError 单个短视频、只剩最后一集、这一集正在生成分镜脚本、不是最新版本或生成尚未成功。
   * @throws NotFoundError 记录或集不存在。
   */
  deleteEpisode(runId: number, rawInput: unknown): void {
    const { screenplays, runs } = this.dependencies;
    this.dependencies.stages.editLatest(runId, (run) => {
      const ref = readRef(rawInput);
      this.assertSeries(run.workId, '删除');
      if (run.appliedAt !== null) {
        const episodes = screenplays.listEpisodes(run.workId);
        if (!episodes.some((episode) => episode.id === ref)) {
          throw new NotFoundError('集不存在。');
        }
        this.assertKeepsOneEpisode(episodes.length);
        if (runs.findRunning({ workId: run.workId, stage: 'storyboard_script', episodeId: ref }) !== undefined) {
          throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '这一集正在生成分镜脚本，请等待完成或先取消。' });
        }
        screenplays.deleteEpisode(run.workId, ref);
        return;
      }
      const structure = this.requireStructure(run.id);
      if (structure.episodes[ref] === undefined) {
        throw new NotFoundError('集不存在。');
      }
      this.assertKeepsOneEpisode(structure.episodes.length);
      const episodes = structure.episodes.filter((_, index) => index !== ref).map((episode, index) => ({ ...episode, seq: index + 1 }));
      screenplays.saveStructure(run.id, { ...structure, episodes }, this.timestamp());
    });
  }

  /**
   * 把一集与前一集或后一集互换位置，并让该版本回到待确认。已合并的集只互换序号，分镜脚本、绑定等下游数据跟着集走；尚未合并的互换抽取结果中的位置。
   * @param rawInput { ref, direction }，ref 取自视图，direction 为 'up' 或 'down'。
   * @returns 被移动的集的新定位值（已合并时不变，未合并时为新的位置）。
   * @throws ValidationError 方向不合法、单个短视频、已经在最前或最后、不是最新版本或生成尚未成功。
   * @throws NotFoundError 记录或集不存在。
   */
  moveEpisode(runId: number, rawInput: unknown): number {
    const { screenplays } = this.dependencies;
    let newRef = -1;
    this.dependencies.stages.editLatest(runId, (run) => {
      const step = readMoveStep(readRecord(rawInput));
      const ref = readRef(rawInput);
      this.assertSeries(run.workId, '调整');
      const boundary = step < 0 ? '已经是第一集，不能再前移。' : '已经是最后一集，不能再后移。';
      if (run.appliedAt !== null) {
        const episodes = screenplays.listEpisodes(run.workId);
        const index = episodes.findIndex((episode) => episode.id === ref);
        if (index < 0) {
          throw new NotFoundError('集不存在。');
        }
        const other = episodes[index + step] as EpisodeRecord | undefined;
        if (other === undefined) {
          throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: boundary });
        }
        screenplays.swapEpisodes(run.workId, ref, other.id, this.timestamp());
        newRef = ref;
        return;
      }
      const structure = this.requireStructure(run.id);
      if (structure.episodes[ref] === undefined) {
        throw new NotFoundError('集不存在。');
      }
      if (structure.episodes[ref + step] === undefined) {
        throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: boundary });
      }
      const reordered = [...structure.episodes];
      [reordered[ref], reordered[ref + step]] = [reordered[ref + step], reordered[ref]];
      screenplays.saveStructure(run.id, { ...structure, episodes: reordered.map((episode, index) => ({ ...episode, seq: index + 1 })) }, this.timestamp());
      newRef = ref + step;
    });
    return newRef;
  }

  /**
   * 新增一个实体，并让该版本回到待确认。
   * @param rawInput { kind, name, aliases, description, attributes, isActive }。
   * @returns 新实体的定位值（视图中的 ref）。
   * @throws ValidationError 内容不合法、同类型名称重复、实体数已达上限、不是最新版本或生成尚未成功。
   */
  addEntity(runId: number, rawInput: unknown): number {
    const { screenplays } = this.dependencies;
    let ref = -1;
    this.dependencies.stages.editLatest(runId, (run) => {
      const kind = readRecord(rawInput).kind;
      if (typeof kind !== 'string' || !Object.keys(ENTITY_KIND_LABELS).includes(kind)) {
        throw new ValidationError({ kind: '请选择实体类型。' });
      }
      const edit = normalizeEntityEdit(rawInput, kind as EntityKind);
      if (run.appliedAt !== null) {
        this.assertBelowLimit(screenplays.listEntities(run.workId).length, MAX_ENTITIES, '实体');
        ref = screenplays.insertEntity(run.workId, kind as EntityKind, edit, this.timestamp());
        return;
      }
      const structure = this.requireStructure(run.id);
      this.assertBelowLimit(structure.entities.length, MAX_ENTITIES, '实体');
      if (structure.entities.some((entity) => entity.kind === kind && entity.name === edit.name)) {
        throw new ValidationError({ name: '同类型下已有同名实体，请换一个名称。' });
      }
      ref = structure.entities.length;
      const entities = [...structure.entities, { kind: kind as EntityKind, ...edit }];
      screenplays.saveStructure(run.id, { ...structure, entities }, this.timestamp());
    });
    return ref;
  }

  /**
   * 删除一个实体，并让该版本回到待确认。已合并的实体被镜头、镜头声音或资产绑定引用时不能删除，应改为停用。
   * @param rawInput { ref }，ref 取自视图。
   * @throws ValidationError 实体仍被引用、不是最新版本或生成尚未成功。
   * @throws NotFoundError 记录或实体不存在。
   */
  deleteEntity(runId: number, rawInput: unknown): void {
    const { screenplays } = this.dependencies;
    this.dependencies.stages.editLatest(runId, (run) => {
      const ref = readRef(rawInput);
      if (run.appliedAt !== null) {
        const entity = screenplays.listEntities(run.workId).find((candidate) => candidate.id === ref);
        if (entity === undefined) {
          throw new NotFoundError('实体不存在。');
        }
        const references = screenplays.countEntityReferences(ref);
        if (references > 0) {
          throw new ValidationError({
            [FORM_LEVEL_ERROR_KEY]: `实体“${entity.name}”已被 ${references} 处引用（镜头、声音或资产绑定），不能删除；如不再使用，可改为停用。`
          });
        }
        screenplays.deleteEntity(run.workId, ref);
        return;
      }
      const structure = this.requireStructure(run.id);
      if (structure.entities[ref] === undefined) {
        throw new NotFoundError('实体不存在。');
      }
      const entities = structure.entities.filter((_, index) => index !== ref);
      screenplays.saveStructure(run.id, { ...structure, entities }, this.timestamp());
    });
  }

  /**
   * 用当前剧本包正文重新抽取集和实体，覆盖尚未合并的抽取结果；在后台执行，进度通过阶段事件推送。
   * @throws NotFoundError 记录不存在。
   * @throws ValidationError 不是最新版本、生成尚未成功或抽取结果已合并到作品。
   * @throws TextGenerationError 没有可用的文本模型。
   */
  async reextract(runId: number): Promise<void> {
    const { runs, screenplays, runner, stages } = this.dependencies;
    const run = stages.requireRun(runId);
    const [latest] = runs.listVersions(run);
    if (latest === undefined || latest.id !== run.id) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '只能对最新版本重新抽取，请先切换到最新版本。' });
    }
    if (run.appliedAt !== null) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '集和实体已经合并到作品，不能重新抽取；如需更新，请重新生成剧本。' });
    }
    const patch = createEditPatch(run);
    await runner.reextract(run.id, () => {
      screenplays.clearStructure(run.id, this.timestamp());
      runs.applyEdit(run.id, patch);
    });
  }

  /**
   * 保真模式下只重新标注：保留已抽取的集和实体（含对它们的修改），清除所有集的结构标注后在后台重做；进度通过阶段事件推送。
   * @throws NotFoundError 记录不存在或还没有抽取结果。
   * @throws ValidationError 不是最新版本、生成尚未成功、不是保真模式或抽取结果已合并到作品。
   * @throws TextGenerationError 没有可用的文本模型。
   */
  async reannotate(runId: number): Promise<void> {
    const { runs, screenplays, runner, stages } = this.dependencies;
    const run = stages.requireRun(runId);
    const [latest] = runs.listVersions(run);
    if (latest === undefined || latest.id !== run.id) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '只能对最新版本重新标注，请先切换到最新版本。' });
    }
    if (readFidelity(run) !== 'verbatim') {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '只有原创文稿的剧本有结构标注。' });
    }
    if (run.appliedAt !== null) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '集和实体已经合并到作品，不能重新标注；如需更新，请重新生成剧本，或直接修改每个片段的标注。' });
    }
    const structure = this.requireStructure(run.id);
    const patch = createEditPatch(run);
    await runner.reextract(run.id, () => {
      const episodes = structure.episodes.map(({ segments: _cleared, ...episode }) => episode);
      screenplays.saveStructure(run.id, { ...structure, episodes }, this.timestamp());
      runs.applyEdit(run.id, patch);
    });
  }

  /** 读取作品已合并的集和实体，ref 为数据库标识。 */
  private readMerged(workId: number): { episodes: ScreenplayEpisodeView[]; entities: ScreenplayEntityView[] } {
    const { screenplays } = this.dependencies;
    return {
      episodes: screenplays.listEpisodes(workId).map((episode) => ({ ref: episode.id, ...episode })),
      entities: screenplays.listEntities(workId).map((entity) => ({ ref: entity.id, ...entity }))
    };
  }

  /** 读取尚未合并的抽取结果；还没有抽取时抛出 NotFoundError。 */
  private requireStructure(runId: number): ScreenplayStructure {
    const structure = this.dependencies.screenplays.find(runId)?.structure;
    if (structure === null || structure === undefined) {
      throw new NotFoundError('还没有抽取集和实体。');
    }
    return structure;
  }

  /** 只有 1 集的体量不允许增删集。 */
  private assertSeries(workId: number, action: string): void {
    if (!isMultiEpisode(this.dependencies.works.getWork(workId).kind)) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: `单个短视频只有 1 集，不能${action}集。` });
    }
  }

  /** 数量已达上限时不能再新增。 */
  private assertBelowLimit(count: number, limit: number, label: string): void {
    if (count >= limit) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: `${label}数量已达上限 ${limit}，不能再新增。` });
    }
  }

  /** 至少保留 1 集，不能删到只剩零集。 */
  private assertKeepsOneEpisode(count: number): void {
    if (count <= 1) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '至少保留 1 集，不能删除。' });
    }
  }

  private timestamp(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}

/** 作品剧本阶段的目标。 */
function screenplayTarget(workId: number): StageTarget {
  return { workId, stage: 'screenplay', episodeId: null };
}

/** 从记录的输入快照中取出剧本参数；快照结构不符时返回 null。 */
function readParams(run: StageRun): ScreenplayParams | null {
  const params = (run.input as { params?: unknown }).params;
  return typeof params === 'object' && params !== null ? (params as ScreenplayParams) : null;
}

/** 抽取结果转视图，ref 为在抽取结果中的位置；没有抽取结果时为空。 */
function readStructure(structure: ScreenplayStructure | null): { episodes: ScreenplayEpisodeView[]; entities: ScreenplayEntityView[] } {
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

/** 从记录的输入快照中取出改编强度；快照里没有该字段时为 adapted。 */
function readFidelity(run: StageRun): ScreenplayFidelity {
  return (run.input as { fidelity?: unknown }).fidelity === 'verbatim' ? 'verbatim' : 'adapted';
}

/**
 * 编辑保存一集后的结构标注：原来没有标注则仍然没有；正文被修改则标注失效、返回 undefined；否则合并提交的标注修改（没有提交则保持原样）。
 */
function resolveSegments(current: EpisodeDraft, editedText: string, rawInput: unknown): readonly TextSegment[] | undefined {
  if (current.segments === undefined || editedText !== current.screenplayText) {
    return undefined;
  }
  return applySegmentLabelEdits(rawInput, current.segments) ?? current.segments;
}

/** 读取请求中的定位值：非负整数。 */
function readRef(rawInput: unknown): number {
  const ref = readRecord(rawInput).ref;
  if (typeof ref !== 'number' || !Number.isInteger(ref) || ref < 0) {
    throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '定位信息无效。' });
  }
  return ref;
}
