// ------------------------------------------------------------------------
// 名称：voice-preview-service.ts
// 说明：分镜动画台词试听服务：列出可选的声音模型，用说话人的音色（绑定的音色参考，或还没绑定时暂存的试听音色）与所选音频模型把一条对白或旁白合成为语音，并缓存结果。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：不依赖 VS Code；只试听已保存的对白与旁白（模型会产生费用，没有音色的说话人不调用）；角色音色取本集绑定的主音色参考，旁白取作品的旁白音色，都没有时取暂存的试听音色；模型支持参考音频时用音色参考，否则用资产记录的预置音色，没有记录再按说话人固定挑一个；缓存键含模型、提示词、音色与参考音频内容，台词、说话方式、音色或模型任一变化都会重新调用模型，没有变化则直接用缓存；缓存先查内存再查本地磁盘（diskCache），重启扩展后仍可用，磁盘读写失败不影响合成；restore 只读缓存把本集已合成的配音返回（不调用模型）；render 同时供“按描述生成音色”使用。
// ------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { FORM_LEVEL_ERROR_KEY, NotFoundError, ProviderError, ValidationError } from '../../domain/errors';
import { AudioCapability } from '../../domain/models/model-capability';
import { AssetRepository } from '../../domain/ports/asset-repository';
import { BindingRepository } from '../../domain/ports/binding-repository';
import { MediaDownloader } from '../../domain/ports/media-downloader';
import { NarratorVoiceRepository } from '../../domain/ports/narrator-voice-repository';
import { AudioGenerationRequest, AudioJobResult, RemoteJobRef, ResolvedAudioCall } from '../../domain/ports/provider-adapters';
import { VoiceCache } from '../../domain/ports/voice-cache';
import { ASSET_AUDIO_MAX_BYTES, AUDIO_PRESET_VOICE_KEY, detectAudioMime } from '../../domain/rules/asset-rules';
import { buildVoicePrompt, pickPresetVoice, readVoicePreviewInput, readVoiceRestoreInput, toLanguageCode, toSpeakerKey } from '../../domain/rules/voice-preview-rules';
import { ProviderService } from './provider-service';
import { StoryboardService } from './storyboard-service';
import { VoiceDraftStore } from './voice-draft-store';

/** 没有可用声音模型时的提示。 */
export const NO_VOICE_MODEL_MESSAGE = '还没有可用的声音模型：请到“模型设置”启用音频服务商、填写访问密钥，并启用支持语音的音频模型。';

/** 内存缓存最多保留的条数。 */
const CACHE_MAX_ENTRIES = 40;
/** 内存缓存的 Base64 总长度上限。 */
const CACHE_MAX_CHARS = 64 * 1024 * 1024;
/** 等待合成结果的最大轮询次数与间隔；千问、豆包语音的提交都是同步的，第一次查询即成功。 */
const MAX_POLLS = 30;
const POLL_INTERVAL_MS = 1000;
/** 旁白在界面与提示里的称呼。 */
export const NARRATOR_NAME = '旁白';

/** 下拉里的一个声音模型。 */
export interface VoiceModelOption {
  readonly id: number;
  /** 服务商与模型名称。 */
  readonly label: string;
  /** 是否支持参考音频：支持时用音色参考合成，否则用预置音色。 */
  readonly supportsReference: boolean;
  /** 模型的预置音色；支持参考音频的模型通常为空。 */
  readonly voices: readonly string[];
}

/** 声音模型选项与不可用时的提示。 */
export interface VoicePreviewOptions {
  readonly models: readonly VoiceModelOption[];
  /** 没有可用模型时的提示，要求用户去配置；有模型时为 null。 */
  readonly unavailableHint: string | null;
}

/** 一条对白的试听结果。 */
export interface VoicePreviewResult {
  /** 音频的 MIME 类型。 */
  readonly mime: string;
  /** Base64 音频内容（不带前缀）。 */
  readonly data: string;
  /** 是否直接使用了缓存（没有调用模型）。 */
  readonly cached: boolean;
  /** 需要提醒的说明，如所选模型不支持参考音频；没有时为 null。 */
  readonly note: string | null;
}

/** 从缓存读回的一条配音。 */
export interface RestoredVoice {
  readonly soundId: number;
  /** 音频的 MIME 类型。 */
  readonly mime: string;
  /** Base64 音频内容（不带前缀）。 */
  readonly data: string;
}

