// ------------------------------------------------------------------------
// 名称：stage-start-service.ts
// 说明：已有作品的阶段生成启动服务：把所选文本模型保存为作品的文本模型后启动创意、节拍表、剧本、分镜脚本的生成，启动失败时恢复作品原来的选择；分镜脚本启动成功后再保存作品的目标视频默认参数。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：保存模型与启动生成之间隔着异步的模型解析，无法放进数据库事务，启动失败时用补偿恢复；补偿失败只记录日志，仍抛出启动的原始错误；新建作品并启动创意生成见 work-creation-service.ts。
// ------------------------------------------------------------------------

import { StageRun } from '../../domain/models/stage-run';
import { ProfileChanges } from '../../domain/rules/generation-profile-rules';
import { BeatSheetService } from './beat-sheet-service';
import { runWithCompensation } from './compensation';
import { GenerationProfileService } from './generation-profile-service';
import { ScreenplayService } from './screenplay-service';
import { StageService } from './stage-service';
import { StoryboardService } from './storyboard-service';
import { TextSettingsService } from './text-settings-service';

/** 阶段生成启动服务的依赖。 */
export interface StageStartServiceDependencies {
  /** 读取并保存作品单独选择的文本模型。 */
  readonly textModels: Pick<TextSettingsService, 'getWorkState' | 'setWorkModel'>;
  readonly stages: Pick<StageService, 'startCreative'>;
  readonly beatSheets: Pick<BeatSheetService, 'start'>;
  readonly screenplays: Pick<ScreenplayService, 'start'>;
  readonly storyboards: Pick<StoryboardService, 'start'>;
  readonly profiles: Pick<GenerationProfileService, 'saveWorkDefaults'>;
}

/** 启动分镜脚本生成的请求。 */
export interface StoryboardStartRequest {
  readonly workId: number;
  /** 要生成的集标识。 */
  readonly episodeIds: readonly number[];
  /** 界面提交的原始生成参数。 */
  readonly params: unknown;
  /** 画幅；null 表示取项目默认画幅。 */
  readonly aspectRatio: string | null;
  /** 启动成功后保存为作品默认的目标视频参数；没有改动时为空对象。 */
  readonly defaultChanges: ProfileChanges;
}

/** 已有作品的阶段生成启动服务。 */
export class StageStartService {
  constructor(private readonly dependencies: StageStartServiceDependencies) {}

  /**
   * 保存文本模型后重新启动作品的创意生成。
   * @param modelKey 本次选择的文本模型键；null 表示沿用默认。
   * @param rawParams 界面提交的创意生成参数。
   * @throws ValidationError 文本模型不可选、参数不合法、参考节拍表但节拍表未确认，或作品正在生成。
   * @throws TextGenerationError 没有可用的文本模型。
   */
  startCreative(workId: number, modelKey: string | null, rawParams: unknown): Promise<StageRun> {
    return this.startWithTextModel(workId, modelKey, () => this.dependencies.stages.startCreative(workId, rawParams));
  }

  /**
   * 保存文本模型后启动节拍表生成。
   * @param modelKey 本次选择的文本模型键；null 表示沿用默认。
   * @param rawParams 界面提交的节拍表参数。
   */
  startBeatSheet(workId: number, modelKey: string | null, rawParams: unknown): Promise<StageRun> {
    return this.startWithTextModel(workId, modelKey, () => this.dependencies.beatSheets.start(workId, rawParams));
  }

  /**
   * 保存文本模型后启动剧本生成。
   * @param modelKey 本次选择的文本模型键；null 表示沿用默认。
   * @param rawParams 界面提交的剧本参数。
   */
  startScreenplay(workId: number, modelKey: string | null, rawParams: unknown): Promise<StageRun> {
    return this.startWithTextModel(workId, modelKey, () => this.dependencies.screenplays.start(workId, rawParams));
  }

  /**
   * 保存文本模型后启动所选各集的分镜脚本生成；启动成功后再保存目标视频的默认参数，启动失败时不改动作品默认。
   * @param modelKey 本次选择的文本模型键；null 表示沿用默认。
   */
  async startStoryboard(request: StoryboardStartRequest, modelKey: string | null): Promise<StageRun[]> {
    const { storyboards, profiles } = this.dependencies;
    const runs = await this.startWithTextModel(request.workId, modelKey, () =>
      storyboards.start(request.workId, request.episodeIds, request.params, request.aspectRatio)
    );
    if (Object.keys(request.defaultChanges).length > 0) {
      profiles.saveWorkDefaults(request.workId, request.defaultChanges);
    }
    return runs;
  }

  /** 把所选文本模型保存为作品的文本模型后执行启动；启动失败时恢复作品原来的选择。 */
  private async startWithTextModel<T>(workId: number, modelKey: string | null, start: () => Promise<T>): Promise<T> {
    const { textModels } = this.dependencies;
    const previousKey = (await textModels.getWorkState(workId)).selectedKey;
    textModels.setWorkModel(workId, modelKey);
    return runWithCompensation(start, () => textModels.setWorkModel(workId, previousKey), `启动生成失败后，恢复作品 ${workId} 原来的文本模型选择失败：`);
  }
}
