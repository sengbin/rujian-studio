// ------------------------------------------------------------------------
// 名称：base-provider-api-client.ts
// 说明：各服务商 Bearer 鉴权 HTTP 客户端的共用基类：带鉴权的 JSON 请求（POST、GET、DELETE）、流式事件请求、测试连接，以及 HTTP 状态到失败分类的转换。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：服务商名称、接口地址设置项、超时配置由子类通过构造参数传入，错误响应的解析（buildHttpError）、HTTP 200 响应体里的业务错误、测试连接的判定由子类覆盖；超时、取消与网络错误脱敏仍由传输层完成（见 provider-http-transport.ts）。
// ------------------------------------------------------------------------

import { ProviderError, ProviderFailure } from '../../../domain/errors';
import { ProviderCallContext } from '../../../domain/ports/provider-adapters';
import { requireSecureEndpoint } from './provider-endpoint';
import { FetchFunction, HttpTimeouts, ProviderHttpTransport } from './provider-http-transport';

/** 默认超时：普通请求需要上传 Base64 内联的参考素材，留出余量；流式生成只在长时间无数据时才算超时。 */
export const DEFAULT_PROVIDER_TIMEOUTS: HttpTimeouts = {
  requestMs: 60_000,
  streamIdleMs: 120_000
};

/** 测试连接判定为地址不对时追加的提示。 */
const ADDRESS_HINT = '请检查接口地址是否正确。';

/** 服务商设置里一个接口地址项：设置键与未配置时提示里的名称。 */
export interface ProviderEndpointSetting {
  readonly settingKey: string;
  readonly label: string;
}

/** 子类向基类提供的服务商信息。 */
export interface ProviderApiClientProfile {
  /** 服务商显示名称，用于超时、断连与错误说明。 */
  readonly providerName: string;
  /** 普通 JSON 请求使用的接口地址项。 */
  readonly endpoint: ProviderEndpointSetting;
  /** 流式对话请求与文本测试连接使用的接口地址项；与 endpoint 相同时传同一个对象。 */
  readonly streamEndpoint: ProviderEndpointSetting;
  readonly timeouts: HttpTimeouts;
}

/**
 * 按 HTTP 状态判断失败分类：401、403 为鉴权，429 为限流，其余 4xx 为参数，其他为服务端。
 * @param status HTTP 状态码。
 * @param overrides 服务商特有的状态与分类的对应，优先于通用规则。
 */
export function classifyHttpStatus(status: number, overrides: Readonly<Record<number, ProviderFailure>> = {}): ProviderFailure {
  const override = overrides[status];
  if (override !== undefined) return override;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'invalid_request';
  return 'server';
}

/** 使用 Bearer 访问密钥鉴权的服务商 HTTP 客户端基类。 */
export abstract class BaseProviderApiClient {
  protected readonly transport: ProviderHttpTransport;

  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   * @param profile 服务商名称、接口地址设置项与超时配置。
   */
  constructor(
    fetchFunction: FetchFunction,
    private readonly profile: ProviderApiClientProfile
  ) {
    this.transport = new ProviderHttpTransport(fetchFunction, {
      providerName: profile.providerName,
      timeouts: profile.timeouts,
      buildHttpError: (status, payload) => this.buildHttpError(status, payload)
    });
  }

  /**
   * 发起 GET 请求。
   * @param context 调用凭据与设置。
   * @param path 相对接口地址的路径，以 / 开头。
   * @returns 响应的 JSON 对象。
   * @throws ProviderError 网络失败、非 2xx 响应、响应体里的业务错误，或响应不是 JSON 对象。
   */
  async getJson(context: ProviderCallContext, path: string): Promise<Record<string, unknown>> {
    return this.sendJson(context, 'GET', path, { headers: {} });
  }

  /**
   * 发起 DELETE 请求。
   * @param context 调用凭据与设置。
   * @param path 相对接口地址的路径，以 / 开头。
   * @throws ProviderError 网络失败、非 2xx 响应或响应体里的业务错误。
   */
  async deleteJson(context: ProviderCallContext, path: string): Promise<Record<string, unknown>> {
    return this.sendJson(context, 'DELETE', path, { headers: {} });
  }

  /**
   * 确认接口地址与访问密钥可用：查询一个不存在的任务。平台返回带错误码的业务错误（如任务不存在）说明请求已通过鉴权。
   * @param context 调用凭据与设置。
   * @param probePath 查询不存在任务的接口路径，以 / 开头。
   * @throws ProviderError 鉴权失败、网络故障、服务端错误，或响应不像平台的业务错误（接口地址可能不正确）。
   */
  async checkConnection(context: ProviderCallContext, probePath: string): Promise<void> {
    await this.confirmReachable(() => this.getJson(context, probePath));
  }

