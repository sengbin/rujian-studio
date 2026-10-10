// ------------------------------------------------------------------------
// 名称：minimax-text-provider.ts
// 说明：MiniMax 文本适配器：通过 OpenAI 兼容的对话接口生成文本，强制模型调用输出工具提交结构化结果，支持随请求发送图片（M3.1、M3）。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：使用流式输出降低长内容生成超时的风险；接口文档没有 JSON Schema 模式，所以像千问带图片的请求一样用工具调用返回结果，并在系统段要求调用该工具；reasoning_split 让思考内容走单独字段，不混进正文；按模型能力尽量压低思考（M3 关闭，M3.1 调到最低，M2.x 无法控制）；输出被截断（finish_reason 为 length）时直接报错，不使用不完整的结果。
// ------------------------------------------------------------------------

import { ProviderError } from '../../../domain/errors';
import { TextCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor, ProviderDescriptor } from '../../../domain/models/model-provider';
import { ProviderCallContext, TextModelProvider } from '../../../domain/ports/provider-adapters';
import { TextGenerationRequest } from '../../../domain/ports/text-generation-port';
import { buildUserContent, collectToolCallArguments } from '../shared/chat-tool-call';
import { findDescribedModelByCode } from '../shared/provider-model-lookup';
import { FetchFunction, MinimaxApiClient, classifyMinimaxErrorCode } from './minimax-api-client';
import { MINIMAX_PROVIDER, MINIMAX_PROVIDER_NAME } from './minimax-catalog';
import { MINIMAX_CHAT_PATH, MINIMAX_TEXT_MODELS, MinimaxTextModel } from './minimax-text-catalog';

/** MiniMax 的文本适配器。 */
export class MinimaxTextProvider implements TextModelProvider {
  readonly kind = 'text';
  readonly provider: ProviderDescriptor = MINIMAX_PROVIDER;
  private readonly client: MinimaxApiClient;

  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   */
  constructor(fetchFunction?: FetchFunction) {
    this.client = new MinimaxApiClient(fetchFunction);
  }

  listModels(): readonly ModelDescriptor<'text'>[] {
    return MINIMAX_TEXT_MODELS.map((model) => model.descriptor);
  }

  getCapability(modelCode: string): TextCapability | undefined {
    return findDescribedModelByCode(MINIMAX_TEXT_MODELS, modelCode)?.descriptor.capability;
  }

  async generate(modelCode: string, request: TextGenerationRequest, context: ProviderCallContext): Promise<unknown> {
    const model = findDescribedModelByCode(MINIMAX_TEXT_MODELS, modelCode);
    if (model === undefined) {
      throw new ProviderError('invalid_request', `${MINIMAX_PROVIDER_NAME}没有文本模型 ${modelCode}。`);
    }
    if ((request.images ?? []).length > 0 && !model.descriptor.capability.imageInput) {
      throw new ProviderError('invalid_request', `模型 ${modelCode} 不支持图片输入，请换用支持图片的文本模型。`);
    }

    const events = this.client.postEventStream(context, MINIMAX_CHAT_PATH, buildBody(model, request));
    return collectToolCallArguments(events, request.tool.name, { providerName: MINIMAX_PROVIDER_NAME, classifyErrorCode: classifyMinimaxErrorCode });
  }
}

/** 构造对话请求体：系统段与用户段分开发送，提供输出工具，思考内容单独返回，并按模型压低思考。 */
function buildBody(model: MinimaxTextModel, request: TextGenerationRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: model.descriptor.code,
    messages: [
      { role: 'system', content: `${request.system}\n\n请调用工具 ${request.tool.name} 提交结果，不要把结果写在回复正文里。` },
      { role: 'user', content: buildUserContent(request) }
    ],
    stream: true,
    max_tokens: model.descriptor.capability.maxOutputTokens,
    reasoning_split: true,
    tools: [{ type: 'function', function: { name: request.tool.name, description: request.tool.description, parameters: request.tool.inputSchema } }]
  };
  if (model.thinking === 'disabled') body.thinking = { type: 'disabled' };
  if (model.thinking === 'low-effort') body.reasoning_effort = 'low';
  return body;
}
