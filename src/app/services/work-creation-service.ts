// ------------------------------------------------------------------------
// 名称：work-creation-service.ts
// 说明：新建作品并开始生成的服务：创建作品并保存它的文本模型（同一个事务），再启动创意生成，或对原创文稿直接导入原稿章节；启动或导入失败时撤销刚创建的作品。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：创建作品与保存文本模型是同步写库，放进一个事务；启动创意生成要等待模型解析，不能放进事务，失败时用补偿删除作品，补偿失败只记录日志、仍抛出原始错误；能在写库前校验的（生成参数、新作品不可能有已确认节拍表）先校验。
// ------------------------------------------------------------------------

import { Work } from '../../domain/models/work';
import { UnitOfWork } from '../../domain/ports/unit-of-work';
import { assertBeatReferenceReady, normalizeCreativeParams } from '../../domain/rules/creative-rules';
import { NormalizedWorkCreation } from '../../domain/rules/work-rules';
import { runWithCompensation } from './compensation';
import { StageService } from './stage-service';
import { TextSettingsService } from './text-settings-service';
import { WorkService } from './work-service';

/** 新建作品服务的依赖。 */
export interface WorkCreationServiceDependencies {
  readonly works: Pick<WorkService, 'createWork' | 'deleteWork'>;
  readonly stages: Pick<StageService, 'startCreative' | 'importOriginal'>;
  readonly textModels: Pick<TextSettingsService, 'setWorkModel'>;
  readonly transaction: UnitOfWork;
}

/** 新建作品并开始生成的请求。 */
export interface WorkCreationRequest {
  readonly projectId: number;
  /** 已校验的作品内容与素材。 */
  readonly creation: NormalizedWorkCreation;
  /** 作品使用的文本模型键；null 表示沿用默认。 */
  readonly textModelKey: string | null;
  /** 创意生成参数；原创文稿没有生成，不传。 */
  readonly params?: unknown;
}

/** 撤销新作品失败时的日志说明。 */
const ROLLBACK_FAILED_MESSAGE = '启动生成失败后，撤销刚创建的作品失败，作品可能残留：';

/** 新建作品并开始生成的服务。 */
export class WorkCreationService {
  constructor(private readonly dependencies: WorkCreationServiceDependencies) {}

  /**
   * 创建作品并保存文本模型，然后启动创意生成；原创文稿则直接导入原稿章节。
   * 没能启动生成或导入时撤销刚创建的作品，用户修正后可以直接重新提交。
   * @param request 作品创建请求（作品内容、文本模型与来源素材）。
   * @returns 新作品。
   * @throws ValidationError 内容或参数不合法、文本模型不可选、参考节拍表（新作品没有已确认的节拍表）、原稿缺失或分段过多。
   * @throws ConflictError 项目内作品名称重复。
   * @throws TextGenerationError 没有可用的文本模型。
   */
  async createAndStart(request: WorkCreationRequest): Promise<Work> {
    const { works, stages, textModels, transaction } = this.dependencies;
    const imports = request.creation.input.sourceType === 'original';
    if (!imports) {
      // 新作品不可能有已确认的节拍表，参考节拍表模式在写库之前就能判定失败。
      assertBeatReferenceReady(normalizeCreativeParams(request.params).beatReferenceMode, undefined);
    }

    const work = transaction.runInTransaction(() => {
      const created = works.createWork(request.projectId, request.creation);
      textModels.setWorkModel(created.id, request.textModelKey);
      return created;
    });
    await runWithCompensation(
      async () => {
        if (imports) {
          stages.importOriginal(work.id);
        } else {
          await stages.startCreative(work.id, request.params);
        }
      },
      () => works.deleteWork(work.id),
      ROLLBACK_FAILED_MESSAGE
    );
    return work;
  }
}