/** 读取已保存配音的结果：缓存里有的对白，没有的不返回。 */
export interface VoiceRestoreResult {
  readonly clips: readonly RestoredVoice[];
}

/** 按请求合成的结果。 */
export interface RenderedVoice {
  readonly mime: string;
  /** Base64 音频内容（不带前缀）。 */
  readonly data: string;
  /** 平台返回的音频时长（秒）；没有返回时为 null。 */
  readonly durationSeconds: number | null;
  /** 是否直接使用了缓存（没有调用模型）。 */
  readonly cached: boolean;
}

/** 台词试听服务的依赖。 */
export interface VoicePreviewServiceDependencies {
  readonly storyboards: Pick<StoryboardService, 'getView'>;
  readonly bindings: Pick<BindingRepository, 'listByEpisode'>;
  readonly assets: Pick<AssetRepository, 'findById' | 'listReferenceFiles'>;
  /** 作品的旁白音色。 */
  readonly narrators: Pick<NarratorVoiceRepository, 'find'>;
  /** 说话人还没有绑定音色时，暂存的试听音色。 */
  readonly drafts: Pick<VoiceDraftStore, 'find'>;
  readonly providers: Pick<ProviderService, 'listUsableModels' | 'resolveAudioCall'>;
  readonly downloader: MediaDownloader;
  /** 合成结果的本地磁盘缓存：重启扩展、重新打开预览后仍然可用；缺省只用内存缓存。 */
  readonly diskCache?: VoiceCache;
  /** 轮询间隔的等待函数，测试时可注入立即返回的实现。 */
  readonly wait?: (milliseconds: number) => Promise<void>;
}

/** 一条缓存的合成结果。 */
interface CachedVoice {
  readonly mime: string;
  readonly data: string;
  readonly durationSeconds: number | null;
}

/** 说话人的音色来源：音色参考样本、语言与预置音色。 */
interface VoiceSource {
  readonly speakerName: string;
  /** 为没有记录预置音色的说话人按它固定挑一个预置音色。 */
  readonly seed: number;
  readonly sample: { readonly mime: string; readonly content: Buffer };
  /** 语言代码（zh、en）；不确定时为 null。 */
  readonly language: string | null;
  /** 音色记录的预置音色；没有时为 null。 */
  readonly presetVoice: string | null;
}

/** 台词试听服务。 */
export class VoicePreviewService {
  private readonly cache = new Map<string, CachedVoice>();
  private cacheChars = 0;
  /** 正在合成的请求：相同内容的重复请求共用一次调用。 */
  private readonly pending = new Map<string, Promise<CachedVoice>>();
  private readonly wait: (milliseconds: number) => Promise<void>;

