// ------------------------------------------------------------------------
// 名称：screenplay-workflow.ts
// 说明：剧本阶段工作流：依据已确认的创意章节生成剧本包正文，再从正文抽取集和实体；原稿保真模式（原创文稿）下正文直接取自章节、不调用模型改写，并在抽取后给每一集的正文做结构标注；支持中断后继续与重新抽取。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：正文与抽取结果都保存在剧本包表，重试时已有正文则跳过生成、已有抽取结果则跳过抽取、已有标注的集跳过标注；重新抽取时先清除抽取结果再执行；保真模式下集的正文由程序按段落序号截取、标注只引用片段序号，模型不复制原文。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, ValidationError } from '../../domain/errors';
import { AdaptationChecklist } from '../../domain/models/adaptation-checklist';
import { BeatSheet } from '../../domain/models/beat-sheet';
import { ChapterDraft } from '../../domain/models/creative';
import {
  EpisodeDraft,
  ScreenplayFidelity,
  ScreenplayParams,
  ScreenplayStructure,
  ScreenplayText,
  TextSegment
} from '../../domain/models/screenplay';
import { ProductionFormatType } from '../../domain/models/production-profile';
import { AdaptationChecklistRepository } from '../../domain/ports/adaptation-checklist-repository';
import { ChapterRepository } from '../../domain/ports/chapter-repository';
import { PromptTemplates } from '../../domain/ports/prompt-templates';
import { ScreenplayRepository } from '../../domain/ports/screenplay-repository';
import { describeConfirmedOptions, needsAdaptation, parseAdaptationOptions } from '../../domain/rules/adaptation-checklist-rules';
import { readBeatSheetSnapshot } from '../../domain/rules/beat-sheet-rules';
import { countWords } from '../../domain/rules/creative-rules';
import { FieldErrors, assertNoFieldErrors, readOptionalChoice, readRecord, readText } from '../../domain/rules/field-readers';
import { getProductionProfile, isMultiEpisode, listSupportedFormats } from '../../domain/rules/production-profile-rules';
import { KnownCharacter, parseSegmentLabels } from '../../domain/rules/segment-rules';
import { WORK_NAME_MAX_LENGTH } from '../../domain/rules/work-rules';
import {
  ScreenplayContext,
  normalizeScreenplayParams,
  parseScreenplayText,
  parseStructure,
  parseVerbatimStructure,
  countSpokenWords
} from '../../domain/rules/screenplay-rules';
import { renderAnnotatedText, renderNumbered, splitParagraphs, splitSegments } from '../../domain/rules/text-segmenter';
import { CalibrationResult, describeDeviation } from '../../domain/rules/timing-calibration-rules';
import { askModel } from './ask-model';
import { runWithCalibration } from './calibration';
import {
  SUBMIT_ADAPTATION_OPTIONS_TOOL,
  SUBMIT_SCREENPLAY_TOOL,
  SUBMIT_SEGMENT_LABELS_TOOL,
  createStructureTool,
  createVerbatimStructureTool
} from './output-tools/screenplay-output-tools';
import { NOT_APPLICABLE, wrapMaterial } from './prompt-templates';
import { StageContext, StageWorkflow } from './stage-workflow';

/** 剧本阶段保存到阶段记录的输入快照。 */
export interface ScreenplayRunInput {
  readonly formatType: ProductionFormatType;
  /** 单个短视频的集标题取作品名称，生成时的名称记录在快照里。 */
  readonly workName: string;
  /** 改编强度：adapted 依据创意章节改写，verbatim 原稿文字原样保留（原创文稿）。 */
  readonly fidelity: ScreenplayFidelity;
  readonly params: ScreenplayParams;
  /** 启动时已确认的节拍表快照（改编强度为 adapted 且有已确认节拍表时）：作为目标时长的参考基准，触发结构性改编清单与轻量校准。 */
  readonly beatSheet?: BeatSheet;
}

