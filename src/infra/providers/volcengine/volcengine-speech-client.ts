// ------------------------------------------------------------------------
// 名称：volcengine-speech-client.ts
// 说明：豆包语音合成的 HTTP 客户端：以 Chunked 单向流式接口提交文本，读取逐行返回的 JSON，拼接出完整音频；并把 HTTP 状态和语音错误码统一转换为 ProviderError。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：豆包语音是火山引擎独立于方舟的产品，用豆包语音控制台创建的 API Key，通过 X-Api-Key 与 X-Api-Resource-Id 请求头鉴权，成功时以 code 20000000 的行结束；没有收到结束标记说明响应不完整，按网络故障处理；超时与流式读取由共用的传输层完成。
// ------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { ProviderError, ProviderFailure } from '../../../domain/errors';
import { ProviderCallContext } from '../../../domain/ports/provider-adapters';
import { requireSecureEndpoint } from '../shared/provider-endpoint';
import { FetchFunction, HttpTimeouts, ProviderHttpTransport } from '../shared/provider-http-transport';
import { readObject } from '../shared/provider-payload';
import { DEFAULT_VOLCENGINE_TIMEOUTS } from './volcengine-api-client';
import { VOLCENGINE_ENDPOINT_SETTING_KEY, VOLCENGINE_SPEECH_PROVIDER_NAME } from './volcengine-catalog';

/** 语音合成成功结束的状态码。 */
const SPEECH_FINISHED_CODE = 20_000_000;

/** 服务端通用错误的状态码下限：不小于它的错误按服务端错误处理。 */
const SPEECH_SERVER_ERROR_CODE_MIN = 50_000_000;

/** 语音合成说明文字里的名称。 */
const SPEECH_NAME = VOLCENGINE_SPEECH_PROVIDER_NAME;

/** 豆包语音合成 HTTP 客户端。 */
export class VolcengineSpeechClient {
  private readonly transport: ProviderHttpTransport;

  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   * @param timeouts 超时配置，缺省使用 DEFAULT_VOLCENGINE_TIMEOUTS。
   */
  constructor(fetchFunction: FetchFunction = fetch, timeouts: HttpTimeouts = DEFAULT_VOLCENGINE_TIMEOUTS) {
    this.transport = new ProviderHttpTransport(fetchFunction, { providerName: SPEECH_NAME, timeouts, buildHttpError });
  }

  /**
   * 合成语音并返回完整的音频内容。
   * @param context 调用凭据（豆包语音的 API Key）与设置；接口地址取自豆包语音的接口地址设置。
   * @param resourceId 资源标识（X-Api-Resource-Id），决定模型版本与计费方式，如 seed-tts-2.0。
   * @param body 请求体对象。
   * @throws ProviderError 网络失败、非 2xx 响应、平台返回错误码、没有音频，或响应不完整；调用方主动取消时原样抛出取消异常。
   */
  async synthesize(context: ProviderCallContext, resourceId: string, body: unknown): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let finished = false;
    const lines = this.transport.streamLines(readEndpoint(context), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'X-Api-Key': context.apiKey, 'X-Api-Resource-Id': resourceId, 'X-Api-Request-Id': randomUUID(), 'Content-Type': 'application/json' },
      signal: context.signal
    });
    for await (const line of lines) {
      const message = parseLine(line);
      const code = typeof message.code === 'number' ? message.code : 0;
      if (code === SPEECH_FINISHED_CODE) {
        finished = true;
        break;
      }
      if (code !== 0) {
        throw buildSpeechError(code, typeof message.message === 'string' ? message.message : '');
      }
      if (typeof message.data === 'string' && message.data !== '') {
        chunks.push(Buffer.from(message.data, 'base64'));
      }
    }
    if (!finished) {
      throw new ProviderError('network', `${SPEECH_NAME}的响应不完整，没有收到结束标记，请重试。`);
    }
    if (chunks.length === 0) {
      throw new ProviderError('server', `${SPEECH_NAME}没有返回音频。`);
    }
    return Buffer.concat(chunks);
  }
}

/** 取语音合成接口地址；未配置或不是 https 地址时在发请求前报参数错误。 */
function readEndpoint(context: ProviderCallContext): string {
  return requireSecureEndpoint(context.settings[VOLCENGINE_ENDPOINT_SETTING_KEY], `尚未配置${SPEECH_NAME}的接口地址。`);
}

/** 解析响应的一行 JSON；不是 JSON 对象时视为服务端异常。 */
function parseLine(line: string): Record<string, unknown> {
  try {
    return readObject(JSON.parse(line));
  } catch (error) {
    throw new ProviderError('server', `${SPEECH_NAME}返回了无法解析的内容。`, { cause: error });
  }
}

/** 按语音错误码和说明判断失败分类：并发限流、音色或资源未授权、服务端错误，其余为参数问题。 */
function classifySpeechError(code: number, message: string): ProviderFailure {
  if (/quota exceeded/i.test(message)) return 'rate_limited';
  if (/permission denied|access denied/i.test(message)) return 'auth';
  return code >= SPEECH_SERVER_ERROR_CODE_MIN ? 'server' : 'invalid_request';
}

/** 把平台返回的错误码转换为带分类的错误。 */
function buildSpeechError(code: number, message: string): ProviderError {
  return new ProviderError(classifySpeechError(code, message), `${SPEECH_NAME}返回错误（${code}）：${message === '' ? '未知错误' : message}`, { code: String(code) });
}

/** 把非 2xx 响应转换为带分类的错误：错误码与说明在顶层，或放在 header 对象里。 */
function buildHttpError(status: number, payload: Record<string, unknown>): ProviderError {
  const source = typeof payload.code === 'number' || typeof payload.message === 'string' ? payload : readObject(payload.header);
  const code = typeof source.code === 'number' ? source.code : null;
  const message = typeof source.message === 'string' && source.message !== '' ? source.message : `HTTP ${status}`;
  const codeText = code === null ? null : String(code);
  const category = classifyStatus(status);
  return new ProviderError(category, `${SPEECH_NAME}返回错误${code === null ? '' : `（${code}）`}：${message}`, { code: codeText });
}

/** 按 HTTP 状态判断失败分类。 */
function classifyStatus(status: number): ProviderFailure {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'server' : 'invalid_request';
}