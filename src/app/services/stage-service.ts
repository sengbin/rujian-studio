// ------------------------------------------------------------------------
// 名称：stage-service.ts
// 说明：阶段应用服务：启动创意生成、导入原创文稿的原稿、取消、重试、确认采用、保存人工编辑的章节，并整理创意阶段产出页需要的视图数据；剧本阶段的专属操作见 screenplay-service.ts。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：状态流转规则来自 stage-review-rules.ts，本服务只负责组合读写与通知；取消、重试、确认采用、编辑的通用流程对各阶段共用。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, NotFoundError, ValidationError } from '../../domain/errors';
import { BeatSheet } from '../../domain/models/beat-sheet';
import { ChapterDraft, CreativeParams } from '../../domain/models/creative';
import { ProductionFormatType } from '../../domain/models/production-profile';
import { StageDisplayStatus, StageKind, StageRun, StageTarget } from '../../domain/models/stage-run';
import { WorkSourceType } from '../../domain/models/work';
import { ChapterRepository } from '../../domain/ports/chapter-repository';
import { ScreenplayRepository } from '../../domain/ports/screenplay-repository';
import { StageRunRepository } from '../../domain/ports/stage-run-repository';
import { readBeatSheetSnapshot } from '../../domain/rules/beat-sheet-rules';
import { assertBeatReferenceReady, countWords, normalizeChapterEdit, normalizeCreativeParams } from '../../domain/rules/creative-rules';
import {
  canApprove,
  canCancel,
  canRetry,
  createApprovalPatch,
  createEditPatch,
  toDisplayStatus
} from '../../domain/rules/stage-review-rules';
import { evaluateCalibration } from '../../domain/rules/timing-calibration-rules';
import { WORK_KIND_LABELS } from '../../domain/rules/work-rules';
import { ApprovedBeatSheetReader } from '../stages/approved-beat-sheet';
import { StageRunner } from '../stages/stage-runner';
import { OriginalImporter } from '../stages/original-importer';
import { ChangeNotifier } from './change-notifier';
import { readRunParams } from './stage-run-params';
import { WorkService } from './work-service';

/** 阶段数据变化的载荷：哪个作品的哪条记录变了。 */
export interface StageChange {
  readonly workId: number;
  readonly runId: number;
  readonly stage: StageKind;
}

/** 版本下拉列表中的一项。 */
export interface StageVersionItem {
  readonly id: number;
  readonly version: number;
  readonly display: StageDisplayStatus;
  readonly isCurrent: boolean;
  readonly createdAt: string;
}

/** 章节字数与设定范围的关系：short 少于下限，long 超过上限，null 在范围内。 */
export type ChapterWordHint = 'short' | 'long' | null;

/** 参考节拍表模式下一章的参考目标与实测值的对比。 */
export interface ChapterReference {
  readonly targetWords: number;
  /** (实测 - 目标) / 目标。 */
  readonly deviationRatio: number;
  readonly withinTolerance: boolean;
}

/** 阶段产出页展示的一章。 */
export interface ChapterView extends ChapterDraft {
  readonly wordCount: number;
  readonly wordHint: ChapterWordHint;
  /** 参考节拍表模式下的参考对比；自由创作为 null。 */
  readonly reference: ChapterReference | null;
}

/** 阶段产出页展示的记录概况。 */
export interface StageRunView {
  readonly id: number;
  readonly version: number;
  readonly display: StageDisplayStatus;
  readonly isCurrent: boolean;
  readonly modelInfo: string | null;
  readonly errorMessage: string | null;
  /** 失败时是否保留了模型原始输出。 */
  readonly hasRawOutput: boolean;
  readonly progress: { readonly step: string; readonly total: number; readonly done: number } | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly approvedAt: string | null;
}

/** 当前记录允许的操作。 */
export interface StageActions {
  readonly canApprove: boolean;
  readonly canCancel: boolean;
  readonly canRetry: boolean;
  /** 是否可以编辑章节：只有最新版本、且生成成功时可编辑。 */
  readonly canEdit: boolean;
  /** 编辑保存后会让已确认的版本回到待确认，保存前需要提示。 */
  readonly editNeedsConfirm: boolean;
}

/** 创意阶段产出页的完整视图。 */
export interface CreativeStageView {
  readonly work: {
    readonly id: number;
    readonly projectId: number;
    readonly name: string;
    readonly kind: ProductionFormatType;
    /** 作品形态的界面名称。 */
    readonly kindLabel: string;
    readonly sourceType: WorkSourceType;
  };
  readonly versions: StageVersionItem[];
  readonly run: StageRunView;
  readonly params: CreativeParams | null;
  /** 参考节拍表模式下使用的容差比例；自由创作为 null。 */
  readonly toleranceRatio: number | null;
  /** 参考节拍表模式下的自动重写轮数上限；自由创作为 null。 */
  readonly maxCalibrationRounds: number | null;
  readonly chapters: ChapterView[];
  readonly totalWords: number;
  readonly actions: StageActions;
}

