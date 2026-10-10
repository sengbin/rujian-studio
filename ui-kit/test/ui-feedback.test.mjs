// ------------------------------------------------------------------------
// 名称：ui-feedback.test.mjs
// 说明：界面组件库反馈与图片组件的 DOM 测试：说明块、提示区、缩略图、查看原图，以及文本转换与字节格式化。
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

test('说明块：显示说明文字，可带按钮，没有按钮时不留空节点', () => {
  const { ui } = setup();
  const plain = ui.state({ text: '加载中…' });
  assert.ok(plain.classList.contains('ui-state'));
  assert.equal(plain.querySelector('p.description').textContent, '加载中…');
  assert.equal(plain.querySelector('button'), null);
  assert.equal(plain.children.length, 1);

  let clicks = 0;
  const withButton = ui.state({ text: '还没有项目。', button: ui.button({ text: '创建项目', onClick: () => (clicks += 1) }) });
  const button = withButton.querySelector('button');
  assert.equal(button.textContent, '创建项目');
  button.click();
  assert.equal(clicks, 1);
});

test('提示区：默认隐藏并带 role=status，成功与失败用不同状态类，空串清除并隐藏', () => {
  const { ui } = setup();
  const message = ui.message();
  assert.equal(message.element.getAttribute('role'), 'status');
  assert.equal(message.element.hidden, true);
  assert.ok(message.element.classList.contains('ui-message'));

  message.show('已保存。', false);
  assert.equal(message.element.hidden, false);
  assert.equal(message.element.textContent, '已保存。');
  assert.ok(message.element.classList.contains('status-success') && !message.element.classList.contains('status-error'));

  message.show('保存失败。', true);
  assert.ok(message.element.classList.contains('status-error') && !message.element.classList.contains('status-success'));

  message.show('', false);
  assert.equal(message.element.hidden, true);
  assert.equal(message.element.textContent, '');
});

test('提示区：flush 去掉外边距类，role 可改为 alert，显示后仍保留基础类', () => {
  const { ui } = setup();
  const message = ui.message({ flush: true, role: 'alert' });
  assert.equal(message.element.getAttribute('role'), 'alert');
  message.show('出错了', true);
  assert.ok(message.element.classList.contains('ui-message--flush'));
  assert.ok(message.element.classList.contains('ui-message') && message.element.classList.contains('status-error'));
});

test('缩略图：有图可点击时是按钮，无点击时是普通块，没有图片时显示占位文字', () => {
  const { ui } = setup();
  let clicks = 0;
  const clickable = ui.thumb({ src: 'data:image/png;base64,AAAA', alt: '猫', title: '查看原图', ariaLabel: '查看原图：猫', onClick: () => (clicks += 1) });
  assert.equal(clickable.tagName.toLowerCase(), 'button');
  assert.ok(clickable.classList.contains('ui-thumb') && clickable.classList.contains('ui-thumb--button'));
  assert.equal(clickable.getAttribute('type'), 'button');
  assert.equal(clickable.getAttribute('aria-label'), '查看原图：猫');
  assert.equal(clickable.getAttribute('title'), '查看原图');
  assert.equal(clickable.querySelector('img.ui-image--cover').getAttribute('alt'), '猫');
  clickable.click();
  assert.equal(clicks, 1);

  const still = ui.thumb({ src: 'data:image/png;base64,AAAA', alt: '猫', className: 'page-thumb' });
  assert.equal(still.tagName.toLowerCase(), 'div');
  assert.ok(still.classList.contains('page-thumb'));

  const empty = ui.thumb({ text: '无图', className: 'page-thumb' });
  assert.equal(empty.textContent, '无图');
  assert.equal(empty.querySelector('img'), null);
  assert.ok(empty.classList.contains('ui-thumb') && empty.classList.contains('page-thumb'));
});

test('查看原图：弹出页带标题和完整显示的图片，可关闭', async () => {
  const { ui, doc } = setup();
  const handle = ui.viewImage({ title: '客厅图', src: 'data:image/png;base64,AAAA' });
  const image = doc.querySelector('.ui-image-viewer img.ui-image--contain');
  assert.ok(image, '应显示原图');
  assert.equal(image.getAttribute('alt'), '客厅图');
  assert.equal(doc.querySelector('.ui-dialog__title').textContent, '客厅图');
  handle.close('api');
  await handle.closed;
  assert.equal(doc.querySelector('.ui-image-viewer'), null);
});

test('文本转换与字节格式化：空值按空串，字节按 1024 进位，B 取整、其余一位小数', () => {
  const { ui } = setup();
  assert.equal(ui.toText(undefined), '');
  assert.equal(ui.toText(null), '');
  assert.equal(ui.toText(0), '0');
  assert.equal(ui.toText(false), 'false');
  assert.equal(ui.formatBytes(0), '0 B');
  assert.equal(ui.formatBytes(1023), '1023 B');
  assert.equal(ui.formatBytes(1536), '1.5 KB');
  assert.equal(ui.formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(ui.formatBytes(3 * 1024 * 1024 * 1024), '3.0 GB');
  assert.equal(ui.formatBytes(2048 * 1024 * 1024 * 1024), '2048.0 GB');
});
