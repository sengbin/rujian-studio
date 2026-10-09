// ------------------------------------------------------------------------
// 名称：strict-json-schema.test.ts
// 说明：严格 JSON Schema 转换的自动化测试：可选字段改为允许 null、全部属性列入 required、禁止额外属性，以及结果中 null 的去除。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：只验证转换规则，不访问网络。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { omitNullProperties, toStrictSchema } from './strict-json-schema';

test('转换：原 required 之外的属性允许 null，全部属性列入 required 并禁止额外属性', () => {
  const schema = {
    type: 'object',
    properties: {
      refused: { type: 'string' },
      kind: { type: 'string', enum: ['a', 'b'] },
      title: { type: 'string' },
      chapters: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, note: { type: 'integer', minimum: 1 } }, required: ['name'] }
      }
    },
    required: ['title']
  };
  const original = JSON.stringify(schema);

  assert.deepEqual(toStrictSchema(schema), {
    type: 'object',
    properties: {
      refused: { type: ['string', 'null'] },
      kind: { type: ['string', 'null'], enum: ['a', 'b', null] },
      title: { type: 'string' },
      chapters: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, note: { type: ['integer', 'null'] } },
          required: ['name', 'note'],
          additionalProperties: false
        }
      }
    },
    required: ['refused', 'kind', 'title', 'chapters'],
    additionalProperties: false
  });
  assert.equal(JSON.stringify(schema), original, '不修改传入的 Schema');
});

test('转换：去掉数值范围、数组长度等不支持的约束关键字，保留 description 与 enum', () => {
  const strict = toStrictSchema({
    type: 'object',
    properties: { list: { type: 'array', minItems: 2, maxItems: 5, description: '列表', items: { type: 'number', exclusiveMinimum: 0, minimum: 0 } } },
    required: ['list']
  });
  assert.deepEqual(strict, {
    type: 'object',
    properties: { list: { type: 'array', description: '列表', items: { type: 'number' } } },
    required: ['list'],
    additionalProperties: false
  });
});

test('转换：没有 type 的属性用 anyOf 加 null，已允许 null 的类型不重复追加', () => {
  const strict = toStrictSchema({ type: 'object', properties: { any: { description: '任意值' }, nullable: { type: ['string', 'null'] } } }) as {
    properties: Record<string, unknown>;
  };
  assert.deepEqual(strict.properties.any, { anyOf: [{ description: '任意值' }, { type: 'null' }] });
  assert.deepEqual(strict.properties.nullable, { type: ['string', 'null'] });
});

test('去除 null：递归删除对象属性里的 null，数组元素与其他值保持不变', () => {
  assert.deepEqual(omitNullProperties({ a: null, b: 0, c: '', d: [{ e: null, f: 1 }], g: { h: null } }), { b: 0, c: '', d: [{ f: 1 }], g: {} });
});
