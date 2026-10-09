// ------------------------------------------------------------------------
// 名称：fake-qianwen.js
// 说明：真实调用核对脚本使用的假千问接口：拦截全局 fetch，模拟文本（流式对话）、视频、图像（异步任务）与音频（同步）接口以及结果文件下载，用于不访问网络、不花费额度地验证生成工作台与资产生成。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：行为约定：访问密钥必须以 sk- 开头，否则返回 401；无图文本请求按 JSON Schema 返回正文，带图请求通过工具调用返回；提示词包含“违规”时失败并返回内容审核错误；任务经过排队、生成中后成功；图片结果为纯色 PNG（每张颜色不同），音频结果为 2 秒的 WAV，视频结果为 2 秒的小视频（fake-video.mp4）；其他地址的请求交给真实的 fetch。
// ------------------------------------------------------------------------

'use strict';

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { createResponder } = require('./text-responder');

/** 文本接口的模拟行为：textMode 可为 normal、slow、fail。 */
const state = { textMode: 'normal', textDelayMs: 300 };

/** 假视频：2 秒、160×90 的 VP9 小视频，浏览器可解码，用于验证尾帧截取。 */
const FAKE_VIDEO_FILE = path.join(__dirname, 'fake-video.mp4');

const CHAT_PATH = '/compatible-mode/v1/chat/completions';
const CREATE_PATH = '/services/aigc/video-generation/video-synthesis';
const IMAGE_CREATE_PATH = '/services/aigc/image-generation/generation';
const AUDIO_PATHS = ['/services/audio/tts/SpeechSynthesizer', '/services/audio/music/generation'];
const TASK_PATH = /\/tasks\/([^/?]+)$/;
const FAKE_RESULT_HOST = 'https://fake-oss.example.com/';
/** 查询到最终结果之前经历的状态。 */
const PENDING_POLLS = 1;
const RUNNING_POLLS = 1;
/** 假图片的尺寸与调色板：每张图一种颜色，便于在版本层区分。 */
const IMAGE_SIZE = 256;
const IMAGE_COLORS = [
  [214, 96, 77],
  [67, 147, 195],
  [102, 189, 99],
  [244, 165, 130],
  [146, 197, 222],
  [171, 130, 255]
];
/** 假音频：16 位单声道 WAV，时长与采样率。 */
const AUDIO_SECONDS = 2;
const AUDIO_SAMPLE_RATE = 8000;

let crcTable = null;

/** 计算 PNG 块使用的 CRC32。 */
function crc32(buffer) {
  if (crcTable === null) {
    crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 组装一个 PNG 数据块。 */
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** 生成一张纯色（带对角渐变）的 PNG。 */
function makePng(index) {
  const [red, green, blue] = IMAGE_COLORS[index % IMAGE_COLORS.length];
  const header = Buffer.alloc(13);
  header.writeUInt32BE(IMAGE_SIZE, 0);
  header.writeUInt32BE(IMAGE_SIZE, 4);
  header[8] = 8;
  header[9] = 2;
  const stride = IMAGE_SIZE * 3 + 1;
  const raw = Buffer.alloc(stride * IMAGE_SIZE);
  for (let y = 0; y < IMAGE_SIZE; y += 1) {
    for (let x = 0; x < IMAGE_SIZE; x += 1) {
      const shade = 0.6 + (0.4 * (x + y)) / (2 * IMAGE_SIZE);
      const offset = y * stride + 1 + x * 3;
      raw[offset] = Math.round(red * shade);
      raw[offset + 1] = Math.round(green * shade);
      raw[offset + 2] = Math.round(blue * shade);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/** 生成一段 440Hz 的 WAV。 */
function makeWav() {
  const samples = AUDIO_SECONDS * AUDIO_SAMPLE_RATE;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(AUDIO_SAMPLE_RATE, 24);
  buffer.writeUInt32LE(AUDIO_SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) {
    buffer.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / AUDIO_SAMPLE_RATE)), 44 + i * 2);
  }
  return buffer;
}

/** 以 JSON 响应。 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** 读取请求头（兼容 Headers 与普通对象）。 */
function readHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : headers[key];
}

/** 取出图片任务请求中的文本提示词（文本在 messages[0].content 的 text 项里）。 */
function readImagePrompt(body) {
  const content = body.input?.messages?.[0]?.content;
  const item = Array.isArray(content) ? content.find((entry) => typeof entry.text === 'string') : undefined;
  return item ? item.text : '';
}

/** 取出对话请求中所有消息的文本，拼成完整提示词。 */
function readChatPrompt(body) {
  return (body.messages ?? [])
    .flatMap((message) => (Array.isArray(message.content) ? message.content : [{ text: message.content }]))
    .map((part) => part.text)
    .filter((text) => typeof text === 'string')
    .join('\n');
}

/** 等待指定毫秒；请求被取消时立即抛出取消错误。 */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Canceled'), { name: 'AbortError' }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
  });
}

