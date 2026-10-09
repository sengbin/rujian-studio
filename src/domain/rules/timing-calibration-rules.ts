// ------------------------------------------------------------------------
// 名称：timing-calibration-rules.ts
// 说明：时长校准规则：判断实测值是否落在目标值的容差范围内，并整理成反馈给模型的偏差说明。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：设计见 private-docs/rujian-studio/开发文档-vscode/production-profile-design.md 第 7.4 节；纯函数，不访问存储；容差与重写轮数的默认值由制作方案引用。
// ------------------------------------------------------------------------

/** 默认校准容差：±15%。 */
export const DEFAULT_TOLERANCE_RATIO = 0.15;
/** 默认最大自动重写轮数。 */
export const DEFAULT_MAX_CALIBRATION_ROUNDS = 2;

/** 浮点比较的误差，避免容差临界点因舍入被误判。 */
const BOUNDARY_EPSILON = 1e-9;

/** 一次校准判断的结果。 */
export interface CalibrationResult {
  readonly withinTolerance: boolean;
  readonly actual: number;
  readonly target: number;
  /** (实测 - 目标) / 目标，正数为超出、负数为不足。 */
  readonly deviationRatio: number;
}

/**
 * 判断实测值是否落在目标值的容差范围内（含边界）。
 * @param actual 实测值。
 * @param target 目标值，必须大于 0。
 * @param toleranceRatio 容差比例，如 0.15。
 * @throws RangeError 目标值不是正数。
 */
export function evaluateCalibration(actual: number, target: number, toleranceRatio: number): CalibrationResult {
  if (!(target > 0)) {
    throw new RangeError('校准目标必须大于 0。');
  }
  const deviationRatio = (actual - target) / target;
  return {
    withinTolerance: Math.abs(actual - target) <= target * toleranceRatio + BOUNDARY_EPSILON,
    actual,
    target,
    deviationRatio
  };
}

/**
 * 目标值的容差范围，取整后用于提示词里的“字数范围”：下限向上取整、上限向下取整，下限至少为 1。
 * @param target 目标值。
 * @param toleranceRatio 容差比例。
 */
export function toleranceRange(target: number, toleranceRatio: number): { readonly min: number; readonly max: number } {
  const min = Math.max(1, Math.ceil(target * (1 - toleranceRatio) - BOUNDARY_EPSILON));
  const max = Math.max(min, Math.floor(target * (1 + toleranceRatio) + BOUNDARY_EPSILON));
  return { min, max };
}

/** 保留一位小数的数值文字。 */
function formatNumber(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * 把偏差整理成反馈给模型的一句话，如“目标约 30 秒，实测约 45 秒，超出 15 秒（50%）”。
 * @param result 校准结果。
 * @param unit 数值单位，如“秒”“字”。
 */
export function describeDeviation(result: CalibrationResult, unit: string): string {
  const difference = result.actual - result.target;
  const direction = difference > 0 ? '超出' : '不足';
  const percent = Math.round(Math.abs(result.deviationRatio) * 100);
  return `目标约 ${formatNumber(result.target)} ${unit}，实测约 ${formatNumber(result.actual)} ${unit}，${direction} ${formatNumber(Math.abs(difference))} ${unit}（${percent}%）`;
}
