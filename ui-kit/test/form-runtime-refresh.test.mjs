// ------------------------------------------------------------------------
// 名称：form-runtime-refresh.test.mjs
// 说明：表单引擎随可选模型实时刷新的 DOM 测试：收到模型变化事件后，已打开表单里的下拉选项与说明更新、新增字段出现，用户没有改动时关闭不提示放弃修改。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：使用 jsdom 加载组件库与 resources/form/form-runtime.js，宿主用假实现并记录请求。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { createUiEnvironment } from './ui-environment.mjs';

const RESOURCES_ROOT = fileURLToPath(new URL('../../resources/', import.meta.url));

let env;

afterEach(() => env?.close());

const OLD_DEFAULT = '沿用默认（没有可用的文本模型）';
const NEW_DEFAULT = '沿用默认（千问 · 模型甲）';

/** 文本模型下拉字段。 */
function textModelField(options, description) {
  return { key: 'textModel', label: '文本模型', description, control: 'select', required: true, followsFirstOption: true, options };
}

/** 加载表单引擎并打开一个表单；refreshed 是刷新请求返回的内容。 */
async function openForm(initial, refreshed) {
  env = createUiEnvironment();
  const { window } = env;
  const handlers = new Map();
  const requests = [];
  window.hostBridge = {
    request: async (name) => {
      requests.push(name);
      if (name === 'form.open') return initial;
      if (name === 'form.refresh') return refreshed;
      return {};
    },
    onEvent: (name, handler) => handlers.set(name, handler)
  };
  window.eval(readFileSync(`${RESOURCES_ROOT}form/form-runtime.js`, 'utf8'));
  const closed = window.aiForm.open({ form: 'demo' });
  await new Promise((resolve) => window.setTimeout(resolve, 20));
  const emit = async () => {
    handlers.get('models.changed')();
    await new Promise((resolve) => window.setTimeout(resolve, 300));
  };
  return { document: window.document, requests, closed, emit };
}

/** 页面里各字段的当前显示：下拉的所选文字与说明。 */
function readFields(document) {
  return [...document.querySelectorAll('.ui-field')].map((field) => ({
    label: field.querySelector('.ui-field__label')?.textContent,
    value: field.querySelector('.ui-select__value')?.textContent,
    description: field.querySelector('.ui-field__description')?.textContent
  }));
}

test('收到模型变化事件：下拉选项与说明更新，选中第一项的字段跟随新的第一项，新增的字段出现', async () => {
  const initial = {
    formId: 1,
    schema: { title: '新建作品', submitLabel: '保存', fields: [textModelField([OLD_DEFAULT], '说明甲')] },
    values: { textModel: OLD_DEFAULT }
  };
  const refreshed = {
    schema: {
      title: '新建作品',
      submitLabel: '保存',
      fields: [
        textModelField([NEW_DEFAULT, '千问 · 模型甲'], '说明乙'),
        { key: 'videoModel', label: '目标视频模型', description: '可选', control: 'select', required: false, options: ['千问 · 视频甲'] }
      ]
    },
    values: { textModel: NEW_DEFAULT, videoModel: '' }
  };
  const { document, requests, closed, emit } = await openForm(initial, refreshed);
  assert.deepEqual(readFields(document).map((field) => field.value), [OLD_DEFAULT]);

  await emit();
  assert.ok(requests.includes('form.refresh'));
  assert.deepEqual(readFields(document), [
    { label: '文本模型', value: NEW_DEFAULT, description: '必填，说明乙' },
    { label: '目标视频模型', value: '请选择', description: '可选' }
  ]);

  // 没有手动修改过，刷新后关闭不会询问是否放弃修改。
  [...document.querySelectorAll('button')].find((button) => button.textContent === '取消').click();
  assert.equal(await closed, false);
  assert.ok(requests.includes('form.close'));
});

test('收到模型变化事件：所选模型仍可用时保留用户的选择，字段减少时移除', async () => {
  const initial = {
    formId: 2,
    schema: {
      title: '新建作品',
      submitLabel: '保存',
      fields: [
        textModelField([NEW_DEFAULT, '千问 · 模型甲', '千问 · 模型乙'], '说明'),
        { key: 'videoModel', label: '目标视频模型', description: '可选', control: 'select', required: false, options: ['千问 · 视频甲'] }
      ]
    },
    values: { textModel: NEW_DEFAULT, videoModel: '' }
  };
  const refreshed = {
    schema: { title: '新建作品', submitLabel: '保存', fields: [textModelField([NEW_DEFAULT, '千问 · 模型甲'], '说明')] },
    values: { textModel: NEW_DEFAULT }
  };
  const { document, closed, emit } = await openForm(initial, refreshed);
  const trigger = document.querySelector('.ui-select__trigger');
  trigger.click();
  [...document.querySelectorAll('.ui-select__option')].find((option) => option.textContent === '千问 · 模型甲').click();
  assert.equal(readFields(document)[0].value, '千问 · 模型甲');

  await emit();
  assert.deepEqual(readFields(document).map((field) => [field.label, field.value]), [['文本模型', '千问 · 模型甲']]);

  // 用户改动过，关闭时仍会询问。
  [...document.querySelectorAll('button')].find((button) => button.textContent === '取消').click();
  await new Promise((resolve) => env.window.setTimeout(resolve, 20));
  assert.ok([...document.querySelectorAll('button')].some((button) => button.textContent === '放弃修改'));
  [...document.querySelectorAll('button')].find((button) => button.textContent === '放弃修改').click();
  assert.equal(await closed, false);
});

test('说明文字随来源字段的所选值变化：初始值与切换后都显示对应说明，没有对应值时显示默认说明', async () => {
  const initial = {
    formId: 3,
    schema: {
      title: '生成节拍表',
      submitLabel: '开始生成',
      fields: [
        { key: 'template', label: '节拍模板', description: '模板', control: 'select', required: true, options: ['模板甲', '模板乙', '模板丙'] },
        {
          key: 'seconds',
          label: '目标时长',
          description: '默认说明',
          control: 'text',
          required: false,
          descriptionByValue: { sourceKey: 'template', byValue: { 模板甲: '推荐 10 秒', 模板乙: '推荐 60 秒' } },
          valueByValue: { sourceKey: 'template', byValue: { 模板甲: '10', 模板乙: '60' } }
        }
      ]
    },
    values: { template: '模板乙', seconds: '' }
  };
  const { document } = await openForm(initial, initial);
  const secondsDescription = () => readFields(document)[1].description;
  assert.equal(secondsDescription(), '推荐 60 秒');
  const secondsValue = () => document.querySelectorAll('.ui-field')[1].querySelector('input').value;
  assert.equal(secondsValue(), '');

  const choose = (name) => {
    document.querySelector('.ui-select__trigger, .ui-select button, [role="combobox"]').click();
    [...document.querySelectorAll('[role="option"]')].find((option) => option.textContent === name).click();
  };
  choose('模板甲');
  assert.equal(secondsDescription(), '推荐 10 秒');
  assert.equal(secondsValue(), '10');
  choose('模板丙');
  assert.equal(secondsDescription(), '默认说明');
  assert.equal(secondsValue(), '10');
});