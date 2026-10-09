// ------------------------------------------------------------------------
// 名称：minimax-image-provider.test.ts
// 说明：MiniMax 图像适配器的自动化测试：模型声明、请求校验、请求体构造、一次请求生成多张、内容安全拦截、任务引用解码、错误分类。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：注入假的 fetch，不访问网络；请求体与响应字段对照 MiniMax 开放平台“文生图”“图生图”文档。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../domain/errors';
import { ImageGenerationRequest, MediaInput, ProviderCallContext } from '../../../domain/ports/provider-adapters';
import { FakeResponse, createFakeFetch } from '../shared/testing/fake-fetch';
import { MinimaxImageProvider } from './minimax-image-provider';

const CONTEXT: ProviderCallContext = { apiKey: 'mm-test-key', settings: { endpoint: 'https://mm.test' } };
const IMAGE_01 = 'image-01';
const IMAGE_LIVE = 'image-01-live';

function createProvider(responses: FakeResponse[] = []) {
  const { fetchFunction, calls } = createFakeFetch(responses);
  return { calls, provider: new MinimaxImageProvider(fetchFunction) };
}

function media(mimeType: string, size = 3): MediaInput {
  return { mimeType, data: new Uint8Array(size).fill(1) };
}

/** 一个最简合法请求，测试按需覆盖字段。 */
function request(overrides: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest {
  return {
    modelCode: IMAGE_01,
    prompt: '一只橘猫',
    negativePrompt: null,
    referenceImages: [],
    aspectRatio: null,
    resolution: null,
    count: 1,
    seed: null,
    extraParams: {},
    ...overrides
  };
}

function success(imageUrls: string[]): FakeResponse {
  return { body: { data: { image_urls: imageUrls }, metadata: { success_count: imageUrls.length, failed_count: 0 }, base_resp: { status_code: 0, status_msg: 'success' } } };
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

test('适配器声明：两个模型，image-01 多一个 21:9 画幅，没有分辨率档位，支持种子与一张参考图，不支持取消', () => {
  const { provider } = createProvider();
  assert.deepEqual(provider.listModels().map((model) => model.code), [IMAGE_01, IMAGE_LIVE]);
  assert.ok(provider.getCapability(IMAGE_01)?.aspectRatios.includes('21:9'));
  assert.equal(provider.getCapability(IMAGE_LIVE)?.aspectRatios.includes('21:9'), false);
  for (const model of provider.listModels()) {
    assert.deepEqual(model.capability.resolutions, []);
    assert.equal(model.capability.imagesPerRequestMax, 9);
    assert.equal(model.capability.referenceImagesMax, 1);
    assert.equal(model.capability.seed, true);
  }
  assert.equal(provider.getCapability('nope'), undefined);
  assert.equal('cancel' in provider, false);
  assert.equal(provider.provider.code, 'minimax');
});

test('校验：合法请求没有问题；提示词、反向提示词、参考图、画幅、分辨率、数量、种子不合规时逐条指出', () => {
  const { provider } = createProvider();
  assert.deepEqual(provider.validate(request()), []);
  assert.deepEqual(provider.validate(request({ aspectRatio: '21:9', count: 9, seed: 0, referenceImages: [media('image/png')] })), []);

  assert.match(provider.validate(request({ prompt: ' ' })).join(), /提示词不能为空/);
  assert.match(provider.validate(request({ prompt: '字'.repeat(1501) })).join(), /提示词不能超过 1500 字/);
  assert.match(provider.validate(request({ negativePrompt: '丑' })).join(), /不支持反向提示词/);
  assert.match(provider.validate(request({ referenceImages: [media('image/png'), media('image/png')] })).join(), /参考图最多 1 张/);
  assert.match(provider.validate(request({ referenceImages: [media('image/webp')] })).join(), /只支持 JPG、PNG/);
  assert.match(provider.validate(request({ referenceImages: [media('image/png', 11 * 1024 * 1024)] })).join(), /大小必须在 1 字节到 10 MB/);
  assert.match(provider.validate(request({ modelCode: IMAGE_LIVE, aspectRatio: '21:9' })).join(), /画幅 21:9/);
  assert.match(provider.validate(request({ resolution: '2K' })).join(), /不支持指定分辨率/);
  assert.match(provider.validate(request({ count: 10 })).join(), /1 到 9 之间/);
  assert.match(provider.validate(request({ count: 0 })).join(), /1 到 9 之间/);
  assert.match(provider.validate(request({ seed: -1 })).join(), /随机种子/);
  assert.match(provider.validate(request({ extraParams: { style: 'x' } })).join(), /不支持的模型参数：style/);
  assert.deepEqual(provider.validate(request({ modelCode: 'x' })), ['MiniMax没有模型 x。']);
});

test('提交：一次请求带 n 生成多张，请求体用画幅与种子，水印关闭，图片地址编码进任务引用', async () => {
  const { provider, calls } = createProvider([success(['https://cdn.test/a.png', 'https://cdn.test/b.png'])]);
  const ref = await provider.submit(request({ aspectRatio: '16:9', count: 2, seed: 7 }), CONTEXT);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://mm.test/v1/image_generation');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer mm-test-key');
  assert.deepEqual(calls[0].body, { model: IMAGE_01, prompt: '一只橘猫', response_format: 'url', n: 2, aigc_watermark: false, aspect_ratio: '16:9', seed: 7 });
  assert.equal(ref.modelCode, IMAGE_01);

  const state = await provider.query(ref);
  assert.equal(state.status, 'succeeded');
  assert.deepEqual(state.result, { imageUrls: ['https://cdn.test/a.png', 'https://cdn.test/b.png'] });
});

test('提交：参考图作为人物主体参考以 Base64 内联；水印参数可打开', async () => {
  const { provider, calls } = createProvider([success(['https://cdn.test/a.png'])]);
  await provider.submit(request({ referenceImages: [media('image/jpeg')], extraParams: { watermark: true } }), CONTEXT);
  assert.deepEqual(calls[0].body, {
    model: IMAGE_01,
    prompt: '一只橘猫',
    response_format: 'url',
    n: 1,
    aigc_watermark: true,
    subject_reference: [{ type: 'character', image_file: 'data:image/jpeg;base64,AQEB' }]
  });
});

test('提交失败：校验不过不发请求；没有返回图片时按内容安全或服务端错误报告；状态码错误按分类报告', async () => {
  const invalid = createProvider();
  assert.equal((await rejectedWith(invalid.provider.submit(request({ prompt: '' }), CONTEXT))).category, 'invalid_request');
  assert.equal(invalid.calls.length, 0);

  const blocked = createProvider([{ body: { data: { image_urls: [] }, metadata: { success_count: 0, failed_count: 2 }, base_resp: { status_code: 0 } } }]);
  assert.equal((await rejectedWith(blocked.provider.submit(request({ count: 2 }), CONTEXT))).category, 'content_rejected');

  const empty = createProvider([{ body: { data: {}, base_resp: { status_code: 0 } } }]);
  assert.equal((await rejectedWith(empty.provider.submit(request(), CONTEXT))).category, 'server');

  const sensitive = createProvider([{ body: { base_resp: { status_code: 1026, status_msg: 'sensitive' } } }]);
  const sensitiveError = await rejectedWith(sensitive.provider.submit(request(), CONTEXT));
  assert.equal(sensitiveError.category, 'content_rejected');
  assert.equal(sensitiveError.code, '1026');

  const limited = createProvider([{ body: { base_resp: { status_code: 1002, status_msg: 'rate limit' } } }]);
  assert.equal((await rejectedWith(limited.provider.submit(request(), CONTEXT))).category, 'rate_limited');
});

test('查询：任务引用损坏时报参数错误', async () => {
  const { provider } = createProvider();
  const error = await rejectedWith(provider.query({ modelCode: IMAGE_01, remoteJobId: 'not json' }));
  assert.equal(error.category, 'invalid_request');
  assert.match(error.message, /任务引用已损坏/);
});
