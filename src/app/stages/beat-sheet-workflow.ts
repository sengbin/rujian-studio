// ------------------------------------------------------------------------
// 名称：beat-sheet-workflow.ts
// 说明：节拍表阶段工作流：整理素材（文字灵感、图片、小说或原稿各段要点），由程序按节拍模板计算各节拍的参考时长与字数，再让模型只分配每个节拍的剧情内容，校验后保存。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：参考预算由程序计算、不调用模型；节拍数量与顺序必须与模板一致；素材整理与创意阶段共用（source-material.ts），整理进度保存在 progress.detail，素材指纹不一致时丢弃重来；原创文稿按小说处理；节拍表已有产出时重试直接跳过。
// ------------------------------------------------------------------------

import { BeatSheetParams } from '../../domain/models/beat-sheet';
import { BeatTemplate, ProductionFormatType } from '../../domain/models/production-profile';
import { BeatSheetRepository } from '../../domain/ports/beat-sheet-repository';
import { CreativeSourceReader } from '../../domain/ports/creative-source-reader';
import { PromptTemplates } from '../../domain/ports/prompt-templates';
import { allocateBeatBudget, composeBeats, normalizeBeatSheetParams, parseBeatSheet } from '../../domain/rules/beat-sheet-rules';
import { FieldErrors, assertNoFieldErrors, readOptionalChoice, readRecord } from '../../domain/rules/field-readers';
import { NovelSplitSettings } from '../../domain/rules/novel-splitter';
import { getBeatTemplate, getProductionProfile, listSupportedFormats } from '../../domain/rules/production-profile-rules';
import { WorkSourceType } from '../../domain/models/work';
import { askModel, AskOptions } from './ask-model';
import { createBeatSheetTool } from './output-tools/beat-sheet-output-tools';
import { NOT_APPLICABLE } from './prompt-templates';
import { isSameFingerprint } from './source-fingerprint';
import { MaterialProgress, MaterialSourceType, loadSource, prepareMaterial, readMaterialProgress } from './source-material';
import { StageContext, StageWorkflow } from './stage-workflow';

/** 节拍表阶段保存到阶段记录的输入快照。 */
export interface BeatSheetRunInput {
  readonly formatType: ProductionFormatType;
  readonly sourceType: WorkSourceType;
  readonly params: BeatSheetParams;
}

/** 节拍表工作流的依赖。 */
export interface BeatSheetWorkflowDependencies {
  readonly beatSheets: BeatSheetRepository;
  readonly sources: CreativeSourceReader;
  readonly prompts: PromptTemplates;
  /** 读取当前的小说分段设置。 */
  readonly getSplitSettings: () => NovelSplitSettings;
  readonly now?: () => Date;
}

/** 各提示词模板使用的变量，模板文件必须与之完全一致（测试校验）；素材整理使用的模板见创意阶段。 */
export const BEAT_SHEET_PROMPT_VARIABLES: Readonly<Record<string, readonly string[]>> = {
  'beat-sheet-assign': ['material', 'beatStructure', 'extra', 'sourcesRule', 'sourcesExample']
};

/** 当前支持的体量类型，用于校验参数。 */
const FORMAT_TYPES: readonly ProductionFormatType[] = listSupportedFormats().map((profile) => profile.formatType);
/** 作品素材来源的全部取值，用于校验参数。 */
const SOURCE_TYPES: readonly WorkSourceType[] = ['text', 'image', 'novel', 'original'];

/** 作品素材来源转为素材整理的来源：原创文稿的原稿与小说一样分段处理。 */
function toMaterialSource(sourceType: WorkSourceType): MaterialSourceType {
  return sourceType === 'original' ? 'novel' : sourceType;
}

/** 把节拍模板与参考预算整理为提示词里的“节拍结构”。 */
function describeBeatStructure(template: BeatTemplate, params: BeatSheetParams): string {
  const budgets = allocateBeatBudget(params.targetDurationSeconds, params.wordsPerSecond, template.items);
  const profile = getProductionProfile(params.formatType);
  const unit = profile.durationScopeLabel;
  const lines = [
    `节拍模板：${template.label}。${unit}目标时长约 ${params.targetDurationSeconds} 秒，按 ${params.wordsPerSecond} 字/秒换算约 ${Math.round(params.targetDurationSeconds * params.wordsPerSecond)} 字。`
  ];
  if (profile.multiEpisode) {
    lines.push(
      `这是连载短剧，参考集数约 ${params.episodeCount} 集；节拍说明的是每一集的组织方式。请以故事的第一集为对象，把素材开头的剧情分配到各节拍（第一集没有上一集可承接，凡是承接上一集的节拍改作开场钩子，其余节拍照常），具体分集由后续的剧本阶段决定。`
    );
  }
  template.items.forEach((item, index) => {
    const budget = budgets[index];
    lines.push(`${item.seq}. ${item.label}（参考约 ${budget.estimatedSeconds} 秒 / ${budget.estimatedWords} 字，占 ${Math.round(item.targetRatio * 100)}%）：${item.purpose}`);
  });
  return lines.join('\n');
}

