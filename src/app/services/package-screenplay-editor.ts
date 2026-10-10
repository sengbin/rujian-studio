// ------------------------------------------------------------------------
// 名称：package-screenplay-editor.ts
// 说明：剧本编辑策略之一：集和实体还没有合并到作品时，修改剧本包上的抽取结果（定位值 ref 为在抽取结果中的位置）。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：每次整体重写抽取结果；删除、互换后集序号按位置重排；同类型实体不能重名；确认采用时才把抽取结果合并到作品。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, NotFoundError, ValidationError } from '../../domain/errors';
import { EntityEdit, EntityKind, EpisodeEdit } from '../../domain/models/screenplay';
import { StageRun } from '../../domain/models/stage-run';
import { ScreenplayRepository } from '../../domain/ports/screenplay-repository';
import { MAX_ENTITIES, MAX_EPISODES_LIMIT, normalizeEntityEdit } from '../../domain/rules/screenplay-rules';
import { DUPLICATE_ENTITY_NAME_TEXT, ScreenplayEditor, assertBelowLimit, assertKeepsOneEpisode, describeMoveBoundary, requireStructure, resolveSegments } from './screenplay-editing';

/** 剧本包上抽取结果编辑的依赖。 */
export interface PackageScreenplayEditorDependencies {
  readonly screenplays: ScreenplayRepository;
  /** 当前时间的 ISO 字符串。 */
  readonly timestamp: () => string;
}

/** 剧本包上尚未合并的抽取结果的编辑。 */
export class PackageScreenplayEditor implements ScreenplayEditor {
  constructor(private readonly dependencies: PackageScreenplayEditorDependencies) {}

  saveEpisode(run: StageRun, ref: number, edit: EpisodeEdit, rawInput: unknown): void {
    const { screenplays, timestamp } = this.dependencies;
    const structure = requireStructure(screenplays, run.id);
    const target = structure.episodes[ref];
    if (target === undefined) {
      throw new NotFoundError('集不存在。');
    }
    const segments = resolveSegments(target, edit.screenplayText, rawInput);
    // segments 为空时写入 JSON 会自动省略该字段。
    const episodes = structure.episodes.map((episode, index) => (index === ref ? { ...episode, ...edit, segments } : episode));
    screenplays.saveStructure(run.id, { ...structure, episodes }, timestamp());
  }

  saveEntity(run: StageRun, ref: number, rawInput: unknown): void {
    const { screenplays, timestamp } = this.dependencies;
    const structure = requireStructure(screenplays, run.id);
    const target = structure.entities[ref];
    if (target === undefined) {
      throw new NotFoundError('实体不存在。');
    }
    const edit = normalizeEntityEdit(rawInput, target.kind);
    if (structure.entities.some((entity, index) => index !== ref && entity.kind === target.kind && entity.name === edit.name)) {
      throw new ValidationError({ name: DUPLICATE_ENTITY_NAME_TEXT });
    }
    const entities = structure.entities.map((entity, index) => (index === ref ? { ...entity, ...edit } : entity));
    screenplays.saveStructure(run.id, { ...structure, entities }, timestamp());
  }

  addEpisode(run: StageRun, edit: EpisodeEdit): number {
    const { screenplays, timestamp } = this.dependencies;
    const structure = requireStructure(screenplays, run.id);
    assertBelowLimit(structure.episodes.length, MAX_EPISODES_LIMIT, '集');
    const ref = structure.episodes.length;
    const episodes = [...structure.episodes, { seq: ref + 1, ...edit }];
    screenplays.saveStructure(run.id, { ...structure, episodes }, timestamp());
    return ref;
  }

  deleteEpisode(run: StageRun, ref: number): void {
    const { screenplays, timestamp } = this.dependencies;
    const structure = requireStructure(screenplays, run.id);
    if (structure.episodes[ref] === undefined) {
      throw new NotFoundError('集不存在。');
    }
    assertKeepsOneEpisode(structure.episodes.length);
    const episodes = structure.episodes.filter((_, index) => index !== ref).map((episode, index) => ({ ...episode, seq: index + 1 }));
    screenplays.saveStructure(run.id, { ...structure, episodes }, timestamp());
  }

  /**
   * 互换抽取结果中的位置，返回被移动的集的新位置。
   * @param run 剧本阶段记录。
   * @param ref 要移动的集的定位值。
   * @param step 移动方向，1 向后、-1 向前。
   */
  moveEpisode(run: StageRun, ref: number, step: number): number {
    const { screenplays, timestamp } = this.dependencies;
    const structure = requireStructure(screenplays, run.id);
    if (structure.episodes[ref] === undefined) {
      throw new NotFoundError('集不存在。');
    }
    if (structure.episodes[ref + step] === undefined) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: describeMoveBoundary(step) });
    }
    const reordered = [...structure.episodes];
    [reordered[ref], reordered[ref + step]] = [reordered[ref + step], reordered[ref]];
    screenplays.saveStructure(run.id, { ...structure, episodes: reordered.map((episode, index) => ({ ...episode, seq: index + 1 })) }, timestamp());
    return ref + step;
  }

  addEntity(run: StageRun, kind: EntityKind, edit: EntityEdit): number {
    const { screenplays, timestamp } = this.dependencies;
    const structure = requireStructure(screenplays, run.id);
    assertBelowLimit(structure.entities.length, MAX_ENTITIES, '实体');
    if (structure.entities.some((entity) => entity.kind === kind && entity.name === edit.name)) {
      throw new ValidationError({ name: DUPLICATE_ENTITY_NAME_TEXT });
    }
    const entities = [...structure.entities, { kind, ...edit }];
    screenplays.saveStructure(run.id, { ...structure, entities }, timestamp());
    return structure.entities.length;
  }

  deleteEntity(run: StageRun, ref: number): void {
    const { screenplays, timestamp } = this.dependencies;
    const structure = requireStructure(screenplays, run.id);
    if (structure.entities[ref] === undefined) {
      throw new NotFoundError('实体不存在。');
    }
    const entities = structure.entities.filter((_, index) => index !== ref);
    screenplays.saveStructure(run.id, { ...structure, entities }, timestamp());
  }
}
