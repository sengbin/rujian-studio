// ------------------------------------------------------------------------
// 名称：voice-preview-service.test.ts
// 说明：分镜动画台词试听服务的自动化测试：可选的声音模型与未配置时的提示、用音色参考合成与按预置音色合成、台词或说话方式或模型变化后重新合成而没有变化时用缓存、相同内容的并发请求共用一次调用、轮询与各类失败、缓存淘汰。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：用假音频适配器与桩的分镜、绑定、资产仓库，不依赖数据库；轮询间隔注入为立即返回。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundError, ProviderError, ValidationError } from '../../domain/errors';
import { AudioCapability } from '../../domain/models/model-capability';
import { ModelRecord, UsableModel } from '../../domain/models/model-provider';
import { MediaDownloader } from '../../domain/ports/media-downloader';
import { AudioJobResult, RemoteJobState } from '../../domain/ports/provider-adapters';
import { FAKE_AUDIO_CAPABILITY, FAKE_CALL_CONTEXT, FakeAudioProvider } from '../../domain/ports/testing/fake-model-providers';
import { MemoryVoiceCache } from '../../domain/ports/testing/memory-voice-cache';
import { VoiceCache } from '../../domain/ports/voice-cache';
import { NO_VOICE_MODEL_MESSAGE, VoicePreviewService, VoicePreviewServiceDependencies } from './voice-preview-service';
import { VoiceDraftStore } from './voice-draft-store';

const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ')]);
const VOICE_ASSET_ID = 7;
const SPEAKER_ID = 11;
const UNBOUND_ID = 12;

/** 支持参考音频的模型：提示词里要用 @voice1 引用，不带预置音色。 */
const REFERENCE_CAPABILITY: AudioCapability = { ...FAKE_AUDIO_CAPABILITY, voices: [], referenceAudio: true, referenceMark: '@voice1' };
/** 只有预置音色的模型：不支持参考音频。 */
const PRESET_CAPABILITY: AudioCapability = { ...FAKE_AUDIO_CAPABILITY, voices: ['小红', '小明', '小刚'], referenceAudio: false };
/** 配乐模型：不能生成语音。 */
const MUSIC_CAPABILITY: AudioCapability = { ...FAKE_AUDIO_CAPABILITY, audioKinds: ['music'], voices: [] };

/** 一个模型记录。 */
function modelRecord(id: number, code: string, capability: AudioCapability): ModelRecord {
  return { id, providerId: 1, code, displayName: `模型${id}`, kind: 'audio', isEnabled: true, capability, createdAt: '2026-10-07T00:00:00.000Z' };
}

/** 分镜里的一条声音。 */
function soundRecord(id: number, overrides: Record<string, unknown> = {}) {
  return { id, kind: 'dialogue', speakerEntityId: SPEAKER_ID, text: '今晚会下雨', delivery: '低声', startOffsetSeconds: null, durationSeconds: null, isEnabled: true, ...overrides };
}

