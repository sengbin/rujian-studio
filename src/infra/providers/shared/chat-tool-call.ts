// ------------------------------------------------------------------------
// 名称：chat-tool-call.ts
// 说明：OpenAI 兼容对话接口的文本适配器共用部分：用户消息内容（可带图片）的构造，以及从流式响应中累积并解析模型通过工具（或 JSON Schema 模式的正文）返回的结构化结果。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：输出被截断（finish_reason 为 length）时直接报错，不使用不完整的结果；错误码到失败分类的映射由各服务商传入；原位于千问AI平台文本适配器中，现供各服务商共用。
// ------------------------------------------------------------------------

import { ProviderError, ProviderFailure } from '../../../domain/errors';
import { TextGenerationRequest } from '../../../domain/ports/text-generation-port';
import { isRecord, toDataUri } from './provider-payload';
import { toStrictSchema } from './strict-json-schema';

/** 流式响应中累积的一次工具调用。 */
interface ToolCallDraft {
  name: string;
  argumentsText: string;
}

/** 一个流式事件中与结果有关的内容。 */
interface ChoiceDelta {
  readonly content: string;
  readonly toolCalls: ReadonlyArray<{ readonly index: number; readonly name: string; readonly argumentsText: string }>;
  readonly finishReason: string | null;
}

/** 解析流式结果所需的服务商差异。 */
export interface ChatToolCallOptions {
  /** 服务商显示名称，用于错误说明，如“千问AI平台”。 */
  readonly providerName: string;
  /** 按错误码判断失败分类；不认识的错误码返回 null，按服务端错误处理。 */
  readonly classifyErrorCode: (code: string | null) => ProviderFailure | null;
}

const EMPTY_DELTA: ChoiceDelta = { content: '', toolCalls: [], finishReason: null };

/** JSON Schema 模式下追加到系统段的说明：任务提示词里的“通过工具提交，参数”在这里指直接输出的 JSON 对象。 */
export const JSON_OUTPUT_NOTE = '\n\n本次没有可调用的工具：把提示词里“通过工具提交”的参数对象直接作为回复输出，只输出符合给定 JSON Schema 的 JSON，不要输出其他文字；不用的字段填 null。';

/** 构造请求体的 response_format：以输出工具的参数 Schema 为准，开启严格模式。 */
export function buildJsonSchemaFormat(tool: TextGenerationRequest['tool']): Record<string, unknown> {
  return {
    type: 'json_schema',
    json_schema: { name: tool.name, description: tool.description, strict: true, schema: toStrictSchema(tool.inputSchema) }
  };
}

/** 构造用户消息的内容：没有图片时为文本，有图片时为“图片在前、文本在后”的内容块列表。 */
export function buildUserContent(request: TextGenerationRequest): string | Array<Record<string, unknown>> {
  const images = request.images ?? [];
  if (images.length === 0) {
    return request.user;
  }
  return [...images.map((image) => ({ type: 'image_url', image_url: { url: toDataUri(image) } })), { type: 'text', text: request.user }];
}

/**
 * 读完流式事件，取出模型通过指定工具返回的参数对象。
 * @param events 事件的 data 内容，不含结束标记。
 * @param toolName 期望被调用的工具名称。
 * @param options 服务商名称与错误码分类。
 * @throws ProviderError 事件是错误信息、输出被截断、没有通过期望的工具返回，或工具参数不是合法的 JSON 对象。
 */
export async function collectToolCallArguments(events: AsyncIterable<string>, toolName: string, options: ChatToolCallOptions): Promise<object> {
  const { calls, content } = await readStream(events, options);
  const drafts = [...calls.values()];
  const chosen = drafts.find((draft) => draft.name === toolName);
  if (chosen === undefined) {
    if (drafts.length > 0) {
      throw new ProviderError('invalid_request', `模型调用了非预期的工具“${drafts[0].name}”，应为“${toolName}”，请重试。`);
    }
    const detail = content.trim() === '' ? '' : `：${content.trim().slice(0, 200)}`;
    throw new ProviderError('invalid_request', `模型没有通过工具返回结果${detail}`);
  }
  return parseJsonObject(chosen.argumentsText, '工具参数');
}

/**
 * 读完流式事件，把模型以 JSON Schema 模式返回的正文解析为对象。
 * @param events 事件的 data 内容，不含结束标记。
 * @param options 服务商名称与错误码分类。
 * @throws ProviderError 事件是错误信息、输出被截断、没有内容，或内容不是合法的 JSON 对象。
 */
