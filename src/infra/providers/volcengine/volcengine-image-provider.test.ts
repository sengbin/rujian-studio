// ------------------------------------------------------------------------
// 名称：volcengine-image-provider.test.ts
// 说明：火山引擎 Seedream 图像适配器的自动化测试：模型声明、请求校验、尺寸换算、请求体构造、多张图并行生成与部分失败、任务引用解码、错误分类。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：注入假的 fetch，不访问网络；请求体与响应字段对照方舟“图片生成 API”文档。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../domain/errors';
import { ImageGenerationRequest, MediaInput, ProviderCallContext } from '../../../domain/ports/provider-adapters';
import { FakeResponse, createFakeFetch } from '../shared/testing/fake-fetch';
import { VolcengineImageProvider } from './volcengine-image-provider';

const CONTEXT: ProviderCallContext = { apiKey: 'ark-test-key', settings: { endpoint: 'https://ark.test/api/v3' } };
const PRO = 'doubao-seedream-5-0-pro-260628';
const LITE = 'doubao-seedream-5-0-260128';

function createProvider(responses: FakeResponse[] = []) {
  const { fetchFunction, calls } = createFakeFetch(responses);
  return { calls, provider: new VolcengineImageProvider(fetchFunction) };
}

function image(size = 4): MediaInput {
  return { mimeType: 'image/png', data: new Uint8Array(size).fill(1) };
}

