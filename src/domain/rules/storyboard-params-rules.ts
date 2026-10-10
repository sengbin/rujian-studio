// ------------------------------------------------------------------------
// 名称：storyboard-params-rules.ts
// 说明：分镜脚本阶段生成参数的规则：参数取值范围、连贯策略与声音模式的界面文字、生成参数的校验与规范化。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：界面提交的校验失败抛出 ValidationError；镜头与声音字段的共用限制在 storyboard-shot-fields。
// ------------------------------------------------------------------------

import { AudioMode, ContinuityStrategy, SOUND_KIND_LABELS, SoundKind, StoryboardParams } from '../models/storyboard';
import {
  FieldErrors,
  assertNoFieldErrors,
  isBlank,
  readInteger,
  readOptionalDecimal,
  readOptionalText,
  readRecord
} from './field-readers';
import { DEFAULT_GROUP_MAX_SECONDS, GROUP_SECONDS_MAX, GROUP_SECONDS_MIN } from './shot-group-rules';
import { SHOT_SECONDS_MAX, SHOT_SECONDS_MIN, SOUND_KINDS } from './storyboard-shot-fields';

/** 镜头总数上限的取值范围；不填时取最大值。 */
export const MAX_SHOTS_LIMIT = 200;

/** 分镜补充要求的长度上限。 */
export const STORYBOARD_EXTRA_MAX_LENGTH = 2000;
/** 分镜画面风格的长度上限。 */
export const STORYBOARD_STYLE_MAX_LENGTH = 50;

/** 连贯策略、声音模式的选项，界面显示文字与键一一对应。 */
export const CONTINUITY_LABELS: Readonly<Record<ContinuityStrategy, string>> = {
  cut: '组间硬切（推荐）',
  none: '无',
  prev_tail: '尾帧接首帧',
  ai: '由 AI 判断是否接尾帧'
};
/** 声音模式的界面名称。 */
export const AUDIO_MODE_LABELS: Readonly<Record<AudioMode, string>> = {
  none: '无声',
  native: '模型原生生成'
};

/** 读取声音类型列表：数组，或表单传来的 JSON 数组文本。 */
function readSoundKinds(value: unknown, errors: FieldErrors): SoundKind[] {
  let list: unknown = value;
  if (typeof value === 'string') {
    try {
      list = value.trim() === '' ? [] : JSON.parse(value);
    } catch {
      list = null;
    }
  }
  if (list === undefined || list === null) {
    return [];
  }
  if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
    errors.audioElements = '声音内容格式不正确。';
    return [];
  }
  const labelToKind = new Map(SOUND_KINDS.map((kind) => [SOUND_KIND_LABELS[kind], kind]));
  const kinds: SoundKind[] = [];
  for (const item of list as string[]) {
    // 表单提交的是界面文字，宿主内部使用键，两种写法都接受。
    const kind = SOUND_KINDS.includes(item as SoundKind) ? (item as SoundKind) : labelToKind.get(item);
    if (kind === undefined) {
      errors.audioElements = `声音内容必须是以下之一：${SOUND_KINDS.map((key) => SOUND_KIND_LABELS[key]).join('、')}。`;
      return [];
    }
    if (!kinds.includes(kind)) {
      kinds.push(kind);
    }
  }
  return SOUND_KINDS.filter((kind) => kinds.includes(kind));
}

/** 读取选项：界面文字或键都接受；缺省取默认值。 */
function readLabeledChoice<T extends string>(
  source: Record<string, unknown>,
  key: string,
  label: string,
  labels: Readonly<Record<T, string>>,
  fallback: T,
  errors: FieldErrors
): T {
  const keys = Object.keys(labels) as T[];
  const raw = source[key];
  if (isBlank(raw)) {
    return fallback;
  }
  const matched = typeof raw === 'string' ? keys.find((item) => item === raw || labels[item] === raw) : undefined;
  if (matched === undefined) {
    errors[key] = `${label}必须是以下之一：${keys.map((item) => labels[item]).join('、')}。`;
    return fallback;
  }
  return matched;
}

/**
 * 校验并规范化分镜脚本阶段的生成参数（F5 中影响生成的字段）。
 * @param rawInput 界面提交的原始内容，数字字段可以是数字或文本。
 * @throws ValidationError 存在不合法的字段。
 */
