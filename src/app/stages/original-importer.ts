// ------------------------------------------------------------------------
// 名称：original-importer.ts
// 说明：原创文稿的导入：把作品保存的原稿按分段设置切成章节，作为已确认的创意阶段产出，不调用模型、不改写文字，之后可以直接生成剧本。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：不经过阶段执行器，同步完成；章节正文就是原稿片段，章节标题取原稿中的章节标题，没有则按序号命名；导入记录的输入快照只含素材来源，没有生成参数。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, ValidationError } from '../../domain/errors';
import { StageRun } from '../../domain/models/stage-run';
import { ChapterRepository } from '../../domain/ports/chapter-repository';
import { CreativeSourceReader } from '../../domain/ports/creative-source-reader';
import { StageRunRepository } from '../../domain/ports/stage-run-repository';
import { MAX_CHAPTERS_LIMIT } from '../../domain/rules/creative-rules';
import { NovelSplitSettings, splitNovel } from '../../domain/rules/novel-splitter';
import { createApprovalPatch } from '../../domain/rules/stage-review-rules';

/** 原创文稿导入的依赖。 */
export interface OriginalImporterDependencies {
  readonly runs: StageRunRepository;
  readonly chapters: ChapterRepository;
  readonly sources: CreativeSourceReader;
  /** 读取当前的分段设置。 */
  readonly getSplitSettings: () => NovelSplitSettings;
  readonly now?: () => Date;
}

/** 导入记录的输入快照：创意阶段以素材来源区分原创文稿，没有生成参数。 */
const IMPORT_INPUT = { sourceType: 'original' } as const;

/** 原创文稿导入器。 */
export class OriginalImporter {
  constructor(private readonly dependencies: OriginalImporterDependencies) {}

  /**
   * 导入作品的原稿：新建一个创意版本，写入逐段原文的章节，并直接确认采用。
   * @param workId 作品标识。
   * @returns 已确认的创意阶段记录。
   * @throws ValidationError 没有找到原稿，或分段数超过章节数上限。
   */
  importOriginal(workId: number): StageRun {
    const { runs, chapters, sources, getSplitSettings } = this.dependencies;
    const text = sources.readNovelText(workId);
    if (text === undefined || text.trim().length === 0) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '没有找到原稿，请先添加原稿文件或文字。' });
    }
    const segments = splitNovel(text, getSplitSettings());
    if (segments.length > MAX_CHAPTERS_LIMIT) {
      throw new ValidationError({
        [FORM_LEVEL_ERROR_KEY]: `原稿被分成 ${segments.length} 段，超过上限 ${MAX_CHAPTERS_LIMIT} 段。请在“模型”设置中调大每段字数上限，或拆分原稿后分别创建作品。`
      });
    }

    const timestamp = (this.dependencies.now?.() ?? new Date()).toISOString();
    const created = runs.create(
      { workId, stage: 'creative', episodeId: null, input: IMPORT_INPUT, sourceRunId: null, sourceRevision: null, modelInfo: null },
      timestamp
    );
    for (const segment of segments) {
      chapters.save(created.id, { seq: segment.index, title: segment.title ?? `第 ${segment.index} 段`, content: segment.text }, timestamp);
    }
    const succeeded = runs.markSucceeded(created.id, timestamp);
    if (succeeded === undefined) {
      throw new Error(`阶段记录 ${created.id} 标记成功后读取失败。`);
    }
    return runs.approve(created.id, createApprovalPatch(succeeded, timestamp)) ?? succeeded;
  }
}