/** 阶段应用服务的依赖。 */
export interface StageServiceDependencies {
  readonly works: WorkService;
  readonly runs: StageRunRepository;
  readonly chapters: ChapterRepository;
  /** 剧本的抽取结果在确认采用时合并到集和实体。 */
  readonly screenplays: ScreenplayRepository;
  readonly runner: StageRunner;
  /** 读取作品当前已确认的节拍表：参考节拍表模式的创意生成启动时把它存进输入快照。 */
  readonly approvedBeatSheet: ApprovedBeatSheetReader;
  /** 原创文稿的导入：不调用模型，直接把原稿分段写成已确认的创意章节。 */
  readonly originals: OriginalImporter;
  /** 阶段数据变化的通知器，与执行器共用，页面据此刷新。 */
  readonly changes: ChangeNotifier<StageChange>;
  readonly now?: () => Date;
}

/** 没有正在生成的任务时的提示。 */
const NOT_RUNNING_MESSAGE = '当前没有正在生成的任务。';
/** 只能编辑最新版本时的提示。 */
const NOT_LATEST_MESSAGE = '只能编辑最新版本的产出，请先切换到最新版本。';
/** 原创文稿不生成创意时的提示。 */
const ORIGINAL_NOT_GENERATED_MESSAGE = '原创文稿不生成创意，原稿已直接分段为章节；需要修改请直接编辑章节正文。';

/** 阶段应用服务。 */
export class StageService {
  constructor(private readonly dependencies: StageServiceDependencies) {}

  /** 订阅阶段数据变化；返回取消订阅的函数。 */
  onDidChange(listener: (change: StageChange) => void): () => void {
    return this.dependencies.changes.subscribe(listener);
  }