export async function collectJsonContent(events: AsyncIterable<string>, options: ChatToolCallOptions): Promise<object> {
  const { content } = await readStream(events, options);
  if (content.trim() === '') {
    throw new ProviderError('invalid_request', '模型没有返回内容。');
  }
  return parseJsonObject(content, '内容');
}

/** 读完流式事件，累积正文与工具调用；输出因长度被截断时报错。 */
async function readStream(events: AsyncIterable<string>, options: ChatToolCallOptions): Promise<{ calls: Map<number, ToolCallDraft>; content: string }> {
  const calls = new Map<number, ToolCallDraft>();
  let content = '';
  let finishReason: string | null = null;
  for await (const data of events) {
    const choice = readChoice(data, options);
    content += choice.content;
    for (const call of choice.toolCalls) {
      const draft = calls.get(call.index) ?? { name: '', argumentsText: '' };
      draft.name += call.name;
      draft.argumentsText += call.argumentsText;
      calls.set(call.index, draft);
    }
    finishReason = choice.finishReason ?? finishReason;
  }
  if (finishReason === 'length') {
    throw new ProviderError('invalid_request', '模型的输出超出最大长度被截断，请在“模型设置”中调小“每段字数上限”后重试。');
  }
  return { calls, content };
}

/**
 * 解析一个流式事件。没有候选的事件（如用量统计）忽略；事件里带错误信息或内容不是 JSON 对象时抛出。
 * keep-alive、空行与结束标记在传输层已经过滤，不会到这里。
 * @throws ProviderError 事件是错误信息，或不是合法的 JSON 对象。
 */
function readChoice(data: string, options: ChatToolCallOptions): ChoiceDelta {
  let chunk: unknown;
  try {
    chunk = JSON.parse(data);
  } catch (error) {
    throw new ProviderError('server', `${options.providerName}返回的流式事件不是合法的 JSON。`, { cause: error });
  }
  if (!isRecord(chunk)) {
    throw new ProviderError('server', `${options.providerName}返回的流式事件不是 JSON 对象。`);
  }
  if (isRecord(chunk.error)) {
    const code = typeof chunk.error.code === 'string' ? chunk.error.code : null;
    const message = typeof chunk.error.message === 'string' ? chunk.error.message : '未知错误';
    throw new ProviderError(options.classifyErrorCode(code) ?? 'server', `${options.providerName}返回错误${code === null ? '' : `（${code}）`}：${message}`, { code });
  }
  // 部分服务商（如 MiniMax）把错误放在 base_resp 里，状态码不为 0 即失败。
  if (isRecord(chunk.base_resp) && typeof chunk.base_resp.status_code === 'number' && chunk.base_resp.status_code !== 0) {
    const code = String(chunk.base_resp.status_code);
    const message = typeof chunk.base_resp.status_msg === 'string' && chunk.base_resp.status_msg !== '' ? chunk.base_resp.status_msg : '未知错误';
    throw new ProviderError(options.classifyErrorCode(code) ?? 'server', `${options.providerName}返回错误（${code}）：${message}`, { code });
  }
  const choice = Array.isArray(chunk.choices) && isRecord(chunk.choices[0]) ? chunk.choices[0] : undefined;
  if (choice === undefined) {
    return EMPTY_DELTA;
  }
  const delta = isRecord(choice.delta) ? choice.delta : {};
  const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls.filter(isRecord) : [];
  return {
    content: typeof delta.content === 'string' ? delta.content : '',
    toolCalls: toolCalls.map((call, position) => {
      const fn = isRecord(call.function) ? call.function : {};
      return {
        index: typeof call.index === 'number' ? call.index : position,
        name: typeof fn.name === 'string' ? fn.name : '',
        argumentsText: typeof fn.arguments === 'string' ? fn.arguments : ''
      };
    }),
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null
  };
}

/** 把文本解析为 JSON 对象；subject 用于错误说明，如“工具参数”“内容”。 */
function parseJsonObject(text: string, subject: string): object {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ProviderError('invalid_request', `模型返回的${subject}不是合法的 JSON，请重试。`, { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new ProviderError('invalid_request', `模型返回的${subject}不是 JSON 对象，请重试。`);
  }
  return parsed;
}
