// ------------------------------------------------------------------------
// 名称：asset-creation-service.ts
// 说明：新建资产并继续的服务：创建资产，从实体新建时同时绑定为该实体的形象（同一个事务），再按所选方式出图（音频）或在后台生成提示词；后续步骤失败时删除刚创建的资产。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：创建与绑定是同步写库，放进一个事务，绑定失败不留下没人用的资产；出图提交要等待模型解析、提示词生成在后台进行，不能放进事务，失败时用补偿删除资产，补偿失败只记录日志、仍抛出原始错误，用户修改后重新提交不会因重名被拒绝。
// ------------------------------------------------------------------------

import { AssetKind, AssetRecord } from '../../domain/models/asset';
import { UnitOfWork } from '../../domain/ports/unit-of-work';
import { AssetPromptService } from './asset-prompt-service';
import { AssetService, CreateAssetOptions } from './asset-service';
import { BindingService } from './binding-service';
import { runWithCompensation } from './compensation';

/** 新建资产服务对出图（音频）的需求：提交生成（AssetGenerationService 实现）。 */
export interface AssetRunSubmitter {
  submit(rawInput: unknown): Promise<unknown>;
}

/** 新建资产服务的依赖。 */
export interface AssetCreationServiceDependencies {
  readonly assets: Pick<AssetService, 'createAsset' | 'deleteAsset'>;
  readonly bindings: Pick<BindingService, 'bind'>;
  readonly prompts: Pick<AssetPromptService, 'start'>;
  readonly generation: AssetRunSubmitter;
  readonly transaction: UnitOfWork;
}

/** 创建之后继续做什么：直接出图（音频）、后台生成提示词、生成提示词后再出图。 */
export type AssetFollowUp =
  | { readonly mode: 'direct'; readonly runRequest: Readonly<Record<string, unknown>> }
  | { readonly mode: 'prompt'; readonly textModelKey: string | null }
  | { readonly mode: 'promptAndRun'; readonly textModelKey: string | null; readonly runRequest: Readonly<Record<string, unknown>> };

/** 新建资产并继续的请求。 */
export interface AssetCreationRequest {
  readonly kind: AssetKind;
  /** 表单提交的原始内容。 */
  readonly rawInput: unknown;
  /** 所属分类与来源实体；从实体新建时带来源实体标识。 */
  readonly options: CreateAssetOptions;
  /** 从实体新建时的集与实体，创建后绑定为该实体的形象。 */
  readonly entity?: { readonly episodeId: number; readonly entityId: number };
  /** 创建之后继续做什么；只创建时不传。 */
  readonly followUp?: AssetFollowUp;
}

/** 删除资产失败时的日志说明。 */
const ROLLBACK_FAILED_MESSAGE = '新建资产后的步骤失败，删除刚创建的资产失败，资产可能残留：';

/** 新建资产并继续的服务。 */
export class AssetCreationService {
  constructor(private readonly dependencies: AssetCreationServiceDependencies) {}

  /**
   * 创建资产（从实体新建时同时绑定），再按所选方式继续；后续步骤没能完成时删除刚创建的资产。
   * @returns 新资产。
   * @throws ValidationError 内容不合法，或后续的出图、提示词生成不满足条件。
   * @throws ConflictError 同类型下名称重复，或实体已绑定过这个资产。
   * @throws NotFoundError 集、实体不存在。
   */
  async createAndContinue(request: AssetCreationRequest): Promise<AssetRecord> {
    const { assets, bindings, transaction } = this.dependencies;
    const { entity, followUp } = request;
    const asset = transaction.runInTransaction(() => {
      const created = assets.createAsset(request.kind, request.rawInput, request.options);
      if (entity !== undefined) {
        bindings.bind({ episodeId: entity.episodeId, entityId: entity.entityId, assetId: created.id, purpose: 'visual' });
      }
      return created;
    });
    if (followUp !== undefined) {
      await runWithCompensation(() => this.continueWith(asset.id, followUp), () => assets.deleteAsset(asset.id), ROLLBACK_FAILED_MESSAGE);
    }
    return asset;
  }

  /** 按所选方式继续：提交出图，或启动提示词生成（可在完成后自动出图）。 */
  private async continueWith(assetId: number, followUp: AssetFollowUp): Promise<void> {
    const { prompts, generation } = this.dependencies;
    if (followUp.mode === 'direct') {
      await generation.submit({ assetId, ...followUp.runRequest });
    } else if (followUp.mode === 'prompt') {
      prompts.start(assetId, followUp.textModelKey);
    } else {
      prompts.start(assetId, followUp.textModelKey, async () => {
        await generation.submit({ assetId, ...followUp.runRequest });
      });
    }
  }
}
