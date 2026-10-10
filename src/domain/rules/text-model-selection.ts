// ------------------------------------------------------------------------
// 名称：text-model-selection.ts
// 说明：文本模型选择的标识：把“服务商的某个文本模型”编码为字符串键，并解析回来。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-03
// 备注：键用于保存全局默认与作品的文本模型选择：model:<服务商代码>/<模型代码>；不含数据库标识，模型重新同步后键依然有效。
// ------------------------------------------------------------------------

/** 键的最大长度。 */
export const TEXT_MODEL_KEY_MAX_LENGTH = 200;

/** 文本模型键的前缀，后面是模型标识。 */
const PROVIDER_PREFIX = 'model:';

/** 解析后的文本模型选择：服务商的文本模型。 */
export interface TextModelSelection {
  readonly providerCode: string;
  readonly modelCode: string;
}

/**
 * 生成服务商文本模型的键。
 * @param providerCode 服务商代码。
 * @param modelCode 服务商侧的模型标识。
 */
export function providerModelKey(providerCode: string, modelCode: string): string {
  return `${PROVIDER_PREFIX}${providerCode}/${modelCode}`;
}

/**
 * 解析键。
 * @param key 待解析的键。
 * @returns 选择；格式不正确返回 undefined。
 */
export function parseTextModelKey(key: string): TextModelSelection | undefined {
  if (key.length > TEXT_MODEL_KEY_MAX_LENGTH || !key.startsWith(PROVIDER_PREFIX)) {
    return undefined;
  }
  const rest = key.slice(PROVIDER_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash > 0 && slash < rest.length - 1) {
    return { providerCode: rest.slice(0, slash), modelCode: rest.slice(slash + 1) };
  }
  return undefined;
}
