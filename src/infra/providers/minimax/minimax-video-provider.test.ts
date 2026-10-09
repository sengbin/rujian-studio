// ------------------------------------------------------------------------
// 名称：minimax-video-provider.test.ts
// 说明：MiniMax H3 视频适配器的自动化测试：模型声明、请求校验、请求体构造、任务提交、查询、取消、测试连接与错误分类。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：注入假的 fetch，不访问网络；请求体与响应字段对照 MiniMax 开放平台“创建视频生成任务”“查询任务”“取消或删除任务”文档。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../domain/errors';
import { MediaInput, ProviderCallContext, VideoGenerationRequest } from '../../../domain/ports/provider-adapters';
import { FakeResponse, createFakeFetch } from '../shared/testing/fake-fetch';
import { MinimaxVideoProvider } from './minimax-video-provider';

const CONTEXT: ProviderCallContext = { apiKey: 'mm-test-key', settings: { endpoint: 'https://mm.test' } };
const H3 = 'MiniMax-H3';
const H3_MAX = 'MiniMax-H3-Max';
const CREATE = 'https://mm.test/v2/video_generation';
const QUERY = 'https://mm.test/v2/query/video_generation';

function createProvider(responses: FakeResponse[] = []) {
  const { fetchFunction, calls } = createFakeFetch(responses);
  return { calls, provider: new MinimaxVideoProvider(fetchFunction) };
}

function media(mimeType: string, size = 3): MediaInput {
  return { mimeType, data: new Uint8Array(size).fill(1) };
}

/** 一个最简合法请求（文生视频），测试按需覆盖字段。 */
function request(overrides: Partial<VideoGenerationRequest> = {}): VideoGenerationRequest {
  return {
    modelCode: H3,
    prompt: '一只猫在奔跑',
    firstFrame: null,
    lastFrame: null,
    referenceImages: [],
    referenceAudios: [],
    aspectRatio: '16:9',
    resolution: null,
    durationSeconds: 5,
    audioMode: null,
    seed: null,
    extraParams: {},
    ...overrides
  };
}

async function rejectedWith(action: Promise<unknown>): Promise<ProviderError> {
  try {
    await action;
  } catch (error) {
    assert.ok(error instanceof ProviderError, '应抛出 ProviderError');
    return error;
  }
  assert.fail('应抛出错误');
}

test('适配器声明：两个模型的分辨率与时长范围，始终带原生声音，不支持随机种子，支持取消', () => {
  const { provider } = createProvider();
  assert.deepEqual(provider.listModels().map((model) => model.code), [H3, H3_MAX]);
  assert.deepEqual(provider.getCapability(H3)?.resolutions, ['768P', '2K']);
  assert.deepEqual([provider.getCapability(H3)?.duration.min, provider.getCapability(H3)?.duration.max], [4, 15]);
  assert.deepEqual(provider.getCapability(H3_MAX)?.resolutions, ['480P', '768P']);
  assert.deepEqual([provider.getCapability(H3_MAX)?.duration.min, provider.getCapability(H3_MAX)?.duration.max], [5, 15]);
  for (const model of provider.listModels()) {
    assert.equal(model.capability.seed, false);
    assert.deepEqual(model.capability.audioModes, ['native']);
    assert.equal(model.capability.firstFrame && model.capability.lastFrame, true);
    assert.equal(model.capability.referenceImagesMax, 9);
    assert.equal(model.capability.audioInputMax?.count, 3);
  }
  assert.equal(provider.getCapability('nope'), undefined);
  assert.equal(typeof provider.cancel, 'function');
  assert.equal(provider.provider.code, 'minimax');
});

test('校验：合法请求没有问题；画幅、分辨率、时长、声音模式、种子超出能力时逐条指出', () => {
  const { provider } = createProvider();
  assert.deepEqual(provider.validate(request()), []);
  assert.deepEqual(provider.validate(request({ resolution: '2K', durationSeconds: 15, audioMode: 'native' })), []);
  assert.deepEqual(provider.validate(request({ modelCode: H3_MAX, resolution: '480P', durationSeconds: 5 })), []);

  assert.equal(provider.validate(request({ aspectRatio: '5:4', resolution: '4K', durationSeconds: 16, audioMode: 'none', seed: 1 })).length, 5);
  assert.match(provider.validate(request({ durationSeconds: 3 })).join(), /时长 3 秒/);
  assert.match(provider.validate(request({ durationSeconds: null })).join(), /必须指定视频时长/);
  assert.match(provider.validate(request({ durationSeconds: -1 })).join(), /时长 -1 秒/);
  assert.match(provider.validate(request({ modelCode: H3_MAX, durationSeconds: 4 })).join(), /时长 4 秒/);
  assert.match(provider.validate(request({ modelCode: H3_MAX, resolution: '2K' })).join(), /分辨率 2K/);
  assert.match(provider.validate(request({ aspectRatio: null })).join(), /纯文字生成视频必须指定画幅/);
  assert.deepEqual(provider.validate(request({ modelCode: 'x' })), ['MiniMax没有模型 x。']);
  assert.match(provider.validate(request({ prompt: ' ' })).join(), /提示词不能为空/);
  assert.match(provider.validate(request({ prompt: 'a'.repeat(7001) })).join(), /提示词不能超过 7000 字/);
});