/** 节拍表阶段工作流。 */
export class BeatSheetWorkflow implements StageWorkflow {
  readonly stage = 'beat_sheet' as const;

  constructor(private readonly dependencies: BeatSheetWorkflowDependencies) {}

  normalizeInput(rawInput: unknown): Readonly<Record<string, unknown>> {
    const source = readRecord(rawInput);
    const errors: FieldErrors = {};
    const formatType = readOptionalChoice(source, 'formatType', '作品形态', FORMAT_TYPES, errors);
    if (formatType === null && errors.formatType === undefined) {
      errors.formatType = '作品形态不能为空。';
    }
    const sourceType = readOptionalChoice(source, 'sourceType', '素材来源', SOURCE_TYPES, errors);
    if (sourceType === null && errors.sourceType === undefined) {
      errors.sourceType = '素材来源不能为空。';
    }
    assertNoFieldErrors(errors);

    const params = normalizeBeatSheetParams(typeof source.params === 'object' && source.params !== null ? source.params : source, formatType as ProductionFormatType);
    return { formatType, sourceType, params };
  }

  async execute(context: StageContext): Promise<void> {
    const { run } = context;
    const { beatSheets, sources, prompts, getSplitSettings } = this.dependencies;
    // 输入快照由 normalizeInput 生成，结构可信。
    const input = run.input as unknown as BeatSheetRunInput;
    const { params } = input;
    if (beatSheets.find(run.id) !== undefined) {
      return;
    }

    const template = getBeatTemplate(params.beatTemplateId);
    const sourceType = toMaterialSource(input.sourceType);
    const source = loadSource(sources, getSplitSettings, run.workId, sourceType);
    const state: MaterialProgress = readMaterialProgress(run.progress?.detail);
    // 素材或分段设置与上次不一致时，已整理的要点不再适用。
    if (sourceType !== 'text' && !isSameFingerprint(state.source, source.fingerprint)) {
      state.summaries = [];
      state.digest = null;
    }
    state.source = source.fingerprint;

    const materialSteps = sourceType === 'novel' ? source.segments.length : sourceType === 'image' ? 1 : 0;
    const report = (step: string): void => {
      const materialDone = sourceType === 'novel' ? state.summaries.length : sourceType === 'image' && state.digest !== null ? 1 : 0;
      context.reportProgress({ step, total: materialSteps + 1, done: materialDone, detail: { ...state } });
    };
    const ask = <T>(name: string, variables: Record<string, string>, parse: (json: unknown) => T, options: AskOptions): Promise<T> =>
      askModel(context, prompts, name, variables, parse, options);

    const material = await prepareMaterial({
      sourceType,
      idea: params.idea,
      segments: source.segments,
      images: source.images,
      state,
      report,
      ask
    });

    report('分配节拍内容');
    const novel = sourceType === 'novel';
    const assignments = await ask(
      'beat-sheet-assign',
      {
        material,
        beatStructure: describeBeatStructure(template, params),
        extra: params.extra ?? NOT_APPLICABLE,
        sourcesRule: novel ? `每个节拍必须用 sourceRefs 列出依据的原文分段序号（1 到 ${source.segments.length}，可多个，没有依据时给空数组），序号取自上面各段前的编号。` : '',
        sourcesExample: novel ? ', "sourceRefs": [1, 2]' : ''
      },
      (json) => parseBeatSheet(json, template.items.length, novel ? source.segments.length : 0),
      {
        overflowHint: '请在设置中增大“每段字数上限”以减少分段数，或缩短素材后重试。',
        tool: createBeatSheetTool(novel, template.items.length)
      }
    );

    const timestamp = (this.dependencies.now?.() ?? new Date()).toISOString();
    beatSheets.save(run.id, params, composeBeats(template, params, assignments), timestamp);
    context.reportProgress({ step: '已完成', total: materialSteps + 1, done: materialSteps + 1, detail: { ...state } });
  }
}
