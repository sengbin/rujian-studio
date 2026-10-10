// ------------------------------------------------------------------------
// 名称：creative-workflow.ts
// 说明：创意阶段工作流：整理素材（文字、图片、小说分段要点）、规划大纲、逐章生成并逐章保存，支持中断后继续。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：进度（素材指纹、分段要点、图片描述、大纲）保存在阶段记录的 progress.detail 中；章节保存在章节表，重试时跳过已完成的部分；素材指纹（分段设置、各段长度、内容哈希）与上次不一致时丢弃全部旧进度与章节，从头开始。
// ------------------------------------------------------------------------

import { GeneratedOutputError, ValidationError } from '../../domain/errors';
import { BeatSheet } from '../../domain/models/beat-sheet';
import { ChapterDraft, ChapterOutlineItem, CreativeParams } from '../../domain/models/creative';
import { StageProgress } from '../../domain/models/stage-run';
import { ChapterRepository } from '../../domain/ports/chapter-repository';
import { CreativeSourceReader } from '../../domain/ports/creative-source-reader';
import { readBeatSheetSnapshot } from '../../domain/rules/beat-sheet-rules';
import { assertBeatReferenceReady, countWords, normalizeCreativeParams, parseChapter, parseOutline } from '../../domain/rules/creative-rules';
import { FieldErrors, assertNoFieldErrors, readOptionalChoice, readRecord } from '../../domain/rules/field-readers';
import { NovelSegment, NovelSplitSettings } from '../../domain/rules/novel-splitter';
import { CalibrationResult, describeDeviation, toleranceRange } from '../../domain/rules/timing-calibration-rules';
import { PromptTemplates } from '../../domain/ports/prompt-templates';
import { ImageInput } from '../../domain/ports/text-generation-port';
import { AskOptions, askModel } from './ask-model';
import { runWithCalibration } from './calibration';
import { SUBMIT_CHAPTER_TOOL, createOutlineTool } from './output-tools/creative-output-tools';
import { NOT_APPLICABLE, wrapMaterial } from './prompt-templates';
import { LoadedSource, MaterialProgress, MaterialSourceType, loadSource, prepareMaterial, readMaterialProgress, segmentLabel } from './source-material';
import { SourceFingerprint, isSameFingerprint } from './source-fingerprint';
import { StageContext, StageWorkflow } from './stage-workflow';

/** 素材来源：文字灵感、灵感图片、小说原文。 */
export type CreativeSourceType = MaterialSourceType;

/** 创意阶段保存到阶段记录的输入快照。 */
export interface CreativeRunInput {
  readonly sourceType: CreativeSourceType;
  readonly params: CreativeParams;
  /** 参考节拍表模式下启动时已确认的节拍表快照；自由创作模式没有。 */
  readonly beatSheet?: BeatSheet;
}

/** 创意工作流的依赖。 */
export interface CreativeWorkflowDependencies {
  readonly chapters: ChapterRepository;
  readonly sources: CreativeSourceReader;
  readonly prompts: PromptTemplates;
  /** 读取当前的小说分段设置。 */
  readonly getSplitSettings: () => NovelSplitSettings;
  readonly now?: () => Date;
}

/** 各提示词模板使用的变量，模板文件必须与之完全一致（测试校验）。 */
export const CREATIVE_PROMPT_VARIABLES: Readonly<Record<string, readonly string[]>> = {
  system: [],
  'creative-summary': ['segmentIndex', 'segmentCount', 'segmentTitle', 'segment'],
  'creative-digest-images': ['imageCount'],
  'creative-outline': ['sourceKind', 'material', 'params', 'minWords', 'maxWords', 'maxChapters', 'beatRule', 'sourcesRule', 'sourcesExample'],
  'creative-chapter': [
    'seq',
    'total',
    'material',
    'params',
    'outline',
    'chapterTitle',
    'chapterSummary',
    'previousEnding',
    'sourceText',
    'minWords',
    'maxWords',
    'calibrationFeedback'
  ]
};

/** 创意阶段支持的素材来源，不含原创文稿（它直接导入，不经创意生成）。 */
const SOURCE_TYPES: readonly CreativeSourceType[] = ['text', 'image', 'novel'];
/** 素材来源在提示词里的称呼。 */
const SOURCE_KIND_LABELS: Readonly<Record<CreativeSourceType, string>> = {
  text: '文字灵感',
  image: '灵感图片',
  novel: '小说原文'
};
/** 写下一章时附带的上一章结尾字数，用来衔接情节。 */
const PREVIOUS_ENDING_CHARS = 300;
/** 恢复进度时发现素材或分段设置与上次不一致（或无法确认一致）、丢弃旧进度从头开始时给用户的提示。 */
const RESTART_NOTICE = '素材或分段设置与上次不一致，已丢弃之前的进度从头开始';