/** 创建服务与桩；sounds 为分镜里的声音，可在测试中修改。 */
function createFixture(options: { readonly models?: readonly ModelRecord[]; readonly files?: boolean; readonly referenceBytes?: Buffer; readonly downloaded?: Buffer; readonly narrator?: boolean; readonly assetPresetVoice?: string; readonly diskCache?: VoiceCache } = {}) {
  const models = options.models ?? [modelRecord(5, 'ref-audio', REFERENCE_CAPABILITY), modelRecord(6, 'preset-audio', PRESET_CAPABILITY), modelRecord(8, 'music-audio', MUSIC_CAPABILITY)];
  const adapter = new FakeAudioProvider(models.map((model) => ({ code: model.code, displayName: model.displayName, kind: 'audio' as const, capability: model.capability as AudioCapability })));
  const view = {
    entities: [
      { id: SPEAKER_ID, name: '守夜人' },
      { id: UNBOUND_ID, name: '新兵' }
    ],
    shots: [
      {
        sounds: [
          soundRecord(1),
          soundRecord(2, { kind: 'narration', speakerEntityId: null }),
          soundRecord(3, { speakerEntityId: UNBOUND_ID }),
          soundRecord(4, { text: '  ' }),
          soundRecord(5, { kind: 'sfx', speakerEntityId: null })
        ]
      }
    ]
  };
  const downloads: string[] = [];
  const downloader: MediaDownloader = {
    download: async (url) => {
      downloads.push(url);
      return options.downloaded ?? WAV;
    }
  };
  const usable: UsableModel[] = models.map((model) => ({ model, providerCode: 'fake', providerName: '假服务商' }));
  const drafts = new VoiceDraftStore();
  const dependencies: VoicePreviewServiceDependencies = {
    storyboards: { getView: () => view } as unknown as VoicePreviewServiceDependencies['storyboards'],
    bindings: {
      listByEpisode: () => [
        { id: 1, episodeId: 1, entityId: SPEAKER_ID, entityName: '守夜人', assetId: VOICE_ASSET_ID, assetName: '低沉嗓音', assetKind: 'audio', purpose: 'voice', isPrimary: true, note: '', createdAt: '' },
        { id: 2, episodeId: 1, entityId: UNBOUND_ID, entityName: '新兵', assetId: 99, assetName: '形象', assetKind: 'character', purpose: 'visual', isPrimary: true, note: '', createdAt: '' }
      ]
    },
    assets: {
      findById: () => ({ attributes: { language: '中文', ...(options.assetPresetVoice === undefined ? {} : { preset_voice: options.assetPresetVoice }) } }) as never,
      listReferenceFiles: () => (options.files === false ? [] : [{ id: 1, mime: 'audio/wav', content: options.referenceBytes ?? WAV } as never])
    },
    narrators: { find: () => (options.narrator === true ? { workId: 1, assetId: VOICE_ASSET_ID, assetName: '旁白嗓音' } : undefined) },
    drafts,
    providers: {
      listUsableModels: async () => usable,
      resolveAudioCall: async (modelId: number) => {
        const model = models.find((candidate) => candidate.id === modelId);
        if (model === undefined) throw new ProviderError('invalid_request', '所选音频模型已不存在，请重新选择。');
        return { adapter, context: FAKE_CALL_CONTEXT, modelCode: model.code };
      }
    },
    downloader,
    ...(options.diskCache === undefined ? {} : { diskCache: options.diskCache }),
    wait: async () => undefined
  };
  return { service: new VoicePreviewService(dependencies), adapter, view, downloads, drafts, sound: (id: number) => view.shots[0].sounds.find((item) => item.id === id)! };
}

const request = (soundId: number, modelId = 5) => ({ episodeId: 1, soundId, modelId });

test('本地磁盘缓存：合成结果保存到磁盘，重启（新服务）后内容没变就直接用，不再调用模型；内容变了才重新合成', async () => {
  const diskCache = new MemoryVoiceCache();
  const first = createFixture({ diskCache });
  await first.service.synthesize(1, request(1));
  assert.equal(diskCache.entries.size, 1, '合成结果已保存');

  const second = createFixture({ diskCache });
  const again = await second.service.synthesize(1, request(1));
  assert.equal(again.cached, true);
  assert.equal(second.adapter.submitted.length, 0, '重启后没有调用模型');

  second.sound(1).text = '明天会放晴';
  assert.equal((await second.service.synthesize(1, request(1))).cached, false);
  assert.equal(second.adapter.submitted.length, 1, '台词改了需要重新合成');
  assert.equal(diskCache.entries.size, 2, '新结果另外保存，没有覆盖旧的');
});

test('重新合成：绕过缓存并用新结果替换磁盘里的旧结果', async () => {
  const diskCache = new MemoryVoiceCache();
  const newer = Buffer.concat([WAV, Buffer.from('new')]);
  await createFixture({ diskCache }).service.synthesize(1, request(1));
  const [key] = [...diskCache.entries.keys()];
  assert.deepEqual(diskCache.entries.get(key)?.content, WAV);

  const fixture = createFixture({ diskCache, downloaded: newer });
  const result = await fixture.service.synthesize(1, { ...request(1), regenerate: true });
  assert.equal(result.cached, false);
  assert.deepEqual(diskCache.entries.get(key)?.content, newer, '磁盘里的结果被替换');
  assert.equal((await createFixture({ diskCache }).service.synthesize(1, request(1))).data, newer.toString('base64'), '之后用的是新结果');
});

