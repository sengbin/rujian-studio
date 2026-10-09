// ------------------------------------------------------------------------
// 名称：tab-state.test.ts
// 说明：标签状态的自动化测试：同一键不重复、激活、关闭后的激活顺序和循环切换。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯逻辑测试，不涉及 DOM。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TabState } from './tab-state';

/** 创建带三个标签 a、b、c 的状态，当前激活 c。 */
function createState(): TabState {
  const state = new TabState();
  for (const key of ['a', 'b', 'c']) {
    state.open({ key, title: key.toUpperCase() });
  }
  return state;
}

const keys = (state: TabState): string[] => state.list().map((tab) => tab.key);

test('打开新标签追加到末尾并激活；同一键再次打开只激活，不重复添加', () => {
  const state = createState();
  assert.deepEqual(keys(state), ['a', 'b', 'c']);
  assert.equal(state.active, 'c');

  assert.equal(state.open({ key: 'a', title: 'A' }), false);
  assert.deepEqual(keys(state), ['a', 'b', 'c']);
  assert.equal(state.active, 'a');
});

test('激活：已有标签返回 true，不存在返回 false 且不改变当前标签', () => {
  const state = createState();
  assert.equal(state.activate('b'), true);
  assert.equal(state.active, 'b');
  assert.equal(state.activate('x'), false);
  assert.equal(state.active, 'b');
});

test('关闭当前标签：激活右侧相邻标签，没有右侧时激活左侧，全部关闭后没有激活项', () => {
  const state = createState();
  state.activate('b');
  state.close('b');
  assert.equal(state.active, 'c');

  state.close('c');
  assert.equal(state.active, 'a');

  state.close('a');
  assert.equal(state.active, undefined);
  assert.deepEqual(keys(state), []);
});

test('关闭非当前标签不改变当前标签；关闭不存在的标签返回 false', () => {
  const state = createState();
  state.activate('a');
  assert.equal(state.close('c'), true);
  assert.equal(state.active, 'a');
  assert.equal(state.close('x'), false);
});

test('循环切换：首尾相接，只有一个标签时保持不变', () => {
  const state = createState();
  state.cycle(1);
  assert.equal(state.active, 'a');
  state.cycle(-1);
  assert.equal(state.active, 'c');

  const single = new TabState();
  single.open({ key: 'only', title: 'Only' });
  single.cycle(1);
  assert.equal(single.active, 'only');
});