test('校验：素材组合——尾帧可单独使用，首尾帧与参考素材互斥', () => {
  const { provider } = createProvider();
  const png = media('image/png');
  assert.deepEqual(provider.validate(request({ aspectRatio: null, firstFrame: png })), []);
  assert.deepEqual(provider.validate(request({ aspectRatio: null, lastFrame: png })), []);
  assert.deepEqual(provider.validate(request({ aspectRatio: null, firstFrame: png, lastFrame: png })), []);
  assert.deepEqual(provider.validate(request({ aspectRatio: null, referenceImages: [png], referenceAudios: [media('audio/mpeg')] })), []);
  assert.match(provider.validate(request({ firstFrame: png, referenceImages: [png] })).join(), /不能与参考图/);
  assert.match(provider.validate(request({ lastFrame: png, referenceAudios: [media('audio/wav')] })).join(), /不能与参考图/);
});

test('校验：图片格式与大小、参考图数量、参考音频数量、格式与大小', () => {
  const { provider } = createProvider();
  const png = media('image/png');
  assert.match(provider.validate(request({ referenceImages: Array.from({ length: 10 }, () => png) })).join(), /参考图最多 9 张/);
  assert.match(provider.validate(request({ referenceImages: [media('text/plain')] })).join(), /类型必须以 image\/ 开头/);
  assert.match(provider.validate(request({ firstFrame: media('image/gif') })).join(), /只支持 JPG、PNG、WEBP、HEIC、HEIF/);
  assert.match(provider.validate(request({ firstFrame: media('image/png', 31 * 1024 * 1024) })).join(), /大小必须在 1 字节到 30 MB/);

  const wav = media('audio/wav');
  assert.match(provider.validate(request({ referenceAudios: Array.from({ length: 4 }, () => wav) })).join(), /参考音频最多 3 段/);
  assert.match(provider.validate(request({ referenceAudios: [media('audio/mp4')] })).join(), /只支持 WAV、MP3/);
  assert.match(provider.validate(request({ referenceAudios: [media('audio/wav', 16 * 1024 * 1024)] })).join(), /大小必须在 1 字节到 15 MB/);

  const big = media('image/png', 20 * 1024 * 1024);
  assert.match(provider.validate(request({ referenceImages: [big, big, big] })).join(), /素材合计超过请求体上限 64 MB/);
});

test('提交：文生视频请求体含文本、默认分辨率与画幅，返回任务标识', async () => {
  const { provider, calls } = createProvider([{ body: { task_id: '424010985738629' } }]);
  const ref = await provider.submit(request(), CONTEXT);
  assert.deepEqual(ref, { modelCode: H3, remoteJobId: '424010985738629' });
  assert.equal(calls[0].url, CREATE);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer mm-test-key');
  assert.deepEqual(calls[0].body, {
    model: H3,
    content: [{ type: 'text', text: '一只猫在奔跑' }],
    resolution: '768P',
    duration: 5,
    ratio: '16:9',
    aigc_watermark: false
  });
});