  /**
   * 启动作品的创意生成：新建一个版本，生成在后台执行。
   * @param workId 作品标识。
   * @param rawParams 表单提交的生成参数。
   * @throws NotFoundError 作品不存在。
   * @throws ValidationError 参数不合法或该作品正在生成。
   * @throws TextGenerationError 没有可用的文本模型。
   */
  async startCreative(workId: number, rawParams: unknown): Promise<StageRun> {
    const work = this.dependencies.works.getWork(workId);
    if (work.sourceType === 'original') {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: ORIGINAL_NOT_GENERATED_MESSAGE });
    }
    const run = await this.dependencies.runner.start({
      target: creativeTarget(workId),
      input: { sourceType: work.sourceType, params: rawParams, ...this.readBeatReference(workId, rawParams) }
    });
    this.publish(run);
    return run;
  }

  /**
   * 参考节拍表模式下取出已确认的节拍表，作为创意生成输入快照的一部分；自由创作返回空对象。
   * @throws ValidationError 参数不合法，或参考节拍表但节拍表尚未确认。
   */
  private readBeatReference(workId: number, rawParams: unknown): { readonly beatSheet?: BeatSheet } {
    const mode = normalizeCreativeParams(rawParams).beatReferenceMode;
    const beatSheet = mode === 'reference' ? this.dependencies.approvedBeatSheet(workId) : undefined;
    assertBeatReferenceReady(mode, beatSheet);
    return beatSheet === undefined ? {} : { beatSheet };
  }

  /**
   * 导入原创文稿作品的原稿：原稿分段写成章节并直接确认采用，不调用模型。
   * @param workId 作品标识。
   * @throws NotFoundError 作品不存在。
   * @throws ValidationError 作品不是原创文稿、没有原稿或分段数超过上限。
   */
  importOriginal(workId: number): StageRun {
    const work = this.dependencies.works.getWork(workId);
    if (work.sourceType !== 'original') {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '只有原创文稿作品可以导入原稿。' });
    }
    const run = this.dependencies.originals.importOriginal(workId);
    this.publish(run);
    return run;
  }

  /**
   * 读取最近一次创意生成使用的参数，作为“重新生成”表单的初始值。
   * @returns 参数；没有生成记录时为 undefined。
   */
  getLastCreativeParams(workId: number): CreativeParams | undefined {
    const [latest] = this.dependencies.runs.listVersions(creativeTarget(workId));
    return latest === undefined ? undefined : (readRunParams<CreativeParams>(latest) ?? undefined);
  }

  /**
   * 整理创意阶段产出页的视图。
   * @param workId 作品标识。
   * @param runId 要查看的版本；缺省为最新版本。
   * @throws NotFoundError 作品或版本不存在，或还没有生成记录。
   */
  getCreativeView(workId: number, runId?: number): CreativeStageView {
    const work = this.dependencies.works.getWork(workId);
    const versions = this.dependencies.runs.listVersions(creativeTarget(workId));
    const latest = versions[0];
    if (latest === undefined) {
      throw new NotFoundError('该作品还没有创意生成记录。');
    }
    const run = runId === undefined ? latest : versions.find((candidate) => candidate.id === runId);
    if (run === undefined) {
      throw new NotFoundError('版本不存在。');
    }

    const params = readRunParams<CreativeParams>(run);
    const beatSheet = readBeatSheetSnapshot((run.input as { beatSheet?: unknown }).beatSheet);
    const chapters = this.dependencies.chapters.list(run.id).map((chapter) => toChapterView(chapter, params, beatSheet));
    return {
      work: { id: work.id, projectId: work.projectId, name: work.name, kind: work.kind, kindLabel: WORK_KIND_LABELS[work.kind], sourceType: work.sourceType },
      versions: versions.map(toVersionItem),
      run: toRunView(run),
      params,
      toleranceRatio: beatSheet?.params.toleranceRatio ?? null,
      maxCalibrationRounds: beatSheet?.params.maxCalibrationRounds ?? null,
      chapters,
      totalWords: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
      actions: {
        canApprove: canApprove(run),
        canCancel: canCancel(run),
        canRetry: canRetry(run),
        canEdit: run.id === latest.id && run.status === 'succeeded',
        editNeedsConfirm: run.reviewStatus === 'approved'
      }
    };
  }

  /**
   * 读取失败记录保留的模型原始输出，用于排查。
   * @throws NotFoundError 记录不存在。
   */
  getRawOutput(runId: number): string {
    return this.requireRun(runId).rawOutput ?? '';
  }

  /**
   * 取消正在生成的记录。
   * @throws ValidationError 该记录没有正在执行的生成。
   */
  cancel(runId: number): void {
    if (!this.dependencies.runner.cancel(runId)) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: NOT_RUNNING_MESSAGE });
    }
  }

  /**
   * 取消作品各阶段正在进行的生成并等待它们结束；没有则什么都不做。删除作品前调用。
   */
  async cancelRunningForWork(workId: number): Promise<void> {
    const { runs, runner, screenplays } = this.dependencies;
    const running: number[] = [];
    for (const stage of ['beat_sheet', 'creative', 'screenplay'] as const) {
      const found = runs.findRunning({ workId, stage, episodeId: null });
      if (found !== undefined) {
        running.push(found.id);
      }
    }
    for (const episode of screenplays.listEpisodes(workId)) {
      const found = runs.findRunning({ workId, stage: 'storyboard_script', episodeId: episode.id });
      if (found !== undefined) {
        running.push(found.id);
      }
    }
    await Promise.all(running.map((runId) => runner.cancelAndWait(runId)));
  }

  /**
   * 重试失败或已取消的记录：从已保存的进度与章节继续。
   * @throws NotFoundError 记录不存在。
   * @throws ValidationError 记录不是失败或已取消，或已有生成在进行。
   * @throws TextGenerationError 没有可用的文本模型。
   */
  async retry(runId: number): Promise<void> {
    await this.dependencies.runner.resume(runId);
  }

  /**
   * 确认采用：该版本成为当前版本，原来的当前版本变为历史。剧本尚未合并时，在同一事务内把抽取结果合并到集和实体。
   * @throws NotFoundError 记录不存在。
   * @throws ValidationError 记录不是生成成功且待确认；或剧本新版本里已不存在的旧集已有下游数据（合并整体回滚）。
   */
  approve(runId: number): void {
    const run = this.requireRun(runId);
    // 剧本的改编取舍还在等用户确认时没有正文和抽取结果，不能确认采用。
    if (run.stage === 'screenplay' && (this.dependencies.screenplays.find(run.id)?.structure ?? null) === null) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '剧本还没有生成完成，请先确认改编取舍或等待生成结束。' });
    }
    const timestamp = this.timestamp();
    const patch = createApprovalPatch(run, timestamp);
    const merge = run.stage === 'screenplay' && run.appliedAt === null ? () => this.dependencies.screenplays.merge(run.id, timestamp) : undefined;
    const approved = this.dependencies.runs.approve(run.id, patch, merge);
    this.publish(approved ?? run);
  }

  /**
   * 保存人工编辑的一章：更新章节，并让该版本回到待确认（修订号加 1）。
   * @throws NotFoundError 记录或章节不存在。
   * @throws ValidationError 内容不合法、不是最新版本或生成尚未成功。
   */
  saveChapter(runId: number, rawChapter: unknown): void {
    const { chapters } = this.dependencies;
    this.editLatest(runId, (run) => {
      const chapter = normalizeChapterEdit(rawChapter);
      if (!chapters.list(run.id).some((saved) => saved.seq === chapter.seq)) {
        throw new NotFoundError(`第 ${chapter.seq} 章不存在。`);
      }
      chapters.save(run.id, chapter, this.timestamp());
    });
  }

  /**
   * 编辑最新版本的产出：校验通过后执行写入，再让该版本回到待确认（修订号加 1）并通知界面。
   * @param write 校验内容并写入产出；抛出异常则不改变确认状态。
   * @throws NotFoundError 记录不存在。
   * @throws ValidationError 不是最新版本或生成尚未成功。
   */
  editLatest(runId: number, write: (run: StageRun) => void): void {
    const { runs } = this.dependencies;
    const run = this.requireRun(runId);
    const [latest] = runs.listVersions(run);
    if (latest === undefined || latest.id !== run.id) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: NOT_LATEST_MESSAGE });
    }
    const patch = createEditPatch(run);
    write(run);
    const edited = runs.applyEdit(run.id, patch);
    this.publish(edited ?? run);
  }

  /**
   * 确认记录属于指定作品和阶段，防止页面用别的作品的记录标识操作。
   * @throws NotFoundError 记录不存在或不属于该作品和阶段（分镜脚本还要属于该集）。
   */
  assertRunBelongs(runId: number, workId: number, stage: StageKind, episodeId: number | null = null): void {
    const run = this.dependencies.runs.findById(runId);
    if (run === undefined || run.workId !== workId || run.stage !== stage || (stage === 'storyboard_script' && run.episodeId !== episodeId)) {
      throw new NotFoundError('版本不存在。');
    }
  }

  /** 读取记录，不存在时抛出 NotFoundError。 */
  requireRun(runId: number): StageRun {
    const run = this.dependencies.runs.findById(runId);
    if (run === undefined) {
      throw new NotFoundError('阶段记录不存在。');
    }
    return run;
  }

  private publish(run: StageRun): void {
    this.dependencies.changes.notify({ workId: run.workId, runId: run.id, stage: run.stage });
  }

  /** 通知界面记录已变化，供阶段专属的服务在自己写入产出后调用。 */
  notifyChanged(run: StageRun): void {
    this.publish(run);
  }

  private timestamp(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}

