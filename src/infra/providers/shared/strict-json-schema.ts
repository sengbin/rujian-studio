// ------------------------------------------------------------------------
// 名称：strict-json-schema.ts
// 说明：严格 JSON Schema 模式（strict）的公共处理：把工具参数的 Schema 转成严格模式要求的形式，并去掉模型为可选字段填入的 null。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：严格模式要求每个对象的所有属性都列入 required、additionalProperties 为 false，可选字段只能写成允许 null 的类型；方舟文档只列出 type、enum、properties、items、anyOf 等关键字，数值与长度范围等关键字可能被直接报错，转换时去掉（范围由各解析器校验）；工具定义不把 null 当作有意义的取值，所以结果里的 null 一律视为“未填”。
// ------------------------------------------------------------------------

import { isRecord } from './provider-payload';

type JsonObject = Record<string, unknown>;

/** 严格模式不保证支持的约束关键字：数值范围、数组长度、字符串长度与格式。 */
const UNSUPPORTED_KEYWORDS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'format'
];

/**
 * 把工具参数的 JSON Schema 转成严格模式要求的形式：原 required 之外的属性改为允许 null，再把全部属性列入 required，并禁止额外属性，同时去掉不支持的约束关键字。
 * @param schema 工具定义里的参数 Schema，不会被修改。
 */
export function toStrictSchema(schema: Readonly<JsonObject>): JsonObject {
  return strictenNode(schema);
}

/**
 * 去掉结果里值为 null 的对象属性，使“可选字段填 null”与“可选字段不填”等价。
 * @param value 模型按严格 Schema 返回的结果。
 */
export function omitNullProperties(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(omitNullProperties);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== null).map(([key, child]) => [key, omitNullProperties(child)]));
  }
  return value;
}

function strictenNode(node: Readonly<JsonObject>): JsonObject {
  const result: JsonObject = { ...node };
  for (const keyword of UNSUPPORTED_KEYWORDS) {
    delete result[keyword];
  }
  if (isRecord(node.items)) {
    result.items = strictenNode(node.items);
  }
  if (isRecord(node.properties)) {
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    const properties: JsonObject = {};
    for (const [name, child] of Object.entries(node.properties)) {
      if (!isRecord(child)) {
        properties[name] = child;
        continue;
      }
      const strict = strictenNode(child);
      properties[name] = required.has(name) ? strict : allowNull(strict);
    }
    result.properties = properties;
    result.required = Object.keys(properties);
    result.additionalProperties = false;
  }
  return result;
}

/** 让一个属性的 Schema 允许 null；有枚举时把 null 也加入枚举，否则 null 通不过枚举校验。 */
function allowNull(node: Readonly<JsonObject>): JsonObject {
  if (node.type === undefined) {
    return { anyOf: [node, { type: 'null' }] };
  }
  const types = Array.isArray(node.type) ? node.type : [node.type];
  const result: JsonObject = { ...node, type: types.includes('null') ? types : [...types, 'null'] };
  if (Array.isArray(node.enum) && !node.enum.includes(null)) {
    result.enum = [...node.enum, null];
  }
  return result;
}
