// ------------------------------------------------------------------------
// 名称：sidebar-status.test.ts
// 说明：侧栏底部状态条内容的自动化测试：数据库与模型状态的文案、等级，以及已启用模型数的统计口径。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：无
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModelRecord, ProviderRecord } from '../domain/models/model-provider';
import { buildSidebarStatus, countEnabledModels } from './sidebar-status';

/** 构造只含统计所需字段的服务商记录。 */
function provider(id: number, isEnabled: boolean): ProviderRecord {
  return { id, code: `p${id}`, displayName: `服务商${id}`, settings: {}, isEnabled, createdAt: '', updatedAt: '' };
}

/** 构造只含统计所需字段的模型记录。 */
function model(id: number, providerId: number, isEnabled: boolean): ModelRecord {
  return { id, providerId, code: `m${id}`, displayName: `模型${id}`, kind: 'text', isEnabled } as ModelRecord;
}

test('数据库正常且有已启用模型：两项均为正常等级', () => {
  const entries = buildSidebarStatus({ databaseReady: true, enabledModelCount: 3 });

  assert.deepEqual(
    entries.map((entry) => [entry.id, entry.value, entry.level]),
    [['database', '正常', 'normal'], ['models', '已启用 3 个', 'normal']]
  );
});

test('没有已启用模型：模型条目为需要留意，并以文字说明', () => {
  const models = buildSidebarStatus({ databaseReady: true, enabledModelCount: 0 }).find((entry) => entry.id === 'models');

  assert.deepEqual([models?.value, models?.level], ['尚未启用', 'warning']);
});

test('数据库不可用：只有错误等级的数据库条目，不显示模型条目', () => {
  const entries = buildSidebarStatus({ databaseReady: false, enabledModelCount: 5 });

  assert.deepEqual(entries.map((entry) => [entry.id, entry.value, entry.level]), [['database', '不可用', 'error']]);
});

test('统计已启用模型：服务商和模型都启用才计入', () => {
  const providers = [provider(1, true), provider(2, false)];
  const models = [model(1, 1, true), model(2, 1, false), model(3, 2, true)];
  const repository = {
    listProviders: () => providers,
    listModels: (filter?: { providerId?: number }) => models.filter((item) => filter?.providerId === undefined || item.providerId === filter.providerId)
  };

  assert.equal(countEnabledModels(repository), 1);
});
