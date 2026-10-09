// ------------------------------------------------------------------------
// 名称：ui-styles.test.mjs
// 说明：界面组件库样式的静态检查：滚动条无箭头、无背景、悬停才显示滑块，禁用态样式覆盖所有控件。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：jsdom 不计算样式，这里直接检查样式文本；真实外观靠浏览器手工验证。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { sourceRoot } from './load-manifest.mjs';

/** 读取组件库样式文件。 */
function readStyle(name) {
  return readFileSync(join(sourceRoot, name), 'utf8').replace(/\r\n/g, '\n');
}

/** 取某个选择器对应的样式块内容（选择器需完全一致）。 */
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  assert.ok(match, `找不到样式规则：${selector}`);
  return match[1];
}

test('滚动条：去掉两端箭头，轨道与角落没有背景', () => {
  const css = readStyle('ui-scrollbar.css');
  assert.match(ruleBody(css, '*::-webkit-scrollbar-button'), /display:\s*none/);
  assert.match(ruleBody(css, '*::-webkit-scrollbar-track,\n*::-webkit-scrollbar-corner'), /background:\s*transparent/);
  assert.match(ruleBody(css, '*::-webkit-scrollbar'), /background:\s*transparent/);
});

test('滚动条：平时滑块透明，鼠标移到区域上（带悬停标记）才出现', () => {
  const css = readStyle('ui-scrollbar.css');
  assert.match(ruleBody(css, '*::-webkit-scrollbar-thumb'), /background-color:\s*transparent/);
  assert.match(ruleBody(css, '[data-ui-hover]::-webkit-scrollbar-thumb'), /background-color:\s*var\(--scrollbar-thumb-bg\)/);
  assert.match(ruleBody(css, '[data-ui-hover]::-webkit-scrollbar-thumb:hover'), /--scrollbar-thumb-hover-bg/);
});

test('滚动条：鼠标悬停在滚动条各部分上保持箭头光标', () => {
  const css = readStyle('ui-scrollbar.css');
  const selector = '*::-webkit-scrollbar,\n*::-webkit-scrollbar-track,\n*::-webkit-scrollbar-thumb,\n*::-webkit-scrollbar-corner';
  assert.match(ruleBody(css, selector), /cursor:\s*default/);
});

test('滚动条：只允许把 scrollbar-color 重置为 auto（非 auto 时 Chromium 会忽略 -webkit-scrollbar 样式）', () => {
  const scrollbarCss = readStyle('ui-scrollbar.css');
  assert.match(ruleBody(scrollbarCss, '*'), /scrollbar-color:\s*auto/, '需要重置外层在 html 上可能设置的 scrollbar-color');
  assert.doesNotMatch(scrollbarCss, /scrollbar-width\s*:/);
  assert.doesNotMatch(scrollbarCss, /scrollbar-color:\s*(?!auto\b)\S/);
  for (const file of ['ui-controls.css', 'ui-dialog.css']) {
    assert.doesNotMatch(readStyle(file), /scrollbar-(color|width)\s*:/, `${file} 不应设置标准滚动条属性`);
  }
});

test('禁用态：按钮、输入、下拉、单选复选、开关都有明确样式', () => {
  const css = readStyle('ui-controls.css');
  for (const selector of [
    '.ui-input.ui-is-disabled,\n.ui-textarea.ui-is-disabled',
    '.ui-select__trigger:disabled',
    '.ui-choice[aria-disabled="true"] .ui-choice__label',
    '.ui-switch-row.ui-is-disabled .ui-switch-row__label'
  ]) {
    assert.match(ruleBody(css, selector), /var\(--disabled-(text|bg|border)\)/, `${selector} 应使用禁用态令牌`);
  }
  assert.match(ruleBody(css, '.ui-button:disabled,\n.ui-button:disabled:hover,\n.ui-button:disabled:active'), /cursor:\s*default/);
  assert.match(ruleBody(css, '.ui-switch:disabled,\n.ui-switch:disabled:hover,\n.ui-switch:disabled:active'), /cursor:\s*default/);
});

