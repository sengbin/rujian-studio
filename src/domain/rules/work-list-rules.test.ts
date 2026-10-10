// ------------------------------------------------------------------------
// 名称：work-list-rules.test.ts
// 说明：作品列表视图规则的自动化测试：剧本视图与分镜脚本视图是否列出作品。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯函数测试，不依赖数据库。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isListedInScreenplayView, isListedInStoryboardView } from './work-list-rules';

test('剧本视图：创意已确认或已有剧本记录才列出', () => {
  assert.equal(isListedInScreenplayView({ canStartScreenplay: true, screenplay: { runId: null } }), true);
  assert.equal(isListedInScreenplayView({ canStartScreenplay: false, screenplay: { runId: 4 } }), true);
  assert.equal(isListedInScreenplayView({ canStartScreenplay: false, screenplay: { runId: null } }), false);
});

test('分镜脚本视图：剧本已确认或已有分镜脚本记录才列出', () => {
  assert.equal(isListedInStoryboardView({ canStart: true, started: 0 }), true);
  assert.equal(isListedInStoryboardView({ canStart: false, started: 2 }), true);
  assert.equal(isListedInStoryboardView({ canStart: false, started: 0 }), false);
});
