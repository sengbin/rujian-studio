// ------------------------------------------------------------------------
// 名称：voice-draft-service.test.ts
// 说明：“按描述生成音色”服务的自动化测试：说话人状态、对话框信息（音色描述缺省取值、建议名称、其他集数）、按描述或预置音色生成并暂存、换一个绕过缓存、采用后创建音色资产并绑定（角色、旁白、其他集、绑定失败回滚）和各类校验。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：用桩的分镜、绑定、资产与合成服务，不依赖数据库；暂存使用真实的内存暂存。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/errors';
import { AudioCapability } from '../../domain/models/model-capability';
import { AudioGenerationRequest, ResolvedAudioCall } from '../../domain/ports/provider-adapters';
import { FAKE_AUDIO_CAPABILITY, FAKE_CALL_CONTEXT, FakeAudioProvider } from '../../domain/ports/testing/fake-model-providers';
import { VoiceDraftService, VoiceDraftServiceDependencies } from './voice-draft-service';
import { VoiceDraftStore } from './voice-draft-store';

const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ')]);
const SPEAKER_ID = 11;
const OTHER_ID = 12;
const SCENE_ID = 20;

/** 支持参考音频的模型：按描述生成音色。 */
const DESCRIBE_CAPABILITY: AudioCapability = { ...FAKE_AUDIO_CAPABILITY, voices: [], referenceAudio: true, referenceMark: '@voice1' };
/** 只有预置音色的模型。 */
const PRESET_CAPABILITY: AudioCapability = { ...FAKE_AUDIO_CAPABILITY, voices: ['小红', '小明', '小刚'], referenceAudio: false };
/** 配乐模型。 */
const MUSIC_CAPABILITY: AudioCapability = { ...FAKE_AUDIO_CAPABILITY, audioKinds: ['music'], voices: [] };

const MODELS = [
  { id: 5, code: 'describe', capability: DESCRIBE_CAPABILITY },
  { id: 6, code: 'preset', capability: PRESET_CAPABILITY },
  { id: 8, code: 'music', capability: MUSIC_CAPABILITY }
];

