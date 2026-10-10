// ------------------------------------------------------------------------
// 名称：result-file-cleanup.test.ts
// 说明：结果视频文件清理的自动化测试：只删除没有结果记录引用的视频文件，已引用的保留。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：使用假的结果存储与记录读取，不涉及文件系统。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sweepUnreferencedResults } from './result-file-cleanup';

test('只删除没有记录引用的视频文件，返回删除数量', async () => {
  const removed: string[] = [];
  const count = await sweepUnreferencedResults({
    jobs: { listResultFilePaths: () => ['videos/1/1/1/1-1.mp4'] },
    results: {
      listFiles: async () => ['videos/1/1/1/1-1.mp4', 'videos/1/1/1/2-2.mp4', 'videos/2/2/2/3-3.mp4'],
      remove: async (filePath) => void removed.push(filePath)
    }
  });
  assert.equal(count, 2);
  assert.deepEqual(removed, ['videos/1/1/1/2-2.mp4', 'videos/2/2/2/3-3.mp4']);
});

test('没有文件或全部被引用时什么也不删', async () => {
  const removed: string[] = [];
  const results = { listFiles: async () => ['videos/a.mp4'], remove: async (filePath: string) => void removed.push(filePath) };
  assert.equal(await sweepUnreferencedResults({ jobs: { listResultFilePaths: () => ['videos/a.mp4'] }, results }), 0);
  assert.equal(await sweepUnreferencedResults({ jobs: { listResultFilePaths: () => [] }, results: { ...results, listFiles: async () => [] } }), 0);
  assert.deepEqual(removed, []);
});