  constructor(private readonly dependencies: VoicePreviewServiceDependencies) {
    this.wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  /** 列出可选的声音模型：模型与服务商都已启用、已配置访问密钥，且能生成语音。 */
  async getOptions(): Promise<VoicePreviewOptions> {
    const usable = await this.dependencies.providers.listUsableModels('audio');
    const models = usable
      .filter((item) => (item.model.capability as AudioCapability).audioKinds.includes('voice'))
      .map((item) => ({
        id: item.model.id,
        label: `${item.providerName} · ${item.model.displayName}`,
        supportsReference: (item.model.capability as AudioCapability).referenceAudio,
        voices: (item.model.capability as AudioCapability).voices
      }));
    return { models, unavailableHint: models.length === 0 ? NO_VOICE_MODEL_MESSAGE : null };
  }

  /**
   * 合成一条对白或旁白。
   * @param workId 作品标识，已由页面校验归属。
   * @param rawInput 界面提交的原始内容：episodeId、runId（可选）、soundId、modelId。
   * @throws ValidationError 请求不合法，声音不是对白或旁白，没有台词，说话人还没有音色，或请求不符合模型能力。
   * @throws NotFoundError 声音条目已不存在，或音色参考还没有音频文件。
   * @throws ProviderError 模型不可用、没有访问密钥，或合成失败。
   */
  async synthesize(workId: number, rawInput: unknown): Promise<VoicePreviewResult> {
    const input = readVoicePreviewInput(rawInput);
    const { storyboards, providers } = this.dependencies;
    const view = storyboards.getView(workId, input.episodeId, input.runId);
    const sound = view.shots.flatMap((shot) => shot.sounds).find((candidate) => candidate.id === input.soundId);
    if (sound === undefined) {
      throw new NotFoundError('这条声音已不存在，可能刚被修改，请重新播放。');
    }
    const isDialogue = sound.kind === 'dialogue' && sound.speakerEntityId !== null;
    if (!isDialogue && sound.kind !== 'narration') {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '只能试听有说话人的角色对白与旁白。' });
    }
    if (sound.text.trim() === '') {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: isDialogue ? '这条对白没有台词。' : '这条旁白没有台词。' });
    }
    const speakerId = isDialogue ? sound.speakerEntityId : null;
    const speakerName = speakerId === null ? NARRATOR_NAME : (view.entities.find((entity) => entity.id === speakerId)?.name ?? '说话人');
    const source = this.resolveVoiceSource(workId, input.episodeId, speakerId, speakerName);

    const call = await providers.resolveAudioCall(input.modelId);
    const capability = this.requireVoiceCapability(call);
    const { request, note } = buildSoundRequest(call, capability, sound, source);
    const rendered = await this.render(input.modelId, call, request, input.regenerate);
    return { mime: rendered.mime, data: rendered.data, cached: rendered.cached, note };
  }

  /**
   * 读取本集里已经合成并保存过的配音：只查缓存（内存与本地磁盘），不调用模型，没有结果的对白不返回。
   * 台词、说话方式、音色或模型变了的对白，缓存键随之变化，所以不会命中，需要重新合成。
   * @param workId 作品标识，已由页面校验归属。
   * @param rawInput 界面提交的原始内容：episodeId、runId（可选）、modelId。
   * @throws ValidationError 请求不合法，或所选模型不能生成语音。
   * @throws ProviderError 模型不可用或没有访问密钥。
   */
  async restore(workId: number, rawInput: unknown): Promise<VoiceRestoreResult> {
    const input = readVoiceRestoreInput(rawInput);
    const { storyboards, providers } = this.dependencies;
    const view = storyboards.getView(workId, input.episodeId, input.runId);
    const call = await providers.resolveAudioCall(input.modelId);
    const capability = this.requireVoiceCapability(call);
    /** 同一说话人的音色来源只读取一次；没有音色或没有音频文件的说话人记为 null。 */
    const sources = new Map<string, VoiceSource | null>();
    const clips: RestoredVoice[] = [];
    for (const sound of view.shots.flatMap((shot) => shot.sounds)) {
      const isDialogue = sound.kind === 'dialogue' && sound.speakerEntityId !== null;
      if ((!isDialogue && sound.kind !== 'narration') || sound.text.trim() === '') {
        continue;
      }
      const speakerId = isDialogue ? sound.speakerEntityId : null;
      const speakerKey = toSpeakerKey(speakerId);
      if (!sources.has(speakerKey)) {
        const speakerName = speakerId === null ? NARRATOR_NAME : (view.entities.find((entity) => entity.id === speakerId)?.name ?? '说话人');
        try {
          sources.set(speakerKey, this.resolveVoiceSource(workId, input.episodeId, speakerId, speakerName));
        } catch {
          sources.set(speakerKey, null);
        }
      }
      const source = sources.get(speakerKey);
      if (source === null || source === undefined) {
        continue;
      }
      const { request } = buildSoundRequest(call, capability, sound, source);
      const hit = this.lookup(cacheKey(input.modelId, request));
      if (hit !== undefined) {
        clips.push({ soundId: sound.id, mime: hit.mime, data: hit.data });
      }
    }
    return { clips };
  }

  /** 所选模型必须能生成语音。 */
  private requireVoiceCapability(call: ResolvedAudioCall): AudioCapability {
    const capability = call.adapter.getCapability(call.modelCode);
    if (capability === undefined || !capability.audioKinds.includes('voice')) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '所选模型不能生成语音，请重新选择声音模型。' });
    }
    return capability;
  }

  /** 先查内存缓存，再查本地磁盘缓存（命中后放进内存）；都没有返回 undefined。 */
  private lookup(key: string): CachedVoice | undefined {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      // 命中后移到末尾，最近用过的最后淘汰。
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    let entry;
    try {
      entry = this.dependencies.diskCache?.get(key);
    } catch {
      return undefined;
    }
    if (entry === undefined) {
      return undefined;
    }
    const voice: CachedVoice = { mime: entry.mime, data: entry.content.toString('base64'), durationSeconds: null };
    this.remember(key, voice);
    return voice;
  }

  /** 把合成结果写进本地磁盘缓存；写入失败不影响本次合成。 */
  private persist(key: string, voice: CachedVoice): void {
    try {
      this.dependencies.diskCache?.put(key, voice.mime, Buffer.from(voice.data, 'base64'));
    } catch {
      // 缓存只是为了省钱，写不进去就算了。
    }
  }

  /**
   * 按请求调用模型合成一段语音并缓存（内存与本地磁盘）；内容没有变化时直接用缓存，相同内容的并发请求共用一次调用。
   * @param modelId 音频模型标识，参与缓存键。
   * @param call 已解析的模型调用。
   * @param request 合成请求。
   * @param fresh 为 true 时不读缓存，重新调用模型，结果仍写入缓存并替换旧结果。
   * @throws ValidationError 请求不符合模型能力。
   * @throws ProviderError 合成失败。
   */
  async render(modelId: number, call: ResolvedAudioCall, request: AudioGenerationRequest, fresh = false): Promise<RenderedVoice> {
    const key = cacheKey(modelId, request);
    const cached = fresh ? undefined : this.lookup(key);
    if (cached !== undefined) {
      return { ...cached, cached: true };
    }
    let running = fresh ? undefined : this.pending.get(key);
    if (running === undefined) {
      const started = this.generate(call, request).finally(() => {
        if (this.pending.get(key) === started) this.pending.delete(key);
      });
      running = started;
      this.pending.set(key, started);
    }
    const voice = await running;
    this.remember(key, voice, fresh);
    this.persist(key, voice);
    return { ...voice, cached: false };
  }

  /**
   * 找出说话人的音色来源：角色取本集绑定的主音色参考，旁白取作品的旁白音色；都没有时取暂存的试听音色。
   * @throws ValidationError 说话人还没有音色。
   * @throws NotFoundError 音色参考还没有音频文件。
   */
  private resolveVoiceSource(workId: number, episodeId: number, speakerId: number | null, speakerName: string): VoiceSource {
    const { bindings, assets, narrators, drafts } = this.dependencies;
    let assetId: number | undefined;
    let assetName = '';
    if (speakerId === null) {
      const narrator = narrators.find(workId);
      assetId = narrator?.assetId;
      assetName = narrator?.assetName ?? '';
    } else {
      const binding = bindings.listByEpisode(episodeId).find((item) => item.entityId === speakerId && item.purpose === 'voice' && item.isPrimary);
      assetId = binding?.assetId;
      assetName = binding?.assetName ?? '';
    }
    if (assetId !== undefined) {
      const [voiceFile] = assets.listReferenceFiles(assetId);
      if (voiceFile === undefined) {
        throw new NotFoundError(`音色参考“${assetName}”还没有音频文件，请先上传，或生成并采用。`);
      }
      const asset = assets.findById(assetId);
      return {
        speakerName,
        seed: speakerId ?? 0,
        sample: { mime: voiceFile.mime, content: voiceFile.content },
        language: toLanguageCode(asset?.attributes.language, ['zh', 'en']),
        presetVoice: asset?.attributes[AUDIO_PRESET_VOICE_KEY] ?? null
      };
    }
    const draft = drafts.find(workId, toSpeakerKey(speakerId));
    if (draft !== undefined) {
      return { speakerName, seed: speakerId ?? 0, sample: { mime: draft.mime, content: draft.content }, language: draft.language, presetVoice: draft.presetVoice };
    }
    const hint = speakerId === null ? '请先在动画预览里生成旁白音色。' : '请先在动画预览里为角色生成音色，或在生成工作台的“绑定素材”里绑定音色。';
    throw new ValidationError({
      [FORM_LEVEL_ERROR_KEY]: speakerId === null ? `${speakerName}还没有音色，${hint}` : `“${speakerName}”还没有绑定音色参考，${hint}`
    });
  }

  /** 调用模型合成并下载结果。 */
  private async generate(call: ResolvedAudioCall, request: AudioGenerationRequest): Promise<CachedVoice> {
    const issues = call.adapter.validate(request);
    if (issues.length > 0) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: issues.join('；') });
    }
    const ref = await call.adapter.submit(request, call.context);
    const result = await this.waitForAudio(call, ref);
    const content = await this.dependencies.downloader.download(result.audioUrl, ASSET_AUDIO_MAX_BYTES);
    const mime = detectAudioMime(content);
    if (mime === null) {
      throw new ProviderError('server', '平台返回的文件不是有效的 MP3、WAV 或 M4A 音频。');
    }
    return { mime, data: content.toString('base64'), durationSeconds: result.durationSeconds };
  }

  /** 轮询任务直到成功，返回音频结果；失败、取消、过期或超时时抛出 ProviderError。 */
  private async waitForAudio(call: ResolvedAudioCall, ref: RemoteJobRef): Promise<AudioJobResult> {
    for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
      const state = await call.adapter.query(ref, call.context);
      switch (state.status) {
        case 'succeeded':
          if (state.result === null) {
            throw new ProviderError('server', '平台报告合成已完成，但没有返回音频。');
          }
          return state.result;
        case 'failed':
          throw new ProviderError(state.errorCategory ?? 'server', state.errorMessage ?? '平台没有返回失败原因。', { code: state.errorCode });
        case 'canceled':
          throw new ProviderError('server', '语音合成已被取消。');
        case 'expired':
          throw new ProviderError('server', '平台已不再保留这次合成，请重试。');
        default:
          await this.wait(POLL_INTERVAL_MS);
      }
    }
    throw new ProviderError('server', '等待语音合成结果超时，请稍后重试。');
  }

  /** 写入缓存，超过条数或总大小上限时淘汰最久没用的；replace 为 true 时用新结果替换同一键的旧结果。 */
  private remember(key: string, voice: CachedVoice, replace = false): void {
    const old = this.cache.get(key);
    if (old !== undefined) {
      if (!replace) {
        return;
      }
      this.cache.delete(key);
      this.cacheChars -= old.data.length;
    }
    this.cache.set(key, voice);
    this.cacheChars += voice.data.length;
    for (const [oldKey, old] of this.cache) {
      if (this.cache.size <= CACHE_MAX_ENTRIES && this.cacheChars <= CACHE_MAX_CHARS) {
        break;
      }
      if (oldKey === key) {
        continue;
      }
      this.cache.delete(oldKey);
      this.cacheChars -= old.data.length;
    }
  }
}

