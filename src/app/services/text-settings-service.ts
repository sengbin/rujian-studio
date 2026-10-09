// ------------------------------------------------------------------------
// 名称：text-settings-service.ts
// 说明：文本模型设置服务：整理设置页需要的视图（全局默认文本模型、可选模型、小说分段），校验后保存修改，并提供作品单独选择文本模型所需的候选与读写。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-03
// 备注：设置即时保存，不合法的值直接拒绝而不是悄悄回退；可选模型 = 已启用的服务商文本模型（模型与服务商都启用），被关闭或停用的模型不再出现在列表中；作品没有单独选择时使用全局默认；默认或作品单独选择的模型不可用时不换成别的模型（价格不同会带来意外费用），只通过 modelNote、unavailableHint 提示重新选择，未重新选择前生成会失败。
// ------------------------------------------------------------------------

import { ValidationError } from '../../domain/errors';
import { UsableModel } from '../../domain/models/model-provider';
import { TextGenerationSettingsStore } from '../../domain/ports/text-generation-settings-store';
import { WorkTextModelRepository } from '../../domain/ports/work-text-model-repository';
import { NovelSplitMode } from '../../domain/rules/novel-splitter';
import {
  SEGMENT_CHARS_MAX,
  SEGMENT_CHARS_MIN,
  normalizeTextGenerationSettingsPatch
} from '../../domain/rules/text-generation-settings';
import { TEXT_MODEL_KEY_MAX_LENGTH, parseTextModelKey, providerModelKey } from '../../domain/rules/text-model-selection';
import { ChangeNotifier } from './change-notifier';

/** 没有任何可选文本模型时的提示。 */
export const NO_TEXT_MODEL_NOTE = '没有可选的文本模型，生成文本时会失败。请在服务商（如“千问AI平台”“火山引擎”）的设置中启用一个文本模型。';

/** 已保存的默认文本模型已不可用时的提示。 */
export const DEFAULT_MODEL_UNAVAILABLE_HINT = '原来的默认文本模型已不可用，请重新选择；未重新选择前生成文本会失败。';

/** 作品原先单独选择的文本模型已不可用时的提示。 */
export const WORK_MODEL_UNAVAILABLE_HINT = '原选择的文本模型已不可用，请重新选择；未重新选择前生成文本会失败。';

/** 选用的服务商文本模型没有启用。 */
export const MODEL_NOT_ENABLED_MESSAGE = '所选文本模型没有启用，请从列表中选择。';

/** 一个可选的文本模型。 */
export interface TextModelChoice {
  /** 模型的键，见 text-model-selection.ts。 */
  readonly key: string;
  /** 列表中显示的名称，如“千问AI平台 · Qwen3.8 Max（旗舰）”“火山引擎 · 豆包 Seed 2.1 Pro（旗舰）”。 */
  readonly label: string;
}

/** 设置页展示的文本模型设置。 */
export interface TextSettingsView {
  /** 当前生效的全局默认文本模型的键；没有任何可选模型，或已保存的默认模型不可用时为空串。 */
  readonly defaultModel: string;
  /** 全部可选的文本模型。 */
  readonly choices: readonly TextModelChoice[];
  readonly splitMode: NovelSplitMode;
  readonly maxSegmentChars: number;
  /** 每段字数上限的允许范围。 */
  readonly segmentCharsRange: { readonly min: number; readonly max: number };
  /** 模型相关的提示：已保存的默认模型不可用；没有问题时为 null。 */
  readonly modelNote: string | null;
  /** 没有任何可选文本模型时的警告；否则为 null。 */
  readonly engineNote: string | null;
}

/** 作品表单需要的文本模型选择状态。 */
export interface WorkTextModelState {
  readonly choices: readonly TextModelChoice[];
  /** 全局默认文本模型的名称；没有可选模型或默认模型不可用时为 null。 */
  readonly defaultLabel: string | null;
  /** 作品单独选择且当前仍可用的模型键；沿用默认时为 null。 */
  readonly selectedKey: string | null;
  /** 作品原先单独选择的模型已不可用时的提示；没有这种情况时为 null。 */
  readonly unavailableHint: string | null;
}

/** 设置服务对服务商文本模型的需求。 */
export interface TextModelSource {
  /** 列出可供选择的服务商文本模型（模型与服务商都已启用）。 */
  listSelectableTextModels(): UsableModel[];
}

/** 文本模型设置服务。 */
export class TextSettingsService {
  private readonly changeNotifier = new ChangeNotifier();