/** 剧本工作流的依赖。 */
export interface ScreenplayWorkflowDependencies {
  readonly chapters: ChapterRepository;
  readonly screenplays: ScreenplayRepository;
  readonly checklists: AdaptationChecklistRepository;
  readonly prompts: PromptTemplates;
  readonly now?: () => Date;
}

/** 各提示词模板使用的变量，模板文件必须与之完全一致（测试校验）。 */
export const SCREENPLAY_PROMPT_VARIABLES: Readonly<Record<string, readonly string[]>> = {
  'screenplay-adaptation-options': ['material', 'targetSeconds', 'baselineSeconds', 'extra'],
  'screenplay-text': ['material', 'formatDescription', 'params', 'adaptationRule', 'episodeRule', 'maxDuration', 'calibrationFeedback'],
  'screenplay-extract': ['screenplay', 'episodeRule', 'maxDuration', 'episodeOutput'],
  'screenplay-extract-verbatim': ['screenplay', 'episodeRule', 'maxDuration', 'episodeOutput'],
  'screenplay-annotate': ['episodeTitle', 'characters', 'context', 'segments']
};

/** 当前支持的体量类型，用于校验参数。 */
const FORMAT_TYPES: readonly ProductionFormatType[] = listSupportedFormats().map((profile) => profile.formatType);
/** 剧本的忠实度取值：改编、逐字保留。 */
const FIDELITIES: readonly ScreenplayFidelity[] = ['adapted', 'verbatim'];
/** 生成正文与抽取两个基础步骤；保真模式在其后按集增加标注步骤。 */
const BASE_STEPS = 2;
/** 一次请求最多标注的片段数，超过则分批，避免输出过长。 */
const SEGMENT_BATCH_SIZE = 150;
/** 分批标注时，作为上文带给下一批的片段数。 */
const CONTEXT_SEGMENT_COUNT = 3;
const NO_CHARACTERS = '（没有角色，所有对白和心声的说话人都不填，并标记 uncertain）';
const NO_CONTEXT = '（这是本集开头，没有上文）';

/** 报告进度：步骤名称、已完成步数，总步数缺省为基础步骤数。 */
type ReportProgress = (step: string, done: number, total?: number) => void;

/** 校准重写单个集时，提示词里对这份剧本的说明。 */
const SINGLE_EPISODE_DESCRIPTION = '单集剧本（只有 1 集）';

/** 生成正文时对集数的要求。 */
function describeTextEpisodeRule(formatType: ProductionFormatType, params: ScreenplayParams): string {
  return !isMultiEpisode(formatType)
    ? '这是单个短视频，整部剧本就是 1 集，不分集。'
    : `按剧情拆分为多集，最多 ${params.maxEpisodes} 集；上限不是目标，按故事的完整度决定集数，每集要有相对完整的起承转合，集与集之间保留悬念衔接。剧本中每集以“第 N 集 标题”开头。`;
}

/** 抽取时对集数的要求。 */
function describeExtractEpisodeRule(formatType: ProductionFormatType, params: ScreenplayParams): string {
  return !isMultiEpisode(formatType) ? '这是单个短视频，只有 1 集。' : `按剧本中的集划分，最多 ${params.maxEpisodes} 集。`;
}

/** 抽取时对每集输出的要求。 */
function describeEpisodeOutput(formatType: ProductionFormatType): string {
  return !isMultiEpisode(formatType)
    ? 'episodes 只包含 1 项：填写 synopsis，不需要 title 和 screenplayText。'
    : 'episodes 每项填写 title 和 synopsis，screenplayText 从剧本正文中原样摘录属于该集的部分，不得改写、删减或合并。';
}

/** 保真模式下划分集的要求：原稿没有现成的集标记，按情节在段落边界处划分。 */
function describeVerbatimEpisodeRule(formatType: ProductionFormatType, params: ScreenplayParams): string {
  return !isMultiEpisode(formatType)
    ? '这是单个短视频，只有 1 集。'
    : `按原稿情节的起承转合划分为多集，最多 ${params.maxEpisodes} 集；上限不是目标，不要为凑集数拆分，只在段落之间分集。`;
}

