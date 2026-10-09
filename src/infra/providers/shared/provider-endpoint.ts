// ------------------------------------------------------------------------
// 名称：provider-endpoint.ts
// 说明：各服务商适配器共用的接口地址处理：取设置里的接口地址，要求使用 https（本机回环地址除外），并去掉末尾的斜杠。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：请求会携带访问密钥，非 https 地址会让密钥明文发出，所以在发请求前拒绝；本机回环地址只在本机内通信，允许 http 以便接本地假服务调试。
// ------------------------------------------------------------------------

import { ProviderError } from '../../../domain/errors';

/** 允许使用 http 的本机回环主机名。 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * 校验并规范化接口地址。
 * @param endpoint 设置里保存的接口地址；未配置时为 undefined 或空串。
 * @param missingMessage 未配置时的提示。
 * @returns 去掉末尾斜杠的接口地址。
 * @throws ProviderError 未配置（invalid_request），或不是 https 地址、无法解析（invalid_request）。
 */
export function requireSecureEndpoint(endpoint: string | undefined, missingMessage: string): string {
  if (endpoint === undefined || endpoint === '') {
    throw new ProviderError('invalid_request', missingMessage);
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch (error) {
    throw new ProviderError('invalid_request', `接口地址无法识别：${endpoint}。请检查接口地址是否正确。`, { cause: error });
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new ProviderError('invalid_request', '接口地址必须以 https:// 开头，否则访问密钥会以明文发送。');
  }
  return endpoint.replace(/\/+$/, '');
}
