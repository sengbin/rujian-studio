// ------------------------------------------------------------------------
// 名称：shot-cut-rules.test.ts
// 说明：组间硬切规则的自动化测试：景别与机位变化的识别、有效剪辑切换的判断、组与组之间衔接的提醒。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：纯函数测试，不依赖数据库。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CutCheckShot, checkGroupCuts, classifyCut, isEffectiveCut, shotSizeLevel } from './shot-cut-rules';

function shot(id: number, overrides: Partial<CutCheckShot> = {}): CutCheckShot {
  return { id, sceneLabel: 'a', shotSize: '中景', cameraAngle: '平视', firstFrameMode: 'none', entityIds: [], ...overrides };
}

test('景别等级：较具体的词优先，识别不了为 null', () => {
  assert.equal(shotSizeLevel('大远景'), 1);
  assert.equal(shotSizeLevel('远景'), 2);
  assert.equal(shotSizeLevel('双人中景'), 4);
  assert.equal(shotSizeLevel('中近景'), 5);
  assert.equal(shotSizeLevel('近景'), 6);
  assert.equal(shotSizeLevel('大特写'), 8);
  assert.equal(shotSizeLevel('特写'), 7);
  assert.equal(shotSizeLevel('航拍视角'), null);
});

test('有效切换：场次变化，或景别、机位至少有一项变化；两项都没变不算', () => {
  assert.equal(isEffectiveCut(shot(1), shot(2, { sceneLabel: 'b' })), true);
  assert.equal(isEffectiveCut(shot(1), shot(2, { shotSize: '特写' })), true);
  assert.equal(isEffectiveCut(shot(1), shot(2, { cameraAngle: '低角度仰拍' })), true);
  assert.equal(isEffectiveCut(shot(1), shot(2)), false);
  // 同一类别的不同写法不算变化。
  assert.equal(isEffectiveCut(shot(1, { cameraAngle: '平视' }), shot(2, { cameraAngle: '平视，24mm 广角' })), false);
  assert.equal(isEffectiveCut(shot(1, { shotSize: '中景' }), shot(2, { shotSize: '双人中景' })), false);
  // 识别不了时按文字比较；任一方没填写则无法判断，既不算有效切换也不当作问题。
  assert.equal(isEffectiveCut(shot(1, { cameraAngle: '荷兰角' }), shot(2, { cameraAngle: '荷兰角' })), false);
  assert.equal(isEffectiveCut(shot(1, { cameraAngle: '荷兰角' }), shot(2, { cameraAngle: '手持晃动' })), true);
  assert.equal(classifyCut(shot(1, { shotSize: '' }), shot(2)), 'unknown');
  assert.equal(classifyCut(shot(1), shot(2)), 'unchanged');
  assert.equal(classifyCut(shot(1, { shotSize: '', cameraAngle: '' }), shot(2, { shotSize: '', cameraAngle: '' })), 'unknown');
});

test('组间检查：硬切处景别和机位都没变时提醒；第一组不检查；有变化不提醒', () => {
  const shots = [shot(1), shot(2), shot(3), shot(4, { shotSize: '特写' })];
  const notices = checkGroupCuts(shots, [[1, 2], [3], [4]], new Set());
  assert.deepEqual(notices.map((notice) => [notice.shotId, notice.code]), [[3, 'cut_unchanged']]);
  assert.match(notices[0].text, /第 2 组.*跳切/);
});

test('组间检查：组首接上一镜头尾帧且本组有绑定了参考图或音色的实体时提醒，没有绑定时不提醒', () => {
  const shots = [shot(1), shot(2, { firstFrameMode: 'prev_tail', entityIds: [7] }), shot(3), shot(4, { firstFrameMode: 'prev_tail', entityIds: [8] })];
  const notices = checkGroupCuts(shots, [[1], [2, 3], [4]], new Set([7]));
  assert.deepEqual(notices.map((notice) => [notice.shotId, notice.code]), [[2, 'tail_drops_references']]);
});

test('组间检查：组首指定了图片作首帧时不检查', () => {
  const shots = [shot(1), shot(2, { firstFrameMode: 'image' })];
  assert.deepEqual(checkGroupCuts(shots, [[1], [2]], new Set()), []);
});
