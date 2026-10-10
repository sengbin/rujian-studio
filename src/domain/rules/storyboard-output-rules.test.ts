// ------------------------------------------------------------------------
// 名称：storyboard-output-rules.test.ts
// 说明：分镜脚本模型输出解析规则的自动化测试：镜头与声音校验、实体按名称映射、首帧来源、镜头数与总时长限制。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯函数测试，不依赖数据库。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeneratedOutputError } from '../errors';
import { StoryboardEntity, StoryboardParams } from '../models/storyboard';
import { parseStoryboard } from './storyboard-output-rules';

const ENTITIES: StoryboardEntity[] = [
  { id: 1, kind: 'character', name: '守夜人', aliases: ['老陈'] },
  { id: 2, kind: 'scene', name: '灯塔', aliases: [] },
  { id: 3, kind: 'prop', name: '灯塔', aliases: [] }
];

const PARAMS: StoryboardParams = {
  visualStyle: null,
  minShotSeconds: null,
  maxShotSeconds: null,
  groupMaxSeconds: 15,
  maxShots: null,
  continuity: 'ai',
  audioMode: 'native',
  audioElements: ['dialogue', 'narration', 'sfx', 'music'],
  extra: null
};

/** 一个合规的镜头，可按需覆盖字段。 */
function shot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    durationSeconds: 4,
    entities: [{ kind: 'character', name: '守夜人' }],
    prompt: '灯塔',
    firstFrameMode: 'none',
    sounds: [],
    ...overrides
  };
}

/** 捕获输出校验的问题列表。 */
function issuesOf(raw: unknown, params: StoryboardParams = PARAMS): readonly string[] {
  try {
    parseStoryboard(raw, { params, entities: ENTITIES });
  } catch (error) {
    if (error instanceof GeneratedOutputError) {
      return error.issues;
    }
    throw error;
  }
  return [];
}

test('解析：镜头时长不能超过单组最长时长，否则放不进任何一组', () => {
  const params = { ...PARAMS, groupMaxSeconds: 10 };
  assert.deepEqual(issuesOf({ shots: [shot({ durationSeconds: 11 })] }, params), ['第 1 个镜头的 durationSeconds 必须是 0.1 到 10 之间的数字。']);
  assert.deepEqual(issuesOf({ shots: [shot({ durationSeconds: 10 })] }, params), []);
});

test('解析：所有镜头总时长不能超过本集目标时长，恰好等于或没有目标时长时通过', () => {
  const raw = { shots: [shot(), shot(), shot(), shot()] };
  const issues = (maxTotalSeconds: number | null): readonly string[] => {
    try {
      parseStoryboard(raw, { params: PARAMS, entities: ENTITIES, maxTotalSeconds });
    } catch (error) {
      if (error instanceof GeneratedOutputError) {
        return error.issues;
      }
      throw error;
    }
    return [];
  };
  assert.deepEqual(issues(15), ['所有镜头总时长 16 秒，超过本集目标时长 15 秒，请减少镜头或缩短镜头时长。']);
  assert.deepEqual(issues(16), []);
  assert.deepEqual(issues(null), []);
});

test('解析：镜头序号由顺序决定，实体按（类型，名称或别名）映射为标识，说话人自动加入出场实体', () => {
  const shots = parseStoryboard(
    {
      shots: [
        shot({ entities: [{ kind: 'scene', name: '灯塔' }, { kind: 'prop', name: '灯塔' }] }),
        shot({
          firstFrameMode: 'prev_tail',
          entities: [],
          sounds: [
            { kind: 'dialogue', speaker: '老陈', text: '今晚会下雨。', delivery: '低声' },
            { kind: 'sfx', text: '雷声', durationSeconds: 2 }
          ]
        })
      ]
    },
    { params: PARAMS, entities: ENTITIES }
  );
  assert.deepEqual(shots.map((item) => item.seq), [1, 2]);
  assert.deepEqual(shots[0].entityIds, [2, 3], '同名不同类型的实体分别映射');
  assert.equal(shots[1].firstFrameMode, 'prev_tail');
  assert.deepEqual(shots[1].entityIds, [1], '老陈是守夜人的别名，并加入出场实体');
  assert.equal(shots[1].sounds[0].speakerEntityId, 1);
  assert.equal(shots[1].sounds[1].durationSeconds, 2);
});

