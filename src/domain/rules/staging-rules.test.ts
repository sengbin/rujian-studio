// ------------------------------------------------------------------------
// 名称：staging-rules.test.ts
// 说明：镜头站位规则的自动化测试：站位字段读取与校验、写成视频提示词的文字，以及模型输出、用户编辑中站位的校验与实体映射。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：纯函数测试，不依赖数据库。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeneratedOutputError, ValidationError } from '../errors';
import { ShotDraft, ShotStaging, StoryboardEntity, StoryboardParams } from '../models/storyboard';
import { describeStaging, readStagingFields } from './staging-rules';
import { normalizeShotEdit, parseStoryboard } from './storyboard-rules';

const ENTITIES: StoryboardEntity[] = [
  { id: 1, kind: 'character', name: '守夜人', aliases: ['老陈'] },
  { id: 2, kind: 'scene', name: '灯塔', aliases: [] },
  { id: 3, kind: 'prop', name: '木桌', aliases: [] }
];

const PARAMS: StoryboardParams = {
  visualStyle: null,
  minShotSeconds: null,
  maxShotSeconds: null,
  groupMaxSeconds: 15,
  maxShots: null,
  continuity: 'none',
  audioMode: 'none',
  audioElements: [],
  extra: null
};

/** 一个合规的镜头，可按需覆盖字段。 */
function shot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { durationSeconds: 4, entities: [{ kind: 'character', name: '守夜人' }], prompt: '灯塔', staging: [], ...overrides };
}

/** 解析模型输出里的一个镜头。 */
function parseOne(raw: unknown): ShotDraft {
  return parseStoryboard({ shots: [raw] }, { params: PARAMS, entities: ENTITIES })[0];
}

/** 解析模型输出并返回校验问题。 */
function issuesOf(raw: unknown): readonly string[] {
  try {
    parseOne(raw);
  } catch (error) {
    if (error instanceof GeneratedOutputError) {
      return error.issues;
    }
    throw error;
  }
  return [];
}

test('读取站位字段：空值为 null，全空且没有动作视为没有填写', () => {
  const issues: string[] = [];
  assert.equal(readStagingFields({}, '站位', issues), null);
  assert.equal(readStagingFields({ startX: '', endX: null, action: '  ' }, '站位', issues), null);
  assert.deepEqual(readStagingFields({ startX: 'left', facing: 'right', action: ' 坐下 ' }, '站位', issues), {
    startX: 'left',
    startDepth: null,
    endX: null,
    endDepth: null,
    facing: 'right',
    action: '坐下'
  });
  assert.deepEqual(issues, []);
});

test('读取站位字段：不在取值范围内的位置与过长的动作记录问题', () => {
  const issues: string[] = [];
  readStagingFields({ startX: '左边', startDepth: 'near', facing: 'up', action: '动'.repeat(101) }, '守夜人的站位', issues);
  assert.equal(issues.length, 4);
  assert.ok(issues.every((issue) => issue.startsWith('守夜人的站位的 ')));
});

test('站位文字：起点、朝向、终点与动作依次描述，画面外写成进入、离开', () => {
  const names = new Map([[1, '守夜人'], [3, '木桌']]);
  const staging: ShotStaging[] = [
    { entityId: 1, startX: 'left', startDepth: 'front', endX: 'off_right', endDepth: null, facing: 'right', action: '' },
    { entityId: 3, startX: null, startDepth: 'back', endX: null, endDepth: null, facing: null, action: '' },
    { entityId: 9, startX: 'center', startDepth: null, endX: null, endDepth: null, facing: null, action: '没有名称' }
  ];
  assert.equal(describeStaging(staging, names), '站位（以观众看到的画面为准）：守夜人位于画面左侧前景，面朝画面右侧，向画面右外离开画面；木桌位于背景。');
  assert.equal(describeStaging([], names), '');
  assert.equal(describeStaging(staging.slice(2), names), '', '找不到名称的条目跳过');
});

test('解析：站位的实体按名称映射并自动加入出场实体，场景与全空条目忽略，同一实体后面的覆盖前面的', () => {
  const first = parseOne(
    shot({
      entities: [{ kind: 'scene', name: '灯塔' }],
      staging: [
        { kind: 'character', name: '老陈', startX: 'left', startDepth: 'middle' },
        { kind: 'character', name: '守夜人', startX: 'right', endX: 'center', facing: 'camera', action: '回头' },
        { kind: 'scene', name: '灯塔', startX: 'center' },
        { kind: 'prop', name: '木桌' }
      ]
    })
  );
  assert.deepEqual(first.entityIds, [2, 1]);
  assert.deepEqual(first.staging, [{ entityId: 1, startX: 'right', startDepth: null, endX: 'center', endDepth: null, facing: 'camera', action: '回头' }]);
});

test('解析：没有 staging 时为空；引用不存在的实体、位置不合法、不是数组都记为问题', () => {
  assert.deepEqual(parseOne({ durationSeconds: 4, entities: [], prompt: '灯塔' }).staging, []);
  assert.equal(issuesOf(shot({ staging: [{ kind: 'character', name: '路人', startX: 'left' }, { kind: 'character', name: '守夜人', startX: '左边' }] })).length, 2);
  assert.match(issuesOf(shot({ staging: 'left' })).join(), /staging 必须是数组/);
});

test('编辑：站位按实体标识提交，场景忽略，站位的实体自动加入出场实体', () => {
  const edit = normalizeShotEdit(
    {
      prompt: '新画面',
      durationSeconds: 3,
      entityIds: [2],
      staging: [
        { entityId: 1, startX: 'left', endX: 'center', action: '走近' },
        { entityId: 2, startX: 'center' },
        { entityId: 3 }
      ],
      sounds: []
    },
    ENTITIES,
    true
  );
  assert.deepEqual(edit.entityIds, [2, 1]);
  assert.deepEqual(edit.staging, [{ entityId: 1, startX: 'left', startDepth: null, endX: 'center', endDepth: null, facing: null, action: '走近' }]);
  assert.deepEqual(normalizeShotEdit({ prompt: '新画面', durationSeconds: 3 }, ENTITIES, true).staging, []);
});

test('编辑：站位的实体不存在、位置不合法或格式不对时报字段错误', () => {
  const base = { prompt: '新画面', durationSeconds: 3, entityIds: [], sounds: [] };
  for (const staging of [[{ entityId: 99, startX: 'left' }], [{ entityId: 1, facing: 'up' }], 'left']) {
    assert.throws(() => normalizeShotEdit({ ...base, staging }, ENTITIES, true), (error) => error instanceof ValidationError && error.fieldErrors.staging !== undefined, JSON.stringify(staging));
  }
});