/** 创建服务与桩；voiceBindings 为各集已有主音色绑定的角色，键为集标识。 */
function createFixture(options: { readonly voiceBindings?: Record<number, number[]>; readonly takenNames?: string[]; readonly bindFailsOnEpisode?: number } = {}) {
  const adapter = new FakeAudioProvider(MODELS.map((model) => ({ code: model.code, displayName: model.code, kind: 'audio' as const, capability: model.capability })));
  const rendered: Array<{ modelId: number; request: AudioGenerationRequest; fresh: boolean }> = [];
  const bound: Array<{ episodeId: number; entityId: number; assetId: number; purpose: string }> = [];
  const created: Array<Record<string, unknown>> = [];
  const deleted: number[] = [];
  const narratorSet: Array<{ workId: number; assetId: number }> = [];
  const taken = new Set(options.takenNames ?? []);
  const voiceBindings = options.voiceBindings ?? {};
  const drafts = new VoiceDraftStore();
  const attributes: Record<string, string> = { voice: '低沉沙哑的老年男声', identity: '灯塔守夜人' };

  const dependencies: VoiceDraftServiceDependencies = {
    storyboards: {
      getView: (workId: number, episodeId: number) => {
        if (workId !== 1 || episodeId < 1 || episodeId > 3) throw new NotFoundError('集不存在。');
        return {
          work: { name: '灯塔' },
          entities: [
            { id: SPEAKER_ID, kind: 'character', name: '守夜人' },
            { id: OTHER_ID, kind: 'character', name: '新兵' },
            { id: SCENE_ID, kind: 'scene', name: '灯塔顶' }
          ]
        };
      }
    } as unknown as VoiceDraftServiceDependencies['storyboards'],
    bindings: {
      getEntityDetail: () => ({ projectId: 1, kind: 'character', name: '守夜人', description: '寡言', attributes }),
      listBindings: (episodeId: number) =>
        (voiceBindings[episodeId] ?? []).map((entityId) => ({ episodeId, entityId, purpose: 'voice', isPrimary: true })),
      listSiblingEpisodeIds: () => [1, 2, 3],
      bind: (raw: { episodeId: number; entityId: number; assetId: number; purpose: string }) => {
        if (raw.episodeId === options.bindFailsOnEpisode) throw new ValidationError({ '': '绑定失败。' });
        bound.push(raw);
        voiceBindings[raw.episodeId] = [...(voiceBindings[raw.episodeId] ?? []), raw.entityId];
        return {} as never;
      }
    } as unknown as VoiceDraftServiceDependencies['bindings'],
    assets: {
      isNameAvailable: (_kind: string, name: string) => !taken.has(name),
      createVoiceAsset: (sample: Record<string, unknown>) => {
        if (taken.has(sample.name as string)) throw new ConflictError('name', '已有同名资产，请换一个名称。');
        created.push(sample);
        return { id: 90 + created.length, name: sample.name as string } as never;
      },
      deleteAsset: (id: number) => {
        deleted.push(id);
      }
    } as unknown as VoiceDraftServiceDependencies['assets'],
    narrators: {
      find: () => (narratorSet.length === 0 ? undefined : { workId: 1, assetId: narratorSet[0].assetId, assetName: '旁白嗓音' }),
      set: (workId: number, assetId: number) => {
        narratorSet.push({ workId, assetId });
      }
    },
    drafts,
    providers: {
      resolveAudioCall: async (modelId: number): Promise<ResolvedAudioCall> => {
        const model = MODELS.find((candidate) => candidate.id === modelId);
        if (model === undefined) throw new NotFoundError('所选音频模型已不存在，请重新选择。');
        return { adapter, context: FAKE_CALL_CONTEXT, modelCode: model.code };
      }
    },
    voices: {
      render: async (modelId: number, _call: ResolvedAudioCall, request: AudioGenerationRequest, fresh = false) => {
        rendered.push({ modelId, request, fresh });
        return { mime: 'audio/wav', data: WAV.toString('base64'), durationSeconds: 2.5, cached: !fresh && rendered.length > 1 };
      }
    },
    now: () => new Date('2026-10-07T00:00:00.000Z')
  };
  return { service: new VoiceDraftService(dependencies), drafts, rendered, bound, created, deleted, narratorSet, attributes, voiceBindings };
}

const draftRequest = (overrides: Record<string, unknown> = {}) => ({ episodeId: 1, entityId: SPEAKER_ID, modelId: 5, sampleText: '今晚会下雨', delivery: '低声', description: '低沉沙哑的老年男声', ...overrides });

test('说话人状态：列出有试听音色的角色，旁白按“作品音色、试听音色、没有”区分', async () => {
  const { service, narratorSet } = createFixture();
  assert.deepEqual(service.getSpeakers(1), { narrator: 'none', narratorAssetName: null, draftEntityIds: [] });

  await service.createDraft(1, draftRequest());
  await service.createDraft(1, draftRequest({ entityId: OTHER_ID }));
  assert.deepEqual(service.getSpeakers(1).draftEntityIds, [SPEAKER_ID, OTHER_ID]);
  assert.deepEqual(service.getSpeakers(2), { narrator: 'none', narratorAssetName: null, draftEntityIds: [] }, '别的作品互不影响');

  await service.createDraft(1, draftRequest({ entityId: undefined }));
  assert.equal(service.getSpeakers(1).narrator, 'draft');
  narratorSet.push({ workId: 1, assetId: 90 });
  assert.deepEqual([service.getSpeakers(1).narrator, service.getSpeakers(1).narratorAssetName], ['bound', '旁白嗓音']);
});