test('表格操作列：按钮垂直居中，带图标与纯文字按钮不会错开', () => {
  const css = readStyle('ui-table.css');
  assert.match(ruleBody(css, '.ui-table__cell--actions .ui-button'), /vertical-align:\s*middle/);
});

test('多行文本：关闭浏览器原生的拖动手柄，改用自绘把手', () => {
  const css = readStyle('ui-controls.css');
  assert.match(css, /\.ui-textarea__field \{[^}]*resize:\s*none/);
  assert.match(ruleBody(css, '.ui-textarea__grip'), /cursor:\s*ns-resize/);
  assert.match(ruleBody(css, '.ui-textarea.ui-is-disabled .ui-textarea__grip'), /display:\s*none/);
});

test('宽度占满的输入类控件自带 box-sizing，不依赖页面的全局样式', () => {
  const css = readStyle('ui-controls.css');
  for (const selector of ['.ui-input,\n.ui-textarea', '.ui-input__field,\n.ui-textarea__field', '.ui-select__trigger']) {
    assert.match(ruleBody(css, selector), /box-sizing:\s*border-box/, `${selector} 应设置 box-sizing`);
  }
});

test('令牌：定义了禁用态颜色', () => {
  const tokens = readStyle('ui-tokens.css');
  for (const name of ['--disabled-text', '--disabled-bg', '--disabled-border']) {
    assert.ok(tokens.includes(`${name}:`), `缺少令牌 ${name}`);
  }
});

test('全局字体：由令牌统一定义并应用到 body，对话框沿用令牌', () => {
  const tokens = readStyle('ui-tokens.css');
  assert.ok(tokens.includes('--font-family:'), '缺少令牌 --font-family');
  assert.match(ruleBody(tokens, 'body'), /font-family:\s*var\(--font-family\)/);
  assert.ok(!readStyle('ui-dialog.css').includes('--host-font-family'), '对话框不应绕过全局字体令牌');
});

test('表格：样式只使用令牌颜色，令牌已定义；数字列靠右，操作列收缩到内容宽度', () => {
  const css = readStyle('ui-table.css');
  const tokens = readStyle('ui-tokens.css');
  const used = new Set(css.match(/--(?:table|chip)-[a-z-]+/g));
  assert.ok(used.size > 0, '表格样式应使用表格令牌');
  for (const name of used) assert.ok(tokens.includes(`${name}:`), `缺少令牌 ${name}`);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-f]{3,8}\b|\brgba?\(/i, '表格样式不应写死颜色');
  assert.match(ruleBody(css, '.ui-table__cell--number'), /text-align:\s*right/);
  assert.match(ruleBody(css, '.ui-table__cell--actions'), /width:\s*1%/);
});

test('表格操作列：左对齐、固定在右侧，行内单元格不透明且悬停色叠在底色上', () => {
  const css = readStyle('ui-table.css');
  const actions = ruleBody(css, '.ui-table__cell--actions');
  assert.match(actions, /text-align:\s*left/);
  assert.match(actions, /position:\s*sticky/);
  assert.match(actions, /right:\s*0/);
  assert.match(ruleBody(css, '.ui-table tbody .ui-table__cell--actions'), /background:\s*var\(--table-surface\)/);
  assert.match(ruleBody(css, '.ui-table tbody tr:hover .ui-table__cell--actions'), /background:\s*var\(--table-row-hover-solid\)/);
  assert.match(readStyle('ui-tokens.css'), /--table-row-hover-solid:[^;]*var\(--table-surface\)/);
});