/** 保存在阶段记录 progress.detail 中的创意进度，用于中断后继续；素材整理部分见 MaterialProgress。 */
interface CreativeProgressDetail extends MaterialProgress {
  outline: ChapterOutlineItem[] | null;
}

/** 一次执行中共用的状态与辅助函数。 */
interface Environment {
  readonly context: StageContext;
  readonly input: CreativeRunInput;
  readonly state: CreativeProgressDetail;
  readonly segments: readonly NovelSegment[];
  readonly images: readonly ImageInput[];
  readonly savedChapters: Map<number, { title: string; content: string }>;
  report(step: string): void;
  ask<T>(template: string, variables: Record<string, string>, parse: (json: unknown) => T, options: AskOptions): Promise<T>;
}

/** 从阶段记录的进度中读取创意进度，缺失或格式不对时视为从头开始。 */
function readDetail(progress: StageProgress | null): CreativeProgressDetail {
  const detail = progress?.detail;
  const source = typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>) : {};
  return { ...readMaterialProgress(detail), outline: Array.isArray(source.outline) ? (source.outline as ChapterOutlineItem[]) : null };
}

/** 把生成参数整理为提示词中的“创作要求”文字。 */
function formatParams(params: CreativeParams): string {
  const lines = [
    params.genre === null ? null : `题材：${params.genre}`,
    params.tone === null ? null : `基调：${params.tone}`,
    params.preserve === null ? null : `必须保留的内容：${params.preserve}`,
    params.adjust === null ? null : `允许调整的内容：${params.adjust}`,
    params.extra === null ? null : `补充要求：${params.extra}`
  ].filter((line): line is string => line !== null);
  return lines.length === 0 ? NOT_APPLICABLE : lines.join('\n');
}

/** 把节拍表整理为大纲提示词里的“按节拍组织章节”要求。 */
function describeBeatRule(beatSheet: BeatSheet): string {
  const lines = beatSheet.beats.map((beat) => `${beat.seq}. ${beat.label}（参考约 ${beat.estimatedWords} 字）：${beat.synopsis}`);
  return [
    `\n## 节拍表\n`,
    `已确认的节拍表要求按节拍组织章节：恰好 ${beatSheet.beats.length} 章，一个节拍一章，按下面的顺序一一对应；每章的梗概依据对应节拍的剧情内容，章节数和字数以节拍表为准，上面的字数范围只是参考。`,
    ...lines,
    ''
  ].join('\n');
}

/** 重写一章时追加到提示词的偏差反馈：带上上一稿，要求只调整篇幅，不改变已确认的内容。 */
function describeChapterFeedback(feedback: CalibrationResult, previous: ChapterDraft): string {
  return [
    '\n## 上一稿的偏差\n',
    `上一稿正文：${describeDeviation(feedback, '字')}。请在上一稿的基础上重写本章：保留所有已有的台词和关键情节，只${feedback.deviationRatio > 0 ? '精简次要描写' : '补充必要的细节'}；不得编造新情节；不得改变已确认的人物、事件和结局。`,
    '上一稿全文：',
    wrapMaterial(previous.content),
    ''
  ].join('\n');
}

/** 创意阶段工作流。 */
export class CreativeWorkflow implements StageWorkflow {
  readonly stage = 'creative' as const;

  constructor(private readonly dependencies: CreativeWorkflowDependencies) {}

  normalizeInput(rawInput: unknown): Readonly<Record<string, unknown>> {
    const source = readRecord(rawInput);
    const errors: FieldErrors = {};

    const sourceType = readOptionalChoice(source, 'sourceType', '素材来源', SOURCE_TYPES, errors);
    if (sourceType === null && errors.sourceType === undefined) {
      errors.sourceType = '素材来源不能为空。';
    }

    let params: CreativeParams | undefined;
    try {
      const rawParams = typeof source.params === 'object' && source.params !== null ? source.params : source;
      params = normalizeCreativeParams(rawParams);
    } catch (error) {
      if (!(error instanceof ValidationError)) {
        throw error;
      }
      Object.assign(errors, error.fieldErrors);
    }
    assertNoFieldErrors(errors);
    // 参考模式下必须带着启动时已确认的节拍表快照，重试和查看偏差都以它为准。
    const beatSheet = params?.beatReferenceMode === 'reference' ? readBeatSheetSnapshot(source.beatSheet) : undefined;
    assertBeatReferenceReady(params?.beatReferenceMode ?? 'free', beatSheet);
    return beatSheet === undefined ? { sourceType, params } : { sourceType, params, beatSheet };
  }

