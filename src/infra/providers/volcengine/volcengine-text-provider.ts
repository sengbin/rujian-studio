// ------------------------------------------------------------------------
// 名称：volcengine-text-provider.ts
// 说明：火山引擎文本适配器：通过方舟对话（Chat）接口生成文本，用严格 JSON Schema 模式返回结构化结果，支持随请求发送图片。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：使用流式输出降低长内容生成超时的风险；关闭深度思考（thinking.type 为 disabled）；目录里的模型都在方舟“结构化输出”支持列表中，参数 Schema 按方舟要求改写（见 strict-json-schema）；不设置 max_tokens 时默认只有 4096，所以仍按模型能力传入；输出被截断（finish_reason 为 length）时直接报错，不使用不完整的结果。
// ------------------------------------------------------------------------

import { ProviderError } from '../../../domain/errors';
import { TextCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor, ProviderDescriptor } from '../../../domain/models/model-provider';
import { ProviderCallContext, TextModelProvider } from '../../../domain/ports/provider-adapters';
import { TextGenerationRequest } from '../../../domain/ports/text-generation-port';
import { JSON_OUTPUT_NOTE, buildJsonSchemaFormat, buildUserContent, collectJsonContent } from '../shared/chat-tool-call';
import { findModelByCode } from '../shared/provider-model-lookup';
import { omitNullProperties } from '../shared/strict-json-schema';
import { FetchFunction, VolcengineApiClient, classifyArkErrorCode } from './volcengine-api-client';
import { VOLCENGINE_PROVIDER, VOLCENGINE_PROVIDER_NAME } from './volcengine-catalog';
import { VOLCENGINE_CHAT_PATH, VOLCENGINE_TEXT_MODELS } from './volcengine-text-catalog';

/** 火山引擎的文本适配器。 */
export class VolcengineTextProvider implements TextModelProvider {
  readonly kind = 'text';
  readonly provider: ProviderDescriptor = VOLCENGINE_PROVIDER;
  private readonly client: VolcengineApiClient;

  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   */
  constructor(fetchFunction?: FetchFunction) {
    this.client = new VolcengineApiClient(fetchFunction);
  }

  listModels(): readonly ModelDescriptor<'text'>[] {
    return VOLCENGINE_TEXT_MODELS;
  }

  getCapability(modelCode: string): TextCapability | undefined {
    return findModelByCode(VOLCENGINE_TEXT_MODELS, modelCode)?.capability;
  }

  checkConnection(context: ProviderCallContext): Promise<void> {
    return this.client.checkTextConnection(context, VOLCENGINE_CHAT_PATH);
  }

  async generate(modelCode: string, request: TextGenerationRequest, context: ProviderCallContext): Promise<unknown> {
    const capability = this.getCapability(modelCode);
    if (capability === undefined) {
      throw new ProviderError('invalid_request', `${VOLCENGINE_PROVIDER_NAME}没有文本模型 ${modelCode}。`);
    }
    if ((request.images ?? []).length > 0 && !capability.imageInput) {
      throw new ProviderError('invalid_request', `模型 ${modelCode} 不支持图片输入，请换用支持图片的文本模型。`);
    }

    const events = this.client.postEventStream(context, VOLCENGINE_CHAT_PATH, buildBody(modelCode, request, capability));
    const output = await collectJsonContent(events, { providerName: VOLCENGINE_PROVIDER_NAME, classifyErrorCode: classifyArkErrorCode });
    return omitNullProperties(output);
  }
}

/** 构造对话请求体：系统段与用户段分开发送，严格遵循参数 Schema，关闭深度思考。 */
function buildBody(modelCode: string, request: TextGenerationRequest, capability: TextCapability): Record<string, unknown> {
  return {
    model: modelCode,
    messages: [
      { role: 'system', content: request.system + JSON_OUTPUT_NOTE },
      { role: 'user', content: buildUserContent(request) }
    ],
    stream: true,
    thinking: { type: 'disabled' },
    max_tokens: capability.maxOutputTokens,
    response_format: buildJsonSchemaFormat(request.tool)
  };
}
