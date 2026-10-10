// ------------------------------------------------------------------------
// 名称：screenplay-editing.ts
// 说明：剧本编辑策略的契约（ScreenplayEditor：编辑一集、编辑实体、新增、删除、调整集的顺序）与两种策略共用的检查：定位值读取、数量上限、至少保留一集、结构标注的取舍、读取抽取结果。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：入参已由 ScreenplayService 读取并校验；策略只负责写入各自的存储：合并之前写剧本包上的抽取结果（package-screenplay-editor.ts），合并之后写作品的集和实体（merged-screenplay-editor.ts）。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, NotFoundError, ValidationError } from '../../domain/errors';
import { EntityEdit, EntityKind, EpisodeDraft, EpisodeEdit, ScreenplayStructure, TextSegment } from '../../domain/models/screenplay';
import { StageRun } from '../../domain/models/stage-run';
import { ScreenplayRepository } from '../../domain/ports/screenplay-repository';
import { readRecord } from '../../domain/rules/field-readers';
import { applySegmentLabelEdits } from '../../domain/rules/segment-rules';

/** 同类型下实体重名时给用户的提示。 */
export const DUPLICATE_ENTITY_NAME_TEXT = '同类型下已有同名实体，请换一个名称。';

/** 剧本编辑策略：对已通过校验的请求，写入对应存储。所有方法都在“只能编辑最新且生成成功的版本”的检查之内调用。 */
export interface ScreenplayEditor {
  /**
   * 保存一集。
   * @param ref 集的定位值。
   * @param rawInput 原始请求，用于读取结构标注的修改。
   * @throws NotFoundError 集不存在。
   */
  saveEpisode(run: StageRun, ref: number, edit: EpisodeEdit, rawInput: unknown): void;
  /**
   * 保存一个实体；实体类型取已有实体的类型。
   * @throws NotFoundError 实体不存在。
   * @throws ValidationError 内容不合法或同类型名称重复。
   */
  saveEntity(run: StageRun, ref: number, rawInput: unknown): void;
  /**
   * 在末尾新增一集。
   * @returns 新集的定位值。
   * @throws ValidationError 集数已达上限。
   */
  addEpisode(run: StageRun, edit: EpisodeEdit): number;
  /**
   * 删除一集。
   * @throws NotFoundError 集不存在。
   * @throws ValidationError 只剩最后一集，或（已合并时）这一集正在生成分镜脚本。
   */
  deleteEpisode(run: StageRun, ref: number): void;
  /**
   * 把一集与前一集（step 为 -1）或后一集（step 为 1）互换位置。
   * @returns 被移动的集的新定位值。
   * @throws NotFoundError 集不存在。
   * @throws ValidationError 已经在最前或最后。
   */
  moveEpisode(run: StageRun, ref: number, step: number): number;
  /**
   * 新增一个实体。
   * @returns 新实体的定位值。
   * @throws ValidationError 实体数已达上限，或同类型名称重复。
   */
  addEntity(run: StageRun, kind: EntityKind, edit: EntityEdit): number;
  /**
   * 删除一个实体。
   * @throws NotFoundError 实体不存在。
   * @throws ValidationError （已合并时）实体仍被引用。
   */
  deleteEntity(run: StageRun, ref: number): void;
}

/** 读取请求中的定位值：非负整数。 */
export function readRef(rawInput: unknown): number {
  const ref = readRecord(rawInput).ref;
  if (typeof ref !== 'number' || !Number.isInteger(ref) || ref < 0) {
    throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '定位信息无效。' });
  }
  return ref;
}

/** 数量已达上限时不能再新增。 */
export function assertBelowLimit(count: number, limit: number, label: string): void {
  if (count >= limit) {
    throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: `${label}数量已达上限 ${limit}，不能再新增。` });
  }
}

/** 至少保留 1 集，不能删到只剩零集。 */
export function assertKeepsOneEpisode(count: number): void {
  if (count <= 1) {
    throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '至少保留 1 集，不能删除。' });
  }
}

/** 集已经在最前或最后、不能再移动时的提示。 */
export function describeMoveBoundary(step: number): string {
  return step < 0 ? '已经是第一集，不能再前移。' : '已经是最后一集，不能再后移。';
}

/**
 * 编辑保存一集后的结构标注：原来没有标注则仍然没有；正文被修改则标注失效、返回 undefined；否则合并提交的标注修改（没有提交则保持原样）。
 */
export function resolveSegments(current: EpisodeDraft, editedText: string, rawInput: unknown): readonly TextSegment[] | undefined {
  if (current.segments === undefined || editedText !== current.screenplayText) {
    return undefined;
  }
  return applySegmentLabelEdits(rawInput, current.segments) ?? current.segments;
}

/**
 * 读取剧本包上尚未合并的抽取结果。
 * @throws NotFoundError 还没有抽取集和实体。
 */
export function requireStructure(screenplays: Pick<ScreenplayRepository, 'find'>, runId: number): ScreenplayStructure {
  const structure = screenplays.find(runId)?.structure;
  if (structure === null || structure === undefined) {
    throw new NotFoundError('还没有抽取集和实体。');
  }
  return structure;
}
