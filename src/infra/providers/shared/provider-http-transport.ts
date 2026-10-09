// ------------------------------------------------------------------------
// 名称：provider-http-transport.ts
// 说明：各服务商 HTTP 客户端共用的传输层：带超时的 JSON 请求、按行读取的流式响应与 SSE 事件读取，并把网络错误、超时和非 2xx 响应统一转换为 ProviderError。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：不含任何服务商的地址、鉴权和错误码规则，这些由各服务商的客户端通过选项注入；fetch 与超时可注入以便测试；普通请求总超时，流式请求空闲超时，并都与调用方的取消信号合并；网络错误消息只含固定说明与脱敏摘要，不含地址与访问密钥，也不携带原始异常。
// ------------------------------------------------------------------------

import { ProviderError } from '../../../domain/errors';

/** 可注入的 fetch 函数类型。 */
export type FetchFunction = typeof fetch;

/** 请求超时配置，单位为毫秒；测试时可注入更短的值。 */
export interface HttpTimeouts {
  /** 普通请求（提交、查询、取消、测试连接）从发起到读完响应的总超时。 */
  readonly requestMs: number;
  /** 流式请求的空闲超时：连续这么久没有收到任何数据就中止。 */
  readonly streamIdleMs: number;
}

/** 传输层的选项。 */
export interface HttpTransportOptions {
  /** 服务商显示名称，用于超时、断连等说明，如“千问AI平台”。 */
  readonly providerName: string;
  readonly timeouts: HttpTimeouts;
  /** 把非 2xx 响应转换为带分类的错误；payload 为响应体解析出的对象，解析失败时为空对象。 */
  readonly buildHttpError: (status: number, payload: Record<string, unknown>) => ProviderError;
}

/** 一次请求的内容。 */
export interface HttpRequest {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  /** 调用方的取消信号。 */
  readonly signal?: AbortSignal;
  /** 覆盖普通请求的总超时（毫秒）；上传大素材或同步生成时使用，缺省取 timeouts.requestMs。 */
  readonly timeoutMs?: number;
}

/** 每秒的毫秒数，用于把超时毫秒数换算为说明文字里的秒数。 */
const MS_PER_SECOND = 1000;

/** 网络错误摘要的最大长度（字符数）。 */
const NETWORK_SUMMARY_MAX_LENGTH = 120;

/** 底层系统错误码的格式，如 ECONNREFUSED、ENOTFOUND。 */
const SYSTEM_ERROR_CODE_PATTERN = /^E[A-Z0-9_]{2,}$/;

/** 脱敏后替换密钥类内容、地址类内容的占位文字。 */
const REDACTED_SECRET = '[已隐藏]';
const REDACTED_ADDRESS = '[地址]';

/** 摘要为空时的说明。 */
const UNKNOWN_ERROR_TEXT = '未知错误';

