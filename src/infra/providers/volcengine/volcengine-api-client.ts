// ------------------------------------------------------------------------
// 名称：volcengine-api-client.ts
// 说明：火山方舟的 HTTP 客户端：带鉴权的 JSON 请求（POST、GET、DELETE）与对话接口的流式请求，并把 HTTP 状态和错误码统一转换为 ProviderError；提供测试连接。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：方舟用 Bearer 访问密钥鉴权；错误响应为 {"error":{"code","message"}}；超时、网络错误脱敏与流式读取由共用的传输层完成（见 shared/provider-http-transport.ts）；语音合成不走方舟接口，见 volcengine-speech-client.ts。
// ------------------------------------------------------------------------

import { ProviderError, ProviderFailure } from '../../../domain/errors';
import { ProviderCallContext } from '../../../domain/ports/provider-adapters';
import { requireSecureEndpoint } from '../shared/provider-endpoint';
import { FetchFunction, HttpTimeouts, ProviderHttpTransport } from '../shared/provider-http-transport';
import { readObject } from '../shared/provider-payload';
import {
  VOLCENGINE_ENDPOINT_LABEL,
  VOLCENGINE_ENDPOINT_SETTING_KEY,
  VOLCENGINE_PROVIDER_NAME,
  VOLCENGINE_TEXT_ENDPOINT_LABEL,
  VOLCENGINE_TEXT_ENDPOINT_SETTING_KEY
} from './volcengine-catalog';

export type { FetchFunction };

/** 平台返回“接口路径不存在”的错误码：接口地址填错时出现。 */
const PATH_NOT_FOUND_CODE = 'PathNotFound';

/** 错误码与失败分类的对应，按顺序匹配：内容审核、账号与额度、限流、参数。 */
const ERROR_CODE_CATEGORIES: ReadonlyArray<readonly [pattern: RegExp, category: ProviderFailure]> = [
  [/SensitiveContent|RiskDetection|ContentSecurity/, 'content_rejected'],
  [/^(AuthenticationError|AuthN_|MissingHeader|InvalidAccountStatus|InvalidSubscription|AccessDenied|AccountOverdue|OperationDenied|ModelNotOpen|InvalidEndpointOrModel|QuotaExceeded)/, 'auth'],
  [/RateLimitExceeded|^Throttling|^ServerOverloaded|^RequestBurstTooFast|^InflightBatchsizeExceeded|^SetLimitExceeded/, 'rate_limited'],
  [/^(InvalidParameter|MissingParameter|InvalidArgument|InvalidImageURL|InvalidPayload|OutofContextError|RequestTooLarge|RequestBodyTooLarge)/, 'invalid_request']
];

/**
 * 按错误码判断失败分类。
 * @param code 平台返回的错误码。
 * @returns 分类；不认识的错误码返回 null，由调用方决定如何回退。
 */
export function classifyArkErrorCode(code: string | null): ProviderFailure | null {
  const match = ERROR_CODE_CATEGORIES.find(([pattern]) => code !== null && pattern.test(code));
  return match === undefined ? null : match[1];
}

/** 按 HTTP 状态判断失败分类。 */
function classifyStatus(status: number): ProviderFailure {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'invalid_request';
  return 'server';
}

/** 默认超时：普通请求需要上传 Base64 内联的参考素材，留出余量；流式生成只在长时间无数据时才算超时。 */
export const DEFAULT_VOLCENGINE_TIMEOUTS: HttpTimeouts = {
  requestMs: 60_000,
  streamIdleMs: 120_000
};

/** 火山方舟 HTTP 客户端。 */
export class VolcengineApiClient {
  private readonly transport: ProviderHttpTransport;

  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   * @param timeouts 超时配置，缺省使用 DEFAULT_VOLCENGINE_TIMEOUTS。
   */
  constructor(fetchFunction: FetchFunction = fetch, timeouts: HttpTimeouts = DEFAULT_VOLCENGINE_TIMEOUTS) {
    this.transport = new ProviderHttpTransport(fetchFunction, { providerName: VOLCENGINE_PROVIDER_NAME, timeouts, buildHttpError });
  }

