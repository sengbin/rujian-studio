// ------------------------------------------------------------------------
// 名称：app-request.test.ts
// 说明：自定义协议请求解析的自动化测试：页面 HTML、静态资源的放行范围与路径边界。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：路径只做解析，不访问磁盘。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { resolveAppRequest } from './app-request';
import { toFrameUrl, toResourceUrl } from './shell-channels';

const ROOT = path.resolve('/app-root');
const HTML_BY_ID: Record<string, string> = { 'work-list:text': '<p>work</p>', sidebar: '<p>side</p>' };
const lookup = (frameId: string): string | undefined => HTML_BY_ID[frameId];

test('页面地址返回登记的 HTML，标识里的特殊字符经编码后仍能还原', () => {
  assert.deepEqual(resolveAppRequest(toFrameUrl('work-list:text'), ROOT, lookup), { kind: 'html', html: '<p>work</p>' });
  assert.deepEqual(resolveAppRequest(toFrameUrl('sidebar'), ROOT, lookup), { kind: 'html', html: '<p>side</p>' });
});

test('未登记的页面返回未找到', () => {
  assert.deepEqual(resolveAppRequest(toFrameUrl('other'), ROOT, lookup), { kind: 'notFound' });
});

test('资源地址解析为资源根目录下的文件', () => {
  const result = resolveAppRequest(toResourceUrl('resources/shared/host-bridge.js'), ROOT, lookup);
  assert.deepEqual(result, { kind: 'file', filePath: path.join(ROOT, 'resources', 'shared', 'host-bridge.js') });
  const uiKit = resolveAppRequest(toResourceUrl('ui-kit/src/ui-core.js'), ROOT, lookup);
  assert.deepEqual(uiKit, { kind: 'file', filePath: path.join(ROOT, 'ui-kit', 'src', 'ui-core.js') });
});

test('只放行 resources 与 ui-kit/src 目录，其他目录与同名前缀目录都拒绝', () => {
  for (const target of ['package.json', 'src/main.ts', 'ui-kit/test/x.mjs', 'ui-kit/manifest.json', 'resourcesX/a.js', 'node_modules/a.js']) {
    assert.deepEqual(resolveAppRequest(`rujian-app://res/${target}`, ROOT, lookup), { kind: 'notFound' }, target);
  }
});

test('拒绝 .. 越界（含编码形式）、反斜杠与空路径段', () => {
  for (const target of ['resources/../package.json', 'resources/%2e%2e/package.json', 'resources/..%2Fpackage.json', 'resources%5C..%5Cpackage.json', 'resources//a.js', 'resources/a%00.js']) {
    assert.deepEqual(resolveAppRequest(`rujian-app://res/${target}`, ROOT, lookup), { kind: 'notFound' }, target);
  }
});

test('页面地址不接受多级路径，未知主机与其他协议都返回未找到', () => {
  assert.deepEqual(resolveAppRequest('rujian-app://page/sidebar/extra', ROOT, lookup), { kind: 'notFound' });
  assert.deepEqual(resolveAppRequest('rujian-app://other/resources/a.js', ROOT, lookup), { kind: 'notFound' });
  assert.deepEqual(resolveAppRequest('https://res/resources/a.js', ROOT, lookup), { kind: 'notFound' });
  assert.deepEqual(resolveAppRequest('not a url', ROOT, lookup), { kind: 'notFound' });
});