/** 脱敏规则，按顺序应用：把可能含密钥、地址的片段替换为占位文字。 */
const REDACTIONS: ReadonlyArray<readonly [pattern: RegExp, replacement: string]> = [
  [/\bBearer\s+\S+/gi, REDACTED_SECRET],
  [/\b(?:api[_-]?key|access[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi, REDACTED_SECRET],
  [/\bsk-[A-Za-z0-9_-]{6,}/g, REDACTED_SECRET],
  [/https?:\/\/\S*/gi, REDACTED_ADDRESS],
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, REDACTED_ADDRESS],
  [/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?/gi, REDACTED_ADDRESS],
  [/\?\S*/g, ''],
  [/[A-Za-z0-9_+/=-]{32,}/g, REDACTED_SECRET]
];

/** 服务商 HTTP 请求的传输层。 */
export class ProviderHttpTransport {
  /**
   * @param fetchFunction 发起网络请求的函数，测试时可注入假实现。
   * @param options 服务商名称、超时与错误转换。
   */
  constructor(
    private readonly fetchFunction: FetchFunction,
    private readonly options: HttpTransportOptions
  ) {}

  /**
   * 发起请求并读取 JSON 对象响应。
   * @param url 完整请求地址。
   * @param request 请求内容。
   * @returns 响应的 JSON 对象；响应体为空或不是对象时为空对象。
   * @throws ProviderError 网络失败、超时或非 2xx 响应；调用方主动取消时原样抛出取消异常。
   */
  async requestJson(url: string, request: HttpRequest): Promise<Record<string, unknown>> {
    const timeoutMs = request.timeoutMs ?? this.options.timeouts.requestMs;
    // 默认超时覆盖连接与读取响应体的全过程；调用方传入的取消信号与它合并，任何一个触发都会中止请求。
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout]);
    try {
      const response = await this.fetchFunction(url, { method: request.method, headers: { ...request.headers }, body: request.body, signal });
      const payload = await readJsonObject(response);
      if (!response.ok) {
        throw this.options.buildHttpError(response.status, payload);
      }
      return payload;
    } catch (error) {
      throw this.toRequestFailure(error, { cancelSignal: request.signal, timedOutMs: timeout.aborted ? timeoutMs : null, action: `无法连接${this.options.providerName}` });
    }
  }

  /**
   * 提交请求并逐行读取响应体（已去除首尾空白，跳过空行），连接可持续任意长时间。
   * 超时按“空闲”计算：从发起请求到收到响应头、以及之后每次等待下一段数据，连续超过 streamIdleMs 没有任何数据就中止；
   * 只要数据持续到达，生成多久都不会超时（流式生成总时长不定，不能套用短的总超时）。
   * @param url 完整请求地址。
   * @param request 请求内容；其 timeoutMs 不生效。
   * @throws ProviderError 网络失败、请求超时、非 2xx 响应，或读取流时中断；调用方主动取消时原样抛出取消异常。
   */
  async *streamLines(url: string, request: HttpRequest): AsyncGenerator<string> {
    const idle = new IdleTimeout(request.signal, this.options.timeouts.streamIdleMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      idle.arm();
      const response = await this.fetchFunction(url, { method: request.method, headers: { ...request.headers }, body: request.body, signal: idle.signal });
      if (!response.ok) {
        throw this.options.buildHttpError(response.status, await readJsonObject(response));
      }
      idle.clear();
      if (response.body === null) {
        throw new ProviderError('server', `${this.options.providerName}没有返回内容。`);
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        // 只在等待数据时计时；产出一行后调用方处理的时间不算。
        idle.arm();
        const { done, value } = await reader.read();
        idle.clear();
        buffer += decoder.decode(value, { stream: !done });
        // 以换行分隔；最后一段没有换行结尾时在流结束后一并处理。
        const lines = buffer.split('\n');
        buffer = done ? '' : (lines.pop() ?? '');
        for (const line of lines) {
          const text = line.trim();
          if (text !== '') {
            yield text;
          }
        }
        if (done) {
          return;
        }
      }
    } catch (error) {
      throw this.toRequestFailure(error, {
        cancelSignal: request.signal,
        timedOutMs: idle.timedOut ? this.options.timeouts.streamIdleMs : null,
        action: `读取${this.options.providerName}的响应时中断`
      });
    } finally {
      idle.clear();
      await reader?.cancel().catch(() => undefined);
    }
  }

  /**
   * 提交请求并逐条产出 SSE 事件的 data 内容（不含 `[DONE]` 结束标记）。
   * @param url 完整请求地址。
   * @param request 请求内容。
   * @throws ProviderError 同 streamLines。
   */
  async *streamEvents(url: string, request: HttpRequest): AsyncGenerator<string> {
    for await (const line of this.streamLines(url, request)) {
      const data = readDataLine(line);
      if (data === '[DONE]') {
        return;
      }
      if (data !== null) {
        yield data;
      }
    }
  }

  /**
   * 把请求过程中的异常转换为要抛出的错误：
   * 已是 ProviderError 的原样返回；调用方主动取消的原样返回（不属于服务商故障）；超时转为可重试的 network 类错误；
   * 其余转为 network 类错误，消息只含固定说明与脱敏摘要，不携带原始异常，避免地址、密钥等经 cause 暴露到界面。
   */
  private toRequestFailure(error: unknown, failure: RequestFailureContext): unknown {
    if (error instanceof ProviderError) {
      return error;
    }
    if (failure.cancelSignal?.aborted === true) {
      // 调用方的信号可能是 AbortSignal.timeout（如测试连接自带的超时），其原因为 TimeoutError，按超时处理；其余是主动取消，原样抛出。
      return isTimeoutReason(failure.cancelSignal.reason) ? new ProviderError('network', `请求超时：${this.options.providerName}没有在限定时间内响应。`) : error;
    }
    if (failure.timedOutMs !== null) {
      return new ProviderError('network', `请求超时：${this.options.providerName}在 ${Math.ceil(failure.timedOutMs / MS_PER_SECOND)} 秒内没有响应。`);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return error;
    }
    return new ProviderError('network', `${failure.action}：${summarizeNetworkError(error)}`);
  }
}