test('悬停过渡：按钮与悬停变色的元素使用统一时长令牌，减少动态效果时令牌归零', () => {
  const tokens = readStyle('ui-tokens.css');
  assert.match(tokens, /--hover-duration:\s*0\.15s/);
  assert.match(tokens, /prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{\s*--hover-duration:\s*0s/);
  const transition = /transition:[^;]*var\(--hover-duration\)/;
  assert.match(ruleBody(readStyle('ui-controls.css'), '.ui-button'), transition);
  assert.match(ruleBody(readStyle('ui-controls.css'), '.ui-select__option'), transition);
  assert.match(ruleBody(readStyle('ui-dialog.css'), '.ui-dialog__close'), transition);
  assert.match(ruleBody(readStyle('ui-file-picker.css'), '.ui-file-picker__thumb'), transition);
  assert.match(ruleBody(readStyle('ui-table.css'), '.ui-table tbody tr'), transition);
  assert.match(ruleBody(readStyle('ui-table.css'), '.ui-table tbody .ui-table__cell--actions'), transition);
});

test('交互反馈：输入、下拉、选项、单选复选、开关的悬停与按下颜色分级，表格行只有悬停', () => {
  const css = readStyle('ui-controls.css');
  const tokens = readStyle('ui-tokens.css');
  for (const name of ['--input-border-hover', '--input-border-active', '--option-active-bg', '--option-selected-hover-bg', '--switch-off-active-bg', '--accent-active']) {
    assert.ok(tokens.includes(`${name}:`), `缺少令牌 ${name}`);
  }
  assert.match(css, /\.ui-input:not\(\.ui-is-disabled\)[^{]*:hover[^{]*\{[^}]*--input-border-hover/);
  assert.match(css, /\.ui-select__trigger:not\(:disabled\)[^{]*:hover[^{]*\{[^}]*--input-border-hover/);
  assert.match(ruleBody(css, '.ui-select__option:active'), /--option-active-bg/);
  assert.match(ruleBody(css, '.ui-switch:active'), /--switch-off-active-bg/);
  assert.match(ruleBody(css, '.ui-switch[aria-checked="true"]:active'), /--accent-active/);
  assert.doesNotMatch(readStyle('ui-table.css'), /tr:active/, '表格行只有悬停变化，没有按下变化');
});

test('焦点边框：轮廓向内偏移 1px 盖在边框上，边框加轮廓合计仍为 1px', () => {
  const css = readStyle('ui-controls.css');
  for (const selector of ['.ui-input:focus-within,\n.ui-textarea:focus-within', '.ui-select__trigger:focus-visible']) {
    const body = ruleBody(css, selector);
    assert.match(body, /outline:\s*1px solid/);
    assert.match(body, /outline-offset:\s*-1px/);
  }
});
/** 递归列出目录下的样式文件。 */
function listStyleFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listStyleFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}

test('字体总控：除令牌文件外，样式不写死字号与字重，统一引用 ui-tokens.css 的字体角色令牌', () => {
  const resourcesRoot = join(sourceRoot, '..', '..', 'resources');
  const offenders = [];
  for (const path of [...listStyleFiles(sourceRoot), ...listStyleFiles(resourcesRoot)]) {
    if (path.endsWith('ui-tokens.css')) continue;
    readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (/^\s*font-(size|weight):\s*\d/.test(line)) offenders.push(path + ':' + (index + 1) + ' ' + line.trim());
    });
  }
  assert.deepEqual(offenders, [], '这些位置写死了字号或字重');
});
test('间距与圆角总控：除令牌文件外，样式不写死 3 到 13px 的间距与圆角，统一引用 ui-tokens.css 的间距、圆角令牌', () => {
  const resourcesRoot = join(sourceRoot, '..', '..', 'resources');
  const offenders = [];
  for (const path of [...listStyleFiles(sourceRoot), ...listStyleFiles(resourcesRoot)]) {
    if (path.endsWith('ui-tokens.css')) continue;
    readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, index) => {
      const declaration = /^\s*(margin|padding|gap|row-gap|column-gap|border-radius|--[\w-]*(?:gap|padding|margin|radius))[\w-]*:\s*([^;]+);/.exec(line);
      if (!declaration || /(^|\s)-\d/.test(declaration[2])) return;
      if (/(?<![\w.-])([3-9]|1[0-3])px\b/.test(declaration[2])) offenders.push(path + ':' + (index + 1) + ' ' + line.trim());
    });
  }
  assert.deepEqual(offenders, [], '这些位置写死了间距或圆角');
});