test('对话框信息：音色描述取角色设定，没有时取身份与概述；建议名称避开重名；统计其他还没有音色的集', () => {
  const { service, attributes } = createFixture({ voiceBindings: { 2: [SPEAKER_ID] }, takenNames: ['守夜人·音色'] });
  const info = service.getDraftInfo(1, { episodeId: 1, entityId: SPEAKER_ID });
  assert.deepEqual([info.speakerName, info.description, info.suggestedName, info.otherEpisodes, info.draft, info.narratorAssetName], ['守夜人', '低沉沙哑的老年男声', '守夜人·音色 2', 1, null, null]);

  delete attributes.voice;
  assert.equal(service.getDraftInfo(1, { episodeId: 1, entityId: SPEAKER_ID }).description, '灯塔守夜人；寡言');

  const narrator = service.getDraftInfo(1, { episodeId: 1 });
  assert.deepEqual([narrator.speakerName, narrator.description, narrator.suggestedName, narrator.otherEpisodes], ['旁白', '', '灯塔·旁白', 0]);
});

test('对话框信息校验：集不属于作品、角色不存在、不是角色类型', () => {
  const { service } = createFixture();
  assert.throws(() => service.getDraftInfo(2, { episodeId: 1, entityId: SPEAKER_ID }), NotFoundError);
  assert.throws(() => service.getDraftInfo(1, { episodeId: 1, entityId: 999 }), NotFoundError);
  assert.throws(() => service.getDraftInfo(1, { episodeId: 1, entityId: SCENE_ID }), (error: unknown) => error instanceof ValidationError && /只有角色/.test(error.message));
  assert.throws(() => service.getDraftInfo(1, { episodeId: 'x' }), ValidationError);
});

test('按描述生成（支持参考音频的模型）：提示词是描述、说话方式与台词，不带参考音频；结果暂存，换一个绕过缓存', async () => {
  const { service, rendered, drafts } = createFixture();
  const result = await service.createDraft(1, draftRequest());
  assert.deepEqual([result.mime, result.data, result.presetVoice, result.note, result.sampleText], ['audio/wav', WAV.toString('base64'), null, null, '今晚会下雨']);
  const [first] = rendered;
  assert.equal(first.request.prompt, '说话人（低沉沙哑的老年男声，低声）说：“今晚会下雨”');
  assert.deepEqual([first.request.voice, first.request.referenceAudio, first.request.language, first.fresh], [null, null, 'zh', false]);
  const stored = drafts.find(1, `entity:${SPEAKER_ID}`);
  assert.deepEqual([stored?.modelId, stored?.durationSeconds, stored?.content.equals(WAV), stored?.language], [5, 2.5, true, 'zh']);

  await service.createDraft(1, draftRequest({ regenerate: true, sampleText: 'Rain tonight' }));
  assert.equal(rendered[1].fresh, true);
  assert.equal(rendered[1].request.language, 'en');
  assert.equal(drafts.find(1, `entity:${SPEAKER_ID}`)?.sampleText, 'Rain tonight', '新的替换旧的');

  assert.equal(service.getDraftInfo(1, { episodeId: 1, entityId: SPEAKER_ID }).draft?.sampleText, 'Rain tonight');
});

test('按描述生成（只有预置音色的模型）：用所选的预置音色，不在模型里时按说话人挑，提示描述不起作用', async () => {
  const { service, rendered } = createFixture();
  const chosen = await service.createDraft(1, draftRequest({ modelId: 6, presetVoice: '小刚' }));
  assert.deepEqual([rendered[0].request.voice, rendered[0].request.prompt, chosen.presetVoice], ['小刚', '今晚会下雨', '小刚']);
  assert.match(chosen.note ?? '', /只有预置音色/);

  const fallback = await service.createDraft(1, draftRequest({ modelId: 6, presetVoice: '不存在' }));
  assert.equal(fallback.presetVoice, PRESET_CAPABILITY.voices[SPEAKER_ID % PRESET_CAPABILITY.voices.length]);
});

test('生成校验：试听台词不能为空或过长，模型不存在或不能生成语音', async () => {
  const { service, rendered } = createFixture();
  await assert.rejects(() => service.createDraft(1, draftRequest({ sampleText: '  ' })), ValidationError);
  await assert.rejects(() => service.createDraft(1, draftRequest({ sampleText: '字'.repeat(121) })), ValidationError);
  await assert.rejects(() => service.createDraft(1, draftRequest({ modelId: 404 })), NotFoundError);
  await assert.rejects(() => service.createDraft(1, draftRequest({ modelId: 8 })), (error: unknown) => error instanceof ValidationError && /不能生成语音/.test(error.message));
  await assert.rejects(() => service.createDraft(1, draftRequest({ entityId: SCENE_ID })), ValidationError);
  assert.equal(rendered.length, 0, '这些情况都不调用模型');
});

