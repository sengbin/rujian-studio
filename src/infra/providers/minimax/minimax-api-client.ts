// ------------------------------------------------------------------------
// 名称：minimax-api-client.ts
// 说明：MiniMax 的 HTTP 客户端：带鉴权的 JSON 请求（POST、GET、DELETE）与对话接口的流式请求，并把 HTTP 状态、base_resp 状态码和错误码统一转换为 ProviderError；提供测试连接。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：用 Bearer 访问密钥鉴权；失败有两种形态：HTTP 非 2xx（响应体为 {"error":{"type","message"}}，message 末尾括号内是平台错误码）与 HTTP 200 但 base_resp.status_code 不为 0（图片、语音接口）；超时、网络错误脱敏与流式读取由共用的传输层完成（见 shared/provider-http-transport.ts）。
// ------------------------------------------------------------------------

import { ProviderError, ProviderFailure } from '../../../domain/errors';
import { ProviderCallContext } from '../../../domain/ports/provider-adapters';
import { requireSecureEndpoint } from '../shared/provider-endpoint';
import { FetchFunction, HttpTimeouts, ProviderHttpTransport } from '../shared/provider-http-transport';
import { readObject } from '../shared/provider-payload';
import { MINIMAX_ENDPOINT_SETTING_KEY, MINIMAX_PROVIDER_NAME } from './minimax-catalog';

export type { FetchFunction };

/** 默认超时：普通请求需要上传 Base64 内联的参考素材，留出余量；流式生成只在长时间无数据时才算超时。 */
export const DEFAULT_MINIMAX_TIMEOUTS: HttpTimeouts = {
  requestMs: 60_000,
  streamIdleMs: 120_000
};

/** 平台错误码与失败分类的对应。 */
const ERROR_CODE_CATEGORIES: Readonly<Record<string, ProviderFailure>> = {
  // 请求频率、Token 与连接数限制，以及 M Plan 资源限制
  '1002': 'rate_limited',
  '1039': 'rate_limited',
  '1041': 'rate_limited',
  '2045': 'rate_limited',
  '2056': 'rate_limited',
  // 密钥无效、余额不足与无权访问
  '1004': 'auth',
  '1008': 'auth',
  '2049': 'auth',
  '2038': 'auth',
  '2042': 'auth',
  // 输入或输出内容涉敏
  '1026': 'content_rejected',
  '1027': 'content_rejected',
  // 参数、字符与音频样本问题
  '2013': 'invalid_request',
  '20132': 'invalid_request',
  '1042': 'invalid_request',
  '2037': 'invalid_request',
  '2039': 'invalid_request',
  '2048': 'invalid_request',
  // 未知错误、超时与下游服务错误
  '1000': 'server',
  '1001': 'server',
  '1024': 'server',
  '1033': 'server'
};

/** 响应体 error.message 末尾括号内的平台错误码，如 “... (1004)”。 */
const TRAILING_CODE_PATTERN = /\((\d{4,5})\)\s*$/;

/** 任务不存在的错误说明。 */
const RECORD_NOT_FOUND_PATTERN = /record not found/i;

/**
 * 按平台错误码判断失败分类。
 * @param code 平台返回的错误码（数字的文本形式）。
 * @returns 分类；不认识的错误码返回 null，由调用方决定如何回退。
 */
export function classifyMinimaxErrorCode(code: string | null): ProviderFailure | null {
  return code === null ? null : (ERROR_CODE_CATEGORIES[code] ?? null);
}

/** 按 HTTP 状态判断失败分类。 */
function classifyStatus(status: number): ProviderFailure {
  if (status === 401 || status === 402 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 422) return 'content_rejected';
  if (status >= 400 && status < 500) return 'invalid_request';
  return 'server';
}

/** 构造平台业务错误：错误码能识别时按它分类，否则按回退分类。 */
function buildBusinessError(code: string | null, message: string | null, fallback: ProviderFailure): ProviderError {
  const category = classifyMinimaxErrorCode(code) ?? fallback;
  return new ProviderError(category, `${MINIMAX_PROVIDER_NAME}返回错误${code === null ? '' : `（${code}）`}：${message ?? '未知错误'}`, { code });
}

/**
 * 检查 HTTP 200 响应里的 base_resp：状态码不为 0 时按错误抛出；没有 base_resp 视为成功。
 * @param payload 响应体。
 * @throws ProviderError base_resp.status_code 不为 0。
 */
export function assertBaseResponseOk(payload: Record<string, unknown>): void {
  const baseResponse = readObject(payload.base_resp);
  const status = baseResponse.status_code;
  if (typeof status === 'number' && status !== 0) {
    throw buildBusinessError(String(status), typeof baseResponse.status_msg === 'string' && baseResponse.status_msg !== '' ? baseResponse.status_msg : null, 'server');
  }
}

/** MiniMax HTTP 客户端。 */
export class MinimaxApiClient {
  private readonly transport: ProviderHttpTransport;

  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   * @param timeouts 超时配置，缺省使用 DEFAULT_MINIMAX_TIMEOUTS。
   */
  constructor(fetchFunction: FetchFunction = fetch, timeouts: HttpTimeouts = DEFAULT_MINIMAX_TIMEOUTS) {
    this.transport = new ProviderHttpTransport(fetchFunction, { providerName: MINIMAX_PROVIDER_NAME, timeouts, buildHttpError });
  }

