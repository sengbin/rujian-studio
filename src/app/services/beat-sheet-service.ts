// ------------------------------------------------------------------------
// 名称：beat-sheet-service.ts
// 说明：节拍表阶段应用服务：启动节拍表生成、整理阶段产出页的视图、保存人工编辑的节拍剧情内容，并向下游阶段提供已确认的节拍表。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：取消、重试、确认采用的通用流程由 StageService 负责；节拍表没有上游阶段，也不参与下游的过期判断，下游阶段只在生成时读取当前已确认的节拍表作为参考基准。
// ------------------------------------------------------------------------

import { NotFoundError } from '../../domain/errors';
import { BeatDraft, BeatSheet, BeatSheetParams } from '../../domain/models/beat-sheet';
import { ProductionFormatType } from '../../domain/models/production-profile';
import { StageRun, StageTarget } from '../../domain/models/stage-run';
import { WorkSourceType } from '../../domain/models/work';
import { BeatSheetRepository } from '../../domain/ports/beat-sheet-repository';
import { StageRunRepository } from '../../domain/ports/stage-run-repository';
import { normalizeBeatEdit } from '../../domain/rules/beat-sheet-rules';
import { getBeatTemplate, isMultiEpisode } from '../../domain/rules/production-profile-rules';
import { canApprove, canCancel, canRetry } from '../../domain/rules/stage-review-rules';
import { WORK_KIND_LABELS } from '../../domain/rules/work-rules';
import { ApprovedBeatSheetReader, createApprovedBeatSheetReader } from '../stages/approved-beat-sheet';
import { StageRunner } from '../stages/stage-runner';
import { StageActions, StageRunView, StageService, StageVersionItem, toRunView, toVersionItem } from './stage-service';
import { WorkService } from './work-service';

/** 节拍表阶段产出页的完整视图。 */
export interface BeatSheetStageView {
  readonly work: {
    readonly id: number;
    readonly projectId: number;
    readonly name: string;
    readonly kind: ProductionFormatType;
    /** 作品形态的界面名称。 */
    readonly kindLabel: string;
    /** 体量是否按剧情拆分为多集。 */
    readonly multiEpisode: boolean;
    readonly sourceType: WorkSourceType;
  };
  readonly versions: StageVersionItem[];
  readonly run: StageRunView;
  /** 本次生成使用的参数；输入快照结构不符时为 null。 */
  readonly params: BeatSheetParams | null;
  /** 节拍模板名称；参数缺失时为空串。 */
  readonly templateLabel: string;
  /** 节拍列表；还没有生成时为空。 */
  readonly beats: readonly BeatDraft[];
  readonly actions: StageActions;
}

/** 节拍表阶段应用服务的依赖。 */
export interface BeatSheetServiceDependencies {
  readonly works: WorkService;
  readonly runs: StageRunRepository;
  readonly beatSheets: BeatSheetRepository;
  readonly runner: StageRunner;
  /** 阶段服务：提供编辑的通用流程与变化通知。 */
  readonly stages: StageService;
  readonly now?: () => Date;
}

/** 节拍表阶段应用服务。 */
export class BeatSheetService {
  private readonly approved: ApprovedBeatSheetReader;

  constructor(private readonly dependencies: BeatSheetServiceDependencies) {
    this.approved = createApprovedBeatSheetReader(dependencies.runs, dependencies.beatSheets);
  }

  /**
   * 启动作品的节拍表生成：新建一个版本，生成在后台执行。
   * @param workId 作品标识。
   * @param rawParams 表单提交的生成参数。
   * @throws NotFoundError 作品不存在。
   * @throws ValidationError 参数不合法或该作品正在生成节拍表。
   * @throws TextGenerationError 没有可用的文本模型。
   */
  async start(workId: number, rawParams: unknown): Promise<StageRun> {
    const work = this.dependencies.works.getWork(workId);
    const run = await this.dependencies.runner.start({
      target: beatSheetTarget(workId),
      input: { formatType: work.kind, sourceType: work.sourceType, params: rawParams }
    });
    this.dependencies.stages.notifyChanged(run);
    return run;
  }

  /**
   * 读取最近一次节拍表生成使用的参数，作为“重新生成”表单的初始值。
   * @returns 参数；没有生成记录时为 undefined。
   */
  getLastParams(workId: number): BeatSheetParams | undefined {
    const [latest] = this.dependencies.runs.listVersions(beatSheetTarget(workId));
    return latest === undefined ? undefined : (readParams(latest) ?? undefined);
  }

  /**
   * 读取作品当前已确认的节拍表，供创意、剧本、分镜阶段作为参考基准。
   * @returns 节拍表；没有已确认的版本或产出时为 undefined。
   */
  findApproved(workId: number): BeatSheet | undefined {
    return this.approved(workId);
  }

  /**
   * 整理节拍表阶段产出页的视图。
   * @param workId 作品标识。
   * @param runId 要查看的版本；缺省为最新版本。
   * @throws NotFoundError 作品或版本不存在，或还没有生成记录。
   */
  getView(workId: number, runId?: number): BeatSheetStageView {
    const { works, runs, beatSheets } = this.dependencies;
    const work = works.getWork(workId);
    const versions = runs.listVersions(beatSheetTarget(workId));
    const latest = versions[0];
    if (latest === undefined) {
      throw new NotFoundError('该作品还没有节拍表生成记录。');
    }
    const run = runId === undefined ? latest : versions.find((candidate) => candidate.id === runId);
    if (run === undefined) {
      throw new NotFoundError('版本不存在。');
    }

    const sheet = beatSheets.find(run.id);
    const params = sheet?.params ?? readParams(run);
    return {
      work: { id: work.id, projectId: work.projectId, name: work.name, kind: work.kind, kindLabel: WORK_KIND_LABELS[work.kind], multiEpisode: isMultiEpisode(work.kind), sourceType: work.sourceType },
      versions: versions.map(toVersionItem),
      run: toRunView(run),
      params,
      templateLabel: params === null ? '' : getBeatTemplate(params.beatTemplateId).label,
      beats: sheet?.beats ?? [],
      actions: {
        canApprove: canApprove(run) && sheet !== undefined,
        canCancel: canCancel(run),
        canRetry: canRetry(run),
        canEdit: run.id === latest.id && run.status === 'succeeded' && sheet !== undefined,
        editNeedsConfirm: run.reviewStatus === 'approved'
      }
    };
  }

  /**
   * 保存人工编辑的一个节拍的剧情内容，并让该版本回到待确认（修订号加 1）。
   * @param rawInput { seq, synopsis }。
   * @throws NotFoundError 记录或节拍不存在。
   * @throws ValidationError 内容不合法、不是最新版本或生成尚未成功。
   */
  saveBeat(runId: number, rawInput: unknown): void {
    const { beatSheets } = this.dependencies;
    this.dependencies.stages.editLatest(runId, (run) => {
      const edit = normalizeBeatEdit(rawInput);
      if (!beatSheets.updateSynopsis(run.id, edit.seq, edit.synopsis, (this.dependencies.now?.() ?? new Date()).toISOString())) {
        throw new NotFoundError(`第 ${edit.seq} 个节拍不存在。`);
      }
    });
  }
}

/** 作品节拍表阶段的目标。 */
function beatSheetTarget(workId: number): StageTarget {
  return { workId, stage: 'beat_sheet', episodeId: null };
}

/** 从记录的输入快照中取出参数；快照结构不符时返回 null。 */
function readParams(run: StageRun): BeatSheetParams | null {
  const params = (run.input as { params?: unknown }).params;
  return typeof params === 'object' && params !== null ? (params as BeatSheetParams) : null;
}
