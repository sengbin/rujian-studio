// ------------------------------------------------------------------------
// 名称：screenplay-service.ts
// 说明：剧本阶段应用服务：启动剧本生成、改编取舍的保存与确认、保存人工编辑的正文，读取并校验集与实体的编辑请求后按是否已合并分派给对应的编辑策略，重新抽取、重新标注；视图装配委托 screenplay-views.ts。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：确认采用时才把抽取结果合并到集和实体（见 StageService.approve）；合并之前编辑的是剧本包上的抽取结果（PackageScreenplayEditor），合并之后编辑的是作品的集和实体本身（MergedScreenplayEditor）；集的正文被修改后结构标注即失效并清除，只修改标注则保留片段原文。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, NotFoundError, ValidationError } from '../../domain/errors';
import { ENTITY_KIND_LABELS, EntityKind, ScreenplayParams } from '../../domain/models/screenplay';
import { StageRun } from '../../domain/models/stage-run';
import { AdaptationChecklistRepository } from '../../domain/ports/adaptation-checklist-repository';
import { ScreenplayRepository } from '../../domain/ports/screenplay-repository';
import { StageRunRepository } from '../../domain/ports/stage-run-repository';
import { normalizeSelection } from '../../domain/rules/adaptation-checklist-rules';
import { readMoveStep, readRecord } from '../../domain/rules/field-readers';
import { isMultiEpisode } from '../../domain/rules/production-profile-rules';
import { EPISODE_DURATION_MAX_SECONDS, normalizeEntityEdit, normalizeEpisodeEdit, normalizeScreenplayTextEdit } from '../../domain/rules/screenplay-rules';
import { createEditPatch } from '../../domain/rules/stage-review-rules';
import { ApprovedBeatSheetReader } from '../stages/approved-beat-sheet';
import { StageRunner } from '../stages/stage-runner';
import { MergedScreenplayEditor } from './merged-screenplay-editor';
import { PackageScreenplayEditor } from './package-screenplay-editor';
import { ScreenplayEditor, readRef, requireStructure } from './screenplay-editing';
import { ScreenplayStageView, buildScreenplayStageView, readFidelity, screenplayTarget } from './screenplay-views';
import { readRunParams } from './stage-run-params';
import { StageService } from './stage-service';
import { WorkService } from './work-service';

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

/** 剧本阶段应用服务。 */
export class ScreenplayService {
  private readonly timestamp: () => string;
  private readonly merged: ScreenplayEditor;
  private readonly packaged: ScreenplayEditor;

  constructor(private readonly dependencies: ScreenplayServiceDependencies) {
    const { screenplays, runs } = dependencies;
    this.timestamp = () => (dependencies.now?.() ?? new Date()).toISOString();
    this.merged = new MergedScreenplayEditor({ screenplays, runs, timestamp: this.timestamp });
    this.packaged = new PackageScreenplayEditor({ screenplays, timestamp: this.timestamp });
  }

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
    return latest === undefined ? undefined : (readRunParams<ScreenplayParams>(latest) ?? undefined);
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
    return buildScreenplayStageView(this.dependencies, workId, runId);
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
    this.dependencies.stages.editLatest(runId, (run) => {
      const ref = readRef(rawInput);
      const edit = normalizeEpisodeEdit(rawInput);
      this.editorFor(run).saveEpisode(run, ref, edit, rawInput);
    });
  }

  /**
   * 保存人工编辑的一个实体，并让该版本回到待确认。
   * @param rawInput { ref, name, aliases, description, attributes, isActive }，ref 取自视图。
   * @throws ValidationError 内容不合法、同类型名称重复、不是最新版本或生成尚未成功。
   * @throws NotFoundError 记录或实体不存在。
   */
  saveEntity(runId: number, rawInput: unknown): void {
    this.dependencies.stages.editLatest(runId, (run) => {
      this.editorFor(run).saveEntity(run, readRef(rawInput), rawInput);
    });
  }

  /**
   * 在末尾新增一集，并让该版本回到待确认；单个短视频只有 1 集，不能新增。
   * @param rawInput { title, synopsis, screenplayText, targetDurationSeconds }。
   * @returns 新集的定位值（视图中的 ref）。
   * @throws ValidationError 内容不合法、单个短视频、集数已达上限、不是最新版本或生成尚未成功。
   */
  addEpisode(runId: number, rawInput: unknown): number {
    let ref = -1;
    this.dependencies.stages.editLatest(runId, (run) => {
      this.assertSeries(run.workId, '新增');
      ref = this.editorFor(run).addEpisode(run, normalizeEpisodeEdit(rawInput));
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
    this.dependencies.stages.editLatest(runId, (run) => {
      const ref = readRef(rawInput);
      this.assertSeries(run.workId, '删除');
      this.editorFor(run).deleteEpisode(run, ref);
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
    let newRef = -1;
    this.dependencies.stages.editLatest(runId, (run) => {
      const step = readMoveStep(readRecord(rawInput));
      const ref = readRef(rawInput);
      this.assertSeries(run.workId, '调整');
      newRef = this.editorFor(run).moveEpisode(run, ref, step);
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
    let ref = -1;
    this.dependencies.stages.editLatest(runId, (run) => {
      const kind = readRecord(rawInput).kind;
      if (typeof kind !== 'string' || !Object.keys(ENTITY_KIND_LABELS).includes(kind)) {
        throw new ValidationError({ kind: '请选择实体类型。' });
      }
      const edit = normalizeEntityEdit(rawInput, kind as EntityKind);
      ref = this.editorFor(run).addEntity(run, kind as EntityKind, edit);
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
    this.dependencies.stages.editLatest(runId, (run) => {
      this.editorFor(run).deleteEntity(run, readRef(rawInput));
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
    const structure = requireStructure(screenplays, run.id);
    const patch = createEditPatch(run);
    await runner.reextract(run.id, () => {
      const episodes = structure.episodes.map(({ segments: _cleared, ...episode }) => episode);
      screenplays.saveStructure(run.id, { ...structure, episodes }, this.timestamp());
      runs.applyEdit(run.id, patch);
    });
  }

  /** 编辑策略：已合并到作品的改作品的集和实体，否则改剧本包上的抽取结果。 */
  private editorFor(run: StageRun): ScreenplayEditor {
    return run.appliedAt !== null ? this.merged : this.packaged;
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

  /** 只有 1 集的体量不允许增删集。 */
  private assertSeries(workId: number, action: string): void {
    if (!isMultiEpisode(this.dependencies.works.getWork(workId).kind)) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: `单个短视频只有 1 集，不能${action}集。` });
    }
  }
}
