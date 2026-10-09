// ------------------------------------------------------------------------
// 名称：volcengine-video-provider.test.ts
// 说明：火山引擎 Seedance 视频适配器的自动化测试：模型声明、请求校验、请求体构造、任务提交、查询、取消、测试连接与错误分类。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：注入假的 fetch，不访问网络；请求体与响应字段对照方舟“创建视频生成任务 API”“查询视频生成任务”“取消或删除视频生成任务”文档。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../domain/errors';
import { MediaInput, ProviderCallContext, VideoGenerationRequest } from '../../../domain/ports/provider-adapters';
import { FakeResponse, createFakeFetch } from '../shared/testing/fake-fetch';
import { VolcengineVideoProvider } from './volcengine-video-provider';

const CONTEXT: ProviderCallContext = { apiKey: 'ark-test-key', settings: { endpoint: 'https://ark.test/api/v3' } };
const V25 = 'doubao-seedance-2-5-260628';
const V20 = 'doubao-seedance-2-0-260128';
const TASKS = 'https://ark.test/api/v3/contents/generations/tasks';

function createProvider(responses: FakeResponse[] = []) {
  const { fetchFunction, calls } = createFakeFetch(responses);
  return { calls, provider: new VolcengineVideoProvider(fetchFunction) };
}

function media(mimeType: string, size = 3): MediaInput {
  return { mimeType, data: new Uint8Array(size).fill(1) };
}