test('磁盘缓存读写失败不影响合成', async () => {
  const broken: VoiceCache = {
    get: () => {
      throw new Error('读不了');
    },
    put: () => {
      throw new Error('写不了');
    }
  };
  const fixture = createFixture({ diskCache: broken });
  const result = await fixture.service.synthesize(1, request(1));
  assert.equal(result.cached, false);
  assert.equal(fixture.adapter.submitted.length, 1);
});

test('读取已保存的配音：只返回缓存里有的对白，不调用模型；台词、说话方式改过的不返回；没有音色的说话人、没有台词、非人声的跳过', async () => {
  const diskCache = new MemoryVoiceCache();
  await createFixture({ diskCache }).service.synthesize(1, request(1));

  const fixture = createFixture({ diskCache });
  const restored = await fixture.service.restore(1, { episodeId: 1, modelId: 5 });
  assert.deepEqual(restored.clips.map((clip) => [clip.soundId, clip.mime, clip.data]), [[1, 'audio/wav', WAV.toString('base64')]]);
  assert.equal(fixture.adapter.submitted.length, 0, '只读缓存，没有调用模型');

  fixture.sound(1).delivery = '大声';
  assert.deepEqual((await fixture.service.restore(1, { episodeId: 1, modelId: 5 })).clips, [], '说话方式改过，需要重新合成');
  fixture.sound(1).delivery = '低声';
  assert.equal((await fixture.service.restore(1, { episodeId: 1, modelId: 5 })).clips.length, 1, '改回原样又能读到');
  assert.equal((await fixture.service.restore(1, { episodeId: 1, modelId: 6 })).clips.length, 0, '换了模型没有结果');

  await assert.rejects(() => fixture.service.restore(1, { episodeId: 1, modelId: 8 }), (error: unknown) => error instanceof ValidationError && /不能生成语音/.test(error.message));
  await assert.rejects(() => fixture.service.restore(1, { episodeId: 1, modelId: 404 }), ProviderError);
  await assert.rejects(() => fixture.service.restore(1, { modelId: 5 }), ValidationError);
});

test('声音模型选项：只列能生成语音的已配置模型，带是否支持参考音频；没有可用模型时给出配置提示', async () => {
  const { service } = createFixture();
  const options = await service.getOptions();
  assert.deepEqual(options.models, [
    { id: 5, label: '假服务商 · 模型5', supportsReference: true, voices: [] },
    { id: 6, label: '假服务商 · 模型6', supportsReference: false, voices: ['小红', '小明', '小刚'] }
  ]);
  assert.equal(options.unavailableHint, null);

  const none = await createFixture({ models: [modelRecord(8, 'music-audio', MUSIC_CAPABILITY)] }).service.getOptions();
  assert.deepEqual(none.models, []);
  assert.equal(none.unavailableHint, NO_VOICE_MODEL_MESSAGE);
  assert.ok(NO_VOICE_MODEL_MESSAGE.includes('模型设置'));
});

test('合成（支持参考音频的模型）：用说话人绑定的音色参考，提示词带参考标记与说话方式，语言取音色参考的语言', async () => {
  const { service, adapter, downloads } = createFixture();
  const result = await service.synthesize(1, request(1));

  assert.deepEqual([result.mime, result.data, result.cached, result.note], ['audio/wav', WAV.toString('base64'), false, null]);
  assert.equal(adapter.submitted.length, 1);
  const submitted = adapter.submitted[0];
  assert.equal(submitted.modelCode, 'ref-audio');
  assert.equal(submitted.audioKind, 'voice');
  assert.equal(submitted.prompt, '@voice1，低声，说：“今晚会下雨”');
  assert.deepEqual([submitted.language, submitted.voice, submitted.durationSeconds], ['zh', null, null]);
  assert.equal(submitted.referenceAudio?.mimeType, 'audio/wav');
  assert.deepEqual(Buffer.from(submitted.referenceAudio?.data ?? []), WAV);
  assert.deepEqual(downloads, ['https://fake.example.com/audio.wav']);
});