/** 请求失败的判断依据。 */
interface RequestFailureContext {
  /** 调用方传入的取消信号。 */
  readonly cancelSignal: AbortSignal | undefined;
  /** 已因超时中止时为超时毫秒数，否则为 null。 */
  readonly timedOutMs: number | null;
  /** 失败说明的固定前缀，如“无法连接千问AI平台”。 */
  readonly action: string;
}

/** 流式请求的空闲超时：计时器在等待数据期间运行，超时即中止请求；同时合并调用方的取消信号。 */
class IdleTimeout {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private fired = false;
  /** 传给 fetch 的信号：调用方取消或空闲超时任一触发都会中止。 */
  readonly signal: AbortSignal;

  constructor(
    cancelSignal: AbortSignal | undefined,
    private readonly timeoutMs: number
  ) {
    this.signal = cancelSignal === undefined ? this.controller.signal : AbortSignal.any([cancelSignal, this.controller.signal]);
  }

  /** 是否因空闲超时而中止。 */
  get timedOut(): boolean {
    return this.fired;
  }

  /** 开始（或重新开始）计时。 */
  arm(): void {
    this.clear();
    this.timer = setTimeout(() => {
      this.fired = true;
      this.controller.abort();
    }, this.timeoutMs);
  }

  /** 停止计时。 */
  clear(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

/** 判断信号中止的原因是否为超时（AbortSignal.timeout 触发时为名为 TimeoutError 的异常）。 */
function isTimeoutReason(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'TimeoutError';
}

/**
 * 生成网络错误的脱敏摘要：取异常说明，去掉地址、查询串和形如密钥的内容，附上底层错误码（如 ECONNREFUSED），并限制长度。
 * @param error 请求过程中抛出的异常。
 */
function summarizeNetworkError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = REDACTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), raw)
    .replace(/\s+/g, ' ')
    .trim();
  const summary = redacted.length > NETWORK_SUMMARY_MAX_LENGTH ? `${redacted.slice(0, NETWORK_SUMMARY_MAX_LENGTH)}…` : redacted;
  const text = summary === '' ? UNKNOWN_ERROR_TEXT : summary;
  const code = readSystemErrorCode(error);
  return code === null ? text : `${text}（${code}）`;
}

/** 取底层系统错误码（如 ECONNREFUSED、ENOTFOUND），从异常本身或其 cause 中查找；没有时返回 null。 */
function readSystemErrorCode(error: unknown): string | null {
  for (const candidate of [error, error instanceof Error ? error.cause : undefined]) {
    const code = typeof candidate === 'object' && candidate !== null ? (candidate as { code?: unknown }).code : undefined;
    if (typeof code === 'string' && SYSTEM_ERROR_CODE_PATTERN.test(code)) {
      return code;
    }
  }
  return null;
}

/** 读取 SSE 的一行；不是非空的 data 行时返回 null。 */
function readDataLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) {
    return null;
  }
  const data = trimmed.slice('data:'.length).trim();
  return data === '' ? null : data;
}

/** 读取响应体并解析为 JSON 对象；响应体为空或不是对象时返回空对象。 */
async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