/** 一个最简合法请求，测试按需覆盖字段。 */
function request(overrides: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest {
  return {
    modelCode: PRO,
    prompt: '一只在雨中的橘猫',
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

function generated(url: string): FakeResponse {
  return { body: { created: 1, data: [{ url, size: '2048x2048' }] } };
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

test('适配器声明：模型清单与能力，同步接口没有取消与测试连接', () => {
  const { provider } = createProvider();
  assert.deepEqual(provider.listModels().map((model) => model.code), [PRO, 'doubao-seedream-5-0-flash-260915', LITE, 'doubao-seedream-4-5-251128']);
  assert.equal(provider.getCapability(PRO)?.referenceImagesMax, 10);
  assert.equal(provider.getCapability(LITE)?.referenceImagesMax, 14);
  assert.equal(provider.getCapability('nope'), undefined);
  assert.equal(provider.provider.code, 'volcengine');
  assert.equal('cancel' in provider, false);
  assert.equal('checkConnection' in provider, false);
});

test('校验：合法请求没有问题；提示词、反向提示词、参考图、画幅、分辨率、数量、种子超出能力时逐条指出', () => {
  const { provider } = createProvider();
  assert.deepEqual(provider.validate(request()), []);
  assert.deepEqual(provider.validate(request({ aspectRatio: '16:9', resolution: '2K', count: 4, referenceImages: [image(), image()] })), []);

  assert.match(provider.validate(request({ prompt: '  ' })).join(), /提示词不能为空/);
  assert.match(provider.validate(request({ prompt: 'a'.repeat(4001) })).join(), /提示词不能超过 4000 字/);
  assert.match(provider.validate(request({ negativePrompt: '模糊' })).join(), /不支持反向提示词/);
  assert.match(provider.validate(request({ referenceImages: Array.from({ length: 11 }, () => image()) })).join(), /参考图最多 10 张/);
  assert.match(provider.validate(request({ referenceImages: [{ mimeType: 'text/plain', data: new Uint8Array([1]) }] })).join(), /类型必须以 image\/ 开头/);
  assert.match(provider.validate(request({ aspectRatio: '5:4', resolution: '4K', count: 5, seed: 1 })).join('|'), /画幅 5:4.*\|分辨率 4K.*\|生成数量必须是 1 到 4.*\|该模型不支持随机种子/);
  assert.deepEqual(provider.validate(request({ modelCode: 'x' })), ['火山引擎没有模型 x。']);
});

test('校验：每个模型的每种画幅与分辨率组合换算出的尺寸都在模型的像素范围内', () => {
  const { provider } = createProvider();
  for (const model of provider.listModels()) {
    for (const aspectRatio of model.capability.aspectRatios) {
      for (const resolution of [null, ...model.capability.resolutions]) {
        assert.deepEqual(provider.validate(request({ modelCode: model.code, aspectRatio, resolution })), [], `${model.code} ${aspectRatio} ${resolution}`);
      }
    }
  }
});

test('提交：请求体按一张图构造，水印关闭，返回的任务引用可解码出图片地址', async () => {
  const { provider, calls } = createProvider([generated('https://tos.test/a.jpeg')]);
  const ref = await provider.submit(request(), CONTEXT);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ark.test/api/v3/images/generations');
  assert.equal(calls[0].headers.Authorization, 'Bearer ark-test-key');
  assert.deepEqual(calls[0].body, { model: PRO, prompt: '一只在雨中的橘猫', response_format: 'url', watermark: false });
  assert.equal(ref.modelCode, PRO);

  const state = await provider.query(ref);
  assert.deepEqual(state, { status: 'succeeded', result: { imageUrls: ['https://tos.test/a.jpeg'] }, errorCategory: null, errorCode: null, errorMessage: null });
});

test('尺寸：只给分辨率时传档位；给了画幅时换算成宽x高，缺省分辨率按 2K；都不给则不传', async () => {
  const cases: Array<[Partial<ImageGenerationRequest>, string | undefined]> = [
    [{}, undefined],
    [{ resolution: '1.5K' }, '1.5K'],
    [{ aspectRatio: '1:1', resolution: '2K' }, '2048x2048'],
    [{ aspectRatio: '16:9' }, '2720x1536'],
    [{ aspectRatio: '9:16', resolution: '1K' }, '768x1360'],
    [{ aspectRatio: '21:9', resolution: '1K' }, '1552x656'],
    [{ modelCode: LITE, aspectRatio: '1:1', resolution: '4K' }, '4096x4096']
  ];
  for (const [overrides, size] of cases) {
    const { provider, calls } = createProvider([generated('https://tos.test/a.jpeg')]);
    await provider.submit(request(overrides), CONTEXT);
    assert.equal((calls[0].body as Record<string, unknown>).size, size, JSON.stringify(overrides));
  }
});

test('参考图：一张时传字符串，多张时传数组，都是 Base64 内联地址', async () => {
  const one = createProvider([generated('https://tos.test/a.jpeg')]);
  await one.provider.submit(request({ referenceImages: [image(3)] }), CONTEXT);
  assert.equal((one.calls[0].body as Record<string, unknown>).image, 'data:image/png;base64,AQEB');

  const many = createProvider([generated('https://tos.test/a.jpeg')]);
  await many.provider.submit(request({ referenceImages: [image(3), image(3)] }), CONTEXT);
  assert.deepEqual((many.calls[0].body as Record<string, unknown>).image, ['data:image/png;base64,AQEB', 'data:image/png;base64,AQEB']);
});

test('多张图：并行发起多次请求，部分失败保留已成功的，全部失败抛出第一个失败', async () => {
  const all = createProvider([generated('https://tos.test/1.jpeg'), generated('https://tos.test/2.jpeg'), generated('https://tos.test/3.jpeg')]);
  const ref = await all.provider.submit(request({ count: 3 }), CONTEXT);
  assert.equal(all.calls.length, 3);
  assert.deepEqual((await all.provider.query(ref)).result?.imageUrls.slice().sort(), ['https://tos.test/1.jpeg', 'https://tos.test/2.jpeg', 'https://tos.test/3.jpeg']);

  const partial = createProvider([generated('https://tos.test/1.jpeg'), { status: 500, body: { error: { code: 'InternalServiceError', message: 'oops' } } }]);
  const partialRef = await partial.provider.submit(request({ count: 2 }), CONTEXT);
  assert.deepEqual((await partial.provider.query(partialRef)).result?.imageUrls, ['https://tos.test/1.jpeg']);

  const none = createProvider([
    { status: 400, body: { error: { code: 'InputTextSensitiveContentDetected', message: 'blocked' } } },
    { status: 500, body: { error: { code: 'InternalServiceError', message: 'oops' } } }
  ]);
  const failure = await rejectedWith(none.provider.submit(request({ count: 2 }), CONTEXT));
  assert.equal(failure.category, 'content_rejected');
  assert.equal(failure.code, 'InputTextSensitiveContentDetected');
});

test('错误：校验不通过不发请求；没有图片地址时带上单图错误；HTTP 错误按分类', async () => {
  const invalid = createProvider();
  assert.equal((await rejectedWith(invalid.provider.submit(request({ prompt: '' }), CONTEXT))).category, 'invalid_request');
  assert.equal(invalid.calls.length, 0);

  const noUrl = createProvider([{ body: { data: [{ error: { code: 'OutputImageSensitiveContentDetected', message: 'blocked image' } }] } }]);
  const noUrlError = await rejectedWith(noUrl.provider.submit(request(), CONTEXT));
  assert.equal(noUrlError.category, 'content_rejected');
  assert.match(noUrlError.message, /没有返回图片地址：blocked image/);

  const empty = createProvider([{ body: { data: [] } }]);
  assert.equal((await rejectedWith(empty.provider.submit(request(), CONTEXT))).category, 'server');

  const unauthorized = createProvider([{ status: 401, body: { error: { code: 'AuthenticationError', message: 'bad key' } } }]);
  assert.equal((await rejectedWith(unauthorized.provider.submit(request(), CONTEXT))).category, 'auth');
});

test('任务引用：损坏的引用报参数错误', async () => {
  const { provider } = createProvider();
  await assert.rejects(provider.query({ modelCode: PRO, remoteJobId: 'not json' }), /任务引用已损坏/);
  await assert.rejects(provider.query({ modelCode: PRO, remoteJobId: '{"imageUrls":[]}' }), /任务引用已损坏/);
});
