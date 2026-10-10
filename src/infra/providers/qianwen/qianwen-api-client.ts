// ------------------------------------------------------------------------
// 名称：qianwen-api-client.ts
// 说明：千问AI平台（DashScope 原生接口）的 HTTP 客户端：带鉴权的 JSON 请求与 OpenAI 兼容接口的流式请求，并把 HTTP 状态和错误码统一转换为 ProviderError；提供测试连接。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：继承 BaseProviderApiClient（见 shared/base-provider-api-client.ts）；超时、网络错误脱敏与流式读取由共用的传输层完成（见 shared/provider-http-transport.ts）；图片、视频、音频走原生接口，使用“接口地址”设置，文本走 OpenAI 兼容接口，使用单独的“文本接口地址”设置。
// ------------------------------------------------------------------------

import { ProviderError, ProviderFailure } from '../../../domain/errors';
import { ProviderCallContext } from '../../../domain/ports/provider-adapters';
import { BaseProviderApiClient, DEFAULT_PROVIDER_TIMEOUTS, classifyHttpStatus } from '../shared/base-provider-api-client';
import { FetchFunction, HttpTimeouts } from '../shared/provider-http-transport';
import {
  QIANWEN_ENDPOINT_LABEL,
  QIANWEN_ENDPOINT_SETTING_KEY,
  QIANWEN_TEXT_ENDPOINT_LABEL,
  QIANWEN_TEXT_ENDPOINT_SETTING_KEY
} from './qianwen-catalog';

export type { FetchFunction };

/** 平台错误响应的结构：错误码与说明；原生接口直接在顶层，OpenAI 兼容接口放在 error 对象里。 */
interface ErrorBody {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly error?: unknown;
}

/** 服务商显示名称，用于超时、断连等说明。 */
const PROVIDER_NAME = '千问AI平台';

/** 错误码前缀与失败分类的对应，按顺序匹配。 */
const ERROR_CODE_CATEGORIES: ReadonlyArray<readonly [prefix: string, category: ProviderFailure]> = [
  ['DataInspectionFailed', 'content_rejected'],
  ['data_inspection_failed', 'content_rejected'],
  ['IPInfringementSuspect', 'content_rejected'],
  ['Throttling', 'rate_limited'],
  ['InvalidApiKey', 'auth'],
  ['invalid_api_key', 'auth'],
  ['InvalidParameter', 'invalid_request']
];

/** 默认超时：与各服务商的共用默认值相同。 */
export const DEFAULT_QIANWEN_TIMEOUTS: QianwenTimeouts = DEFAULT_PROVIDER_TIMEOUTS;

/**
 * 按错误码判断失败分类。
 * @param code 平台返回的错误码。
 * @returns 分类；不认识的错误码返回 null，由调用方决定如何回退。
 */
export function classifyErrorCode(code: string | null): ProviderFailure | null {
  const match = ERROR_CODE_CATEGORIES.find(([prefix]) => code !== null && code.startsWith(prefix));
  return match === undefined ? null : match[1];
}

/** 请求超时配置，单位为毫秒；测试时可注入更短的值。 */
export type QianwenTimeouts = HttpTimeouts;

/** 从错误响应中取出错误码与说明，兼容原生与 OpenAI 兼容两种结构。 */
function readErrorFields(payload: Record<string, unknown>): { readonly code: string | null; readonly message: string | null } {
  const body = payload as ErrorBody;
  const source = typeof body.error === 'object' && body.error !== null ? (body.error as ErrorBody) : body;
  return {
    code: typeof source.code === 'string' ? source.code : null,
    message: typeof source.message === 'string' && source.message !== '' ? source.message : null
  };
}

/** 千问AI平台 HTTP 客户端。 */
export class QianwenApiClient extends BaseProviderApiClient {
  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   * @param timeouts 超时配置，缺省使用 DEFAULT_QIANWEN_TIMEOUTS。
   */
  constructor(fetchFunction: FetchFunction = fetch, timeouts: QianwenTimeouts = DEFAULT_QIANWEN_TIMEOUTS) {
    super(fetchFunction, {
      providerName: PROVIDER_NAME,
      endpoint: { settingKey: QIANWEN_ENDPOINT_SETTING_KEY, label: QIANWEN_ENDPOINT_LABEL },
      streamEndpoint: { settingKey: QIANWEN_TEXT_ENDPOINT_SETTING_KEY, label: QIANWEN_TEXT_ENDPOINT_LABEL },
      timeouts
    });
  }

  /**
   * 以 JSON 提交请求体。
   * @param context 调用凭据与设置。
   * @param path 相对接口地址的路径，以 / 开头。
   * @param body 请求体对象。
   * @param extraHeaders 附加请求头。
   * @param timeoutMs 覆盖默认的总超时（毫秒）；上传 Base64 素材或同步生成等耗时较长的请求使用。
   * @returns 响应的 JSON 对象。
   * @throws ProviderError 网络失败、非 2xx 响应，或响应不是 JSON 对象。
   */
  async postJson(
    context: ProviderCallContext,
    path: string,
    body: unknown,
    extraHeaders: Readonly<Record<string, string>> = {},
    timeoutMs?: number
  ): Promise<Record<string, unknown>> {
    return this.postJsonRequest(context, path, body, extraHeaders, timeoutMs);
  }

  /** 把非 2xx 响应转换为带分类的错误。 */
  protected override buildHttpError(status: number, payload: Record<string, unknown>): ProviderError {
    const { code, message } = readErrorFields(payload);
    const category = classifyErrorCode(code) ?? classifyHttpStatus(status);
    return new ProviderError(category, `${PROVIDER_NAME}返回错误${code === null ? '' : `（${code}）`}：${message ?? `HTTP ${status}`}`, { code });
  }
}
