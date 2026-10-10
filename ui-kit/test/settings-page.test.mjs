// ------------------------------------------------------------------------
// 名称：settings-page.test.mjs
// 说明：模型设置页的 DOM 测试：服务商设置里的模型表有价格列（没有价格显示“—”），“测试连接”的结果按接口地址显示在各自标签右侧，服务商列表的每一行带余额、用量查询按钮，结果或失败原因显示在本行，不支持的查询按钮不可用。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：使用 jsdom 加载组件库与 resources/settings/settings.js，宿主请求用假实现并记录调用；放在 ui-kit/test 是因为 npm test 只收集这里的页面测试。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { createUiEnvironment, fire } from './ui-environment.mjs';

const RESOURCES_ROOT = fileURLToPath(new URL('../../resources/', import.meta.url));
/** 设置页按依赖顺序加载的脚本（相对 resources/settings 目录）。 */
const PAGE_SCRIPTS = ['settings-widgets.js', 'settings-secret-form.js', 'settings-text.js', 'settings-provider.js', 'settings-account.js', 'settings.js'];

let env;

afterEach(() => env?.close());

/** 设置页加载数据：两个服务商（火山有两个模型、一个有价格），以及对应的两行账户（一个能查，一个没有接口）。 */
const LOADED = {
  text: {
    defaultModel: '',
    choices: [],
    splitMode: 'chapter',
    maxSegmentChars: 20000,
    segmentCharsRange: { min: 2000, max: 100000 },
    modelNote: null,
    engineNote: null
  },
  providers: [
    {
      id: 1,
      code: 'volc',
      displayName: '火山',
      isEnabled: true,
      apiKeyConfigured: true,
      settings: [],
      models: [
        { id: 1, code: 'm1', displayName: '模型一', kind: 'text', kindLabel: '文本', isEnabled: true, capabilitySummary: ['上下文：1M'], pricing: '输入 6.00 元/百万 token' },
        { id: 2, code: 'm2', displayName: '模型二', kind: 'text', kindLabel: '文本', isEnabled: false, capabilitySummary: [], pricing: null }
      ]
    },
    { id: 2, code: 'qianwen', displayName: '千问', isEnabled: true, apiKeyConfigured: true, settings: [], models: [] }
  ],
  accounts: [
    { providerId: 1, displayName: '火山', credential: 'access-key', credentialReady: true, sharedWith: null, balanceSupported: true, usageSupported: true, note: '需要账户密钥' },
    { providerId: 2, displayName: '千问', credential: 'none', credentialReady: true, sharedWith: null, balanceSupported: false, usageSupported: false, note: '暂无接口' }
  ]
};

/** 建立页面并加载脚本；queryResult 决定账户查询请求的响应。 */
async function setup(queryResult) {
  env = createUiEnvironment();
  const { window, document } = env;
  document.body.innerHTML = '<div id="app"></div>';
  const requests = [];
  window.hostBridge = {
    request: async (name, payload) => {
      requests.push([name, JSON.parse(JSON.stringify(payload ?? null))]);
      if (name === 'settings.load') return LOADED;
      if (name === 'settings.accountBalance' || name === 'settings.accountUsage') return queryResult;
      throw new Error('未预期的请求');
    },
    onEvent: () => undefined
  };
  for (const file of PAGE_SCRIPTS) window.eval(readFileSync(`${RESOURCES_ROOT}settings/${file}`, 'utf8'));
  await new Promise((resolve) => window.setTimeout(resolve, 20));
  return { document, requests };
}

/** 服务商列表的行。 */
function accountRows(document) {
  const section = [...document.querySelectorAll('section')].find((item) => item.querySelector('h2')?.textContent === '模型服务商');
  assert.ok(section, '应有“模型服务商”分区');
  return [...section.querySelectorAll('tbody tr')];
}

/** 按可访问名称或文字找按钮。 */
function findButton(root, label) {
  return [...root.querySelectorAll('button')].find((button) => (button.getAttribute('aria-label') ?? button.textContent).includes(label));
}

const wait = (ms = 10) => new Promise((resolve) => env.window.setTimeout(resolve, ms));

test('服务商列表：每行带查询按钮；能查的行按钮可用并有账户密钥入口，没有接口的行按钮不可用', async () => {
  const { document } = await setup({ ok: true, message: '', entries: [] });
  const [volc, qianwen] = accountRows(document);
  assert.ok(volc.textContent.includes('火山'));
  assert.ok(document.body.textContent.includes('千问：暂无接口'), '说明显示在列表下方');
  assert.equal(findButton(volc, '查询余额').disabled, false);
  assert.equal(findButton(volc, '查询用量').disabled, false);
  assert.ok(findButton(volc, '账户密钥：火山'));
  assert.equal(findButton(qianwen, '查询余额').disabled, true);
  assert.equal(findButton(qianwen, '查询用量').disabled, true);
  assert.equal(findButton(qianwen, '账户密钥'), undefined);
});