/** 一个最简合法请求，测试按需覆盖字段。 */
function request(overrides: Partial<VideoGenerationRequest> = {}): VideoGenerationRequest {
  return {
    modelCode: V20,
    prompt: '一只猫在奔跑',
    firstFrame: null,
    lastFrame: null,
    referenceImages: [],
    referenceAudios: [],
    aspectRatio: null,
    resolution: null,
    durationSeconds: null,
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

test('适配器声明：模型清单与能力，不支持随机种子与提示词改写，支持取消', () => {
  const { provider } = createProvider();
  assert.deepEqual(provider.listModels().map((model) => model.code), [V25, V20, 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-mini-260615']);
  const v25 = provider.getCapability(V25);
  assert.deepEqual([v25?.duration.min, v25?.duration.max, v25?.duration.allowAuto, v25?.referenceImagesMax, v25?.audioInputMax?.count], [4, 30, true, 30, 10]);
  assert.deepEqual(provider.getCapability(V20)?.resolutions, ['480P', '720P', '1080P', '4K']);
  assert.deepEqual(provider.getCapability('doubao-seedance-2-0-fast-260128')?.resolutions, ['480P', '720P']);
  for (const model of provider.listModels()) {
    assert.equal(model.capability.seed, false);
    assert.equal(model.capability.promptExtend, undefined);
    assert.deepEqual(model.capability.fps, [24]);
  }
  assert.equal(provider.getCapability('nope'), undefined);
  assert.equal(typeof provider.cancel, 'function');
  assert.equal(provider.provider.code, 'volcengine');
});

test('校验：合法请求没有问题；画幅、分辨率、时长、声音、种子超出能力时逐条指出', () => {
  const { provider } = createProvider();
  assert.deepEqual(provider.validate(request()), []);
  assert.deepEqual(provider.validate(request({ aspectRatio: '16:9', resolution: '4K', durationSeconds: 15, audioMode: 'none' })), []);
  assert.deepEqual(provider.validate(request({ durationSeconds: -1 })), [], '智能时长');
  assert.deepEqual(provider.validate(request({ modelCode: V25, durationSeconds: 30, resolution: '1080P' })), []);

  const issues = provider.validate(request({ aspectRatio: '5:4', resolution: '8K', durationSeconds: 16, seed: 1 }));
  assert.equal(issues.length, 4);
  assert.ok(provider.validate(request({ durationSeconds: 3 })).length === 1, '低于最短 4 秒');
  assert.ok(provider.validate(request({ durationSeconds: 4.5 })).length === 1, '必须是整数秒');
  assert.ok(provider.validate(request({ modelCode: 'doubao-seedance-2-0-fast-260128', resolution: '1080P' })).length === 1, 'Fast 不支持 1080P');
  assert.ok(provider.validate(request({ modelCode: V25, resolution: '4K' })).length === 1, '2.5 不支持 4K');
  assert.deepEqual(provider.validate(request({ modelCode: 'x' })), ['火山引擎没有模型 x。']);
  assert.match(provider.validate(request({ prompt: 'a'.repeat(4001) })).join(), /提示词不能超过 4000 字/);
});

test('校验：素材组合——尾帧须配首帧，首尾帧与参考素材互斥，提示词与素材至少一项', () => {
  const { provider } = createProvider();
  const png = media('image/png');
  assert.deepEqual(provider.validate(request({ firstFrame: png })), []);
  assert.deepEqual(provider.validate(request({ firstFrame: png, lastFrame: png })), []);
  assert.deepEqual(provider.validate(request({ referenceImages: [png], referenceAudios: [media('audio/mpeg')] })), []);
  assert.match(provider.validate(request({ lastFrame: png })).join(), /同时指定首帧/);
  assert.match(provider.validate(request({ firstFrame: png, referenceImages: [png] })).join(), /不能与参考图/);
  assert.match(provider.validate(request({ prompt: '  ' })).join(), /至少要提供一项/);
  assert.deepEqual(provider.validate(request({ prompt: '', firstFrame: png })), [], '只有素材也可以');
});

test('校验：参考图数量与格式、参考音频数量、格式与大小；2.0 系列不能只传音频，2.5 可以', () => {
  const { provider } = createProvider();
  const png = media('image/png');
  assert.match(provider.validate(request({ referenceImages: Array.from({ length: 10 }, () => png) })).join(), /参考图最多 9 张/);
  assert.deepEqual(provider.validate(request({ modelCode: V25, referenceImages: Array.from({ length: 30 }, () => png) })), []);
  assert.match(provider.validate(request({ referenceImages: [media('text/plain')] })).join(), /类型必须以 image\/ 开头/);
  assert.match(provider.validate(request({ firstFrame: media('image/png', 31 * 1024 * 1024) })).join(), /大小必须在 1 字节到 30 MB/);

  const wav = media('audio/wav');
  assert.match(provider.validate(request({ referenceImages: [png], referenceAudios: Array.from({ length: 4 }, () => wav) })).join(), /参考音频最多 3 段/);
  assert.match(provider.validate(request({ referenceImages: [png], referenceAudios: [media('audio/mp4')] })).join(), /只支持 WAV、MP3/);
  assert.match(provider.validate(request({ referenceImages: [png], referenceAudios: [media('audio/wav', 16 * 1024 * 1024)] })).join(), /大小必须在 1 字节到 15 MB/);
  assert.match(provider.validate(request({ referenceAudios: [wav] })).join(), /不能只传参考音频/);
  assert.deepEqual(provider.validate(request({ modelCode: V25, referenceAudios: [wav] })), []);
});

test('校验：素材合计超过 64 MB 请求体上限时拒绝', () => {
  const { provider } = createProvider();
  const big = media('image/png', 20 * 1024 * 1024);
  assert.match(provider.validate(request({ referenceImages: [big, big, big] })).join(), /素材合计超过请求体上限 64 MB/);
  assert.deepEqual(provider.validate(request({ referenceImages: [big, big] })), []);
});

test('提交：请求体按素材角色构造，分辨率转小写，水印关闭，返回任务标识', async () => {
  const { provider, calls } = createProvider([{ body: { id: 'cgt-1' } }]);
  const ref = await provider.submit(
    request({ modelCode: V25, firstFrame: media('image/png'), lastFrame: media('image/jpeg'), aspectRatio: null, resolution: '1080P', durationSeconds: -1, audioMode: 'native' }),
    CONTEXT
  );
  assert.deepEqual(ref, { modelCode: V25, remoteJobId: 'cgt-1' });
  assert.equal(calls[0].url, TASKS);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer ark-test-key');
  assert.deepEqual(calls[0].body, {
    model: V25,
    content: [
      { type: 'text', text: '一只猫在奔跑' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQEB' }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQEB' }, role: 'last_frame' }
    ],
    watermark: false,
    resolution: '1080p',
    duration: -1,
    generate_audio: true
  });

  const references = createProvider([{ body: { id: 'cgt-2' } }]);
  await references.provider.submit(
    request({ referenceImages: [media('image/png')], referenceAudios: [media('audio/wav')], aspectRatio: '16:9', durationSeconds: 8, audioMode: 'none', extraParams: { watermark: true } }),
    CONTEXT
  );
  assert.deepEqual(references.calls[0].body, {
    model: V20,
    content: [
      { type: 'text', text: '一只猫在奔跑' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQEB' }, role: 'reference_image' },
      { type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,AQEB' }, role: 'reference_audio' }
    ],
    watermark: true,
    ratio: '16:9',
    duration: 8,
    generate_audio: false
  });
});

test('提交：没有提示词时不写文本；校验不通过不发请求；没有任务标识报服务端错误', async () => {
  const onlyFrame = createProvider([{ body: { id: 'cgt-3' } }]);
  await onlyFrame.provider.submit(request({ prompt: '', firstFrame: media('image/png') }), CONTEXT);
  assert.deepEqual((onlyFrame.calls[0].body as { content: unknown[] }).content.length, 1);

  const invalid = createProvider();
  assert.equal((await rejectedWith(invalid.provider.submit(request({ durationSeconds: 99 }), CONTEXT))).category, 'invalid_request');
  assert.equal(invalid.calls.length, 0);

  const noId = createProvider([{ body: {} }]);
  assert.equal((await rejectedWith(noId.provider.submit(request(), CONTEXT))).category, 'server');
});

test('提交：HTTP 错误按错误码分类，带平台错误码', async () => {
  const cases: Array<[number, string, string]> = [
    [400, 'InputImageSensitiveContentDetected.PrivacyInformation', 'content_rejected'],
    [401, 'AuthenticationError', 'auth'],
    [404, 'ModelNotOpen', 'auth'],
    [429, 'ModelAccountRpmRateLimitExceeded', 'rate_limited'],
    [400, 'InvalidParameter', 'invalid_request'],
    [500, 'InternalServiceError', 'server']
  ];
  for (const [status, code, category] of cases) {
    const { provider } = createProvider([{ status, body: { error: { code, message: 'm' } } }]);
    const error = await rejectedWith(provider.submit(request(), CONTEXT));
    assert.equal(error.category, category, code);
    assert.equal(error.code, code);
  }
});

test('查询：各状态映射为统一状态，成功带视频地址与时长，失败带错误分类', async () => {
  const statuses: Array<[string, string]> = [['queued', 'pending'], ['running', 'running'], ['cancelled', 'canceled'], ['expired', 'expired']];
  for (const [platform, unified] of statuses) {
    const { provider, calls } = createProvider([{ body: { id: 'cgt-1', status: platform } }]);
    const state = await provider.query({ modelCode: V20, remoteJobId: 'cgt-1' }, CONTEXT);
    assert.deepEqual(state, { status: unified, result: null, errorCategory: null, errorCode: null, errorMessage: null });
    assert.deepEqual([calls[0].method, calls[0].url], ['GET', `${TASKS}/cgt-1`]);
  }

  const done = createProvider([{ body: { status: 'succeeded', content: { video_url: 'https://tos.test/v.mp4' }, duration: 8 } }]);
  assert.deepEqual((await done.provider.query({ modelCode: V20, remoteJobId: 'cgt-1' }, CONTEXT)).result, { videoUrl: 'https://tos.test/v.mp4', durationSeconds: 8 });

  const noDuration = createProvider([{ body: { status: 'succeeded', content: { video_url: 'https://tos.test/v.mp4' }, frames: 120 } }]);
  assert.equal((await noDuration.provider.query({ modelCode: V20, remoteJobId: 'cgt-1' }, CONTEXT)).result?.durationSeconds, null);

  const failed = createProvider([{ body: { status: 'failed', error: { code: 'OutputVideoSensitiveContentDetected', message: 'blocked' } } }]);
  assert.deepEqual(await failed.provider.query({ modelCode: V20, remoteJobId: 'cgt-1' }, CONTEXT), {
    status: 'failed',
    result: null,
    errorCategory: 'content_rejected',
    errorCode: 'OutputVideoSensitiveContentDetected',
    errorMessage: 'blocked'
  });
  const unknownFailure = createProvider([{ body: { status: 'failed', error: { code: 'SomethingNew', message: 'x' } } }]);
  assert.equal((await unknownFailure.provider.query({ modelCode: V20, remoteJobId: 'cgt-1' }, CONTEXT)).errorCategory, 'server');
});

test('查询：成功却没有视频地址、状态无法识别都报服务端错误', async () => {
  const noUrl = createProvider([{ body: { status: 'succeeded', content: {} } }]);
  assert.equal((await rejectedWith(noUrl.provider.query({ modelCode: V20, remoteJobId: 'cgt-1' }, CONTEXT))).category, 'server');
  const strange = createProvider([{ body: { status: 'paused' } }]);
  assert.match((await rejectedWith(strange.provider.query({ modelCode: V20, remoteJobId: 'cgt-1' }, CONTEXT))).message, /无法识别的任务状态：paused/);
});

test('取消：发送 DELETE；平台不允许取消生成中的任务时带出平台的错误说明', async () => {
  const { provider, calls } = createProvider([{ body: {} }]);
  await provider.cancel?.({ modelCode: V20, remoteJobId: 'cgt-1' }, CONTEXT);
  assert.deepEqual([calls[0].method, calls[0].url], ['DELETE', `${TASKS}/cgt-1`]);

  const running = createProvider([{ status: 400, body: { error: { code: 'InvalidParameter', message: 'task is running' } } }]);
  const error = await rejectedWith(running.provider.cancel?.({ modelCode: V20, remoteJobId: 'cgt-1' }, CONTEXT) as Promise<unknown>);
  assert.match(error.message, /task is running/);
});

test('测试连接：查询一个不存在的任务，带错误码的业务错误说明可用，鉴权失败按分类报错', async () => {
  const reachable = createProvider([{ status: 404, body: { error: { code: 'ResourceNotFound', message: 'no task' } } }]);
  await reachable.provider.checkConnection(CONTEXT);
  assert.deepEqual([reachable.calls[0].method, reachable.calls[0].url], ['GET', `${TASKS}/cgt-00000000-0000-0000-0000-000000000000`]);

  const badKey = createProvider([{ status: 401, body: { error: { code: 'AuthenticationError', message: 'bad' } } }]);
  assert.equal((await rejectedWith(badKey.provider.checkConnection(CONTEXT))).category, 'auth');
});