  /**
   * 以 JSON 提交请求体。
   * @param context 调用凭据与设置。
   * @param path 相对接口地址的路径，以 / 开头。
   * @param body 请求体对象。
   * @param timeoutMs 覆盖默认的总超时（毫秒）；同步生成图片、语音等耗时较长的请求使用。
   * @returns 响应的 JSON 对象。
   * @throws ProviderError 网络失败、非 2xx 响应、base_resp 报错，或响应不是 JSON 对象。
   */
  async postJson(context: ProviderCallContext, path: string, body: unknown, timeoutMs?: number): Promise<Record<string, unknown>> {
    const payload = await this.transport.requestJson(`${readEndpoint(context)}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: buildHeaders(context, { 'Content-Type': 'application/json' }),
      signal: context.signal,
      timeoutMs
    });
    assertBaseResponseOk(payload);
    return payload;
  }

  /**
   * 发起 GET 请求。
   * @param context 调用凭据与设置。
   * @param path 相对接口地址的路径，以 / 开头。
   * @throws ProviderError 网络失败、非 2xx 响应、base_resp 报错，或响应不是 JSON 对象。
   */
  async getJson(context: ProviderCallContext, path: string): Promise<Record<string, unknown>> {
    const payload = await this.transport.requestJson(`${readEndpoint(context)}${path}`, { method: 'GET', headers: buildHeaders(context, {}), signal: context.signal });
    assertBaseResponseOk(payload);
    return payload;
  }

  /**
   * 发起 DELETE 请求。
   * @param context 调用凭据与设置。
   * @param path 相对接口地址的路径，以 / 开头。
   * @throws ProviderError 网络失败、非 2xx 响应或 base_resp 报错。
   */
  async deleteJson(context: ProviderCallContext, path: string): Promise<Record<string, unknown>> {
    const payload = await this.transport.requestJson(`${readEndpoint(context)}${path}`, { method: 'DELETE', headers: buildHeaders(context, {}), signal: context.signal });
    assertBaseResponseOk(payload);
    return payload;
  }

  /**
   * 确认接口地址与访问密钥可用：查询一个不存在的任务。平台返回带错误类型的业务错误（如任务不存在）说明请求已通过鉴权。
   * @param context 调用凭据与设置。
   * @param probePath 查询不存在任务的接口路径，以 / 开头。
   * @throws ProviderError 鉴权失败、网络故障、服务端错误，或响应不像平台的业务错误（接口地址可能不正确）。
   */
  async checkConnection(context: ProviderCallContext, probePath: string): Promise<void> {
    try {
      await this.getJson(context, probePath);
    } catch (error) {
      if (error instanceof ProviderError && (error.category === 'invalid_request' || isRecordNotFound(error))) {
        if (error.code !== null) {
          return;
        }
        throw new ProviderError('invalid_request', `${error.message}。请检查接口地址是否正确。`, { cause: error });
      }
      throw error;
    }
  }

  /**
   * 向对话接口提交流式请求，逐条产出事件的 data 内容（不含 `[DONE]` 结束标记）。
   * @param context 调用凭据与设置。
   * @param path 相对接口地址的路径，以 / 开头。
   * @param body 请求体对象，由调用方设置 stream 为 true。
   * @throws ProviderError 网络失败、请求超时、非 2xx 响应，或读取流时中断；调用方主动取消时原样抛出取消异常。
   */
  async *postEventStream(context: ProviderCallContext, path: string, body: unknown): AsyncGenerator<string> {
    yield* this.transport.streamEvents(`${readEndpoint(context)}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: buildHeaders(context, { 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
      signal: context.signal
    });
  }
}

/** 查询不存在的任务时，平台以错误码 1000 返回“record not found”：说明已通过鉴权，只是任务不存在。 */
function isRecordNotFound(error: ProviderError): boolean {
  return error.category === 'server' && error.code !== null && RECORD_NOT_FOUND_PATTERN.test(error.message);
}

/** 带鉴权的请求头。 */
function buildHeaders(context: ProviderCallContext, extraHeaders: Readonly<Record<string, string>>): Record<string, string> {
  return { Authorization: `Bearer ${context.apiKey}`, ...extraHeaders };
}

/** 取接口地址；未配置或不是 https 地址时在发请求前报参数错误。 */
function readEndpoint(context: ProviderCallContext): string {
  return requireSecureEndpoint(context.settings[MINIMAX_ENDPOINT_SETTING_KEY], `尚未配置${MINIMAX_PROVIDER_NAME}的接口地址。`);
}

/** 把非 2xx 响应转换为带分类的错误：平台错误码取自 base_resp，或 error.message 末尾的括号；都没有时取 error.type 作为错误标识。 */
function buildHttpError(status: number, payload: Record<string, unknown>): ProviderError {
  const baseResponse = readObject(payload.base_resp);
  if (typeof baseResponse.status_code === 'number' && baseResponse.status_code !== 0) {
    const message = typeof baseResponse.status_msg === 'string' && baseResponse.status_msg !== '' ? baseResponse.status_msg : `HTTP ${status}`;
    return buildBusinessError(String(baseResponse.status_code), message, classifyStatus(status));
  }
  const error = readObject(payload.error);
  const message = typeof error.message === 'string' && error.message !== '' ? error.message : `HTTP ${status}`;
  const type = typeof error.type === 'string' && error.type !== '' ? error.type : null;
  const code = TRAILING_CODE_PATTERN.exec(message)?.[1] ?? type;
  return buildBusinessError(code, message, classifyStatus(status));
}
