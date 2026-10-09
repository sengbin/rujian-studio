// ------------------------------------------------------------------------
// 名称：calibration.ts
// 说明：阶段工作流共用的轻量校准：生成 → 实测 → 超出容差则带偏差反馈重新生成，最多重写指定轮数。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：设计见 docs/production-profile-design.md 第 7.3、7.4 节；是各阶段 execute() 内部的一段逻辑，不是独立的阶段；重写结果更接近目标才采用，达到轮数上限仍超出容差时返回最接近目标的一稿并标明偏差，不再继续重写。
// ------------------------------------------------------------------------

import { CalibrationResult, evaluateCalibration } from '../../domain/rules/timing-calibration-rules';

/** 校准执行的选项。 */
export interface CalibrationOptions<T> {
  /** 生成一稿；feedback 为 null 表示首次生成，否则是上一稿的偏差，需据此重写。 */
  readonly generate: (feedback: CalibrationResult | null, previous: T | null) => Promise<T>;
  /** 已有的初稿（如已抽取出的一集正文）；提供时不再首次生成，直接以它为起点校准。 */
  readonly initial?: T;
  /** 实测一稿的数值（秒、字等，与 target 同单位）。 */
  readonly measure: (result: T) => number;
  readonly target: number;
  readonly toleranceRatio: number;
  /** 最大自动重写轮数，不含首次生成。 */
  readonly maxRounds: number;
}

/** 校准执行的结果。 */
export interface CalibrationOutcome<T> {
  readonly result: T;
  readonly calibration: CalibrationResult;
  /** 实际重写的轮数。 */
  readonly rounds: number;
}

/**
 * 生成并校准：首稿落在容差内直接采用；否则带上一稿的偏差重写，最多 maxRounds 轮，重写结果更接近目标才采用。
 * @throws 任何一次生成抛出的错误（含取消）。
 */
export async function runWithCalibration<T>(options: CalibrationOptions<T>): Promise<CalibrationOutcome<T>> {
  const { generate, measure, target, toleranceRatio, maxRounds, initial } = options;
  let result = initial ?? (await generate(null, null));
  let calibration = evaluateCalibration(measure(result), target, toleranceRatio);
  let rounds = 0;
  while (!calibration.withinTolerance && rounds < maxRounds) {
    rounds += 1;
    const candidate = await generate(calibration, result);
    const next = evaluateCalibration(measure(candidate), target, toleranceRatio);
    if (Math.abs(next.deviationRatio) < Math.abs(calibration.deviationRatio)) {
      result = candidate;
      calibration = next;
    }
  }
  return { result, calibration, rounds };
}
