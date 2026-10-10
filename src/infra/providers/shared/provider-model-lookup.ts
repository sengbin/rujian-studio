// ------------------------------------------------------------------------
// 名称：provider-model-lookup.ts
// 说明：各服务商适配器共用的模型查找：按模型代码在模型目录里取模型。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：目录项有两种形态：模型描述本身带 code，或包在 { descriptor } 里附带模型专有信息；找不到时返回 undefined，由调用方报“没有模型”。
// ------------------------------------------------------------------------

/**
 * 按模型代码在目录里查找模型描述。
 * @param models 模型目录，元素自带 code。
 * @param code 模型代码。
 * @returns 找到的目录项；没有时为 undefined。
 */
export function findModelByCode<T extends { readonly code: string }>(models: readonly T[], code: string): T | undefined {
  return models.find((model) => model.code === code);
}

/**
 * 按模型代码在目录里查找带专有信息的模型：目录项的 descriptor 是模型描述。
 * @param models 模型目录，元素带 descriptor.code。
 * @param code 模型代码。
 * @returns 找到的目录项；没有时为 undefined。
 */
export function findDescribedModelByCode<T extends { readonly descriptor: { readonly code: string } }>(models: readonly T[], code: string): T | undefined {
  return models.find((model) => model.descriptor.code === code);
}