test('合成（只有预置音色的模型）：提示词只有台词，按说话人固定挑预置音色，并说明没有用音色参考', async () => {
  const { service, adapter } = createFixture();
  const result = await service.synthesize(1, request(1, 6));
  const submitted = adapter.submitted[0];
  assert.equal(submitted.prompt, '今晚会下雨');
  assert.equal(submitted.referenceAudio, null);
  assert.equal(submitted.voice, PRESET_CAPABILITY.voices[SPEAKER_ID % PRESET_CAPABILITY.voices.length]);
  assert.ok(result.note?.includes('不支持参考音频') && result.note.includes('守夜人'));

  // 同一说话人始终同一个音色。
  await service.synthesize(1, request(1, 6));
  assert.equal(adapter.submitted.length, 1, '内容相同，使用缓存');
});

test('缓存：台词、说话方式、模型任一变化都重新调用模型；都没变化时直接用缓存，不再调用', async () => {
  const { service, adapter, sound } = createFixture();
  await service.synthesize(1, request(1));
  const again = await service.synthesize(1, request(1));
  assert.equal(again.cached, true);
  assert.equal(adapter.submitted.length, 1, '没有变化不再调用模型');

  sound(1).text = '明天会放晴';
  const changedText = await service.synthesize(1, request(1));
  assert.equal(changedText.cached, false);
  assert.equal(adapter.submitted.length, 2, '台词变化重新合成');

  sound(1).delivery = '大声';
  await service.synthesize(1, request(1));
  assert.equal(adapter.submitted.length, 3, '说话方式变化重新合成');

  await service.synthesize(1, request(1, 6));
  assert.equal(adapter.submitted.length, 4, '换模型重新合成');

  sound(1).text = '今晚会下雨';
  sound(1).delivery = '低声';
  assert.equal((await service.synthesize(1, request(1))).cached, true, '改回原来的内容，之前的结果还在缓存里');
  assert.equal(adapter.submitted.length, 4);
});

test('重新合成：内容没变也绕过缓存重新调用模型，结果替换缓存；之后普通请求仍用缓存', async () => {
  const { service, adapter } = createFixture();
  await service.synthesize(1, request(1));
  const again = await service.synthesize(1, { ...request(1), regenerate: true });
  assert.equal(again.cached, false);
  assert.equal(adapter.submitted.length, 2, '重新合成调用了模型');

  assert.equal((await service.synthesize(1, request(1))).cached, true);
  assert.equal(adapter.submitted.length, 2, '之后没有变化仍用缓存');
});

test('音色参考是什么内容就用什么内容提交给模型', async () => {
  const other = Buffer.concat([WAV, Buffer.from('more')]);
  const fixture = createFixture({ referenceBytes: other });
  await fixture.service.synthesize(1, request(1));
  assert.deepEqual(Buffer.from(fixture.adapter.submitted[0].referenceAudio?.data ?? []), other);
});

test('相同内容的并发请求共用一次调用', async () => {
  const { service, adapter } = createFixture();
  const [first, second] = await Promise.all([service.synthesize(1, request(1)), service.synthesize(1, request(1))]);
  assert.equal(adapter.submitted.length, 1);
  assert.equal(first.data, second.data);
});

test('不能试听的声音：音效与配乐、没有台词、说话人没有音色，以及已不存在的声音', async () => {
  const { service, adapter } = createFixture();
  await assert.rejects(() => service.synthesize(1, request(5)), (error: unknown) => error instanceof ValidationError && /有说话人的角色对白与旁白/.test(error.message));
  await assert.rejects(() => service.synthesize(1, request(4)), (error: unknown) => error instanceof ValidationError && /没有台词/.test(error.message));
  await assert.rejects(() => service.synthesize(1, request(3)), (error: unknown) => error instanceof ValidationError && /“新兵”还没有绑定音色参考/.test(error.message));
  await assert.rejects(() => service.synthesize(1, request(2)), (error: unknown) => error instanceof ValidationError && /旁白还没有音色/.test(error.message));
  await assert.rejects(() => service.synthesize(1, request(999)), NotFoundError);
  assert.equal(adapter.submitted.length, 0, '这些情况都不调用模型');
});

