// ------------------------------------------------------------------------
// 名称：storyboard-entities.test.ts
// 说明：分镜脚本实体清单的测试：设定摘要、别名与角色“表演与动作”的附加。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：纯函数测试，不依赖数据库。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StoryboardEntity } from '../../domain/models/storyboard';
import { describeEntities } from './storyboard-workflow';

const GUARD: StoryboardEntity = { id: 1, kind: 'character', name: '守夜人', aliases: ['老周'] };
const LAMP: StoryboardEntity = { id: 2, kind: 'prop', name: '油灯', aliases: [] };

test('没有实体时返回占位文字', () => {
  assert.equal(describeEntities([], new Map()), '（无）');
});

test('没有表演与动作时，清单与原来一致', () => {
  const text = describeEntities([GUARD, LAMP], new Map([[1, '灯塔守护者']]));
  assert.equal(text, '- 角色：守夜人（别名：老周）——灯塔守护者\n- 道具：油灯');
});

test('有表演与动作的角色在其下另起一行缩进列出', () => {
  const text = describeEntities([GUARD, LAMP], new Map([[1, '灯塔守护者']]), new Map([[1, '说谎时眼神先向左下偏移']]));
  assert.equal(text, '- 角色：守夜人（别名：老周）——灯塔守护者\n  表演与动作：说谎时眼神先向左下偏移\n- 道具：油灯');
});
