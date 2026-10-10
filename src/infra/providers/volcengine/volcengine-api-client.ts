// ------------------------------------------------------------------------
// 名称：volcengine-api-client.ts
// 说明：火山方舟的 HTTP 客户端：带鉴权的 JSON 请求（POST、GET、DELETE）与对话接口的流式请求，并把 HTTP 状态和错误码统一转换为 ProviderError；提供测试连接。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：继承 BaseProviderApiClient（见 shared/base-provider-api-client.ts）；方舟用 Bearer 访问密钥鉴权；错误响应为 {"error":{"code","message"}}；超时、网络错误脱敏与流式读取由共用的传输层完成（见 shared/provider-http-transport.ts）；语音合成不走方舟接口，见 volcengine-speech-client.ts。
// ------------------------------------------------------------------------

import { ProviderError, ProviderFailure } from '../../../domain/errors';
import { ProviderCallContext } from '../../../domain/ports/provider-adapters';
import { BaseProviderApiClient, DEFAULT_PROVIDER_TIMEOUTS, classifyHttpStatus } from '../shared/base-provider-api-client';
import { FetchFunction, HttpTimeouts } from '../shared/provider-http-transport';
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

/** 默认超时：与各服务商的共用默认值相同。 */
export const DEFAULT_VOLCENGINE_TIMEOUTS: HttpTimeouts = DEFAULT_PROVIDER_TIMEOUTS;

/** 火山方舟 HTTP 客户端。 */
export class VolcengineApiClient extends BaseProviderApiClient {
  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   * @param timeouts 超时配置，缺省使用 DEFAULT_VOLCENGINE_TIMEOUTS。
   */
  constructor(fetchFunction: FetchFunction = fetch, timeouts: HttpTimeouts = DEFAULT_VOLCENGINE_TIMEOUTS) {
    super(fetchFunction, {
      providerName: VOLCENGINE_PROVIDER_NAME,
      endpoint: { settingKey: VOLCENGINE_ENDPOINT_SETTING_KEY, label: VOLCENGINE_ENDPOINT_LABEL },
      streamEndpoint: { settingKey: VOLCENGINE_TEXT_ENDPOINT_SETTING_KEY, label: VOLCENGINE_TEXT_ENDPOINT_LABEL },
      timeouts
    });
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
    return this.postJsonRequest(context, path, body, {}, timeoutMs);
  }

  /** 接口路径不存在多半是地址填错，不算请求已通过鉴权。 */
  protected override isProbeAnswered(error: ProviderError): boolean {
    return super.isProbeAnswered(error) && error.code !== PATH_NOT_FOUND_CODE;
  }

  /** 把非 2xx 响应转换为带分类的错误：方舟的错误放在 error 对象里。 */
  protected override buildHttpError(status: number, payload: Record<string, unknown>): ProviderError {
    const error = readObject(payload.error);
    const code = typeof error.code === 'string' && error.code !== '' ? error.code : null;
    const message = typeof error.message === 'string' && error.message !== '' ? error.message : `HTTP ${status}`;
    const category = classifyArkErrorCode(code) ?? classifyHttpStatus(status);
    return new ProviderError(category, `${VOLCENGINE_PROVIDER_NAME}返回错误${code === null ? '' : `（${code}）`}：${message}`, { code });
  }
}
