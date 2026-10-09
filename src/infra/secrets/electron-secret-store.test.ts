// ------------------------------------------------------------------------
// 名称：electron-secret-store.test.ts
// 说明：桌面密钥存储的自动化测试：加密落盘、读取、删除、系统不支持加密时拒绝保存、无法解密时按未设置处理。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：用可逆的假加解密器代替 safeStorage，文件写到临时目录。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { ElectronSecretStore, SecretCipher } from './electron-secret-store';

const directory = mkdtempSync(path.join(os.tmpdir(), 'rujian-secret-'));
after(() => rmSync(directory, { recursive: true, force: true }));

/** 假加解密器：加上前缀即视为“加密”，可开关可用性。 */
function createCipher(available = true): SecretCipher {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
    decryptString: (data) => {
      const text = data.toString('utf8');
      if (!text.startsWith('enc:')) {
        throw new Error('无法解密');
      }
      return text.slice(4);
    }
  };
}

let counter = 0;
/** 每个用例使用独立的文件。 */
function newFile(): string {
  counter += 1;
  return path.join(directory, `secrets-${counter}.json`);
}

test('保存后能读回，文件中不含明文', async () => {
  const file = newFile();
  const store = new ElectronSecretStore(file, createCipher());
  await store.set('provider.a', 'sk-plain-secret');

  assert.equal(await store.get('provider.a'), 'sk-plain-secret');
  assert.ok(!readFileSync(file, 'utf8').includes('sk-plain-secret'));
});

test('不存在的键返回 undefined；覆盖与删除生效，删除不存在的键不报错', async () => {
  const store = new ElectronSecretStore(newFile(), createCipher());
  assert.equal(await store.get('x'), undefined);

  await store.set('x', '1');
  await store.set('x', '2');
  assert.equal(await store.get('x'), '2');

  await store.delete('x');
  await store.delete('x');
  assert.equal(await store.get('x'), undefined);
});

test('系统不支持加密时拒绝保存，不写入文件', async () => {
  const store = new ElectronSecretStore(newFile(), createCipher(false));
  await assert.rejects(() => store.set('x', '1'), /不支持安全存储/);
  assert.equal(await store.get('x'), undefined);
});

test('无法解密或文件损坏时按未设置处理', async () => {
  const corrupted = newFile();
  writeFileSync(corrupted, '{不是 JSON', 'utf8');
  assert.equal(await new ElectronSecretStore(corrupted, createCipher()).get('x'), undefined);

  const foreign = newFile();
  writeFileSync(foreign, JSON.stringify({ x: Buffer.from('other:1').toString('base64') }), 'utf8');
  assert.equal(await new ElectronSecretStore(foreign, createCipher()).get('x'), undefined);
});