/** 保真模式下对每集输出的要求：用段落序号划分，不输出原文。 */
function describeVerbatimEpisodeOutput(formatType: ProductionFormatType): string {
  return !isMultiEpisode(formatType)
    ? 'episodes 只包含 1 项：填写 synopsis，不需要 title 和段落序号。'
    : 'episodes 每项填写 title、synopsis、startParagraph 和 endParagraph：用段落序号划分，各集按顺序连续、不重叠、不遗漏，第 1 集从第 1 段开始，最后一集结束在最后一段；不要输出原文。';
}

/** 保真模式的剧本包：正文是各章节正文原样拼接，标题取作品名称。 */
function createVerbatimText(input: ScreenplayRunInput, chapters: readonly ChapterDraft[]): ScreenplayText {
  return parseScreenplayText(
    {
      title: input.workName,
      overview: `原创文稿，共 ${chapters.length} 章，正文取自原稿章节，未做改写。`,
      fullText: chapters.map((chapter) => chapter.content.trim()).join('\n\n')
    },
    !isMultiEpisode(input.formatType)
  );
}

/** 角色清单：每行一个角色，含别名。 */
function describeCharacters(characters: readonly KnownCharacter[]): string {
  if (characters.length === 0) {
    return NO_CHARACTERS;
  }
  return characters.map((character) => `- ${character.name}${character.aliases.length === 0 ? '' : `（别名：${character.aliases.join('、')}）`}`).join('\n');
}

/** 生成正文时的“创作要求”：有节拍表时先写时长参考，再写补充要求；都没有时为“（无）”。 */
function describeTextParams(params: ScreenplayParams, beatSheet: BeatSheet | undefined, formatType: ProductionFormatType): string {
  const lines: string[] = [];
  if (beatSheet !== undefined) {
    const { targetDurationSeconds, wordsPerSecond, toleranceRatio, episodeCount } = beatSheet.params;
    const { multiEpisode, durationScopeLabel } = getProductionProfile(formatType);
    lines.push(
      `时长参考：${durationScopeLabel}目标约 ${targetDurationSeconds} 秒，按 ${wordsPerSecond} 字/秒换算，台词与旁白合计约 ${Math.round(targetDurationSeconds * wordsPerSecond)} 字（画面动作、音效、配乐不计入），允许 ±${Math.round(toleranceRatio * 100)}%；这是目标，不要为凑时长注水，也不要压缩到无法讲完故事。${multiEpisode ? `参考集数约 ${episodeCount} 集。` : ''}`
    );
  }
  if (params.extra !== null) {
    lines.push(`补充要求：${params.extra}`);
  }
  return lines.length === 0 ? NOT_APPLICABLE : lines.join('\n');
}

/** 已确认排除或合并的内容，写进提示词；没有勾选项时为空串。 */
function describeAdaptationRule(checklist: AdaptationChecklist | undefined): string {
  const list = describeConfirmedOptions(checklist);
  if (list === '') {
    return '';
  }
  return `\n## 已确认排除或合并的内容\n\n以下取舍已由用户确认：被排除的支线和场次不得再写入剧本，被合并的人物按合并后的统一人物处理；其余内容照常改编。\n${list}\n`;
}

/** 重写时追加到提示词的偏差反馈：带上上一稿，要求只调整篇幅，不改变已确认的内容。 */
function describeScreenplayFeedback(feedback: CalibrationResult, previousText: string, scope: string): string {
  const direction = feedback.deviationRatio > 0 ? '精简台词与旁白' : '补充必要的台词或旁白';
  return [
    '\n## 上一稿的偏差\n',
    `上一稿${scope}：${describeDeviation(feedback, '秒')}。请在上一稿的基础上重写${scope}：保留所有已有台词和关键情节，只${direction}；不得编造新情节；不得改变已确认的人物、事件和结局；输出仍为完整的剧本包（title、overview、fullText）。`,
    '上一稿全文：',
    wrapMaterial(previousText),
    ''
  ].join('\n');
}

