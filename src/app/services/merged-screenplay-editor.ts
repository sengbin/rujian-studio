// ------------------------------------------------------------------------
// 名称：merged-screenplay-editor.ts
// 说明：剧本编辑策略之一：集和实体已合并到作品之后，直接修改作品的集和实体（定位值 ref 为数据库标识）。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：互换集的位置时分镜脚本、绑定等下游数据跟着集走；删除集连同它的分镜脚本一起删除，正在生成分镜脚本的集不能删；被镜头、镜头声音或资产绑定引用的实体不能删除，应改为停用；同类型实体重名由仓库报冲突。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, NotFoundError, ValidationError } from '../../domain/errors';
import { EntityEdit, EntityKind, EpisodeEdit, EpisodeRecord } from '../../domain/models/screenplay';
import { StageRun } from '../../domain/models/stage-run';
import { ScreenplayRepository } from '../../domain/ports/screenplay-repository';
import { StageRunRepository } from '../../domain/ports/stage-run-repository';
import { MAX_ENTITIES, MAX_EPISODES_LIMIT, normalizeEntityEdit } from '../../domain/rules/screenplay-rules';
import { ScreenplayEditor, assertBelowLimit, assertKeepsOneEpisode, describeMoveBoundary, resolveSegments } from './screenplay-editing';

/** 作品的集和实体编辑的依赖。 */
export interface MergedScreenplayEditorDependencies {
  readonly screenplays: ScreenplayRepository;
  readonly runs: Pick<StageRunRepository, 'findRunning'>;
  /** 当前时间的 ISO 字符串。 */
  readonly timestamp: () => string;
}

/** 已合并到作品的集和实体的编辑。 */
export class MergedScreenplayEditor implements ScreenplayEditor {
  constructor(private readonly dependencies: MergedScreenplayEditorDependencies) {}

  saveEpisode(run: StageRun, ref: number, edit: EpisodeEdit, rawInput: unknown): void {
    const { screenplays, timestamp } = this.dependencies;
    const current = screenplays.listEpisodes(run.workId).find((episode) => episode.id === ref);
    if (current === undefined) {
      throw new NotFoundError('集不存在。');
    }
    const segments = resolveSegments(current, edit.screenplayText, rawInput);
    screenplays.updateEpisode(run.workId, ref, edit, timestamp());
    if (segments !== current.segments) {
      screenplays.updateEpisodeSegments(run.workId, ref, segments ?? null, timestamp());
    }
  }

  saveEntity(run: StageRun, ref: number, rawInput: unknown): void {
    const { screenplays, timestamp } = this.dependencies;
    const current = screenplays.listEntities(run.workId).find((entity) => entity.id === ref);
    if (current === undefined) {
      throw new NotFoundError('实体不存在。');
    }
    screenplays.updateEntity(run.workId, ref, normalizeEntityEdit(rawInput, current.kind), timestamp());
  }

  addEpisode(run: StageRun, edit: EpisodeEdit): number {
    const { screenplays, timestamp } = this.dependencies;
    assertBelowLimit(screenplays.listEpisodes(run.workId).length, MAX_EPISODES_LIMIT, '集');
    return screenplays.insertEpisode(run.workId, edit, timestamp());
  }

  deleteEpisode(run: StageRun, ref: number): void {
    const { screenplays, runs } = this.dependencies;
    const episodes = screenplays.listEpisodes(run.workId);
    if (!episodes.some((episode) => episode.id === ref)) {
      throw new NotFoundError('集不存在。');
    }
    assertKeepsOneEpisode(episodes.length);
    if (runs.findRunning({ workId: run.workId, stage: 'storyboard_script', episodeId: ref }) !== undefined) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '这一集正在生成分镜脚本，请等待完成或先取消。' });
    }
    screenplays.deleteEpisode(run.workId, ref);
  }

  /** 只互换序号，集的标识不变，所以返回原定位值。 */
  moveEpisode(run: StageRun, ref: number, step: number): number {
    const { screenplays, timestamp } = this.dependencies;
    const episodes = screenplays.listEpisodes(run.workId);
    const index = episodes.findIndex((episode) => episode.id === ref);
    if (index < 0) {
      throw new NotFoundError('集不存在。');
    }
    const other = episodes[index + step] as EpisodeRecord | undefined;
    if (other === undefined) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: describeMoveBoundary(step) });
    }
    screenplays.swapEpisodes(run.workId, ref, other.id, timestamp());
    return ref;
  }

  addEntity(run: StageRun, kind: EntityKind, edit: EntityEdit): number {
    const { screenplays, timestamp } = this.dependencies;
    assertBelowLimit(screenplays.listEntities(run.workId).length, MAX_ENTITIES, '实体');
    return screenplays.insertEntity(run.workId, kind, edit, timestamp());
  }

  deleteEntity(run: StageRun, ref: number): void {
    const { screenplays } = this.dependencies;
    const entity = screenplays.listEntities(run.workId).find((candidate) => candidate.id === ref);
    if (entity === undefined) {
      throw new NotFoundError('实体不存在。');
    }
    const references = screenplays.countEntityReferences(ref);
    if (references > 0) {
      throw new ValidationError({
        [FORM_LEVEL_ERROR_KEY]: `实体“${entity.name}”已被 ${references} 处引用（镜头、声音或资产绑定），不能删除；如不再使用，可改为停用。`
      });
    }
    screenplays.deleteEntity(run.workId, ref);
  }
}