test('提交：首尾帧按角色标注且画幅用 adaptive；参考素材按角色标注且画幅取请求值；水印可打开', async () => {
  const frames = createProvider([{ body: { task_id: 'a' } }]);
  await frames.provider.submit(request({ aspectRatio: null, firstFrame: media('image/png'), lastFrame: media('image/jpeg'), resolution: '2K', durationSeconds: 8, audioMode: 'native' }), CONTEXT);
  assert.deepEqual(frames.calls[0].body, {
    model: H3,
    content: [
      { type: 'text', text: '一只猫在奔跑' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQEB' }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQEB' }, role: 'last_frame' }
    ],
    resolution: '2K',
    duration: 8,
    ratio: 'adaptive',
    aigc_watermark: false
  });

  const lastOnly = createProvider([{ body: { task_id: 'b' } }]);
  await lastOnly.provider.submit(request({ aspectRatio: '9:16', lastFrame: media('image/png') }), CONTEXT);
  assert.equal((lastOnly.calls[0].body as { ratio: string }).ratio, 'adaptive');

  const references = createProvider([{ body: { task_id: 'c' } }]);
  await references.provider.submit(
    request({ referenceImages: [media('image/png')], referenceAudios: [media('audio/wav')], aspectRatio: '1:1', extraParams: { watermark: true } }),
    CONTEXT
  );
  assert.deepEqual(references.calls[0].body, {
    model: H3,
    content: [
      { type: 'text', text: '一只猫在奔跑' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQEB' }, role: 'reference_image' },
      { type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,AQEB' }, role: 'reference_audio' }
    ],
    resolution: '768P',
    duration: 5,
    ratio: '1:1',
    aigc_watermark: true
  });

  const adaptiveReferences = createProvider([{ body: { task_id: 'd' } }]);
  await adaptiveReferences.provider.submit(request({ aspectRatio: null, referenceImages: [media('image/png')] }), CONTEXT);
  assert.equal((adaptiveReferences.calls[0].body as { ratio: string }).ratio, 'adaptive');
});

test('提交失败：校验不过不发请求；没有任务标识、敏感内容、余额不足、限流按分类报告', async () => {
  const invalid = createProvider();
  assert.equal((await rejectedWith(invalid.provider.submit(request({ durationSeconds: null }), CONTEXT))).category, 'invalid_request');
  assert.equal(invalid.calls.length, 0);

  const noId = createProvider([{ body: {} }]);
  assert.equal((await rejectedWith(noId.provider.submit(request(), CONTEXT))).category, 'server');

  const sensitive = createProvider([{ status: 422, body: { type: 'error', error: { type: 'unprocessable_entity_error', message: 'video description contains sensitive content (1026)' } } }]);
  const sensitiveError = await rejectedWith(sensitive.provider.submit(request(), CONTEXT));
  assert.equal(sensitiveError.category, 'content_rejected');
  assert.equal(sensitiveError.code, '1026');

  const balance = createProvider([{ status: 402, body: { error: { type: 'insufficient_balance_error', message: 'insufficient balance (1008)' } } }]);
  assert.equal((await rejectedWith(balance.provider.submit(request(), CONTEXT))).category, 'auth');

  const limited = createProvider([{ status: 429, body: { error: { type: 'rate_limit_error', message: 'rate limit, please retry later (1002)' } } }]);
  assert.equal((await rejectedWith(limited.provider.submit(request(), CONTEXT))).category, 'rate_limited');
});

test('查询：排队、运行、成功（带视频地址与时长）、失败（带错误码分类）、已取消各映射为统一状态', async () => {
  const task = (fields: Record<string, unknown>) => ({ body: { task: { id: 't1', model: H3, ...fields } } });
  const { provider, calls } = createProvider([
    task({ status: 'queued' }),
    task({ status: 'running' }),
    task({ status: 'succeeded', content: { url: 'https://cdn.test/v.mp4' }, duration: 5 }),
    task({ status: 'failed', error: { code: '1026', message: 'sensitive' } }),
    task({ status: 'failed', error: { code: '9999', message: 'odd' } }),
    task({ status: 'cancelled' })
  ]);
  const ref = { modelCode: H3, remoteJobId: 't1' };

  assert.equal((await provider.query(ref, CONTEXT)).status, 'pending');
  assert.equal(calls[0].url, `${QUERY}/t1`);
  assert.equal(calls[0].method, 'GET');
  assert.equal((await provider.query(ref, CONTEXT)).status, 'running');
  assert.deepEqual(await provider.query(ref, CONTEXT), {
    status: 'succeeded',
    result: { videoUrl: 'https://cdn.test/v.mp4', durationSeconds: 5 },
    errorCategory: null,
    errorCode: null,
    errorMessage: null
  });
  assert.deepEqual(await provider.query(ref, CONTEXT), { status: 'failed', result: null, errorCategory: 'content_rejected', errorCode: '1026', errorMessage: 'sensitive' });
  assert.equal((await provider.query(ref, CONTEXT)).errorCategory, 'server');
  assert.equal((await provider.query(ref, CONTEXT)).status, 'canceled');
});

test('查询：状态无法识别、成功但没有视频地址时按服务端错误报告', async () => {
  const unknown = createProvider([{ body: { task: { status: 'weird' } } }]);
  assert.match((await rejectedWith(unknown.provider.query({ modelCode: H3, remoteJobId: 't' }, CONTEXT))).message, /无法识别的任务状态/);

  const noUrl = createProvider([{ body: { task: { status: 'succeeded', content: {} } } }]);
  assert.match((await rejectedWith(noUrl.provider.query({ modelCode: H3, remoteJobId: 't' }, CONTEXT))).message, /没有返回视频地址/);
});

test('取消：向任务地址发 DELETE；测试连接：查询不存在的任务，业务错误说明可用，鉴权失败按分类报告', async () => {
  const cancel = createProvider([{ body: { task_id: 't1', action: 'cancelled', status: 'cancelled' } }]);
  await cancel.provider.cancel({ modelCode: H3, remoteJobId: 't1' }, CONTEXT);
  assert.deepEqual([cancel.calls[0].method, cancel.calls[0].url], ['DELETE', CREATE + '/t1']);

  const reachable = createProvider([{ status: 400, body: { type: 'error', error: { type: 'bad_request_error', message: 'invalid task_id (2013)' } } }]);
  await reachable.provider.checkConnection(CONTEXT);
  assert.equal(reachable.calls[0].url, `${QUERY}/0`);

  const badKey = createProvider([{ status: 401, body: { error: { type: 'authorized_error', message: 'login fail (1004)' } } }]);
  assert.equal((await rejectedWith(badKey.provider.checkConnection(CONTEXT))).category, 'auth');
});
