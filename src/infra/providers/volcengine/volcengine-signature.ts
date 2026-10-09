// ------------------------------------------------------------------------
// 名称：volcengine-signature.ts
// 说明：火山引擎 OpenAPI 的 HMAC-SHA256 请求签名：用 AccessKey/SecretKey 为请求生成带 Authorization 的完整请求头。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：签名流程为规范请求 → 待签字符串 → 逐级派生签名密钥（日期、地域、服务、request）；参与签名的头为 content-type、host、x-content-sha256、x-date；时间可注入以便测试。
// ------------------------------------------------------------------------

import { createHash, createHmac } from 'node:crypto';

/** 签名算法名称。 */
const ALGORITHM = 'HMAC-SHA256';

/** 参与签名的请求头（小写，已按字典序）。 */
const SIGNED_HEADERS = 'content-type;host;x-content-sha256;x-date';

/** 待签名的请求。 */
export interface SignableRequest {
  readonly method: 'GET' | 'POST';
  readonly host: string;
  /** 查询参数，如 Action 与 Version。 */
  readonly query: Readonly<Record<string, string>>;
  readonly body: string;
  readonly region: string;
  readonly service: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly now: Date;
}

/** 签名后的请求：完整地址与请求头。 */
export interface SignedRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, text: string): Buffer {
  return createHmac('sha256', key).update(text, 'utf8').digest();
}

/** 按 RFC 3986 编码：保留字母数字与 -_.~，其余按 UTF-8 百分号编码。 */
function encodeRfc3986(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** 规范查询串：参数名按字典序，名与值都编码。 */
function canonicalQuery(query: Readonly<Record<string, string>>): string {
  return Object.keys(query)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(query[key])}`)
    .join('&');
}

/**
 * 为请求生成签名与请求头。
 * @param request 待签名的请求。
 */
export function signVolcengineRequest(request: SignableRequest): SignedRequest {
  const xDate = request.now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const shortDate = xDate.slice(0, 8);
  const contentSha256 = sha256Hex(request.body);
  const contentType = 'application/json';
  const queryString = canonicalQuery(request.query);

  const canonicalHeaders = `content-type:${contentType}\nhost:${request.host}\nx-content-sha256:${contentSha256}\nx-date:${xDate}\n`;
  const canonicalRequest = [request.method, '/', queryString, canonicalHeaders, SIGNED_HEADERS, contentSha256].join('\n');

  const credentialScope = `${shortDate}/${request.region}/${request.service}/request`;
  const stringToSign = [ALGORITHM, xDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(request.secretAccessKey, shortDate), request.region), request.service), 'request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    url: `https://${request.host}/?${queryString}`,
    headers: {
      'Content-Type': contentType,
      'X-Content-Sha256': contentSha256,
      'X-Date': xDate,
      Authorization: `${ALGORITHM} Credential=${request.accessKeyId}/${credentialScope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`
    }
  };
}
