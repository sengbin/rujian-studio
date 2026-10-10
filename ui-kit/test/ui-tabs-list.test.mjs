// ------------------------------------------------------------------------
// 名称：ui-tabs-list.test.mjs
// 说明：界面组件库页签与可选择列表的 DOM 测试：页签的 ARIA 关联、选中切换、键盘导航、回调，以及列表项的选中标记与点击。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：使用 jsdom；无排版，只验证结构、属性和行为，不验证视觉。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createUiEnvironment } from './ui-environment.mjs';

let env;

/** 每个用例使用全新的页面，结束后释放。 */
function setup() {
  env = createUiEnvironment();
  return { ui: env.aiUi, doc: env.document };
}

afterEach(() => env?.close());

/** 创建三个页签，面板用文字内容。 */
function createThreeTabs(ui, extra = {}) {
  return ui.tabs({
    items: [
      { id: 'a', label: '甲', content: '甲的内容', className: 'tab-a' },
      { id: 'b', label: '乙', content: '乙的内容' },
      { id: 'c', label: '丙', content: '丙的内容' }
    ],
    ariaLabel: '示例页签',
    className: 'my-tabs',
    panelClass: 'my-panel',
    ...extra
  });
}

test('页签：页签条与面板按 ARIA 关联，只有选中项可见并在 Tab 顺序里', () => {
  const { ui } = setup();
  const tabs = createThreeTabs(ui, { activeId: 'b' });
  assert.equal(tabs.element.getAttribute('role'), 'tablist');
  assert.equal(tabs.element.getAttribute('aria-label'), '示例页签');
  assert.ok(tabs.element.classList.contains('ui-tabs') && tabs.element.classList.contains('my-tabs'));
  const buttons = [...tabs.element.querySelectorAll('[role="tab"]')];
  assert.deepEqual(buttons.map((button) => button.getAttribute('aria-selected')), ['false', 'true', 'false']);
  assert.deepEqual(buttons.map((button) => button.tabIndex), [-1, 0, -1]);
  assert.deepEqual(tabs.panels.map((panel) => panel.hidden), [true, false, true]);
  buttons.forEach((button, index) => {
    const panel = tabs.panels[index];
    assert.equal(button.getAttribute('aria-controls'), panel.id);
    assert.equal(panel.getAttribute('aria-labelledby'), button.id);
    assert.equal(panel.getAttribute('role'), 'tabpanel');
    assert.ok(panel.classList.contains('my-panel'));
  });
  assert.ok(buttons[0].classList.contains('ui-tab') && buttons[0].classList.contains('tab-a'));
});

test('页签：点击与键盘切换，方向键循环、Home 与 End 跳到两端，每次选中都通知', () => {
  const { ui } = setup();
  const selected = [];
  const tabs = createThreeTabs(ui, { onSelect: (id) => selected.push(id) });
  assert.deepEqual(selected, ['a'], '初始选中也通知，默认选中第一项');
  const press = (id, key) => tabs.buttons[id].dispatchEvent(new env.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  tabs.buttons.c.click();
  assert.equal(tabs.getActiveId(), 'c');
  press('c', 'ArrowRight');
  assert.equal(tabs.getActiveId(), 'a', '最后一项向右回到第一项');
  press('a', 'ArrowLeft');
  assert.equal(tabs.getActiveId(), 'c', '第一项向左回到最后一项');
  press('c', 'Home');
  assert.equal(tabs.getActiveId(), 'a');
  press('a', 'End');
  assert.equal(tabs.getActiveId(), 'c');
  assert.deepEqual(selected, ['a', 'c', 'a', 'c', 'a', 'c']);
});

test('页签：可传入已有面板与数量节点，面板可聚焦；没有页签项时报错', () => {
  const { ui, doc } = setup();
  const count = doc.createElement('span');
  const panel = doc.createElement('div');
  const tabs = ui.tabs({ items: [{ id: 'x', label: '甲', count, panel }], focusablePanels: true });
  assert.equal(tabs.panelById.x, panel);
  assert.equal(panel.getAttribute('tabindex'), '0');
  assert.equal(tabs.buttons.x.lastChild, count);
  assert.throws(() => ui.tabs({ items: [] }), /至少需要一项/);
});

test('列表：列表项用 aria-current 标出当前项，可点击，并带页面类名', () => {
  const { ui } = setup();
  let clicks = 0;
  const current = ui.listItem({ selected: true, className: 'row', ariaLabel: '第一项', onClick: () => clicks++ }, '内容');
  const other = ui.listItem({ selected: false });
  const list = ui.list({ tag: 'aside', className: 'my-list', ariaLabel: '示例列表' }, current, other);
  assert.equal(list.tagName, 'ASIDE');
  assert.ok(list.classList.contains('ui-list') && list.classList.contains('my-list'));
  assert.equal(current.getAttribute('aria-current'), 'true');
  assert.equal(other.hasAttribute('aria-current'), false);
  assert.equal(current.type, 'button');
  assert.ok(current.classList.contains('ui-list__item') && current.classList.contains('row'));
  assert.equal(current.getAttribute('aria-label'), '第一项');
  current.click();
  assert.equal(clicks, 1);
});
test('页签：steps 变体加修饰类，未知变体报错', () => {
  const { ui } = setup();
  const tabs = createThreeTabs(ui, { variant: 'steps' });
  assert.ok(tabs.element.classList.contains('ui-tabs') && tabs.element.classList.contains('ui-tabs--steps'));
  assert.throws(() => createThreeTabs(ui, { variant: 'cards' }), /未知的页签变体/);
});