/** 剧本阶段工作流。 */
export class ScreenplayWorkflow implements StageWorkflow {
  readonly stage = 'screenplay' as const;

  constructor(private readonly dependencies: ScreenplayWorkflowDependencies) {}

  normalizeInput(rawInput: unknown): Readonly<Record<string, unknown>> {
    const source = readRecord(rawInput);
    const errors: FieldErrors = {};
    const formatType = readOptionalChoice(source, 'formatType', '作品形态', FORMAT_TYPES, errors);
    if (formatType === null && errors.formatType === undefined) {
      errors.formatType = '作品形态不能为空。';
    }
    const fidelity = readOptionalChoice(source, 'fidelity', '改编强度', FIDELITIES, errors) ?? 'adapted';
    const workName = readText(source, { key: 'workName', label: '作品名称', required: true, maxLength: WORK_NAME_MAX_LENGTH }, errors);
    assertNoFieldErrors(errors);

    const params = normalizeScreenplayParams(typeof source.params === 'object' && source.params !== null ? source.params : source, formatType as ProductionFormatType);
    // 原稿保真模式不改写正文，没有改编清单与校准，不保存节拍表。
    const beatSheet = fidelity === 'adapted' ? readBeatSheetSnapshot(source.beatSheet) : undefined;
    return beatSheet === undefined ? { formatType, workName, fidelity, params } : { formatType, workName, fidelity, params, beatSheet };
  }

