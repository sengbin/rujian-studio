// ------------------------------------------------------------------------
// 名称：qianwen-text-provider.ts
// 说明：千问AI平台文本适配器：通过 OpenAI 兼容的对话接口生成文本；没有图片时用严格 JSON Schema 模式返回结构化结果，带图片时强制模型调用输出工具。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：使用流式输出降低长内容生成超时的风险；多模态输入不支持 json_schema（会降级为 json_object），所以带图片的请求仍用工具调用，强制指定工具时必须关闭思考（enable_thinking 为 false）；JSON Schema 模式不设 max_tokens（文档要求，避免 JSON 被截断）；输出被截断（finish_reason 为 length）时直接报错，不使用不完整的结果。
// ------------------------------------------------------------------------

import { ProviderError } from '../../../domain/errors';
import { TextCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor, ProviderDescriptor } from '../../../domain/models/model-provider';
import { ProviderCallContext, TextModelProvider } from '../../../domain/ports/provider-adapters';
import { TextGenerationRequest } from '../../../domain/ports/text-generation-port';
import { JSON_OUTPUT_NOTE, buildJsonSchemaFormat, buildUserContent, collectJsonContent, collectToolCallArguments } from '../shared/chat-tool-call';
import { findModelByCode } from '../shared/provider-model-lookup';
import { omitNullProperties } from '../shared/strict-json-schema';
import { FetchFunction, QianwenApiClient, classifyErrorCode } from './qianwen-api-client';
import { QIANWEN_PROVIDER } from './qianwen-catalog';
import { QIANWEN_TEXT_MODELS, TEXT_CHAT_PATH } from './qianwen-text-catalog';

/** 千问AI平台的文本适配器。 */
export class QianwenTextProvider implements TextModelProvider {
  readonly kind = 'text';
  readonly provider: ProviderDescriptor = QIANWEN_PROVIDER;
  private readonly client: QianwenApiClient;

  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   */
  constructor(fetchFunction?: FetchFunction) {
    this.client = new QianwenApiClient(fetchFunction);
  }

  listModels(): readonly ModelDescriptor<'text'>[] {
    return QIANWEN_TEXT_MODELS;
  }

  getCapability(modelCode: string): TextCapability | undefined {
    return findModelByCode(QIANWEN_TEXT_MODELS, modelCode)?.capability;
  }

  checkConnection(context: ProviderCallContext): Promise<void> {
    return this.client.checkTextConnection(context, TEXT_CHAT_PATH);
  }

  async generate(modelCode: string, request: TextGenerationRequest, context: ProviderCallContext): Promise<unknown> {
    const capability = this.getCapability(modelCode);
    if (capability === undefined) {
      throw new ProviderError('invalid_request', `千问AI平台没有文本模型 ${modelCode}。`);
    }
    if ((request.images ?? []).length > 0 && !capability.imageInput) {
      throw new ProviderError('invalid_request', `模型 ${modelCode} 不支持图片输入，请换用支持图片的文本模型。`);
    }

    const options = { providerName: '千问AI平台', classifyErrorCode };
    if ((request.images ?? []).length > 0) {
      const events = this.client.postEventStream(context, TEXT_CHAT_PATH, buildToolBody(modelCode, request, capability));
      return collectToolCallArguments(events, request.tool.name, options);
    }
    const events = this.client.postEventStream(context, TEXT_CHAT_PATH, buildJsonSchemaBody(modelCode, request));
    return omitNullProperties(await collectJsonContent(events, options));
  }
}

/** 构造 JSON Schema 模式的请求体：严格遵循参数 Schema，关闭思考，不限制 max_tokens。 */
function buildJsonSchemaBody(modelCode: string, request: TextGenerationRequest): Record<string, unknown> {
  return {
    model: modelCode,
    messages: [
      { role: 'system', content: request.system + JSON_OUTPUT_NOTE },
      { role: 'user', content: request.user }
    ],
    stream: true,
    enable_thinking: false,
    response_format: buildJsonSchemaFormat(request.tool)
  };
}

/** 构造工具调用的请求体（带图片时使用）：系统段与用户段分开发送，强制调用输出工具，关闭思考。 */
function buildToolBody(modelCode: string, request: TextGenerationRequest, capability: TextCapability): Record<string, unknown> {
  return {
    model: modelCode,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: buildUserContent(request) }
    ],
    stream: true,
    enable_thinking: false,
    max_tokens: capability.maxOutputTokens,
    tools: [{ type: 'function', function: { name: request.tool.name, description: request.tool.description, parameters: request.tool.inputSchema } }],
    tool_choice: { type: 'function', function: { name: request.tool.name } }
  };
}