  async execute(context: StageContext): Promise<void> {
    const { run } = context;
    // 输入快照由 normalizeInput 生成，结构可信。
    const input = run.input as unknown as CreativeRunInput;
    const source = loadSource(this.dependencies.sources, this.dependencies.getSplitSettings, run.workId, input.sourceType);
    const state = readDetail(run.progress);
    const restartNotice = this.discardStaleProgress(run.id, input.sourceType, state, source.fingerprint);
    state.source = source.fingerprint;

    const environment = this.createEnvironment(context, input, state, source, restartNotice);
    const material = await prepareMaterial({
      sourceType: input.sourceType,
      idea: input.params.idea,
      segments: environment.segments,
      images: environment.images,
      state,
      report: environment.report,
      ask: environment.ask
    });
    const outline = await this.planOutline(environment, material);
    await this.writeChapters(environment, material, outline);
  }

  /**
   * 恢复进度前核对素材：已保存的要点、图片描述、大纲与章节只有在素材指纹（分段设置、各段长度、内容哈希）与上次完全一致时才复用，
   * 否则全部丢弃（含已保存的章节），从头开始。文字灵感的内容固定在输入快照中，不需要核对。
   * @returns 发生了丢弃时返回给用户的提示，没有丢弃时为空串。
   */
  private discardStaleProgress(runId: number, sourceType: CreativeSourceType, state: CreativeProgressDetail, current: SourceFingerprint | null): string {
    const { chapters } = this.dependencies;
    const hasProgress = state.summaries.length > 0 || state.digest !== null || state.outline !== null || chapters.list(runId).length > 0;
    if (!hasProgress || sourceType === 'text' || isSameFingerprint(state.source, current)) {
      return '';
    }
    state.summaries = [];
    state.digest = null;
    state.outline = null;
    chapters.clear(runId);
    return RESTART_NOTICE;
  }

  /** 组装一次执行的共用状态与提问函数。 */
  private createEnvironment(
    context: StageContext,
    input: CreativeRunInput,
    state: CreativeProgressDetail,
    source: LoadedSource,
    restartNotice: string
  ): Environment {
    const { prompts, chapters } = this.dependencies;
    const { segments, images } = source;
    const savedChapters = new Map(chapters.list(context.run.id).map((chapter) => [chapter.seq, chapter]));

    const report = (step: string): void => {
      const materialSteps = input.sourceType === 'novel' ? segments.length : input.sourceType === 'image' ? 1 : 0;
      const materialDone =
        input.sourceType === 'novel' ? state.summaries.length : input.sourceType === 'image' && state.digest !== null ? 1 : 0;
      context.reportProgress({
        // 丢弃了旧进度时，提示跟在每一步之后，直到本次执行结束。
        step: restartNotice === '' ? step : `${step}（${restartNotice}）`,
        total: materialSteps + 1 + (state.outline?.length ?? 0),
        done: materialDone + (state.outline === null ? 0 : 1) + savedChapters.size,
        detail: { ...state }
      });
    };

    const ask = <T>(template: string, variables: Record<string, string>, parse: (json: unknown) => T, options: AskOptions): Promise<T> =>
      askModel(context, prompts, template, variables, parse, options);

    return { context, input, state, segments, images, savedChapters, report, ask };
  }