  async execute(context: StageContext): Promise<void> {
    const { run } = context;
    const { chapters, screenplays, prompts } = this.dependencies;
    // 输入快照由 normalizeInput 生成，结构可信。
    const input = run.input as unknown as ScreenplayRunInput;
    const { formatType, params } = input;
    const verbatim = input.fidelity === 'verbatim';
    const single = !isMultiEpisode(formatType);
    const beatSheet = verbatim ? undefined : input.beatSheet;

    const report: ReportProgress = (step, done, total = BASE_STEPS) => context.reportProgress({ step, total, done });

    let screenplay = screenplays.find(run.id);
    if (screenplay === undefined) {
      const upstream = run.sourceRunId === null ? [] : chapters.list(run.sourceRunId);
      if (upstream.length === 0) {
        throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '没有找到已确认的创意章节，请先确认创意。' });
      }
      let text: ScreenplayText;
      if (verbatim) {
        report('导入原稿正文', 0);
        text = createVerbatimText(input, upstream);
      } else {
        // 有已确认的节拍表且内容明显超出目标时长时，先给出改编取舍清单，等用户确认后再继续（确认后由应用服务重新启动本阶段）。
        let adaptation: AdaptationChecklist | undefined;
        if (beatSheet !== undefined) {
          const gate = await this.resolveAdaptation(context, input, beatSheet, upstream, report);
          if (gate.pending) {
            return;
          }
          adaptation = gate.checklist;
        }
        report('生成剧本包正文', 0);
        text = await this.generateText(context, input, upstream, beatSheet, adaptation);
      }
      screenplays.create(run.id, text, this.timestamp());
      screenplay = screenplays.find(run.id);
    }
    if (screenplay === undefined) {
      throw new Error(`阶段记录 ${run.id} 的剧本包写入后读取失败。`);
    }

    if (screenplay.structure === null) {
      report('抽取集和实体', 1);
      const parseContext: ScreenplayContext = { formatType, workName: input.workName, params };
      const { fullText } = screenplay;
      const paragraphs = verbatim ? splitParagraphs(fullText) : [];
      const structure = await askModel(
        context,
        prompts,
        verbatim ? 'screenplay-extract-verbatim' : 'screenplay-extract',
        {
          screenplay: wrapMaterial(verbatim ? renderNumbered(paragraphs) : fullText),
          episodeRule: verbatim ? describeVerbatimEpisodeRule(formatType, params) : describeExtractEpisodeRule(formatType, params),
          maxDuration: String(params.maxEpisodeDurationSeconds),
          episodeOutput: verbatim ? describeVerbatimEpisodeOutput(formatType) : describeEpisodeOutput(formatType)
        },
        (json) => (verbatim ? parseVerbatimStructure(json, parseContext, paragraphs) : parseStructure(json, parseContext, fullText)),
        {
          overflowHint: single ? '剧本正文过长，请缩短后重新抽取。' : '剧本正文过长，请缩短正文或减少集数后重新抽取。',
          tool: verbatim ? createVerbatimStructureTool(single) : createStructureTool(single)
        }
      );
      screenplays.saveStructure(run.id, structure, this.timestamp());
    }

    // 多集短剧：正文抽取出各集之后，分别对每一集单独做时长校准（单集短视频已在生成正文时校准）。
    if (beatSheet !== undefined && !single) {
      await this.calibrateEpisodes(context, input, beatSheet, report);
    }

    const total = verbatim ? BASE_STEPS + (await this.annotateEpisodes(context, report)) : BASE_STEPS;
    report('已完成', total, total);
  }

  /**
   * 结构性改编：基线（已确认章节全文）超出目标时长的容差上限时，让模型分析可取舍的支线、人物合并与场次，保存为待用户确认的清单。
   * 已有清单时直接沿用（未确认则继续等待）；不需要改编，或模型认为没有可取舍的内容时不暂停。
   * @returns pending 为 true 表示清单待用户确认，本次执行到此结束；否则 checklist 是已确认的清单（没有清单为 undefined）。
   */
  private async resolveAdaptation(
    context: StageContext,
    input: ScreenplayRunInput,
    beatSheet: BeatSheet,
    upstream: readonly ChapterDraft[],
    report: ReportProgress
  ): Promise<{ readonly pending: boolean; readonly checklist?: AdaptationChecklist }> {
    const { checklists, prompts } = this.dependencies;
    const runId = context.run.id;
    const saved = checklists.find(runId);
    if (saved !== undefined) {
      return saved.confirmedAt === null ? { pending: true } : { pending: false, checklist: saved };
    }

    const { wordsPerSecond, toleranceRatio, targetDurationSeconds, episodeCount } = beatSheet.params;
    const baselineWords = upstream.reduce((sum, chapter) => sum + countWords(chapter.content), 0);
    const baselineSeconds = Math.round((baselineWords / wordsPerSecond) * 10) / 10;
    // 多集短剧的目标是全剧总时长：单集目标时长乘集数。
    const targetSeconds = isMultiEpisode(input.formatType) ? targetDurationSeconds * episodeCount : targetDurationSeconds;
    if (!needsAdaptation(baselineSeconds, targetSeconds, toleranceRatio)) {
      return { pending: false };
    }

    report('分析改编取舍', 0);
    const options = await askModel(
      context,
      prompts,
      'screenplay-adaptation-options',
      {
        material: wrapMaterial(upstream.map((chapter) => `【第 ${chapter.seq} 章 ${chapter.title}】\n${chapter.content}`).join('\n\n')),
        targetSeconds: String(targetSeconds),
        baselineSeconds: String(baselineSeconds),
        extra: input.params.extra ?? NOT_APPLICABLE
      },
      (json) => parseAdaptationOptions(json, wordsPerSecond),
      { overflowHint: '创意章节过长，请在创意阶段精简章节后重新生成。', tool: SUBMIT_ADAPTATION_OPTIONS_TOOL }
    );
    const timestamp = this.timestamp();
    // 没有可取舍的内容时无须用户确认，直接继续生成正文。
    const checklist: AdaptationChecklist = {
      runId,
      baselineWords,
      baselineSeconds,
      targetSeconds,
      wordsPerSecond,
      toleranceRatio,
      options,
      confirmedAt: options.length === 0 ? timestamp : null,
      updatedAt: timestamp
    };
    checklists.save(checklist);
    return options.length === 0 ? { pending: false, checklist } : { pending: true };
  }

  /**
   * 生成剧本包正文。有节拍表的单集短视频按目标时长做轻量校准：实测超出容差时带偏差反馈、基于上一稿重写，最多 maxCalibrationRounds 轮。
   * @param adaptation 用户已确认的改编清单；没有时不排除任何内容。
   */
  private async generateText(
    context: StageContext,
    input: ScreenplayRunInput,
    upstream: readonly ChapterDraft[],
    beatSheet: BeatSheet | undefined,
    adaptation: AdaptationChecklist | undefined
  ): Promise<ScreenplayText> {
    const { formatType, params } = input;
    const singleEpisode = !isMultiEpisode(formatType);
    const material = wrapMaterial(upstream.map((chapter) => `【第 ${chapter.seq} 章 ${chapter.title}】\n${chapter.content}`).join('\n\n'));
    const generate = (feedback: CalibrationResult | null, previous: ScreenplayText | null): Promise<ScreenplayText> =>
      askModel(
        context,
        this.dependencies.prompts,
        'screenplay-text',
        {
          material,
          formatDescription: getProductionProfile(formatType).promptDescription,
          params: describeTextParams(params, beatSheet, formatType),
          adaptationRule: describeAdaptationRule(adaptation),
          episodeRule: describeTextEpisodeRule(formatType, params),
          maxDuration: String(params.maxEpisodeDurationSeconds),
          calibrationFeedback: feedback === null || previous === null ? '' : describeScreenplayFeedback(feedback, previous.fullText, '剧本')
        },
        (json) => parseScreenplayText(json, singleEpisode),
        { overflowHint: '创意章节过长，请在创意阶段精简章节后重新生成。', tool: SUBMIT_SCREENPLAY_TOOL }
      );
    if (beatSheet === undefined || !singleEpisode) {
      return generate(null, null);
    }
    const { wordsPerSecond, targetDurationSeconds, toleranceRatio, maxCalibrationRounds } = beatSheet.params;
    const outcome = await runWithCalibration({
      generate,
      measure: (text) => countSpokenWords(text.fullText) / wordsPerSecond,
      target: targetDurationSeconds,
      toleranceRatio,
      maxRounds: maxCalibrationRounds
    });
    return outcome.result;
  }

  /**
   * 多集短剧：对时长超出容差的集单独做轻量校准，基于该集现有正文重写，每校准完一集保存一次；其余集和实体不变。
   * 重写只改这一集的正文，不改剧本包全文。
   */
  private async calibrateEpisodes(context: StageContext, input: ScreenplayRunInput, beatSheet: BeatSheet, report: ReportProgress): Promise<void> {
    const runId = context.run.id;
    const { wordsPerSecond, targetDurationSeconds, toleranceRatio, maxCalibrationRounds } = beatSheet.params;
    const seconds = (text: string): number => countSpokenWords(text) / wordsPerSecond;
    let structure = this.requireStructure(runId);

    for (const [position, episode] of structure.episodes.entries()) {
      if (Math.abs(seconds(episode.screenplayText) - targetDurationSeconds) <= targetDurationSeconds * toleranceRatio + 1e-9) {
        continue;
      }
      report(`校准时长：第 ${episode.seq} 集`, BASE_STEPS, BASE_STEPS + structure.episodes.length);
      const rewritten = await runWithCalibration({
        initial: episode.screenplayText,
        generate: async (feedback, previous) => {
          const text = await askModel(
            context,
            this.dependencies.prompts,
            'screenplay-text',
            {
              material: wrapMaterial(`【第 ${episode.seq} 集 ${episode.title}】\n${previous ?? episode.screenplayText}`),
              formatDescription: SINGLE_EPISODE_DESCRIPTION,
              params: `这是对已有第 ${episode.seq} 集剧本的时长校准重写，只重写这一集，保持原有的“第N场”场次结构。\n${describeTextParams(input.params, beatSheet, input.formatType)}`,
              adaptationRule: '',
              episodeRule: '整份剧本就是这 1 集，不分集；不要添加“第 N 集”之类的集标题。',
              maxDuration: String(input.params.maxEpisodeDurationSeconds),
              calibrationFeedback: describeScreenplayFeedback(feedback as CalibrationResult, previous ?? episode.screenplayText, '这一集')
            },
            (json) => parseScreenplayText(json, true),
            { overflowHint: '这一集剧本过长，请在剧本阶段把它拆短后重新生成。', tool: SUBMIT_SCREENPLAY_TOOL }
          );
          return text.fullText;
        },
        measure: seconds,
        target: targetDurationSeconds,
        toleranceRatio,
        maxRounds: maxCalibrationRounds
      });
      structure = {
        ...structure,
        episodes: structure.episodes.map((item, index) => (index === position ? { ...item, screenplayText: rewritten.result } : item))
      };
      this.dependencies.screenplays.saveStructure(runId, structure, this.timestamp());
    }
  }

  /**
   * 给还没有标注的集做结构标注，每完成一集就保存一次，重试时跳过已完成的集。
   * @returns 集的数量。
   */
  private async annotateEpisodes(context: StageContext, report: ReportProgress): Promise<number> {
    const runId = context.run.id;
    let structure = this.requireStructure(runId);
    const characters: KnownCharacter[] = structure.entities
      .filter((entity) => entity.kind === 'character' && entity.isActive)
      .map(({ name, aliases }) => ({ name, aliases }));
    const total = BASE_STEPS + structure.episodes.length;

    for (const [position, episode] of structure.episodes.entries()) {
      if (episode.segments !== undefined) {
        continue;
      }
      report(`标注结构：第 ${episode.seq} 集`, BASE_STEPS + position, total);
      const segments = await this.annotateEpisode(context, episode, characters);
      structure = { ...structure, episodes: structure.episodes.map((item, index) => (index === position ? { ...item, segments } : item)) };
      this.dependencies.screenplays.saveStructure(runId, structure, this.timestamp());
    }
    return structure.episodes.length;
  }

  /** 把一集正文切成片段并标注；片段较多时分批，后一批带上前一批最后几个片段作为上文。 */
  private async annotateEpisode(context: StageContext, episode: EpisodeDraft, characters: readonly KnownCharacter[]): Promise<TextSegment[]> {
    const pieces = splitSegments(episode.screenplayText);
    const segments: TextSegment[] = [];
    for (let start = 0; start < pieces.length; start += SEGMENT_BATCH_SIZE) {
      const batch = pieces.slice(start, start + SEGMENT_BATCH_SIZE);
      const previous = segments.slice(-CONTEXT_SEGMENT_COUNT);
      const labeled = await askModel(
        context,
        this.dependencies.prompts,
        'screenplay-annotate',
        {
          episodeTitle: `第 ${episode.seq} 集 ${episode.title}`,
          characters: describeCharacters(characters),
          context: previous.length === 0 ? NO_CONTEXT : wrapMaterial(renderAnnotatedText(previous)),
          segments: wrapMaterial(renderNumbered(batch))
        },
        (json) => parseSegmentLabels(json, batch, characters),
        { overflowHint: '这一集正文过长，请在剧本阶段把它拆短后重新抽取。', tool: SUBMIT_SEGMENT_LABELS_TOOL }
      );
      segments.push(...labeled);
    }
    return segments;
  }

  /** 读取已保存的抽取结果；没有时说明流程出错。 */
  private requireStructure(runId: number): ScreenplayStructure {
    const structure = this.dependencies.screenplays.find(runId)?.structure;
    if (structure === null || structure === undefined) {
      throw new Error(`阶段记录 ${runId} 的抽取结果保存后读取失败。`);
    }
    return structure;
  }

  private timestamp(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}
