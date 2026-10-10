// ------------------------------------------------------------------------
// 名称：compensation.ts
// 说明：补偿执行：异步步骤失败时撤销此前已提交的写入；补偿本身失败只记录日志，仍抛出步骤的原始错误。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：只用于无法放进数据库事务的异步步骤（如启动后台生成）；能在写库前校验的先校验，补偿的窗口越小越好。
// ------------------------------------------------------------------------

/**
 * 执行异步步骤；失败时执行补偿，再重新抛出步骤的原始错误。
 * @param step 可能失败的异步步骤。
 * @param compensate 撤销此前写入的同步补偿；它抛出的错误不会掩盖原始错误，只记录日志。
 * @param failureMessage 补偿失败时的日志说明。
 */
export async function runWithCompensation<T>(step: () => Promise<T>, compensate: () => void, failureMessage: string): Promise<T> {
  try {
    return await step();
  } catch (error) {
    try {
      compensate();
    } catch (compensationError) {
      console.error(failureMessage, compensationError);
    }
    throw error;
  }
}
