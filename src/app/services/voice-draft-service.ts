// ------------------------------------------------------------------------
// 名称：voice-draft-service.ts
// 说明：分镜动画里“按描述生成音色”的服务：说话人（角色或旁白）还没有音色时，按剧本里的音色描述让声音模型生成一段试听音色并暂存，用户满意后采用：保存为音色参考音频资产并绑定。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：不依赖 VS Code；生成会调用模型并产生费用，只在用户点击时发生；试听音色只暂存在内存里，动画预览把它当作临时音色播放，采用后才写入资产与绑定；角色音色绑定到当前集，可选同时绑定到作品里其他还没有该角色音色的集，旁白音色按作品保存、所有集共用；模型支持参考音频时按描述合成，样本即参考音频，只有预置音色的模型按所选预置音色合成，并把音色名记在资产里。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, NotFoundError, ValidationError } from '../../domain/errors';
import { NarratorVoiceRepository } from '../../domain/ports/narrator-voice-repository';
import { AudioGenerationRequest } from '../../domain/ports/provider-adapters';
import {
  buildDraftPrompt,
  guessLanguageCode,
  pickPresetVoice,
  readVoiceAdoptInput,
  readVoiceDraftInput,
  readVoiceSpeakerInput,
  toLanguageLabel,
  toSpeakerKey,
  VoiceSpeakerInput
} from '../../domain/rules/voice-preview-rules';
import { AssetService } from './asset-service';
import { BindingService } from './binding-service';
import { ProviderService } from './provider-service';
import { StoryboardService } from './storyboard-service';
import { VoiceDraftStore } from './voice-draft-store';
import { NARRATOR_NAME, VoicePreviewService } from './voice-preview-service';

/** 音色描述缺省时从身份与概述取的最大字数。 */
const FALLBACK_DESCRIPTION_MAX_LENGTH = 200;

