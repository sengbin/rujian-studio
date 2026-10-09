// ------------------------------------------------------------------------
// 名称：local-voice-cache.test.ts
// 说明：台词配音本地缓存的自动化测试：保存与读取、同键替换（含换格式）、不合法的键与类型被拒绝、超过条数或总大小上限时淘汰最久没用的、不留临时文件。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：使用临时目录，不访问网络；用修改时间区分新旧，测试里显式设置。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { LocalVoiceCache } from './local-voice-cache';

const keyOf = (text: string) => createHash('sha256').update(text).digest('hex');

/** 在临时目录中创建缓存。 */
function createCache(limits = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'rujian-voice-cache-'));
  return { root, cache: new LocalVoiceCache(path.join(root, 'voice-cache'), limits), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('保存与读取：按键取回原内容与类型，目录不存在或没有这个键时为 undefined，不留临时文件', () => {
  const { root, cache, cleanup } = createCache();
  try {
    const key = keyOf('a');
    assert.equal(cache.get(key), undefined);
    cache.put(key, 'audio/mpeg', Buffer.from('mp3-data'));
    assert.deepEqual(cache.get(key), { mime: 'audio/mpeg', content: Buffer.from('mp3-data') });
    assert.deepEqual(readdirSync(path.join(root, 'voice-cache')), [`${key}.mp3`]);
    assert.equal(cache.get(keyOf('b')), undefined);
  } finally {
    cleanup();
  }
});

test('同一个键再次保存会替换，换了格式时旧格式的文件被清掉', () => {
  const { root, cache, cleanup } = createCache();
  try {
    const key = keyOf('a');
    cache.put(key, 'audio/mpeg', Buffer.from('old'));
    cache.put(key, 'audio/wav', Buffer.from('new'));
    assert.deepEqual(cache.get(key), { mime: 'audio/wav', content: Buffer.from('new') });
    assert.deepEqual(readdirSync(path.join(root, 'voice-cache')), [`${key}.wav`]);
  } finally {
    cleanup();
  }
});

test('不合法的键与不支持的类型被拒绝，读取不合法的键返回 undefined（不会越出目录）', () => {
  const { cache, cleanup } = createCache();
  try {
    assert.throws(() => cache.put('../escape', 'audio/mpeg', Buffer.from('x')), /不合法/);
    assert.throws(() => cache.put(keyOf('a'), 'image/png', Buffer.from('x')), /不合法/);
    assert.equal(cache.get('../escape'), undefined);
    assert.equal(cache.get('ABC'), undefined);
  } finally {
    cleanup();
  }
});

test('淘汰：超过条数上限时删除修改时间最早的，读取会刷新时间让它不先被淘汰', () => {
  const { root, cache, cleanup } = createCache({ maxEntries: 2 });
  try {
    const [a, b, c] = ['a', 'b', 'c'].map(keyOf);
    cache.put(a, 'audio/mpeg', Buffer.from('1'));
    cache.put(b, 'audio/mpeg', Buffer.from('2'));
    const directory = path.join(root, 'voice-cache');
    utimesSync(path.join(directory, `${a}.mp3`), new Date(2020, 0, 1), new Date(2020, 0, 1));
    utimesSync(path.join(directory, `${b}.mp3`), new Date(2021, 0, 1), new Date(2021, 0, 1));
    assert.ok(cache.get(a), '读取 a，它变成最近用过的');
    cache.put(c, 'audio/mpeg', Buffer.from('3'));
    assert.equal(existsSync(path.join(directory, `${b}.mp3`)), false, '最久没用的 b 被淘汰');
    assert.ok(existsSync(path.join(directory, `${a}.mp3`)) && existsSync(path.join(directory, `${c}.mp3`)));
  } finally {
    cleanup();
  }
});

test('淘汰：超过总大小上限时从最旧的开始删除，直到不再超限；新写入的不会被删', () => {
  const { root, cache, cleanup } = createCache({ maxBytes: 10 });
  try {
    const [a, b] = ['a', 'b'].map(keyOf);
    cache.put(a, 'audio/wav', Buffer.alloc(6));
    utimesSync(path.join(root, 'voice-cache', `${a}.wav`), new Date(2020, 0, 1), new Date(2020, 0, 1));
    cache.put(b, 'audio/wav', Buffer.alloc(6));
    assert.equal(cache.get(a), undefined);
    assert.ok(cache.get(b));
  } finally {
    cleanup();
  }
});