export function normalizeStoryboardParams(rawInput: unknown): StoryboardParams {
  const source = readRecord(rawInput);
  const errors: FieldErrors = {};
  const visualStyle = readOptionalText(
    source,
    { key: 'visualStyle', label: '画面风格', required: false, maxLength: STORYBOARD_STYLE_MAX_LENGTH },
    errors
  );
  const decimal = { min: SHOT_SECONDS_MIN, max: SHOT_SECONDS_MAX, maxDecimals: 1 };
  const minShotSeconds = readOptionalDecimal(source, { key: 'minShotSeconds', label: '单镜头最短时长', ...decimal }, errors);
  const maxShotSeconds = readOptionalDecimal(source, { key: 'maxShotSeconds', label: '单镜头最长时长', ...decimal }, errors);
  // 单镜头时长的范围：最长不能小于最短。
  if (minShotSeconds !== null && maxShotSeconds !== null && maxShotSeconds < minShotSeconds) {
    errors.maxShotSeconds = '单镜头最长时长不能小于最短时长。';
  }
  // 单组最长时长留空取默认值；填了就必须是范围内的整数。
  const rawGroupMax = source.groupMaxSeconds;
  const hasGroupMax = !(rawGroupMax === undefined || rawGroupMax === null || (typeof rawGroupMax === 'string' && rawGroupMax.trim() === ''));
  const groupMaxSeconds = hasGroupMax
    ? readInteger(source, { key: 'groupMaxSeconds', label: '单组最长时长', required: true, min: GROUP_SECONDS_MIN, max: GROUP_SECONDS_MAX }, errors)
    : DEFAULT_GROUP_MAX_SECONDS;
  // 单组时长合法时才比较单镜头时长：一个镜头必须能放进一组，所以不能超过单组最长。
  if (errors.groupMaxSeconds === undefined) {
    if (maxShotSeconds !== null && maxShotSeconds > groupMaxSeconds && errors.maxShotSeconds === undefined) {
      errors.maxShotSeconds = `单镜头最长时长不能大于单组最长时长（${groupMaxSeconds} 秒），一个镜头必须能放进一组。`;
    }
    if (minShotSeconds !== null && minShotSeconds > groupMaxSeconds && errors.minShotSeconds === undefined) {
      errors.minShotSeconds = `单镜头最短时长不能大于单组最长时长（${groupMaxSeconds} 秒）。`;
    }
  }
  // 镜头总数上限留空表示不限制。
  const rawMaxShots = source.maxShots;
  const hasMaxShots = !(rawMaxShots === undefined || rawMaxShots === null || (typeof rawMaxShots === 'string' && rawMaxShots.trim() === ''));
  const maxShots = hasMaxShots
    ? readInteger(source, { key: 'maxShots', label: '镜头总数上限', required: true, min: 1, max: MAX_SHOTS_LIMIT }, errors)
    : null;
  const continuity = readLabeledChoice<ContinuityStrategy>(source, 'continuity', '镜头连贯策略', CONTINUITY_LABELS, 'cut', errors);
  const audioMode = readLabeledChoice<AudioMode>(source, 'audioMode', '声音模式', AUDIO_MODE_LABELS, 'native', errors);
  // 没有提交声音内容时默认全选；有声模式下至少要选一项。
  const elements = source.audioElements === undefined ? [...SOUND_KINDS] : readSoundKinds(source.audioElements, errors);
  if (audioMode !== 'none' && elements.length === 0 && errors.audioElements === undefined) {
    errors.audioElements = '请至少选择一项声音内容。';
  }
  const extra = readOptionalText(
    source,
    { key: 'extra', label: '补充要求', required: false, maxLength: STORYBOARD_EXTRA_MAX_LENGTH },
    errors
  );
  // 全部字段校验完才统一报错，让用户一次看到所有问题。
  assertNoFieldErrors(errors);
  return {
    visualStyle,
    minShotSeconds,
    maxShotSeconds,
    groupMaxSeconds,
    maxShots,
    continuity,
    audioMode,
    audioElements: audioMode === 'none' ? [] : elements,
    extra
  };
}