/** 样本文件的扩展名，按 MIME 类型。 */
const SAMPLE_EXTENSIONS: Readonly<Record<string, string>> = { 'audio/wav': '.wav', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a' };

/** 旁白当前的音色状态：已有作品旁白音色、只有暂存的试听音色、都没有。 */
export type NarratorVoiceState = 'bound' | 'draft' | 'none';

/** 作品里各说话人的临时音色与旁白音色状态，预览据此决定对白与旁白能否试听。 */
export interface VoiceSpeakersView {
  readonly narrator: NarratorVoiceState;
  /** 旁白已绑定的音色参考名称；没有为 null。 */
  readonly narratorAssetName: string | null;
  /** 有暂存试听音色的角色实体标识。 */
  readonly draftEntityIds: readonly number[];
}

/** 暂存的试听音色，带样本音频。 */
export interface VoiceDraftView {
  readonly modelId: number;
  readonly mime: string;
  /** Base64 样本音频（不带前缀）。 */
  readonly data: string;
  readonly sampleText: string;
  readonly description: string;
  readonly presetVoice: string | null;
}

/** 打开“生成音色”对话框所需的信息。 */
export interface VoiceDraftInfo {
  readonly speakerName: string;
  /** 角色设定里的音色描述；没有时取身份与概述；旁白没有。 */
  readonly description: string;
  /** 已暂存的试听音色；没有为 null。 */
  readonly draft: VoiceDraftView | null;
  /** 采用后新资产的建议名称，保证没有重名。 */
  readonly suggestedName: string;
  /** 作品里其他还没有该角色音色的集数；旁白与采用后绑定的都是整个作品，为 0。 */
  readonly otherEpisodes: number;
  /** 旁白已有的作品音色参考名称；没有为 null。 */
  readonly narratorAssetName: string | null;
}

/** 生成试听音色的结果。 */
export interface VoiceDraftResult extends VoiceDraftView {
  /** 是否用了缓存（没有调用模型）。 */
  readonly cached: boolean;
  /** 需要提醒的说明，如所选模型只有预置音色；没有为 null。 */
  readonly note: string | null;
}

/** 采用音色的结果。 */
export interface VoiceAdoptResult {
  readonly assetId: number;
  readonly assetName: string;
  /** 除当前集外，同时绑定的集数。 */
  readonly otherEpisodesBound: number;
}

/** 按描述生成音色服务的依赖。 */
export interface VoiceDraftServiceDependencies {
  readonly storyboards: Pick<StoryboardService, 'getView'>;
  readonly bindings: Pick<BindingService, 'getEntityDetail' | 'bind' | 'listBindings' | 'listSiblingEpisodeIds'>;
  readonly assets: Pick<AssetService, 'createVoiceAsset' | 'deleteAsset' | 'isNameAvailable'>;
  readonly narrators: Pick<NarratorVoiceRepository, 'find' | 'set'>;
  readonly drafts: VoiceDraftStore;
  readonly providers: Pick<ProviderService, 'resolveAudioCall'>;
  readonly voices: Pick<VoicePreviewService, 'render'>;
  readonly now?: () => Date;
}

/** 已确认的说话人：角色实体标识（旁白为 null）、名称与所属作品名称。 */
interface ResolvedSpeaker {
  readonly entityId: number | null;
  readonly name: string;
  readonly workName: string;
}

/** 按描述生成音色服务。 */
export class VoiceDraftService {
  constructor(private readonly dependencies: VoiceDraftServiceDependencies) {}

  /** 读取作品里各说话人的临时音色与旁白音色状态。 */
  getSpeakers(workId: number): VoiceSpeakersView {
    const { narrators, drafts } = this.dependencies;
    const narrator = narrators.find(workId);
    const stored = drafts.listByWork(workId);
    const draftEntityIds = stored.flatMap((draft) => {
      const match = /^entity:(\d+)$/.exec(draft.speakerKey);
      return match === null ? [] : [Number(match[1])];
    });
    const narratorDraft = stored.some((draft) => draft.speakerKey === toSpeakerKey(null));
    return {
      narrator: narrator !== undefined ? 'bound' : narratorDraft ? 'draft' : 'none',
      narratorAssetName: narrator?.assetName ?? null,
      draftEntityIds
    };
  }

  /**
   * 读取“生成音色”对话框所需的信息。
   * @param workId 作品标识，已由页面校验归属。
   * @param rawInput 界面提交的原始内容：episodeId、entityId（旁白不填）。
   * @throws ValidationError 请求不合法，或说话人不是角色、旁白。
   * @throws NotFoundError 集或角色不存在。
   */
  getDraftInfo(workId: number, rawInput: unknown): VoiceDraftInfo {
    const { drafts, narrators, bindings, assets } = this.dependencies;
    const input = readVoiceSpeakerInput(rawInput);
    const speaker = this.resolveSpeaker(workId, input);
    const key = toSpeakerKey(speaker.entityId);
    const stored = drafts.find(workId, key);

    let description = '';
    let otherEpisodes = 0;
    if (speaker.entityId !== null) {
      const detail = bindings.getEntityDetail(input.episodeId, speaker.entityId);
      description = detail.attributes.voice ?? [detail.attributes.identity ?? '', detail.description].filter((text) => text.trim() !== '').join('；').slice(0, FALLBACK_DESCRIPTION_MAX_LENGTH);
      otherEpisodes = this.listEpisodesWithoutVoice(input.episodeId, speaker.entityId).length;
    }
    const baseName = speaker.entityId === null ? `${speaker.workName}·${NARRATOR_NAME}` : `${speaker.name}·音色`;
    let suggestedName = baseName;
    for (let index = 2; !assets.isNameAvailable('audio', suggestedName) && index < 100; index += 1) {
      suggestedName = `${baseName} ${index}`;
    }
    return {
      speakerName: speaker.name,
      description,
      draft: stored === undefined ? null : toDraftView(stored),
      suggestedName,
      otherEpisodes,
      narratorAssetName: speaker.entityId === null ? (narrators.find(workId)?.assetName ?? null) : null
    };
  }

  /**
   * 按描述生成一段试听音色并暂存，替换这位说话人已有的试听音色。
   * @param workId 作品标识，已由页面校验归属。
   * @param rawInput 界面提交的原始内容：episodeId、entityId（旁白不填）、modelId、sampleText、delivery、description、presetVoice、regenerate。
   * @throws ValidationError 请求不合法、模型不能生成语音，或请求不符合模型能力。
   * @throws NotFoundError 集或角色不存在。
   * @throws ProviderError 模型不可用、没有访问密钥，或合成失败。
   */
  async createDraft(workId: number, rawInput: unknown): Promise<VoiceDraftResult> {
    const { providers, voices, drafts } = this.dependencies;
    const input = readVoiceDraftInput(rawInput);
    const speaker = this.resolveSpeaker(workId, input);
    const call = await providers.resolveAudioCall(input.modelId);
    const capability = call.adapter.getCapability(call.modelCode);
    if (capability === undefined || !capability.audioKinds.includes('voice')) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '所选模型不能生成语音，请重新选择声音模型。' });
    }

    // 支持参考音频的模型按描述生成，样本之后当作参考音频；只有预置音色的模型按所选的预置音色朗读。
    const byDescription = capability.referenceAudio;
    const presetVoice = byDescription ? null : capability.voices.includes(input.presetVoice ?? '') ? input.presetVoice : pickPresetVoice(capability.voices, speaker.entityId ?? 0);
    const guessed = guessLanguageCode(input.sampleText);
    const language = guessed !== null && capability.languages.includes(guessed) ? guessed : null;
    const request: AudioGenerationRequest = {
      modelCode: call.modelCode,
      audioKind: 'voice',
      prompt: byDescription ? buildDraftPrompt(input.description, input.delivery, input.sampleText) : input.sampleText,
      durationSeconds: null,
      language,
      voice: presetVoice,
      referenceAudio: null,
      delivery: byDescription ? '' : input.delivery,
      extraParams: {}
    };
    const rendered = await voices.render(input.modelId, call, request, input.regenerate);
    drafts.save({
      workId,
      speakerKey: toSpeakerKey(speaker.entityId),
      modelId: input.modelId,
      mime: rendered.mime,
      content: Buffer.from(rendered.data, 'base64'),
      durationSeconds: rendered.durationSeconds,
      sampleText: input.sampleText,
      description: input.description,
      language,
      presetVoice
    });
    return {
      modelId: input.modelId,
      mime: rendered.mime,
      data: rendered.data,
      sampleText: input.sampleText,
      description: input.description,
      presetVoice,
      cached: rendered.cached,
      note: byDescription ? null : '所选模型只有预置音色，音色描述不会影响声音；可以换一个预置音色，或换用支持按描述生成音色的模型。'
    };
  }

  /**
   * 采用暂存的试听音色：保存为“音色参考”音频资产并绑定（角色绑定到当前集，旁白设为作品的旁白音色）。
   * @param workId 作品标识，已由页面校验归属。
   * @param rawInput 界面提交的原始内容：episodeId、entityId（旁白不填）、name、applyToOtherEpisodes。
   * @throws ValidationError 请求不合法，名称不合法，或角色在本集已绑定音色。
   * @throws NotFoundError 集或角色不存在，或还没有可采用的试听音色。
   * @throws ConflictError 已有同名的音频资产。
   */
  adopt(workId: number, rawInput: unknown): VoiceAdoptResult {
    const { drafts, assets, bindings, narrators } = this.dependencies;
    const input = readVoiceAdoptInput(rawInput);
    const speaker = this.resolveSpeaker(workId, input);
    const key = toSpeakerKey(speaker.entityId);
    const draft = drafts.find(workId, key);
    if (draft === undefined) {
      throw new NotFoundError('没有可采用的试听音色，可能已被替换，请重新生成。');
    }
    if (speaker.entityId !== null && this.hasVoiceBinding(input.episodeId, speaker.entityId)) {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: `“${speaker.name}”在本集已经绑定了音色，不能再采用试听音色。` });
    }

    const asset = assets.createVoiceAsset({
      name: input.name,
      description: draft.description,
      language: toLanguageLabel(draft.language),
      presetVoice: draft.presetVoice,
      fileName: `voice-sample${SAMPLE_EXTENSIONS[draft.mime] ?? '.wav'}`,
      content: draft.content,
      durationSeconds: draft.durationSeconds
    });
    let otherEpisodesBound = 0;
    try {
      if (speaker.entityId === null) {
        narrators.set(workId, asset.id, this.timestamp());
      } else {
        bindings.bind({ episodeId: input.episodeId, entityId: speaker.entityId, assetId: asset.id, purpose: 'voice' });
        if (input.applyToOtherEpisodes) {
          for (const episodeId of this.listEpisodesWithoutVoice(input.episodeId, speaker.entityId)) {
            bindings.bind({ episodeId, entityId: speaker.entityId, assetId: asset.id, purpose: 'voice' });
            otherEpisodesBound += 1;
          }
        }
      }
    } catch (error) {
      // 绑定失败时不留下没人用的新资产。
      assets.deleteAsset(asset.id);
      throw error;
    }
    drafts.delete(workId, key);
    return { assetId: asset.id, assetName: asset.name, otherEpisodesBound };
  }

  /** 确认说话人：集属于作品，角色存在且是角色类型；旁白不需要实体。 */
  private resolveSpeaker(workId: number, input: VoiceSpeakerInput): ResolvedSpeaker {
    const view = this.dependencies.storyboards.getView(workId, input.episodeId);
    if (input.entityId === null) {
      return { entityId: null, name: NARRATOR_NAME, workName: view.work.name };
    }
    const entity = view.entities.find((candidate) => candidate.id === input.entityId);
    if (entity === undefined) {
      throw new NotFoundError('角色不存在，可能刚被删除。');
    }
    if (entity.kind !== 'character') {
      throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '只有角色可以生成音色。' });
    }
    return { entityId: entity.id, name: entity.name, workName: view.work.name };
  }

  /** 角色在这一集是否已有主音色绑定。 */
  private hasVoiceBinding(episodeId: number, entityId: number): boolean {
    return this.dependencies.bindings.listBindings(episodeId).some((binding) => binding.entityId === entityId && binding.purpose === 'voice' && binding.isPrimary);
  }

  /** 作品里除这一集外还没有该角色音色的集。 */
  private listEpisodesWithoutVoice(episodeId: number, entityId: number): number[] {
    return this.dependencies.bindings.listSiblingEpisodeIds(episodeId).filter((id) => id !== episodeId && !this.hasVoiceBinding(id, entityId));
  }

  private timestamp(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}

/** 暂存的试听音色转成界面视图。 */
function toDraftView(draft: { readonly modelId: number; readonly mime: string; readonly content: Buffer; readonly sampleText: string; readonly description: string; readonly presetVoice: string | null }): VoiceDraftView {
  return {
    modelId: draft.modelId,
    mime: draft.mime,
    data: draft.content.toString('base64'),
    sampleText: draft.sampleText,
    description: draft.description,
    presetVoice: draft.presetVoice
  };
}
