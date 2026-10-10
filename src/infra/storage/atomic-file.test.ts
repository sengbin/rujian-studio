// ------------------------------------------------------------------------
// 名称：atomic-file.test.ts
// 说明：原子写文件的自动化测试：同步与异步写入成功后替换目标且不留临时文件，写入失败时清理临时文件并保持原文件不变；JSON 文件写入同样如此。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：使用临时目录；用“目标路径是一个目录”让改名失败，用写入函数抛错模拟写到一半失败。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { replaceFileAtomically, replaceFileAtomicallyAsync, writeFileAtomically } from './atomic-file';
import { writeJsonObject } from './json-file';

/** 在临时目录中运行测试，结束后清理。 */
function withDirectory(run: (directory: string) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'rujian-atomic-'));
    try {
      await run(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

test(
  '同步写入：替换已有内容，不留临时文件',
  withDirectory((directory) => {
    const target = path.join(directory, 'a.txt');
    writeFileSync(target, '旧');
    writeFileAtomically(target, '新内容');
    assert.equal(readFileSync(target, 'utf8'), '新内容');
    assert.deepEqual(readdirSync(directory), ['a.txt']);
  })
);

test(
  '同步写入失败：原文件不变，临时文件被清理，错误原样抛出',
  withDirectory((directory) => {
    const target = path.join(directory, 'a.txt');
    writeFileSync(target, '旧');
    const failure = new Error('写到一半失败');
    assert.throws(
      () =>
        replaceFileAtomically(target, (partialPath) => {
          writeFileSync(partialPath, '半截');
          throw failure;
        }),
      failure
    );
    assert.equal(readFileSync(target, 'utf8'), '旧');
    assert.deepEqual(readdirSync(directory), ['a.txt']);
  })
);

test(
  '同步写入：改名失败（目标是目录）时清理临时文件',
  withDirectory((directory) => {
    const target = path.join(directory, 'folder');
    mkdirSync(target);
    assert.throws(() => writeFileAtomically(target, 'x'));
    assert.deepEqual(readdirSync(directory), ['folder']);
  })
);

test(
  '异步写入：成功后替换目标；失败时清理临时文件、保持原文件',
  withDirectory(async (directory) => {
    const target = path.join(directory, 'b.bin');
    writeFileSync(target, '旧');
    await replaceFileAtomicallyAsync(target, async (partialPath) => writeFileSync(partialPath, '新'));
    assert.equal(readFileSync(target, 'utf8'), '新');

    await assert.rejects(
      replaceFileAtomicallyAsync(target, async (partialPath) => {
        writeFileSync(partialPath, '半截');
        throw new Error('下载中断');
      }),
      /下载中断/
    );
    assert.equal(readFileSync(target, 'utf8'), '新');
    assert.deepEqual(readdirSync(directory), ['b.bin']);
  })
);

test(
  'JSON 文件写入：创建目录、替换内容；失败时不留临时文件',
  withDirectory((directory) => {
    const target = path.join(directory, 'sub', 'settings.json');
    writeJsonObject(target, { a: 1 });
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { a: 1 });
    writeJsonObject(target, { a: 2 });
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { a: 2 });
    assert.deepEqual(readdirSync(path.dirname(target)), ['settings.json']);

    const blocked = path.join(directory, 'blocked.json');
    mkdirSync(blocked);
    assert.throws(() => writeJsonObject(blocked, { a: 1 }));
    assert.equal(existsSync(`${blocked}.part`), false);
  })
);
