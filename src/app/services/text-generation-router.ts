// ------------------------------------------------------------------------
// 名称：text-generation-router.ts
// 说明：文本生成的路由实现：按本次生成指定的模型、作品的单独选择、全局默认的优先级决定使用哪个服务商的文本模型。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-03
// 备注：每次 resolveModel 重新按当时的设置选定模型，之后同一个端口的 countTokens 与 generate 沿用该选择，不同作品的生成互不影响；只取优先级最高的那个选择，它已不可用（被停用或服务商被停用）时直接报错，不换成别的模型（模型价格不同，悄悄换会带来意外费用）；只有从未设置过全局默认时才使用第一个可用的文本模型（设置页同样显示它）；服务商调用失败统一转换为 TextGenerationError。
// ------------------------------------------------------------------------

import { ProviderError, TextGenerationError } from '../../domain/errors';
import { UsableModel } from '../../domain/models/model-provider';
import { ResolvedTextCall } from '../../domain/ports/provider-adapters';
import {
  TextGenerationOptions,
  TextGenerationPort,
  TextGenerationRequest,
  TextGenerationSource,
  TextModelIdentity
} from '../../domain/ports/text-generation-port';
import { TextGenerationSettingsStore } from '../../domain/ports/text-generation-settings-store';
import { WorkTextModelRepository } from '../../domain/ports/work-text-model-repository';
import { estimateTokens } from '../../domain/rules/token-estimate';
import { providerModelKey } from '../../domain/rules/text-model-selection';

/** 没有任何可用的文本模型时的提示。 */
export const NO_TEXT_ENGINE_MESSAGE = '没有可用的文本模型：请到“模型设置”启用一个服务商（如千问AI平台、火山引擎）的文本模型。';

/** 本次指定的文本模型已不可用。 */
export const REQUESTED_MODEL_UNAVAILABLE_MESSAGE = '指定的文本模型已不可用，请重新选择。';

/** 作品单独选择的文本模型已不可用。 */
export const WORK_MODEL_UNAVAILABLE_MESSAGE = '作品选择的文本模型已不可用，请在“编辑作品”中重新选择，或改为“沿用默认”。';

/** 全局默认文本模型已不可用。 */
export const DEFAULT_MODEL_UNAVAILABLE_MESSAGE = '默认文本模型已不可用，请到“模型设置”重新选择。';

/** 路由依赖的服务商能力：列出可选的文本模型、取得调用文本模型所需的内容。 */
export interface TextProviderCalls {
  listSelectableTextModels(): UsableModel[];
  resolveTextCall(modelId: number): Promise<ResolvedTextCall>;
}

/** 路由的依赖。 */
export interface TextGenerationRouterDependencies {
  readonly settings: Pick<TextGenerationSettingsStore, 'read'>;
  readonly providers: TextProviderCalls;
  readonly workModels: Pick<WorkTextModelRepository, 'find'>;
}

/** 按设置选择服务商文本模型的文本生成来源。 */
export class TextGenerationRouter implements TextGenerationSource {
  constructor(private readonly dependencies: TextGenerationRouterDependencies) {}

  forWork(workId: number | null, modelKey: string | null = null): TextGenerationPort {
    return new RoutedTextPort(this.dependencies, workId, modelKey);
  }
}

/** 绑定到一个作品、可再指定本次模型的文本生成端口。 */
class RoutedTextPort implements TextGenerationPort {
  private active: ResolvedTextCall | undefined;

  constructor(
    private readonly dependencies: TextGenerationRouterDependencies,
    private readonly workId: number | null,
    private readonly requestedKey: string | null
  ) {}

  async resolveModel(): Promise<TextModelIdentity> {
    const model = this.selectModel();
    let call: ResolvedTextCall;
    try {
      call = await this.dependencies.providers.resolveTextCall(model.model.id);
    } catch (error) {
      throw mapProviderError(error);
    }
    const capability = call.adapter.getCapability(call.modelCode);
    if (capability === undefined) {
      throw new TextGenerationError('unavailable', `文本模型 ${call.modelCode} 已不存在，请在“模型设置”中重新选择。`);
    }
    this.active = call;
    return {
      id: `${call.adapter.provider.code}/${call.modelCode}`,
      maxInputTokens: capability.contextTokens - capability.maxOutputTokens
    };
  }

  async countTokens(text: string): Promise<number> {
    await this.currentCall();
    return estimateTokens(text);
  }

  async generate(request: TextGenerationRequest, options?: TextGenerationOptions): Promise<unknown> {
    const { adapter, modelCode, context } = await this.currentCall();
    try {
      return await adapter.generate(modelCode, request, { ...context, signal: options?.signal });
    } catch (error) {
      throw mapProviderError(error);
    }
  }

  /** 取当前选定的调用；还没有选择过时先按设置选择。 */
  private async currentCall(): Promise<ResolvedTextCall> {
    if (this.active === undefined) {
      await this.resolveModel();
    }
    return this.active as ResolvedTextCall;
  }

  /**
   * 按“本次指定的模型、作品的选择、全局默认”的优先级取模型，只看最高优先级的那个选择。
   * @throws TextGenerationError 该选择已不可用，或从未设置默认且没有任何可用的文本模型。
   */
  private selectModel(): UsableModel {
    const { settings, providers, workModels } = this.dependencies;
    const selectable = providers.listSelectableTextModels();
    const workKey = this.workId === null ? null : workModels.find(this.workId);
    const { defaultModel } = settings.read();

    const chosen = chooseKey(this.requestedKey, workKey, defaultModel);
    // 从未设置过默认：设置页显示并使用第一个可用的文本模型。
    const model =
      chosen === null
        ? selectable[0]
        : selectable.find((item) => providerModelKey(item.providerCode, item.model.code) === chosen.key);
    if (model === undefined) {
      throw new TextGenerationError('unavailable', chosen === null ? NO_TEXT_ENGINE_MESSAGE : chosen.message);
    }
    return model;
  }
}

/** 取优先级最高的选择及其不可用时的提示；全都没有（含默认为空串）时返回 null。 */
function chooseKey(requestedKey: string | null, workKey: string | null, defaultModel: string): { key: string; message: string } | null {
  if (requestedKey !== null) {
    return { key: requestedKey, message: REQUESTED_MODEL_UNAVAILABLE_MESSAGE };
  }
  if (workKey !== null) {
    return { key: workKey, message: WORK_MODEL_UNAVAILABLE_MESSAGE };
  }
  return defaultModel === '' ? null : { key: defaultModel, message: DEFAULT_MODEL_UNAVAILABLE_MESSAGE };
}

/** 把服务商调用的失败转换为文本生成错误：用户可读的原因直接沿用。 */
function mapProviderError(error: unknown): TextGenerationError {
  if (error instanceof TextGenerationError) {
    return error;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new TextGenerationError('canceled', '已取消。', { cause: error });
  }
  if (error instanceof ProviderError) {
    switch (error.category) {
      case 'auth':
        return new TextGenerationError('not_authorized', error.message, { cause: error });
      case 'rate_limited':
        return new TextGenerationError('rate_limited', error.message, { cause: error });
      case 'content_rejected':
        return new TextGenerationError('refused', error.message, { cause: error });
      case 'invalid_request':
        return new TextGenerationError('failed', error.message, { cause: error });
      default:
        return new TextGenerationError('unavailable', error.message, { cause: error });
    }
  }
  return new TextGenerationError('failed', `调用文本模型失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
}
