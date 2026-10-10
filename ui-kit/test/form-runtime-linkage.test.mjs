// ------------------------------------------------------------------------
// 名称：form-runtime-linkage.test.mjs
// 说明：表单引擎字段联动的 DOM 测试：按来源字段的值显示或隐藏字段（visibleWhen）、下拉选项随来源字段逐级变化（optionsByValue），以及隐藏字段不参与校验、提交时仍带值。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-08
// 备注：使用 jsdom 加载组件库与 resources/form/form-runtime.js，宿主用假实现并记录提交的值。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { createUiEnvironment } from './ui-environment.mjs';

const RESOURCES_ROOT = fileURLToPath(new URL('../../resources/', import.meta.url));

let env;

afterEach(() => env?.close());

const MODE_RUN = '直接生成';
const MODE_TEXT = '只生成提示词';
const MODE_BOTH = '提示词并生成';

/** 下拉字段的定义。 */
function select(key, label, extra = {}) {
  return { key, label, description: '', control: 'select', required: false, ...extra };
}

/** 加载表单引擎并打开一个表单；refreshed 是刷新请求返回的内容；返回页面、记录的提交值和触发模型变化事件的函数。 */
async function openForm(schema, values, refreshed) {
  env = createUiEnvironment();
  const { window } = env;
  const submitted = [];
  const handlers = new Map();
  window.hostBridge = {
    request: async (name, payload) => {
      if (name === 'form.open') return { formId: 1, schema, values };
      if (name === 'form.refresh') return refreshed;
      if (name === 'form.submit') submitted.push(payload.values);
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
  return { document: window.document, submitted, closed, emit };
}

/** 页面里各字段（含隐藏的）的元素，按渲染顺序。 */
function fieldsOf(document) {
  return [...document.querySelectorAll('.ui-field')];
}

/** 各字段是否显示。 */
function visibility(document) {
  return fieldsOf(document).map((field) => !field.hidden);
}

/** 在第 index 个字段的下拉里选择某项。 */
function choose(document, index, text) {
  fieldsOf(document)[index].querySelector('.ui-select__trigger').click();
  const option = [...document.querySelectorAll('[role="option"]')].find((item) => item.textContent === text);
  assert.ok(option, `下拉里没有“${text}”`);
  option.click();
}

/** 第 index 个字段下拉当前的选项文字（打开弹层读取后关闭）。 */
function optionsOf(document, index) {
  const trigger = fieldsOf(document)[index].querySelector('.ui-select__trigger');
  trigger.click();
  const texts = [...document.querySelectorAll('[role="option"]')].map((item) => item.textContent);
  trigger.click();
  return texts;
}

/** 第 index 个字段下拉当前显示的值。 */
function valueOf(document, index) {
  return fieldsOf(document)[index].querySelector('.ui-select__value').textContent;
}

/** jsdom 里创建的对象与测试不在同一 realm，比较前先做 JSON 往返。 */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/** 点击提交按钮并等待请求完成。 */
async function clickSubmit(document) {
  [...document.querySelectorAll('button')].find((button) => button.textContent === '创建').click();
  await new Promise((resolve) => env.window.setTimeout(resolve, 20));
}

/** 生成方式、模型、数量三个字段加一个只在需要文本时显示的必填文本字段。 */
const MODE_SCHEMA = {
  title: '新建',
  submitLabel: '创建',
  fields: [
    select('mode', '生成方式', { required: true, options: [MODE_RUN, MODE_TEXT, MODE_BOTH] }),
    select('model', '模型', { options: ['模型甲', '模型乙'], visibleWhen: { sourceKey: 'mode', values: [MODE_RUN, MODE_BOTH] } }),
    select('count', '数量', {
      options: ['1', '2'],
      placeholder: '默认 1',
      optionsByValue: { sourceKey: 'model', byValue: { 模型甲: ['1', '2'], 模型乙: ['1', '2', '3', '4'] } },
      visibleWhen: { sourceKey: 'mode', values: [MODE_RUN, MODE_BOTH] }
    }),
    {
      key: 'note',
      label: '备注',
      description: '',
      control: 'text',
      required: true,
      visibleWhen: { sourceKey: 'mode', values: [MODE_TEXT, MODE_BOTH] }
    }
  ]
};

test('按来源字段的值显示或隐藏字段：初始值与切换后都生效', async () => {
  const { document } = await openForm(MODE_SCHEMA, { mode: MODE_RUN, model: '模型甲', count: '', note: '' });
  assert.deepEqual(visibility(document), [true, true, true, false]);

  choose(document, 0, MODE_TEXT);
  assert.deepEqual(visibility(document), [true, false, false, true]);
  choose(document, 0, MODE_BOTH);
  assert.deepEqual(visibility(document), [true, true, true, true]);
});

test('选项随来源字段变化：换来源后选项更新，仍有效的值保留，无效的值清空', async () => {
  const { document } = await openForm(MODE_SCHEMA, { mode: MODE_RUN, model: '模型甲', count: '', note: '' });
  assert.deepEqual(optionsOf(document, 2), ['默认 1', '1', '2']);

  choose(document, 1, '模型乙');
  assert.deepEqual(optionsOf(document, 2), ['默认 1', '1', '2', '3', '4']);
  choose(document, 2, '4');
  assert.equal(valueOf(document, 2), '4');

  choose(document, 1, '模型甲');
  assert.deepEqual(optionsOf(document, 2), ['默认 1', '1', '2']);
  assert.equal(valueOf(document, 2), '默认 1', '原来的 4 不在新选项里，清空为未选择');

  choose(document, 1, '模型乙');
  choose(document, 2, '2');
  choose(document, 1, '模型甲');
  assert.equal(valueOf(document, 2), '2', '仍在新选项里的值保留');
});

test('隐藏的必填字段不校验，提交时仍带着当前值', async () => {
  const { document, submitted } = await openForm(MODE_SCHEMA, { mode: MODE_RUN, model: '模型甲', count: '', note: '' });
  await clickSubmit(document);
  assert.deepEqual(plain(submitted), [{ mode: MODE_RUN, model: '模型甲', count: '', note: '' }]);
});

test('隐藏的字段显示出来后必填生效：没有填写时不提交并提示，填写后可提交', async () => {
  const { document, submitted } = await openForm(MODE_SCHEMA, { mode: MODE_RUN, model: '模型甲', count: '', note: '' });
  choose(document, 0, MODE_TEXT);
  await clickSubmit(document);
  assert.equal(submitted.length, 0, '备注显示出来后必填，没有填写时不提交');
  assert.match(fieldsOf(document)[3].textContent, /备注不能为空/);

  const input = fieldsOf(document)[3].querySelector('input');
  input.value = '说明';
  input.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  await clickSubmit(document);
  assert.deepEqual(plain(submitted), [{ mode: MODE_TEXT, model: '模型甲', count: '', note: '说明' }]);
});

test('可用模型变化后刷新：所选模型不再可用时改选新的初始值，依赖它的下拉按新定义和当前值重算选项', async () => {
  const refreshed = {
    schema: {
      ...MODE_SCHEMA,
      fields: MODE_SCHEMA.fields.map((field) =>
        field.key === 'model'
          ? { ...field, options: ['模型甲'] }
          : field.key === 'count'
            ? { ...field, optionsByValue: { sourceKey: 'model', byValue: { 模型甲: ['1', '2', '3'] } } }
            : field
      )
    },
    values: { mode: MODE_RUN, model: '模型甲', count: '', note: '' }
  };
  const { document, emit } = await openForm(MODE_SCHEMA, { mode: MODE_RUN, model: '模型甲', count: '', note: '' }, refreshed);
  choose(document, 1, '模型乙');
  choose(document, 2, '4');

  await emit();
  assert.equal(valueOf(document, 1), '模型甲', '模型乙已不可用，改选新定义的初始值');
  assert.deepEqual(optionsOf(document, 2), ['默认 1', '1', '2', '3'], '数量按新的对照表和当前模型重算');
  assert.equal(valueOf(document, 2), '默认 1', '原来的 4 不在新选项里，清空');
});

test('逐级联动：来源改变时依赖它的下拉先换选项，再带动下一级；字段声明 followsFirstOption 时被清空后改选新的第一项', async () => {
  const schema = {
    title: '新建',
    submitLabel: '创建',
    fields: [
      select('kind', '类型', { required: true, options: ['语音', '音乐'] }),
      select('model', '模型', {
        followsFirstOption: true,
        options: ['模型甲', '模型乙'],
        optionsByValue: { sourceKey: 'kind', byValue: { 语音: ['模型甲', '模型乙'], 音乐: ['模型丙'] } }
      }),
      select('voice', '音色', {
        options: ['小红'],
        optionsByValue: { sourceKey: 'model', byValue: { 模型甲: ['小红'], 模型乙: [], 模型丙: ['小蓝', '小绿'] } }
      })
    ]
  };
  const { document } = await openForm(schema, { kind: '语音', model: '模型甲', voice: '小红' });
  assert.deepEqual([valueOf(document, 1), valueOf(document, 2)], ['模型甲', '小红']);

  choose(document, 0, '音乐');
  assert.deepEqual(optionsOf(document, 1), ['请选择', '模型丙']);
  assert.equal(valueOf(document, 1), '模型丙', '原模型不在新选项里，改选新的第一项');
  assert.deepEqual(optionsOf(document, 2), ['请选择', '小蓝', '小绿'], '再下一级按新模型换选项');
  assert.equal(valueOf(document, 2), '请选择', '原音色不在新选项里，清空');
});