test('旁白：用作品的旁白音色合成，和角色对白一样用参考音频', async () => {
  const { service, adapter } = createFixture({ narrator: true });
  const result = await service.synthesize(1, request(2));
  assert.equal(result.note, null);
  const submitted = adapter.submitted[0];
  assert.equal(submitted.prompt, '@voice1，低声，说：“今晚会下雨”');
  assert.deepEqual(Buffer.from(submitted.referenceAudio?.data ?? []), WAV);
});

test('临时音色：说话人没有绑定音色时用暂存的试听音色，有参考音频的模型把样本当参考，只有预置音色的模型用样本记录的预置音色', async () => {
  const { service, adapter, drafts } = createFixture();
  const sample = Buffer.concat([WAV, Buffer.from('draft')]);
  drafts.save({ workId: 1, speakerKey: `entity:${UNBOUND_ID}`, modelId: 5, mime: 'audio/wav', content: sample, durationSeconds: 2, sampleText: '试听', description: '沙哑', language: 'en', presetVoice: '小明' });

  const withReference = await service.synthesize(1, request(3));
  assert.equal(withReference.note, null);
  assert.deepEqual(Buffer.from(adapter.submitted[0].referenceAudio?.data ?? []), sample);
  assert.equal(adapter.submitted[0].language, 'en');

  const preset = await service.synthesize(1, request(3, 6));
  assert.equal(adapter.submitted[1].voice, '小明');
  assert.equal(adapter.submitted[1].referenceAudio, null);
  assert.equal(preset.note, null, '用的是样本记录的预置音色，不需要提醒');
});

test('旁白的临时音色：没有作品旁白音色时用暂存的试听音色', async () => {
  const { service, adapter, drafts } = createFixture();
  drafts.save({ workId: 1, speakerKey: 'narrator', modelId: 5, mime: 'audio/wav', content: WAV, durationSeconds: null, sampleText: '夜幕降临', description: '', language: 'zh', presetVoice: null });
  await service.synthesize(1, request(2));
  assert.equal(adapter.submitted.length, 1);
});

test('已绑定的音色参考记录了预置音色时，只有预置音色的模型按它合成而不是随便挑一个', async () => {
  const { service, adapter } = createFixture({ assetPresetVoice: '小刚' });
  const result = await service.synthesize(1, request(1, 6));
  assert.equal(adapter.submitted[0].voice, '小刚');
  assert.equal(result.note, null);
});

test('资产记录的预置音色不在所选模型里：合成报错、不调用模型，读取已保存配音时跳过该说话人', async () => {
  const { service, adapter } = createFixture({ assetPresetVoice: '不存在的音色' });
  await assert.rejects(
    () => service.synthesize(1, request(1, 6)),
    (error: unknown) => error instanceof ValidationError && error.message.includes('资产的预置音色不在所选模型里，请更换模型或音色')
  );
  assert.equal(adapter.submitted.length, 0);
  assert.deepEqual((await service.restore(1, { episodeId: 1, modelId: 6 })).clips, []);
  assert.equal((await service.synthesize(1, request(1, 5))).cached, false, '支持参考音频的模型不受预置音色影响');
});

test('render：fresh 时不读缓存重新调用模型并更新缓存，返回平台给出的时长', async () => {
  const { service, adapter } = createFixture();
  await service.synthesize(1, request(1));
  assert.equal(adapter.submitted.length, 1);
  const call = { adapter, context: FAKE_CALL_CONTEXT, modelCode: 'ref-audio' };
  const again = await service.render(5, call, adapter.submitted[0]);
  assert.equal(again.cached, true);
  const fresh = await service.render(5, call, adapter.submitted[0], true);
  assert.equal(fresh.cached, false);
  assert.equal(adapter.submitted.length, 2);
});