test('采用角色音色：保存为音色资产并绑定当前集，可选同时绑定其他还没有该角色音色的集，暂存随之清除', async () => {
  const { service, drafts, created, bound } = createFixture({ voiceBindings: { 3: [SPEAKER_ID] } });
  await service.createDraft(1, draftRequest({ modelId: 6, presetVoice: '小明' }));

  const result = service.adopt(1, { episodeId: 1, entityId: SPEAKER_ID, name: '守夜人·音色', applyToOtherEpisodes: true });
  assert.deepEqual(result, { assetId: 91, assetName: '守夜人·音色', otherEpisodesBound: 1 });
  assert.deepEqual(created[0], { name: '守夜人·音色', description: '低沉沙哑的老年男声', language: '中文', presetVoice: '小明', fileName: 'voice-sample.wav', content: WAV, durationSeconds: 2.5 });
  assert.deepEqual(bound.map((item) => [item.episodeId, item.entityId, item.assetId, item.purpose]), [[1, SPEAKER_ID, 91, 'voice'], [2, SPEAKER_ID, 91, 'voice']], '第 3 集已有音色，不覆盖');
  assert.equal(drafts.find(1, `entity:${SPEAKER_ID}`), undefined);
});

test('采用角色音色：不勾选其他集时只绑定当前集', async () => {
  const { service, bound } = createFixture();
  await service.createDraft(1, draftRequest());
  const result = service.adopt(1, { episodeId: 1, entityId: SPEAKER_ID, name: '音色甲', applyToOtherEpisodes: false });
  assert.equal(result.otherEpisodesBound, 0);
  assert.equal(bound.length, 1);
});

test('采用旁白音色：设为作品的旁白音色，不绑定角色', async () => {
  const { service, bound, narratorSet, drafts } = createFixture();
  await service.createDraft(1, draftRequest({ entityId: undefined }));
  const result = service.adopt(1, { episodeId: 2, name: '灯塔·旁白', applyToOtherEpisodes: true });
  assert.deepEqual(result, { assetId: 91, assetName: '灯塔·旁白', otherEpisodesBound: 0 });
  assert.deepEqual(narratorSet, [{ workId: 1, assetId: 91 }]);
  assert.equal(bound.length, 0);
  assert.equal(drafts.find(1, 'narrator'), undefined);
});

test('采用校验：没有试听音色、本集已有音色、名称不合法或重名', async () => {
  const { service, created } = createFixture({ voiceBindings: { 1: [OTHER_ID] }, takenNames: ['重名'] });
  assert.throws(() => service.adopt(1, { episodeId: 1, entityId: SPEAKER_ID, name: '音色' }), NotFoundError);

  await service.createDraft(1, draftRequest());
  await service.createDraft(1, draftRequest({ entityId: OTHER_ID }));
  assert.throws(() => service.adopt(1, { episodeId: 1, entityId: OTHER_ID, name: '音色' }), (error: unknown) => error instanceof ValidationError && /已经绑定了音色/.test(error.message));
  assert.throws(() => service.adopt(1, { episodeId: 1, entityId: SPEAKER_ID, name: '  ' }), ValidationError);
  assert.throws(() => service.adopt(1, { episodeId: 1, entityId: SPEAKER_ID, name: '重名' }), ConflictError);
  assert.equal(created.length, 0);
});

test('采用时绑定失败：不留下没人用的新资产，暂存保留以便重试', async () => {
  const { service, deleted, drafts } = createFixture({ bindFailsOnEpisode: 2 });
  await service.createDraft(1, draftRequest());
  assert.throws(() => service.adopt(1, { episodeId: 1, entityId: SPEAKER_ID, name: '音色甲', applyToOtherEpisodes: true }), ValidationError);
  assert.deepEqual(deleted, [91]);
  assert.ok(drafts.find(1, `entity:${SPEAKER_ID}`) !== undefined);
});
