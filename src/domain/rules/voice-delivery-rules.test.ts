// ------------------------------------------------------------------------
// 名称：voice-delivery-rules.test.ts
// 说明：说话方式换算规则的测试：语速与音量的读取（快慢、轻重、程度词、互相矛盾）与语音指令的书写。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：纯规则测试，不依赖外部环境。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDeliveryInstruction, readDeliveryRates } from './voice-delivery-rules';

test('语速：偏慢、偏快按默认幅度，程度词加大幅度，没有提到为 0', () => {
  assert.deepEqual(readDeliveryRates('轻松的语气、适中的语速、清晰的嗓音'), { speechRate: 0, loudnessRate: 0 });
  assert.equal(readDeliveryRates('语速偏慢').speechRate, -20);
  assert.equal(readDeliveryRates('语速偏快，带着笑意').speechRate, 20);
  assert.equal(readDeliveryRates('语速很快、急切').speechRate, 40);
  assert.equal(readDeliveryRates('一字一顿，缓慢').speechRate, -40);
  assert.equal(readDeliveryRates('开心快乐的语气').speechRate, 0, '“快乐”不是语速');
});

test('音量：悄悄话、低声为轻，大喊、大声为重，程度更强的幅度更大', () => {
  assert.equal(readDeliveryRates('低声、急促').loudnessRate, -30);
  assert.equal(readDeliveryRates('压低声音的悄悄话').loudnessRate, -45);
  assert.equal(readDeliveryRates('大声说话').loudnessRate, 35);
  assert.equal(readDeliveryRates('大喊、语速很快').loudnessRate, 60);
});

test('互相矛盾的描述不调整，空描述为 0', () => {
  assert.deepEqual(readDeliveryRates('语速偏快，但又缓慢'), { speechRate: 0, loudnessRate: 0 });
  assert.equal(readDeliveryRates('小声嘟囔然后大喊').loudnessRate, 0);
  assert.deepEqual(readDeliveryRates('  '), { speechRate: 0, loudnessRate: 0 });
});

test('语音指令：把说话方式写成一句话，没有说话方式时为 null', () => {
  assert.equal(buildDeliveryInstruction(' 尴尬地干笑 '), '你可以用尴尬地干笑的方式说话吗？');
  assert.equal(buildDeliveryInstruction(''), null);
});