test('音色参考还没有音频文件、模型不存在或不能生成语音、请求不合法', async () => {
  const noFile = createFixture({ files: false });
  await assert.rejects(() => noFile.service.synthesize(1, request(1)), (error: unknown) => error instanceof NotFoundError && /还没有音频文件/.test(error.message));

  const { service, adapter } = createFixture();
  await assert.rejects(() => service.synthesize(1, request(1, 404)), ProviderError);
  await assert.rejects(() => service.synthesize(1, request(1, 8)), (error: unknown) => error instanceof ValidationError && /不能生成语音/.test(error.message));
  for (const bad of [null, {}, { episodeId: 1, soundId: 1 }, { episodeId: 'x', soundId: 1, modelId: 5 }, { episodeId: 1, soundId: 0, modelId: 5 }, { episodeId: 1, runId: 'x', soundId: 1, modelId: 5 }]) {
    await assert.rejects(() => service.synthesize(1, bad), ValidationError);
  }
  assert.equal(adapter.submitted.length, 0);
});

test('合成失败：请求不符合模型能力、任务失败、取消、过期、没有结果、超时、文件不是音频都抛出可读的错误，且不进入缓存', async () => {
  const { service, adapter } = createFixture();
  adapter.validate = () => ['提示词不能超过 300 字（当前 400 字）。'];
  await assert.rejects(() => service.synthesize(1, request(1)), (error: unknown) => error instanceof ValidationError && /不能超过 300 字/.test(error.message));
  adapter.validate = () => [];

  const state = (overrides: Partial<RemoteJobState<AudioJobResult>>): RemoteJobState<AudioJobResult> => ({ status: 'failed', result: null, errorCategory: null, errorCode: null, errorMessage: null, ...overrides });
  adapter.queryStates.push(state({ status: 'failed', errorCategory: 'auth', errorCode: 'E1', errorMessage: '密钥无效。' }));
  await assert.rejects(() => service.synthesize(1, request(1)), (error: unknown) => error instanceof ProviderError && error.category === 'auth' && error.code === 'E1' && /密钥无效/.test(error.message));
  adapter.queryStates.push(state({ status: 'failed' }));
  await assert.rejects(() => service.synthesize(1, request(1)), /没有返回失败原因/);
  adapter.queryStates.push(state({ status: 'canceled' }));
  await assert.rejects(() => service.synthesize(1, request(1)), /已被取消/);
  adapter.queryStates.push(state({ status: 'expired' }));
  await assert.rejects(() => service.synthesize(1, request(1)), /不再保留/);
  adapter.queryStates.push(state({ status: 'succeeded' }));
  await assert.rejects(() => service.synthesize(1, request(1)), /没有返回音频/);
  for (let index = 0; index < 30; index += 1) adapter.queryStates.push(state({ status: 'running' }));
  await assert.rejects(() => service.synthesize(1, request(1)), /超时/);

  const notAudio = createFixture({ downloaded: Buffer.from('not audio') });
  await assert.rejects(() => notAudio.service.synthesize(1, request(1)), /不是有效的 MP3、WAV 或 M4A 音频/);

  // 失败不进入缓存：恢复正常后再次调用会真正请求模型。
  const before = adapter.submitted.length;
  const ok = await service.synthesize(1, request(1));
  assert.equal(ok.cached, false);
  assert.equal(adapter.submitted.length, before + 1);
});

test('轮询：任务排队、处理中时等待，成功后取回音频', async () => {
  const { service, adapter } = createFixture();
  adapter.queryStates.push({ status: 'pending', result: null, errorCategory: null, errorCode: null, errorMessage: null });
  adapter.queryStates.push({ status: 'running', result: null, errorCategory: null, errorCode: null, errorMessage: null });
  const result = await service.synthesize(1, request(1));
  assert.equal(result.mime, 'audio/wav');
});

test('缓存淘汰：超过条数上限后最早的结果被淘汰，再次试听会重新调用模型', async () => {
  const { service, adapter, sound } = createFixture();
  for (let index = 0; index < 41; index += 1) {
    sound(1).text = `台词${index}`;
    await service.synthesize(1, request(1));
  }
  assert.equal(adapter.submitted.length, 41);
  sound(1).text = '台词40';
  assert.equal((await service.synthesize(1, request(1))).cached, true, '最近的还在');
  sound(1).text = '台词0';
  assert.equal((await service.synthesize(1, request(1))).cached, false, '最早的已被淘汰');
  assert.equal(adapter.submitted.length, 42);
});