test('查询余额：发出请求，结果显示在本行；查询用量显示各项与说明', async () => {
  const { document, requests } = await setup({ ok: true, message: '2026-10 月账单', entries: [{ name: '可用余额', text: '12.34 元' }] });
  const [volc] = accountRows(document);
  fire(env, findButton(volc, '查询余额'), 'click');
  await wait();
  assert.deepEqual(requests.filter(([name]) => name === 'settings.accountBalance'), [['settings.accountBalance', { providerId: 1 }]]);
  const [updated] = accountRows(document);
  assert.ok(updated.textContent.includes('可用余额') && updated.textContent.includes('12.34 元'));

  fire(env, findButton(updated, '查询用量'), 'click');
  await wait();
  assert.ok(requests.some(([name]) => name === 'settings.accountUsage'));
  assert.ok(accountRows(document)[0].textContent.includes('2026-10 月账单'));
});

test('查询失败：宿主返回的原因显示在本行，请求本身失败时显示“查询失败”', async () => {
  const { document } = await setup({ ok: false, message: '尚未配置账户密钥', entries: [] });
  fire(env, findButton(accountRows(document)[0], '查询余额'), 'click');
  await wait();
  assert.ok(accountRows(document)[0].textContent.includes('尚未配置账户密钥'));

  env.window.hostBridge.request = async () => {
    throw { message: '网络中断' };
  };
  fire(env, findButton(accountRows(document)[0], '查询用量'), 'click');
  await wait();
  assert.ok(accountRows(document)[0].textContent.includes('查询失败：网络中断'));
});

test('服务商设置的模型表：价格列显示价格说明，没有价格的模型显示“—”', async () => {
  const { document } = await setup({ ok: true, message: '', entries: [] });
  fire(env, findButton(document, '设置：火山'), 'click');
  await wait();
  const rows = [...document.querySelectorAll('table')].flatMap((table) => [...table.querySelectorAll('tbody tr')]).filter((row) => row.textContent.includes('模型一') || row.textContent.includes('模型二'));
  assert.equal(rows.length, 2);
  assert.ok(rows[0].textContent.includes('输入 6.00 元/百万 token'));
  assert.ok(rows[1].textContent.includes('—'));
  assert.ok(document.body.textContent.includes('价格'));
});

test('测试连接：每个接口地址的结果显示在对应标签右侧，无法测试的原因显示在状态文字里', async () => {
  const savedSettings = LOADED.providers[0].settings;
  const field = (key, label, kind) => ({ key, label, description: '', control: 'text', defaultValue: '', value: `https://${key}.test`, connectionCheckKind: kind });
  LOADED.providers[0].settings = [field('endpoint', '接口地址（图片、视频）', 'video'), field('textEndpoint', '文本接口地址', 'text')];
  try {
    const { document } = await setup({ ok: true, message: '', entries: [] });
    const original = env.window.hostBridge.request;
    let answer = {
      notice: null,
      results: [
        { settingKey: 'endpoint', ok: true, message: '连接成功！' },
        { settingKey: 'textEndpoint', ok: false, message: '密钥或账号问题：bad' }
      ]
    };
    env.window.hostBridge.request = async (name, payload) => (name === 'settings.providerTestConnection' ? answer : original(name, payload));

    fire(env, findButton(document, '设置：火山'), 'click');
    await wait();
    fire(env, findButton(document, '测试连接'), 'click');
    await wait();
    const heads = [...document.querySelectorAll('.provider-setting-head')];
    assert.deepEqual(heads.map((head) => head.textContent), ['接口地址（图片、视频）连接成功！', '文本接口地址密钥或账号问题：bad']);
    assert.ok(heads[0].querySelector('.provider-setting-result').classList.contains('status-success'));
    assert.ok(heads[1].querySelector('.provider-setting-result').classList.contains('status-error'));

    answer = { notice: '尚未配置访问密钥。', results: [] };
    fire(env, findButton(document, '测试连接'), 'click');
    await wait();
    assert.deepEqual([...document.querySelectorAll('.provider-setting-result')].map((item) => [item.textContent, item.hidden]), [['', true], ['', true]]);
    assert.ok(document.body.textContent.includes('尚未配置访问密钥。'));
  } finally {
    LOADED.providers[0].settings = savedSettings;
  }
});

/** 弹出页（含确认对话框）里文字完全匹配的按钮，取最上层的一个。 */
const dialogButton = (document, text) => [...document.querySelectorAll('.ui-dialog button')].filter((button) => button.textContent.trim() === text).at(-1);

/** 在页面里按可访问名称找输入框并填入内容。 */
function typeInto(document, label, value) {
  const input = document.querySelector(`input[aria-label="${label}"]`);
  assert.ok(input, `应有输入框：${label}`);
  input.value = value;
}