/** 作品创意阶段的目标。 */
function creativeTarget(workId: number): StageTarget {
  return { workId, stage: 'creative', episodeId: null };
}

/** 版本下拉列表中的一项。 */
export function toVersionItem(run: StageRun): StageVersionItem {
  return { id: run.id, version: run.version, display: toDisplayStatus(run), isCurrent: run.isCurrent, createdAt: run.createdAt };
}

/** 阶段产出页展示的记录概况。 */
export function toRunView(run: StageRun): StageRunView {
  return {
    id: run.id,
    version: run.version,
    display: toDisplayStatus(run),
    isCurrent: run.isCurrent,
    modelInfo: run.modelInfo,
    errorMessage: run.errorMessage,
    hasRawOutput: run.rawOutput !== null && run.rawOutput !== '',
    progress: run.progress === null ? null : { step: run.progress.step, total: run.progress.total, done: run.progress.done },
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    approvedAt: run.approvedAt
  };
}

/** 计算章节字数，并与参考目标（参考节拍表模式）或生成参数中的范围（自由创作）比较。 */
function toChapterView(chapter: ChapterDraft, params: CreativeParams | null, beatSheet: BeatSheet | undefined): ChapterView {
  const wordCount = countWords(chapter.content);
  const beat = beatSheet?.beats[chapter.seq - 1];
  if (beatSheet !== undefined && beat !== undefined && beat.estimatedWords > 0) {
    const result = evaluateCalibration(wordCount, beat.estimatedWords, beatSheet.params.toleranceRatio);
    const wordHint: ChapterWordHint = result.withinTolerance ? null : result.deviationRatio > 0 ? 'long' : 'short';
    return {
      ...chapter,
      wordCount,
      wordHint,
      reference: { targetWords: beat.estimatedWords, deviationRatio: result.deviationRatio, withinTolerance: result.withinTolerance }
    };
  }
  const wordHint: ChapterWordHint =
    params === null ? null : wordCount < params.chapterMinWords ? 'short' : wordCount > params.chapterMaxWords ? 'long' : null;
  return { ...chapter, wordCount, wordHint, reference: null };
}
