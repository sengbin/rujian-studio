// ------------------------------------------------------------------------
// 名称：source-material.ts
// 说明：阶段工作流共用的素材整理：读取小说分段或灵感图片并计算指纹，把文字灵感、图片描述、小说各段要点整理成提示词里的素材数据段，进度可中断后继续。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：创意阶段与节拍表阶段共用；整理结果（图片描述、各段要点）保存在调用方阶段记录的 progress.detail 中，素材指纹与上次一致才复用。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, ValidationError } from '../../domain/errors';
import { CreativeSourceReader } from '../../domain/ports/creative-source-reader';
import { ImageInput } from '../../domain/ports/text-generation-port';
import { parseSummary } from '../../domain/rules/creative-rules';
import { NovelSegment, NovelSplitSettings, splitNovel } from '../../domain/rules/novel-splitter';
import { AskOptions } from './ask-model';
import { SUBMIT_SUMMARY_TOOL } from './output-tools/creative-output-tools';
import { wrapMaterial } from './prompt-templates';
import { SourceFingerprint, fingerprintImages, fingerprintNovel, parseFingerprint } from './source-fingerprint';

/** 素材来源：文字灵感、灵感图片、小说原文（原创文稿按小说处理）。 */
export type MaterialSourceType = 'text' | 'image' | 'novel';

/** 没有提供灵感文字时，提示词里的说明。 */
export const NO_IDEA_TEXT = '（没有提供具体灵感，请依据题材、基调和补充要求创作。）';

/** 素材整理的进度，保存在阶段记录的 progress.detail 中。 */
export interface MaterialProgress {
  /** 生成这些进度时的素材指纹；恢复时与当前素材一致才复用。文字灵感没有外部素材，为 null。 */
  source: SourceFingerprint | null;
  /** 小说各段的要点。 */
  summaries: string[];
  /** 灵感图片的描述。 */
  digest: string | null;
}

/** 本次执行读取到的素材。 */
export interface LoadedSource {
  /** 小说各段；其他来源为空。 */
  readonly segments: readonly NovelSegment[];
  /** 灵感图片；其他来源为空。 */
  readonly images: readonly ImageInput[];
  /** 素材指纹；文字灵感为 null。 */
  readonly fingerprint: SourceFingerprint | null;
}

/** 整理素材需要的上下文。 */
export interface MaterialRequest {
  readonly sourceType: MaterialSourceType;
  /** 文字灵感；其他来源忽略。 */
  readonly idea: string | null;
  readonly segments: readonly NovelSegment[];
  readonly images: readonly ImageInput[];
  /** 整理进度，整理过程中直接写入。 */
  readonly state: MaterialProgress;
  /** 报告当前步骤，由调用方附带自己的进度数据后保存。 */
  report(step: string): void;
  ask<T>(template: string, variables: Record<string, string>, parse: (json: unknown) => T, options: AskOptions): Promise<T>;
}

/** 从进度数据中读取素材整理进度，缺失或格式不对时视为从头开始。 */
export function readMaterialProgress(detail: unknown): MaterialProgress {
  const source = typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>) : {};
  return {
    source: parseFingerprint(source.source),
    summaries: Array.isArray(source.summaries) ? source.summaries.filter((item): item is string => typeof item === 'string') : [],
    digest: typeof source.digest === 'string' ? source.digest : null
  };
}

/** 一段原文的标签，如“第 3 段 第三章 归途”。 */
export function segmentLabel(segment: NovelSegment): string {
  return segment.title === null ? `第 ${segment.index} 段` : `第 ${segment.index} 段 ${segment.title}`;
}

/**
 * 读取素材并计算指纹：小说切分为各段，图片读出内容，文字灵感没有外部素材。
 * @throws ValidationError 没有找到小说原文或灵感图片。
 */
export function loadSource(
  sources: CreativeSourceReader,
  getSplitSettings: () => NovelSplitSettings,
  workId: number,
  sourceType: MaterialSourceType
): LoadedSource {
  if (sourceType === 'novel') {
    const settings = getSplitSettings();
    const text = sources.readNovelText(workId);
    if (text === undefined || text.trim().length === 0) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '没有找到小说原文，请先上传原作文件。' });
    }
    const segments = splitNovel(text, settings);
    return { segments, images: [], fingerprint: fingerprintNovel(segments, settings) };
  }
  if (sourceType === 'image') {
    const images = sources.readImages(workId);
    if (images.length === 0) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '没有找到灵感图片，请先添加图片。' });
    }
    return { segments: [], images, fingerprint: fingerprintImages(images) };
  }
  return { segments: [], images: [], fingerprint: null };
}

/**
 * 整理素材为文字：文字灵感直接使用；图片先描述；小说逐段提取要点。已完成的步骤不重复。
 * @returns 用于后续提示词的素材文字，已包裹为数据段。
 */
export async function prepareMaterial(request: MaterialRequest): Promise<string> {
  const { sourceType, idea, state, segments, images, report, ask } = request;

  if (sourceType === 'text') {
    return wrapMaterial(idea ?? NO_IDEA_TEXT);
  }

  if (sourceType === 'image') {
    if (state.digest === null) {
      report('分析图片');
      state.digest = await ask('creative-digest-images', { imageCount: String(images.length) }, parseSummary, {
        images,
        overflowHint: '请减少图片数量后重试。',
        tool: SUBMIT_SUMMARY_TOOL
      });
      report('分析图片');
    }
    return wrapMaterial(state.digest);
  }

  while (state.summaries.length < segments.length) {
    const segment = segments[state.summaries.length];
    report(`阅读原文：${segmentLabel(segment)}`);
    const summary = await ask(
      'creative-summary',
      {
        segmentIndex: String(segment.index),
        segmentCount: String(segments.length),
        segmentTitle: segment.title ?? '无',
        segment: wrapMaterial(segment.text)
      },
      parseSummary,
      { overflowHint: '请在设置中调小“每段字数上限”后重试。', tool: SUBMIT_SUMMARY_TOOL }
    );
    state.summaries.push(summary);
  }
  return wrapMaterial(segments.map((segment, index) => `【${segmentLabel(segment)}】\n${state.summaries[index]}`).join('\n\n'));
}
