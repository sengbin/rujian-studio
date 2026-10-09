// ------------------------------------------------------------------------
// 名称：volcengine-signature.test.ts
// 说明：火山引擎请求签名的自动化测试：请求头格式、签名的确定性，以及内容、密钥、时间变化时签名随之变化。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：不访问网络；与真实服务的比对需要真实密钥，未在自动化测试中进行。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignableRequest, signVolcengineRequest } from './volcengine-signature';

const BASE: SignableRequest = {
  method: 'GET',
  host: 'open.volcengineapi.com',
  query: { Version: '2022-01-01', Action: 'QueryBalanceAcct' },
  body: '',
  region: 'cn-north-1',
  service: 'billing',
  accessKeyId: 'AKTEST',
  secretAccessKey: 'secret',
  now: new Date('2026-10-09T08:30:15.123Z')
};

function signatureOf(request: SignableRequest): string {
  const match = /Signature=([0-9a-f]{64})$/.exec(signVolcengineRequest(request).headers.Authorization);
  assert.ok(match, 'Authorization 应以 64 位十六进制签名结尾');
  return match[1];
}

test('签名：地址的查询参数按字典序排列，请求头带日期、内容摘要和授权信息，不含密钥', () => {
  const signed = signVolcengineRequest(BASE);
  assert.equal(signed.url, 'https://open.volcengineapi.com/?Action=QueryBalanceAcct&Version=2022-01-01');
  assert.equal(signed.headers['X-Date'], '20261009T083015Z');
  assert.equal(signed.headers['X-Content-Sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '空内容的 SHA-256');
  assert.match(
    signed.headers.Authorization,
    /^HMAC-SHA256 Credential=AKTEST\/20261009\/cn-north-1\/billing\/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$/
  );
  assert.ok(!JSON.stringify(signed).includes('secret'));
});

test('签名：相同输入得到相同签名，请求内容、密钥、时间、方法任一变化都会改变签名', () => {
  const base = signatureOf(BASE);
  assert.equal(signatureOf({ ...BASE }), base);
  assert.notEqual(signatureOf({ ...BASE, method: 'POST', body: '{"a":1}' }), base);
  assert.notEqual(signatureOf({ ...BASE, secretAccessKey: 'other' }), base);
  assert.notEqual(signatureOf({ ...BASE, now: new Date('2026-10-09T08:30:16.000Z') }), base);
  assert.notEqual(signatureOf({ ...BASE, query: { ...BASE.query, Action: 'ListBillDetail' } }), base);
});

test('签名：查询参数中的特殊字符按 RFC 3986 编码', () => {
  const signed = signVolcengineRequest({ ...BASE, query: { Action: "a b!'()*" } });
  assert.equal(signed.url, 'https://open.volcengineapi.com/?Action=a%20b%21%27%28%29%2A');
});
