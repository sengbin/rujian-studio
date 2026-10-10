// ------------------------------------------------------------------------
// 名称：group-duration-rules.ts
// 说明：镜头组生成时长与参数的规则：把组总时长对齐到模型允许的取值、模型单次可生成的最长时长、检查镜头组的生成参数能否用于所选模型（种子、提示词改写开关、指定的生成时长）。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯函数，不依赖数据库和具体模型；画幅、分辨率、声音模式等由适配器按模型能力校验，这里不重复。
// ------------------------------------------------------------------------

import { GenerationParams } from '../models/generation';
import { DurationCapability, VideoCapability } from '../models/model-capability';
import { describeDuration, isDurationAllowed } from './model-capability-rules';
import { SECONDS_EPSILON } from './shot-group-rules';

/** 时长对齐的结果：对齐后的值、是否与原值不同、是否超过模型单次可生成的最长时长。 */
export interface FittedDuration {
  readonly seconds: number;
  readonly adjusted: boolean;
  readonly exceedsMax: boolean;
}

/**
 * 把镜头组的总时长对齐到模型允许的取值。只向上取整（不截断镜头），超过模型最长时长时标记 exceedsMax 并返回最长值。
 * @param duration 模型的时长约束。
 * @param seconds 镜头组总时长（秒，可能有小数）。
 */
export function fitGroupDuration(duration: DurationCapability, seconds: number): FittedDuration {
  let fitted = seconds;
  let exceedsMax = false;
  if (duration.options !== undefined && duration.options.length > 0) {
    const options = [...duration.options].sort((left, right) => left - right);
    const match = options.find((option) => option >= seconds - SECONDS_EPSILON);
    exceedsMax = match === undefined;
    fitted = match ?? options[options.length - 1];
  } else {
    const { min, max, step } = duration;
    if (step !== undefined) {
      const origin = min ?? 0;
      fitted = origin + Math.ceil((seconds - origin) / step - SECONDS_EPSILON) * step;
    }
    if (min !== undefined) fitted = Math.max(min, fitted);
    if (max !== undefined && fitted > max + SECONDS_EPSILON) {
      exceedsMax = true;
      fitted = max;
    }
  }
  return { seconds: fitted, adjusted: Math.abs(fitted - seconds) > SECONDS_EPSILON, exceedsMax };
}

/** 模型单次可生成的最长时长（秒）；没有上限信息时为 null。 */
export function maxGroupSeconds(duration: DurationCapability): number | null {
  if (duration.options !== undefined && duration.options.length > 0) return Math.max(...duration.options);
  return duration.max ?? null;
}

/**
 * 检查镜头组的生成参数能否用于所选模型：随机种子需要模型支持；指定的生成时长不得小于组内镜头总时长（不截断镜头），且必须在模型支持的取值内。
 * 画幅、分辨率、声音模式等由适配器按模型能力校验，这里不重复。
 * @param capability 所选模型的能力。
 * @param params 这一组合并后的生成参数。
 * @param totalSeconds 组内镜头时长之和（秒）。
 * @returns 阻断问题说明；没有问题为空数组。
 */
export function validateGroupParams(capability: VideoCapability, params: GenerationParams, totalSeconds: number): string[] {
  const issues: string[] = [];
  if (params.seed !== null && !capability.seed) {
    issues.push('所选模型不支持随机种子，请清除种子设置或换一个模型。');
  }
  if (params.promptExtend !== null && capability.promptExtend !== true) {
    issues.push('所选模型不支持提示词改写开关，请清除该设置或换一个模型。');
  }
  const requested = params.durationSeconds;
  if (requested !== null) {
    // 指定时长小于镜头总时长会让后面的镜头没有时间呈现，直接拒绝而不是静默截断。
    if (requested < totalSeconds - SECONDS_EPSILON) {
      issues.push(`指定的生成时长 ${requested} 秒小于这一组镜头的总时长 ${totalSeconds} 秒，镜头会被截断。请调大生成时长，或清除该设置，按镜头总时长生成。`);
    } else if (!isDurationAllowed(capability.duration, requested)) {
      issues.push(`指定的生成时长 ${requested} 秒不在模型支持的取值内（${describeDuration(capability.duration)}）。`);
    }
  }
  return issues;
}