/** 把若干事件对象写成流式响应，以 [DONE] 结束。 */
function eventStreamResponse(events) {
  const raw = [...events.map((event) => `data: ${JSON.stringify(event)}\n\n`), 'data: [DONE]\n\n'].join('');
  return new Response(raw, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** 安装假的千问接口。 */
function installFakeQianwen() {
  const realFetch = globalThis.fetch;
  const tasks = new Map();
  let nextTaskNumber = 1;

  const respond = createResponder();

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method ?? 'GET').toUpperCase();

    if (url.startsWith(FAKE_RESULT_HOST)) {
      if (url.includes('.png')) return new Response(makePng(Number(/-(\d+)\.png/.exec(url)?.[1] ?? 0)), { status: 200 });
      if (url.includes('.wav')) return new Response(makeWav(), { status: 200 });
      return new Response(fs.readFileSync(FAKE_VIDEO_FILE), { status: 200 });
    }

    const authorized = String(readHeader(init.headers, 'Authorization') ?? '').startsWith('Bearer sk-');

    // 无图文本请求使用 JSON Schema 正文；带图请求继续使用强制工具调用。
    if (url.endsWith(CHAT_PATH) && method === 'POST') {
      if (!authorized) return jsonResponse({ error: { code: 'invalid_api_key', message: 'Invalid API-key provided.' } }, 401);
      if (state.textMode === 'fail') return jsonResponse({ error: { code: 'internal_error', message: '模拟的调用失败' } }, 500);
      const body = JSON.parse(init.body);
      await delay(state.textMode === 'slow' ? state.textDelayMs * 6 : state.textDelayMs, init.signal);
      const tool = body.tools?.[0]?.function;
      const output = respond(readChatPrompt(body));
      if (body.response_format?.type === 'json_schema') {
        return eventStreamResponse([
          { choices: [{ index: 0, delta: { content: output }, finish_reason: null }] },
          { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
        ]);
      }
      return eventStreamResponse([
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: tool?.name ?? '', arguments: output } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
      ]);
    }

    if (url.includes('/api/v1') && url.endsWith(IMAGE_CREATE_PATH) && method === 'POST') {
      if (!authorized) return jsonResponse({ code: 'InvalidApiKey', message: 'Invalid API-key provided.' }, 401);
      const body = JSON.parse(init.body);
      const taskId = `fake-image-${nextTaskNumber++}`;
      tasks.set(taskId, { kind: 'image', prompt: readImagePrompt(body), count: body.parameters?.n ?? 1, polls: 0 });
      return jsonResponse({ request_id: `request-${taskId}`, output: { task_id: taskId, task_status: 'PENDING' } });
    }

    // 音频接口是同步的：直接返回音频地址与时长。
    if (url.includes('/api/v1') && AUDIO_PATHS.some((path) => url.endsWith(path)) && method === 'POST') {
      if (!authorized) return jsonResponse({ code: 'InvalidApiKey', message: 'Invalid API-key provided.' }, 401);
      const body = JSON.parse(init.body);
      const prompt = String(body.input?.text_prompt ?? body.input?.prompt ?? '');
      if (prompt.includes('违规')) {
        return jsonResponse({ code: 'DataInspectionFailed', message: 'Input data may contain inappropriate content.' }, 400);
      }
      return jsonResponse({
        request_id: `request-audio-${nextTaskNumber++}`,
        output: { audio: { url: `${FAKE_RESULT_HOST}audio-${nextTaskNumber}.wav?Expires=1`, duration: AUDIO_SECONDS } },
        usage: { duration: AUDIO_SECONDS }
      });
    }

    if (url.includes('/api/v1') && url.endsWith(CREATE_PATH) && method === 'POST') {
      if (!authorized) {
        return jsonResponse({ code: 'InvalidApiKey', message: 'Invalid API-key provided.' }, 401);
      }
      const body = JSON.parse(init.body);
      const taskId = `fake-task-${nextTaskNumber++}`;
      tasks.set(taskId, { kind: 'video', prompt: String(body.input?.prompt ?? ''), duration: body.parameters?.duration, polls: 0 });
      return jsonResponse({ request_id: `request-${taskId}`, output: { task_id: taskId, task_status: 'PENDING' } });
    }

    const taskMatch = TASK_PATH.exec(url);
    if (url.includes('/api/v1') && taskMatch && method === 'GET') {
      if (!authorized) return jsonResponse({ code: 'InvalidApiKey', message: 'Invalid API-key provided.' }, 401);
      const task = tasks.get(decodeURIComponent(taskMatch[1]));
      if (task === undefined) {
        return jsonResponse({ code: 'InvalidParameter', message: 'task not found' }, 404);
      }
      task.polls += 1;
      if (task.polls <= PENDING_POLLS) return jsonResponse({ output: { task_status: 'PENDING' } });
      if (task.polls <= PENDING_POLLS + RUNNING_POLLS) return jsonResponse({ output: { task_status: 'RUNNING' } });
      if (task.prompt.includes('违规')) {
        return jsonResponse({
          output: { task_status: 'FAILED', code: 'DataInspectionFailed', message: 'Input data may contain inappropriate content.' }
        });
      }
      if (task.kind === 'image') {
        const results = Array.from({ length: task.count }, (_, index) => ({ url: `${FAKE_RESULT_HOST}${taskMatch[1]}-${index}.png?Expires=1` }));
        return jsonResponse({ output: { task_status: 'SUCCEEDED', results } });
      }
      return jsonResponse({
        output: { task_status: 'SUCCEEDED', video_url: `${FAKE_RESULT_HOST}${taskMatch[1]}.mp4?Expires=1` },
        usage: { output_video_duration: task.duration > 0 ? task.duration : 5 }
      });
    }

    return realFetch(input, init);
  };
}

module.exports = { installFakeQianwen };
