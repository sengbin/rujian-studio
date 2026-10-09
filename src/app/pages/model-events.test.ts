// ------------------------------------------------------------------------
// 名称：model-events.test.ts
// 说明：可选模型变化事件的自动化测试：服务商与文本模型设置任一变化都会推送事件，取消订阅后不再推送，事件名称与界面脚本一致。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：不依赖 VS Code；用假的订阅源代替服务。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ChangeNotifier } from '../services/change-notifier';
import { MODEL_EVENTS, watchModelChanges } from './model-events';

test('服务商或文本模型设置变化时推送事件，取消订阅后不再推送', () => {
  const providers = new ChangeNotifier();
  const settings = new ChangeNotifier();
  const posted: string[] = [];
  const stop = watchModelChanges(
    { onDidChangeProviders: (listener) => providers.subscribe(listener) },
    { onDidChangeSettings: (listener) => settings.subscribe(listener) },
    (name) => posted.push(name)
  );
  providers.notify();
  settings.notify();
  assert.deepEqual(posted, [MODEL_EVENTS.changed, MODEL_EVENTS.changed]);
  stop();
  providers.notify();
  settings.notify();
  assert.equal(posted.length, 2);
});

test('事件名称与监听它的界面脚本一致', () => {
  const resources = path.join(__dirname, '..', '..', '..', 'resources');
  for (const file of ['form/form-runtime.js', 'asset-list/asset-generate.js', 'workbench/workbench.js', 'stage/stage-storyboard-preview-voice.js']) {
    assert.ok(readFileSync(path.join(resources, file), 'utf8').includes(`'${MODEL_EVENTS.changed}'`), `${file} 里缺少 ${MODEL_EVENTS.changed}`);
  }
});