test('访问密钥表单：空输入只提示不请求；保存带公共参数并清空输入；宿主的字段错误显示在字段下；清除确认后状态变为未配置', async () => {
  const { document, requests } = await setup({ ok: true, message: '', entries: [] });
  const original = env.window.hostBridge.request;
  let keyAnswer = { provider: { apiKeyConfigured: true } };
  env.window.hostBridge.request = async (name, payload) => {
    if (name === 'settings.providerSetKey' || name === 'settings.providerClearKey') {
      requests.push([name, JSON.parse(JSON.stringify(payload))]);
      if (keyAnswer instanceof Error) throw keyAnswer;
      return keyAnswer;
    }
    return original(name, payload);
  };
  fire(env, findButton(document, '设置：火山'), 'click');
  await wait();

  const input = document.querySelector('input[aria-label="火山访问密钥"]');
  assert.equal(input.placeholder, '已配置，输入新密钥可更换');
  assert.equal(findButton(document, '更换密钥').textContent, '更换密钥');
  fire(env, findButton(document, '更换密钥'), 'click');
  await wait();
  assert.ok(document.body.textContent.includes('访问密钥不能为空。'));
  assert.equal(requests.filter(([name]) => name === 'settings.providerSetKey').length, 0);

  typeInto(document, '火山访问密钥', ' abc ');
  fire(env, findButton(document, '更换密钥'), 'click');
  await wait();
  assert.deepEqual(requests.filter(([name]) => name === 'settings.providerSetKey'), [['settings.providerSetKey', { providerId: 1, apiKey: 'abc' }]]);
  assert.equal(input.value, '');
  assert.ok(!document.body.textContent.includes('访问密钥不能为空。'));
  assert.ok(document.body.textContent.includes('已保存'));

  keyAnswer = Object.assign(new Error('校验失败'), { fieldErrors: { apiKey: '密钥格式不对。' } });
  typeInto(document, '火山访问密钥', 'bad');
  fire(env, findButton(document, '更换密钥'), 'click');
  await wait();
  assert.ok(document.body.textContent.includes('密钥格式不对。'));
  assert.ok(!document.body.textContent.includes('保存失败'));

  keyAnswer = { provider: { apiKeyConfigured: false } };
  fire(env, findButton(document, '清除密钥'), 'click');
  await wait();
  fire(env, dialogButton(document, '清除'), 'click');
  await wait();
  assert.deepEqual(requests.filter(([name]) => name === 'settings.providerClearKey'), [['settings.providerClearKey', { providerId: 1 }]]);
  assert.equal(input.placeholder, '粘贴访问密钥');
  assert.equal(findButton(document, '保存密钥').textContent, '保存密钥');
  assert.equal(findButton(document, '清除密钥').hidden, true);
  assert.equal(findButton(document, '测试连接').disabled, true);
});

test('账户密钥表单：两个输入一起提交，宿主指出的字段错误分别显示，保存失败的其他原因显示在状态文字里', async () => {
  const { document, requests } = await setup({ ok: true, message: '', entries: [] });
  const original = env.window.hostBridge.request;
  let keyAnswer = { account: { credentialReady: true } };
  env.window.hostBridge.request = async (name, payload) => {
    if (name === 'settings.accountSetKey') {
      requests.push([name, JSON.parse(JSON.stringify(payload))]);
      if (keyAnswer instanceof Error) throw keyAnswer;
      return keyAnswer;
    }
    return original(name, payload);
  };
  fire(env, findButton(document, '账户密钥：火山'), 'click');
  await wait();

  typeInto(document, '火山的 AccessKey ID', ' ak ');
  typeInto(document, '火山的 SecretKey', 'sk');
  fire(env, findButton(document, '更换密钥'), 'click');
  await wait();
  assert.deepEqual(requests.filter(([name]) => name === 'settings.accountSetKey'), [['settings.accountSetKey', { providerId: 1, accessKeyId: 'ak', secretAccessKey: 'sk' }]]);
  assert.equal(document.querySelector('input[aria-label="火山的 SecretKey"]').value, '');
  assert.ok(document.body.textContent.includes('已保存'));

  keyAnswer = Object.assign(new Error('校验失败'), { fieldErrors: { accessKeyId: 'ID 不能为空。' } });
  fire(env, findButton(document, '更换密钥'), 'click');
  await wait();
  assert.ok(document.body.textContent.includes('ID 不能为空。'));

  keyAnswer = new Error('网络中断');
  fire(env, findButton(document, '更换密钥'), 'click');
  await wait();
  assert.ok(document.body.textContent.includes('保存失败：网络中断'));
  assert.ok(!document.body.textContent.includes('ID 不能为空。'));
});