  /** 规划章节大纲；已有大纲时直接沿用。 */
  private async planOutline(environment: Environment, material: string): Promise<ChapterOutlineItem[]> {
    const { input, state, segments, report, ask } = environment;
    if (state.outline !== null) {
      return state.outline;
    }
    const { params, sourceType, beatSheet } = input;
    report('规划大纲');
    const novel = sourceType === 'novel';
    // 参考模式：一个节拍一章，章节数与参考字数都来自节拍表。
    const beatCount = beatSheet?.beats.length;
    const wordRanges = beatSheet?.beats.map((beat) => toleranceRange(beat.estimatedWords, beatSheet.params.toleranceRatio));
    const outline = await ask(
      'creative-outline',
      {
        sourceKind: SOURCE_KIND_LABELS[sourceType],
        material,
        params: formatParams(params),
        minWords: String(wordRanges === undefined ? params.chapterMinWords : Math.min(...wordRanges.map((range) => range.min))),
        maxWords: String(wordRanges === undefined ? params.chapterMaxWords : Math.max(...wordRanges.map((range) => range.max))),
        maxChapters: String(beatCount ?? params.maxChapters),
        beatRule: beatSheet === undefined ? '' : describeBeatRule(beatSheet),
        sourcesRule: novel ? `每章必须用 sources 列出本章依据的原文分段序号（1 到 ${segments.length}，可多个），序号取自上面各段前的编号。` : '',
        sourcesExample: novel ? ', "sources": [1, 2]' : ''
      },
      (json) => {
        const parsed = parseOutline(json, beatCount === undefined ? params : { ...params, maxChapters: beatCount }, segments.length);
        if (beatCount !== undefined && parsed.length !== beatCount) {
          throw new GeneratedOutputError([`大纲必须恰好有 ${beatCount} 章，与节拍一一对应（当前 ${parsed.length} 章）。`]);
        }
        return parsed;
      },
      { overflowHint: '请在设置中增大“每段字数上限”以减少分段数，或缩短素材后重试。', tool: createOutlineTool(novel) }
    );
    state.outline = outline;
    report('规划大纲');
    return outline;
  }

  /** 逐章生成并保存；已保存的章节跳过。参考节拍表模式下按节拍的参考字数做轻量校准。 */
  private async writeChapters(environment: Environment, material: string, outline: readonly ChapterOutlineItem[]): Promise<void> {
    const { input, segments, savedChapters, context, report, ask } = environment;
    const { params, sourceType, beatSheet } = input;
    const outlineText = outline.map((item) => `${item.seq}. ${item.title}：${item.summary}`).join('\n');

    for (const item of outline) {
      if (savedChapters.has(item.seq)) {
        continue;
      }
      report(`生成第 ${item.seq} / ${outline.length} 章`);
      const previous = savedChapters.get(item.seq - 1);
      const sourceText =
        sourceType === 'novel'
          ? wrapMaterial(item.sources.map((index) => `【${segmentLabel(segments[index - 1])}】\n${segments[index - 1].text}`).join('\n\n'))
          : NOT_APPLICABLE;

      // 参考模式：本章对应节拍的参考字数为目标，字数范围由容差算出；自由创作：用表单里的字数范围，不校准。
      const beat = beatSheet?.beats[item.seq - 1];
      const range = beat === undefined || beatSheet === undefined ? undefined : toleranceRange(beat.estimatedWords, beatSheet.params.toleranceRatio);
      const generate = async (feedback: CalibrationResult | null, previousDraft: ChapterDraft | null): Promise<ChapterDraft> =>
        ask(
          'creative-chapter',
          {
            seq: String(item.seq),
            total: String(outline.length),
            material: sourceType === 'novel' ? NOT_APPLICABLE : material,
            params: formatParams(params),
            outline: outlineText,
            chapterTitle: item.title,
            chapterSummary: item.summary,
            previousEnding: previous === undefined ? '（这是第一章）' : `……${previous.content.slice(-PREVIOUS_ENDING_CHARS)}`,
            sourceText,
            minWords: String(range?.min ?? params.chapterMinWords),
            maxWords: String(range?.max ?? params.chapterMaxWords),
            calibrationFeedback: feedback === null || previousDraft === null ? '' : describeChapterFeedback(feedback, previousDraft)
          },
          (json) => parseChapter(json, item.seq),
          { overflowHint: '请在设置中调小“每段字数上限”后重试。', tool: SUBMIT_CHAPTER_TOOL }
        );

      const draft =
        beat === undefined || beatSheet === undefined
          ? await generate(null, null)
          : (
              await runWithCalibration({
                generate,
                measure: (chapter) => countWords(chapter.content),
                target: beat.estimatedWords,
                toleranceRatio: beatSheet.params.toleranceRatio,
                maxRounds: beatSheet.params.maxCalibrationRounds
              })
            ).result;
      this.dependencies.chapters.save(context.run.id, draft, (this.dependencies.now?.() ?? new Date()).toISOString());
      savedChapters.set(item.seq, draft);
    }
    report('已完成');
  }
}