  constructor(
    private readonly store: TextGenerationSettingsStore,
    private readonly models: TextModelSource,
    private readonly workModels: WorkTextModelRepository
  ) {}

  /** 订阅文本生成设置的变化（如默认文本模型）；返回取消订阅的函数。 */
  onDidChangeSettings(listener: () => void): () => void {
    return this.changeNotifier.subscribe(listener);
  }

  /** 读取设置页视图。 */
  async getView(): Promise<TextSettingsView> {
    const settings = this.store.read();
    const choices = this.buildChoices();
    const effective = findDefaultChoice(choices, settings.defaultModel);
    // 没有保存过默认模型（空串）时直接使用第一个可选模型，不算“已不可用”；保存过却不可用时不换成别的模型。
    const modelNote = settings.defaultModel !== '' && effective === undefined && choices.length > 0 ? DEFAULT_MODEL_UNAVAILABLE_HINT : null;
    return {
      defaultModel: effective?.key ?? '',
      choices,
      splitMode: settings.novelSplit.mode,
      maxSegmentChars: settings.novelSplit.maxSegmentChars,
      segmentCharsRange: { min: SEGMENT_CHARS_MIN, max: SEGMENT_CHARS_MAX },
      modelNote,
      engineNote: choices.length === 0 ? NO_TEXT_MODEL_NOTE : null
    };
  }

  /**
   * 保存设置的修改。
   * @param rawPatch 界面提交的原始内容，只包含要改的项。
   * @throws ValidationError 值不合法、没有要保存的项，或选用了不可用的模型。
   */
  async update(rawPatch: unknown): Promise<void> {
    const patch = normalizeTextGenerationSettingsPatch(rawPatch);
    if (patch.defaultModel !== undefined) {
      this.assertSelectable(patch.defaultModel, 'defaultModel');
    }
    await this.store.write(patch);
    this.changeNotifier.notify();
  }

  /**
   * 读取作品表单需要的文本模型选择状态。
   * @param workId 作品标识；新建作品或不属于作品（资产）时为 null，没有单独选择。
   */
  async getWorkState(workId: number | null): Promise<WorkTextModelState> {
    const settings = this.store.read();
    const choices = this.buildChoices();
    const defaultLabel = findDefaultChoice(choices, settings.defaultModel)?.label ?? null;
    const stored = workId === null ? null : this.workModels.find(workId);
    const selected = stored === null ? undefined : choices.find((choice) => choice.key === stored);
    const unavailableHint = stored === null || selected !== undefined ? null : WORK_MODEL_UNAVAILABLE_HINT;
    return { choices, defaultLabel, selectedKey: selected?.key ?? null, unavailableHint };
  }

  /**
   * 保存或清除作品单独选择的文本模型。
   * @param workId 作品标识。
   * @param modelKey 模型键；null 表示沿用全局默认。
   * @throws ValidationError 选用了不可用的模型。
   */
  setWorkModel(workId: number, modelKey: string | null): void {
    if (modelKey !== null) {
      this.assertSelectable(modelKey, 'textModel');
    }
    this.workModels.save(workId, modelKey);
  }

  /** 校验键可以选用：格式正确，且对应的服务商文本模型已启用。 */
  private assertSelectable(key: string, field: string): void {
    const selection = key.length > TEXT_MODEL_KEY_MAX_LENGTH ? undefined : parseTextModelKey(key);
    if (selection === undefined) {
      throw new ValidationError({ [field]: '文本模型无效，请从列表中选择。' });
    }
    const enabled = this.models
      .listSelectableTextModels()
      .some((item) => item.providerCode === selection.providerCode && item.model.code === selection.modelCode);
    if (!enabled) {
      throw new ValidationError({ [field]: MODEL_NOT_ENABLED_MESSAGE });
    }
  }

  /** 组装可选模型列表：已启用的服务商文本模型。 */
  private buildChoices(): TextModelChoice[] {
    return this.models.listSelectableTextModels().map((item) => ({
      key: providerModelKey(item.providerCode, item.model.code),
      label: `${item.providerName} · ${item.model.displayName}`
    }));
  }
}

/** 找出生效的全局默认模型：没保存过（空串）时是第一个可选模型；保存过却不可用时为 undefined，不换成别的模型。 */
function findDefaultChoice(choices: readonly TextModelChoice[], defaultModel: string): TextModelChoice | undefined {
  return defaultModel === '' ? choices[0] : choices.find((choice) => choice.key === defaultModel);
}
