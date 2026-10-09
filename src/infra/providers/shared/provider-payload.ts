// ------------------------------------------------------------------------
// 名称：provider-payload.ts
// 说明：各服务商适配器共用的请求内容处理：Base64 素材编码与校验，以及模型专有参数的校验与转换。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：不含任何服务商的接口细节；原位于千问AI平台的协议文件中，现供各服务商适配器共用。
// ------------------------------------------------------------------------

import { MediaInput } from '../../../domain/ports/provider-adapters';

/** 模型专有参数的声明：请求体中的键，以及允许的取值。 */
export interface ExtraParamSpec {
  readonly apiKey: string;
  readonly allowed: readonly (string | boolean)[];
}

/** 把未知值当作对象读取；不是对象时返回空对象。 */
export function readObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 把素材转换为 Base64 内联地址：data:{类型};base64,{内容}。 */
export function toDataUri(media: MediaInput): string {
  return `data:${media.mimeType};base64,${Buffer.from(media.data).toString('base64')}`;
}

/** 校验一组素材的类型与大小。 */
export function validateMediaFiles(files: readonly MediaInput[], mimePrefix: string, label: string, maxBytes: number): string[] {
  const issues: string[] = [];
  for (const file of files) {
    if (!file.mimeType.startsWith(mimePrefix)) {
      issues.push(`${label}素材的类型必须以 ${mimePrefix} 开头（当前 ${file.mimeType}）。`);
    }
    if (file.data.byteLength === 0 || file.data.byteLength > maxBytes) {
      issues.push(`${label}素材大小必须在 1 字节到 ${maxBytes / 1024 / 1024} MB 之间。`);
    }
  }
  return issues;
}

/** 校验模型专有参数：只允许已声明的键，且取值必须在允许范围内。 */
export function validateExtraParams(extraParams: Readonly<Record<string, unknown>>, specs: Readonly<Record<string, ExtraParamSpec>>): string[] {
  const issues: string[] = [];
  for (const [key, value] of Object.entries(extraParams)) {
    const spec = specs[key];
    if (spec === undefined) {
      issues.push(`不支持的模型参数：${key}。`);
    } else if (!spec.allowed.some((candidate) => candidate === value)) {
      const isSwitch = spec.allowed.every((candidate) => typeof candidate === 'boolean');
      issues.push(isSwitch ? `模型参数 ${key} 必须是开或关。` : `模型参数 ${key} 必须是以下之一：${spec.allowed.join('、')}。`);
    }
  }
  return issues;
}

/** 把已通过校验的模型专有参数转换为请求体中的键值。 */
export function mapExtraParams(extraParams: Readonly<Record<string, unknown>>, specs: Readonly<Record<string, ExtraParamSpec>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(extraParams).map(([key, value]) => [specs[key].apiKey, value]));
}
