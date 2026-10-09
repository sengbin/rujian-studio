// ------------------------------------------------------------------------
// 名称：ui-icons.test.mjs
// 说明：内联 SVG 图标的测试：图标创建、文字与图标的匹配规则、按钮图标随文字变化、规则引用的图标都存在。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：使用 jsdom；只验证图标名称与结构，不验证视觉。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { sourceRoot } from './load-manifest.mjs';
import { createUiEnvironment } from './ui-environment.mjs';

let env;

/** 每个用例使用全新的页面，结束后释放。 */
function setup() {
  env = createUiEnvironment();
  return env.aiUi;
}

afterEach(() => env?.close());

/** 按钮文字与应匹配图标名称的对照，覆盖应用里各页面的主要按钮。 */
const EXPECTED_ICONS = [
  ['保存', 'device-floppy'],
  ['保存并继续', 'device-floppy'],
  ['保存密钥', 'key'],
  ['清除密钥', 'key-off'],
  ['添加', 'plus'],
  ['新建作品', 'video-plus'],
  ['创建项目', 'folder-plus'],
  ['创建分类', 'category-plus'],
  ['新建资产', 'photo-plus'],
  ['修改', 'pencil'],
  ['编辑镜头', 'pencil'],
  ['删除', 'trash'],
  ['删除此版本', 'trash'],
  ['取消', 'x'],
  ['关闭', 'x'],
  ['取消生成', 'player-stop'],
  ['确定', 'check'],
  ['确认采用', 'circle-check'],
  ['采用此版本', 'circle-check'],
  ['重试', 'reload'],
  ['重试提示词', 'reload'],
  ['重新生成', 'refresh'],
  ['重新生成提示词', 'refresh'],
  ['生成剧本', 'sparkles'],
  ['创建并生成提示词', 'sparkles'],
  ['开始生成', 'sparkles'],
  ['参考节拍表生成', 'sparkles'],
  ['提示词', 'writing'],
  ['编辑提示词', 'writing'],
  ['查看剧本', 'eye'],
  ['查看原始输出', 'file-code'],
  ['结果版本（2）', 'versions'],
  ['对比所选版本（0/2）', 'arrows-diff'],
  ['播放', 'player-play'],
  ['试听', 'player-play'],
  ['停止', 'player-stop'],
  ['打开视频', 'movie'],
  ['导出…', 'file-export'],
  ['在文件夹中显示', 'folder-open'],
  ['备份到文件…', 'database-export'],
  ['从文件恢复…', 'database-import'],
  ['测试连接', 'plug-connected'],
  ['提交所选（2）', 'send'],
  ['上一步', 'arrow-left'],
  ['上移', 'arrow-up'],
  ['下移', 'arrow-down'],
  ['全选', 'select-all'],
  ['清空', 'eraser'],
  ['从这里拆开', 'scissors'],
  ['并入上一组', 'arrows-join'],
  ['设为主资产', 'star'],
  ['解除', 'unlink'],
  ['选择音色', 'microphone'],
  ['选择资产', 'photo-search'],
  ['第 3 组', 'current-location']
];