  /**
   * 以 JSON 提交请求体。
   * @param context 调用凭据与设置。
   * @param path 相对接口地址的路径，以 / 开头。
   * @param body 请求体对象。
   * @param timeoutMs 覆盖默认的总超时（毫秒）；同步生成图片等耗时较长的请求使用。
   * @returns 响应的 JSON 对象。
   * @throws ProviderError 网络失败、非 2xx 响应，或响应不是 JSON 对象。
   */
  async postJson(context: ProviderCallContext, path: string, body: unknown, timeoutMs?: number): Promise<Record<string, unknown>> {
    return this.transport.requestJson(`${readMediaEndpoint(context)}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: buildHeaders(context, { 'Content-Type': 'application/json' }),
      signal: context.signal,
      timeoutMs
    });
  }

  /**
   * 发起 GET 请求。
   * @param context 调用凭据与设置。
   * @param path 相对接口地址的路径，以 / 开头。
   * @throws ProviderError 网络失败、非 2xx 响应，或响应不是 JSON 对象。
   */
  async getJson(context: ProviderCallContext, path: string): Promise<Record<string, unknown>> {
    return this.transport.requestJson(`${readMediaEndpoint(context)}${path}`, { method: 'GET', headers: buildHeaders(context, {}), signal: context.signal });
  }

  /**
   * 发起 DELETE 请求。
   * @param context 调用凭据与设置。
   * @param path 相对接口地址的路径，以 / 开头。
   * @throws ProviderError 网络失败或非 2xx 响应。
   */
  async deleteJson(context: ProviderCallContext, path: string): Promise<Record<string, unknown>> {
    return this.transport.requestJson(`${readMediaEndpoint(context)}${path}`, { method: 'DELETE', headers: buildHeaders(context, {}), signal: context.signal });
  }

  /**
   * 确认图片、视频接口地址与访问密钥可用：查询一个不存在的任务。平台返回带错误码的业务错误（如任务不存在）说明请求已通过鉴权。
   * @param context 调用凭据与设置。
   * @param probePath 查询不存在任务的接口路径，以 / 开头。
   * @throws ProviderError 鉴权失败、网络故障、服务端错误，或响应不像平台的业务错误（接口地址可能不正确）。
   */
  async checkConnection(context: ProviderCallContext, probePath: string): Promise<void> {
    await confirmReachable(() => this.getJson(context, probePath));
  }

  /**
   * 确认文本接口地址与访问密钥可用：向对话接口提交空请求体，平台先鉴权再检查参数，返回带错误码的参数错误说明地址与密钥可用，且不会产生生成费用。
   * @param context 调用凭据与设置；地址取自“文本接口地址”设置。
   * @param path 相对文本接口地址的对话接口路径，以 / 开头。
   * @throws ProviderError 鉴权失败、网络故障、服务端错误，或响应不像平台的业务错误（接口地址可能不正确）。
   */
  async checkTextConnection(context: ProviderCallContext, path: string): Promise<void> {
    const url = `${readEndpoint(context, VOLCENGINE_TEXT_ENDPOINT_SETTING_KEY, VOLCENGINE_TEXT_ENDPOINT_LABEL)}${path}`;
    await confirmReachable(() =>
      this.transport.requestJson(url, {
        method: 'POST',
        body: '{}',
        headers: buildHeaders(context, { 'Content-Type': 'application/json' }),
        signal: context.signal
      })
    );
  }

  /**
   * 向对话接口提交流式请求，逐条产出事件的 data 内容（不含 `[DONE]` 结束标记）。
   * @param context 调用凭据与设置；地址取自“文本接口地址”设置。
   * @param path 相对文本接口地址的路径，以 / 开头。
   * @param body 请求体对象，由调用方设置 stream 为 true。
   * @throws ProviderError 网络失败、请求超时、非 2xx 响应，或读取流时中断；调用方主动取消时原样抛出取消异常。
   */
  async *postEventStream(context: ProviderCallContext, path: string, body: unknown): AsyncGenerator<string> {
    yield* this.transport.streamEvents(`${readEndpoint(context, VOLCENGINE_TEXT_ENDPOINT_SETTING_KEY, VOLCENGINE_TEXT_ENDPOINT_LABEL)}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: buildHeaders(context, { 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
      signal: context.signal
    });
  }
}

/** 执行探测请求：带错误码的参数类业务错误说明地址与密钥可用，没有错误码或接口路径不存在的多半是地址不对。 */
async function confirmReachable(request: () => Promise<unknown>): Promise<void> {
  try {
    await request();
  } catch (error) {
    if (error instanceof ProviderError && error.category === 'invalid_request') {
      if (error.code !== null && error.code !== PATH_NOT_FOUND_CODE) {
        return;
      }
      throw new ProviderError('invalid_request', `${error.message}。请检查接口地址是否正确。`, { cause: error });
    }
    throw error;
  }
}

/** 带鉴权的请求头。 */
function buildHeaders(context: ProviderCallContext, extraHeaders: Readonly<Record<string, string>>): Record<string, string> {
  return { Authorization: `Bearer ${context.apiKey}`, ...extraHeaders };
}

/** 取图片、视频使用的接口地址。 */
function readMediaEndpoint(context: ProviderCallContext): string {
  return readEndpoint(context, VOLCENGINE_ENDPOINT_SETTING_KEY, VOLCENGINE_ENDPOINT_LABEL);
}

/** 取指定设置项的接口地址；未配置或不是 https 地址时在发请求前报参数错误。 */
function readEndpoint(context: ProviderCallContext, settingKey: string, label: string): string {
  return requireSecureEndpoint(context.settings[settingKey], `尚未配置${VOLCENGINE_PROVIDER_NAME}的${label}。`);
}

/** 把非 2xx 响应转换为带分类的错误：方舟的错误放在 error 对象里。 */
function buildHttpError(status: number, payload: Record<string, unknown>): ProviderError {
  const error = readObject(payload.error);
  const code = typeof error.code === 'string' && error.code !== '' ? error.code : null;
  const message = typeof error.message === 'string' && error.message !== '' ? error.message : `HTTP ${status}`;
  const category = classifyArkErrorCode(code) ?? classifyStatus(status);
  return new ProviderError(category, `${VOLCENGINE_PROVIDER_NAME}返回错误${code === null ? '' : `（${code}）`}：${message}`, { code });
}