  /**
   * 确认文本接口地址与访问密钥可用：向对话接口提交空请求体，平台先鉴权再检查参数，返回带错误码的参数错误说明地址与密钥可用，且不会产生生成费用。
   * @param context 调用凭据与设置；地址取自流式接口地址设置项。
   * @param path 相对文本接口地址的对话接口路径，以 / 开头。
   * @throws ProviderError 鉴权失败、网络故障、服务端错误，或响应不像平台的业务错误（接口地址可能不正确）。
   */
  async checkTextConnection(context: ProviderCallContext, path: string): Promise<void> {
    const url = `${this.readEndpoint(context, this.profile.streamEndpoint)}${path}`;
    await this.confirmReachable(() =>
      this.transport.requestJson(url, {
        method: 'POST',
        body: '{}',
        headers: this.buildHeaders(context, { 'Content-Type': 'application/json' }),
        signal: context.signal
      })
    );
  }

  /**
   * 向对话接口提交流式请求，逐条产出事件的 data 内容（不含 `[DONE]` 结束标记）。
   * @param context 调用凭据与设置；地址取自流式接口地址设置项。
   * @param path 相对接口地址的路径，以 / 开头。
   * @param body 请求体对象，由调用方设置 stream 为 true。
   * @throws ProviderError 网络失败、请求超时、非 2xx 响应，或读取流时中断；调用方主动取消时原样抛出取消异常。
   */
  async *postEventStream(context: ProviderCallContext, path: string, body: unknown): AsyncGenerator<string> {
    yield* this.transport.streamEvents(`${this.readEndpoint(context, this.profile.streamEndpoint)}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: this.buildHeaders(context, { 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
      signal: context.signal
    });
  }

  /** 把非 2xx 响应转换为带分类的错误。 */
  protected abstract buildHttpError(status: number, payload: Record<string, unknown>): ProviderError;

  /** 检查 HTTP 2xx 响应体里的业务错误，有则抛出 ProviderError；默认不检查。 */
  protected assertPayloadOk(_payload: Record<string, unknown>): void {}

  /** 测试连接时，错误是否说明请求已通过鉴权：默认为带错误码的参数类业务错误。 */
  protected isProbeAnswered(error: ProviderError): boolean {
    return error.category === 'invalid_request' && error.code !== null;
  }

  /**
   * 以 JSON 提交请求体。
   * @param context 调用凭据与设置。
   * @param path 相对接口地址的路径，以 / 开头。
   * @param body 请求体对象。
   * @param extraHeaders 附加请求头。
   * @param timeoutMs 覆盖默认的总超时（毫秒）；上传大素材或同步生成时使用。
   * @throws ProviderError 网络失败、非 2xx 响应、响应体里的业务错误，或响应不是 JSON 对象。
   */
  protected async postJsonRequest(
    context: ProviderCallContext,
    path: string,
    body: unknown,
    extraHeaders: Readonly<Record<string, string>>,
    timeoutMs: number | undefined
  ): Promise<Record<string, unknown>> {
    return this.sendJson(context, 'POST', path, { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...extraHeaders }, timeoutMs });
  }

  /** 向普通接口地址发起请求，并检查响应体里的业务错误。 */
  private async sendJson(
    context: ProviderCallContext,
    method: string,
    path: string,
    request: { readonly body?: string; readonly headers: Readonly<Record<string, string>>; readonly timeoutMs?: number }
  ): Promise<Record<string, unknown>> {
    const payload = await this.transport.requestJson(`${this.readEndpoint(context, this.profile.endpoint)}${path}`, {
      method,
      body: request.body,
      headers: this.buildHeaders(context, request.headers),
      signal: context.signal,
      timeoutMs: request.timeoutMs
    });
    this.assertPayloadOk(payload);
    return payload;
  }

  /** 执行探测请求：说明请求已通过鉴权的业务错误视为可用；其余参数类错误多半是地址不对，附上提示后抛出。 */
  private async confirmReachable(request: () => Promise<unknown>): Promise<void> {
    try {
      await request();
    } catch (error) {
      if (!(error instanceof ProviderError)) {
        throw error;
      }
      if (this.isProbeAnswered(error)) {
        return;
      }
      if (error.category === 'invalid_request') {
        throw new ProviderError('invalid_request', `${error.message}。${ADDRESS_HINT}`, { cause: error });
      }
      throw error;
    }
  }

  /** 带鉴权的请求头。 */
  private buildHeaders(context: ProviderCallContext, extraHeaders: Readonly<Record<string, string>>): Record<string, string> {
    return { Authorization: `Bearer ${context.apiKey}`, ...extraHeaders };
  }

  /** 取接口地址；未配置或不是 https 地址时在发请求前报参数错误。 */
  private readEndpoint(context: ProviderCallContext, setting: ProviderEndpointSetting): string {
    return requireSecureEndpoint(context.settings[setting.settingKey], `尚未配置${this.profile.providerName}的${setting.label}。`);
  }
}