test('图标：按名称创建内联 SVG，线条颜色取文字颜色，对读屏软件隐藏；未知名称返回 null', () => {
  const ui = setup();
  const icon = ui.icon('plus', 'demo-icon');
  assert.equal(icon.tagName.toLowerCase(), 'svg');
  assert.equal(icon.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(icon.getAttribute('stroke'), 'currentColor');
  assert.equal(icon.getAttribute('viewBox'), '0 0 24 24');
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.ok(icon.classList.contains('ui-icon') && icon.classList.contains('demo-icon'));
  assert.ok(icon.querySelector('path'), '图标应带图形');
  assert.equal(ui.icon('not-an-icon'), null);
});

test('图标匹配：各页面的按钮文字都匹配到贴切的图标', () => {
  const ui = setup();
  for (const [text, name] of EXPECTED_ICONS) {
    const matched = ui.iconForLabel(text);
    assert.equal(matched?.name, name, `“${text}”应匹配 ${name}`);
    assert.ok(ui.icon(matched.name), `${name} 应存在于图标集`);
  }
  assert.equal(ui.iconForLabel('下一步：配置参数').position, 'end', '前进类文字的图标在文字后');
  assert.equal(ui.iconForLabel('保存').position, 'start');
  assert.equal(ui.iconForLabel('没有对应规则的文字'), null);
});

test('规则引用的图标和页面使用的图标都存在于图标集', () => {
  const rules = readFileSync(join(sourceRoot, 'ui-icon-rules.js'), 'utf8');
  const icons = readFileSync(join(sourceRoot, 'ui-icons.js'), 'utf8');
  const ui = setup();
  const names = [...rules.matchAll(/^\s*\[\/.*\/, '([a-z0-9-]+)'/gm)].map((match) => match[1]);
  assert.ok(names.length > 30, '应读取到全部规则');
  for (const name of new Set(names)) assert.ok(ui.icon(name), `规则引用的图标 ${name} 不存在`);
  assert.ok(!/\bhref=/.test(icons) && !/<use\b/.test(icons), '图标必须内联图形，不引用外部文件');
});

test('按钮：图标按文字自动匹配，指定图标优先，false 不显示图标，图标位置可调', () => {
  const ui = setup();
  const iconName = (button) => button.element.querySelector('svg')?.innerHTML ?? null;
  const saved = ui.button({ text: '保存' });
  assert.ok(saved.element.querySelector('svg.ui-button__icon'));
  assert.equal(saved.element.firstElementChild.tagName.toLowerCase(), 'svg', '图标在文字前');
  assert.equal(iconName(saved), ui.icon('device-floppy').innerHTML);

  const custom = ui.button({ text: '保存', icon: 'send' });
  assert.equal(iconName(custom), ui.icon('send').innerHTML);
  assert.equal(ui.button({ text: '保存', icon: false }).element.querySelector('svg'), null);
  assert.equal(ui.button({ text: '没有对应规则的文字' }).element.querySelector('svg'), null);

  const next = ui.button({ text: '下一步：配置参数' });
  assert.equal(next.element.lastElementChild.tagName.toLowerCase(), 'svg', '前进类图标在文字后');
  assert.equal(ui.button({ text: '没有对应规则的文字', icon: 'plus', iconPosition: 'end' }).element.lastElementChild.tagName.toLowerCase(), 'svg');
});

test('按钮：预设的图标在文字没有匹配项时使用，文字有匹配项时按文字', () => {
  const ui = setup();
  const innerOf = (button) => button.element.querySelector('svg').innerHTML;
  assert.equal(innerOf(ui.button({ kind: 'add', text: '一个没有规则的文字' })), ui.icon('plus').innerHTML);
  assert.equal(innerOf(ui.button({ kind: 'add', text: '创建项目' })), ui.icon('folder-plus').innerHTML);
});

test('按钮：改文字时图标重新匹配，指定过图标后不再随文字变化，纯图标按钮保持图标', () => {
  const ui = setup();
  const innerOf = (button) => button.element.querySelector('svg')?.innerHTML ?? null;
  const submit = ui.button({ text: '保存' });
  submit.setText('取消');
  assert.equal(innerOf(submit), ui.icon('x').innerHTML);
  assert.equal(submit.element.querySelectorAll('svg').length, 1, '换图标后只保留一个图标');
  submit.setText('没有对应规则的文字');
  assert.equal(innerOf(submit), null, '文字没有匹配项时去掉图标');

  const fixed = ui.button({ text: '试听', icon: 'player-play' });
  fixed.setIcon('player-stop');
  fixed.setText('保存');
  assert.equal(innerOf(fixed), ui.icon('player-stop').innerHTML);
  fixed.setIcon('not-an-icon');
  assert.equal(innerOf(fixed), ui.icon('player-stop').innerHTML, '未知图标名被忽略');

  const only = ui.button({ text: '删除', iconOnly: true });
  only.setText('没有对应规则的文字');
  assert.equal(innerOf(only), ui.icon('trash').innerHTML);
  assert.equal(only.element.getAttribute('aria-label'), '没有对应规则的文字');
});

test('对话框：关闭按钮和底部按钮都带内联图标，底部按钮可指定图标', async () => {
  const ui = setup();
  const handle = ui.openDialog({
    title: '示例',
    content: ui.h('p', { text: '内容' }),
    buttons: [{ id: 'ok', text: '确定', variant: 'primary' }, { id: 'extra', text: '没有规则的文字', icon: 'star' }, { id: 'cancel', text: '取消', isCancel: true }]
  });
  const doc = env.document;
  assert.ok(doc.querySelector('.ui-dialog__close svg.ui-dialog__close-icon'), '标题栏关闭按钮应是内联图标');
  const footerButtons = [...doc.querySelectorAll('.ui-dialog__footer button')];
  assert.deepEqual(footerButtons.map((button) => button.querySelector('svg')?.innerHTML), [ui.icon('check').innerHTML, ui.icon('star').innerHTML, ui.icon('x').innerHTML]);
  handle.close('test');
  await handle.closed;
});
