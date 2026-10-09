// ------------------------------------------------------------------------
// 名称：volcengine-account-adapter.test.ts
// 说明：火山引擎账户适配器的自动化测试：余额的解析、账单明细按产品过滤并按计费项汇总、分页、错误转换。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：使用假 fetch 与固定时间；账单字段按费用中心文档构造，未与真实账户核对。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../domain/errors';
import { createFakeFetch } from '../shared/testing/fake-fetch';
import { VolcengineAccountAdapter } from './volcengine-account-adapter';

const CONTEXT = { accessKeyId: 'AKTEST', secretAccessKey: 'secret', settings: {} };
const NOW = () => new Date('2026-10-09T08:00:00.000Z');

function createAdapter(responses: Parameters<typeof createFakeFetch>[0], pattern = /ark|方舟/i) {
  const { fetchFunction, calls } = createFakeFetch(responses);
  return { adapter: new VolcengineAccountAdapter('volcengine', { productPattern: pattern, note: '', fetchFunction, now: NOW }), calls };
}

test('余额：带签名请求费用中心，按字段顺序列出各项金额与币种', async () => {
  const { adapter, calls } = createAdapter([
    { body: { Result: { AvailableBalance: '12.34', CashBalance: '10.00', FreezeAmount: '0.00', ArrearsBalance: '0.00', CreditLimit: '2.34', Currency: 'CNY' } } }
  ]);
  const entries = await adapter.queryBalance(CONTEXT);
  assert.deepEqual(entries.map((entry) => [entry.name, entry.text]), [
    ['可用余额', '12.34 元'],
    ['现金余额', '10.00 元'],
    ['冻结金额', '0.00 元'],
    ['欠费金额', '0.00 元'],
    ['信控额度', '2.34 元']
  ]);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://open.volcengineapi.com/?Action=QueryBalanceAcct&Version=2022-01-01');
  assert.match(calls[0].headers.Authorization, /^HMAC-SHA256 Credential=AKTEST\//);
});

test('余额：响应没有金额字段时报服务端错误', async () => {
  const { adapter } = createAdapter([{ body: { Result: {} } }]);
  await assert.rejects(adapter.queryBalance(CONTEXT), (error: unknown) => error instanceof ProviderError && error.category === 'server');
});

test('用量：只统计匹配产品的账单，按计费项汇总数量与金额，金额高的在前', async () => {
  const { adapter, calls } = createAdapter([
    {
      body: {
        Result: {
          List: [
            { Product: 'ark', ProductZh: '火山方舟', ConfigName: 'doubao-seed-2.1-pro 输入', Unit: '千token', Count: '100', PayableAmount: '0.60' },
            { Product: 'ark', ProductZh: '火山方舟', ConfigName: 'doubao-seed-2.1-pro 输入', Unit: '千token', Count: '50', PayableAmount: '0.30' },
            { Product: 'ark', ProductZh: '火山方舟', ConfigName: 'doubao-seedream-4.5', Unit: '张', Count: '4', PayableAmount: '1.00' },
            { Product: 'ecs', ProductZh: '云服务器', ConfigName: '实例', Unit: '小时', Count: '24', PayableAmount: '9.99' }
          ]
        }
      }
    }
  ]);
  const usage = await adapter.queryUsage(CONTEXT);
  assert.deepEqual(usage.entries.map((entry) => [entry.name, entry.text]), [
    ['doubao-seedream-4.5', '4 张 · 1.00 元'],
    ['doubao-seed-2.1-pro 输入', '150 千token · 0.90 元']
  ]);
  assert.match(usage.note, /2026-10 月账单/);
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { BillPeriod: '2026-10', Limit: 300, Offset: 0, NeedRecordNum: 0, IgnoreZero: 1 });
});

test('用量：满一页继续翻页，没有匹配的账单时说明本月没有记录', async () => {
  const fullPage = Array.from({ length: 300 }, () => ({ Product: 'ecs', ProductZh: '云服务器', ConfigName: 'x', Unit: '', Count: '1', PayableAmount: '1' }));
  const { adapter, calls } = createAdapter([{ body: { Result: { List: fullPage } } }, { body: { Result: { List: [] } } }]);
  const usage = await adapter.queryUsage(CONTEXT);
  assert.deepEqual(usage.entries, []);
  assert.match(usage.note, /本月没有该产品的账单记录/);
  assert.deepEqual(calls.map((call) => (call.body as { Offset: number }).Offset), [0, 300]);
});

test('错误：签名或权限错误按鉴权分类，200 响应带 ResponseMetadata.Error 同样转换', async () => {
  const denied = createAdapter([{ status: 403, body: { ResponseMetadata: { Error: { Code: 'SignatureDoesNotMatch', Message: 'bad signature' } } } }]);
  await assert.rejects(denied.adapter.queryBalance(CONTEXT), (error: unknown) => error instanceof ProviderError && error.category === 'auth' && error.code === 'SignatureDoesNotMatch');

  const inBody = createAdapter([{ body: { ResponseMetadata: { Error: { Code: 'InternalError', Message: 'oops' } } } }]);
  await assert.rejects(inBody.adapter.queryBalance(CONTEXT), (error: unknown) => error instanceof ProviderError && error.code === 'InternalError');
});