/**
 * 按声音条目、说话人的音色与模型能力构造合成请求；支持参考音频的模型用音色参考，否则用预置音色（没用记录的音色时附说明）。
 * 合成与“读取已保存配音”共用它，保证两边算出的缓存键一致。
 */
function buildSoundRequest(
  call: ResolvedAudioCall,
  capability: AudioCapability,
  sound: { readonly text: string; readonly delivery: string },
  source: VoiceSource
): { readonly request: AudioGenerationRequest; readonly note: string | null } {
  const useReference = capability.referenceAudio;
  const presetVoice = useReference ? null : choosePresetVoice(capability.voices, source);
  const request: AudioGenerationRequest = {
    modelCode: call.modelCode,
    audioKind: 'voice',
    prompt: buildVoicePrompt(sound.text, sound.delivery, useReference ? (capability.referenceMark ?? null) : null),
    durationSeconds: null,
    language: source.language !== null && capability.languages.includes(source.language) ? source.language : null,
    voice: presetVoice,
    referenceAudio: useReference ? { mimeType: source.sample.mime, data: source.sample.content } : null,
    delivery: useReference ? '' : sound.delivery,
    extraParams: {}
  };
  const recorded = presetVoice !== null && presetVoice === source.presetVoice;
  const note = useReference || recorded ? null : `所选模型不支持参考音频，“${source.speakerName}”按预置音色试听，与音色参考不同。`;
  return { request, note };
}

/** 只有预置音色的模型所用的音色：优先用音色记录的预置音色（模型提供时），否则按说话人固定挑一个。 */
function choosePresetVoice(voices: readonly string[], source: VoiceSource): string | null {
  if (source.presetVoice !== null && voices.includes(source.presetVoice)) {
    return source.presetVoice;
  }
  return pickPresetVoice(voices, source.seed);
}

/** 缓存键：模型、提示词、音色、语言与参考音频内容任一变化，键就变化。 */
function cacheKey(modelId: number, request: AudioGenerationRequest): string {
  const hash = createHash('sha256');
  hash.update(`${modelId}\n${request.prompt}\n${request.voice ?? ''}\n${request.language ?? ''}\n${request.delivery ?? ''}\n`);
  if (request.referenceAudio !== null) {
    hash.update(request.referenceAudio.data);
  }
  return hash.digest('hex');
}