test('解析：名称带“（别名：…）”后缀、类型填错时报引用了不存在的实体，不猜测映射', () => {
  const entities: StoryboardEntity[] = [
    { id: 1, kind: 'character', name: '松鼠', aliases: [] },
    { id: 2, kind: 'scene', name: '松树洞', aliases: ['树洞'] }
  ];
  const parse = (shotOverrides: Record<string, unknown>): readonly string[] => {
    try {
      parseStoryboard({ shots: [shot(shotOverrides)] }, { params: PARAMS, entities });
    } catch (error) {
      if (error instanceof GeneratedOutputError) {
        return error.issues;
      }
      throw error;
    }
    return [];
  };
  assert.deepEqual(parse({ entities: [{ kind: 'scene', name: '松树洞（别名：树洞）' }] }), ['第 1 个镜头引用了不存在的场景“松树洞（别名：树洞）”，只能引用剧本中已有的实体。']);
  assert.deepEqual(parse({ entities: [{ kind: 'prop', name: '松树洞' }] }), ['第 1 个镜头引用了不存在的道具“松树洞”，只能引用剧本中已有的实体。']);
  assert.deepEqual(parse({ entities: [{ kind: 'scene', name: '树洞' }] }), [], '别名可以直接引用');
});

test('解析：场景出现在站位里被忽略', () => {
  const entities: StoryboardEntity[] = [
    { id: 1, kind: 'character', name: '松鼠', aliases: [] },
    { id: 2, kind: 'scene', name: '松树洞', aliases: ['树洞'] }
  ];
  const shots = parseStoryboard(
    {
      shots: [
        shot({
          entities: [{ kind: 'scene', name: '松树洞' }, { kind: 'character', name: '松鼠' }],
          staging: [
            { kind: 'scene', name: '松树洞' },
            { kind: 'character', name: '松鼠', startX: 'center', startDepth: 'middle', facing: 'camera' }
          ]
        })
      ]
    },
    { params: PARAMS, entities }
  );
  assert.deepEqual([...shots[0].entityIds].sort(), [1, 2]);
  assert.deepEqual(shots[0].staging.map((item) => item.entityId), [1]);
});

test('解析：连贯策略决定首帧来源，不依赖模型', () => {
  const none = parseStoryboard({ shots: [shot(), shot({ firstFrameMode: 'prev_tail' })] }, { params: { ...PARAMS, continuity: 'none' }, entities: ENTITIES });
  assert.deepEqual(none.map((item) => item.firstFrameMode), ['none', 'none']);
  const cut = parseStoryboard({ shots: [shot(), shot({ firstFrameMode: 'prev_tail' })] }, { params: { ...PARAMS, continuity: 'cut' }, entities: ENTITIES });
  assert.deepEqual(cut.map((item) => item.firstFrameMode), ['none', 'none'], '组间硬切不使用尾帧');
  const chain = parseStoryboard({ shots: [shot(), shot(), shot()] }, { params: { ...PARAMS, continuity: 'prev_tail' }, entities: ENTITIES });
  assert.deepEqual(chain.map((item) => item.firstFrameMode), ['none', 'prev_tail', 'prev_tail']);
  assert.match(issuesOf({ shots: [shot({ firstFrameMode: 'prev_tail' })] }).join(), /第 1 个镜头.*prev_tail/);
});

test('解析：无声时忽略声音条目；声音类型必须在参数启用的范围内', () => {
  const silent = parseStoryboard(
    { shots: [shot({ sounds: [{ kind: 'music', text: '配乐' }] })] },
    { params: { ...PARAMS, audioMode: 'none', audioElements: [] }, entities: ENTITIES }
  );
  assert.deepEqual(silent[0].sounds, []);
  const limited = { ...PARAMS, audioElements: ['sfx' as const] };
  assert.match(issuesOf({ shots: [shot({ sounds: [{ kind: 'music', text: '配乐' }] })] }, limited).join(), /kind 必须是以下之一：sfx/);
});

test('解析：引用不存在的实体、说话人不是角色、缺字段、时长越界都会报出具体问题', () => {
  const issues = issuesOf({
    shots: [
      shot({ entities: [{ kind: 'character', name: '路人' }], durationSeconds: 0 }),
      shot({ prompt: '', sounds: [{ kind: 'dialogue', speaker: '灯塔', text: '你好' }] })
    ]
  }).join('\n');
  assert.match(issues, /第 1 个镜头引用了不存在的角色“路人”/);
  assert.match(issues, /第 1 个镜头的 durationSeconds/);
  assert.match(issues, /第 2 个镜头的 prompt 不能为空/);
  assert.match(issues, /speaker 必须是剧本中已有的角色名称/);
});

test('解析：镜头数与时长受参数限制', () => {
  const limited = { ...PARAMS, maxShots: 1, minShotSeconds: 3, maxShotSeconds: 5 };
  assert.match(issuesOf({ shots: [shot(), shot()] }, limited).join(), /超过上限 1 个/);
  assert.match(issuesOf({ shots: [shot({ durationSeconds: 8 })] }, limited).join(), /3 到 5 之间/);
  assert.match(issuesOf({ shots: [] }).join(), /至少需要 1 个镜头/);
  assert.match(issuesOf({}).join(), /shots 数组/);
});
