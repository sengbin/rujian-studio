// ------------------------------------------------------------------------
// 名称：storyboard-preview-voice.test.mjs
// 说明：分镜动画台词配音模块的测试：声音模型的读取与选择、模型变化事件触发刷新并在所选模型消失时改选、对白能否试听的判断、合成请求的载荷与批量合成，以及播放时同步配音（只在开始时间播放一次、暂停与跳转停止、没有合成或台词已改的不播放）。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：配音模块只依赖 window 对象，这里用普通对象代替宿主通信桥与计时器；音频元素用记录调用的替身；页面里的呈现在 storyboard-preview-page.test.mjs 中检查。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScript } from './storyboard-preview-fixtures.mjs';

const MODELS = [
  { id: 5, label: '甲 · 语音', supportsReference: true },
  { id: 6, label: '乙 · 语音', supportsReference: false }
];

/** 加载配音模块；宿主按 handlers 应答，事件处理函数登记到 events；windowExtras 补充浏览器能力（如音频解码）。 */
function setup(handlers = {}, windowExtras = {}) {
  const events = new Map();
  const requests = [];
  const win = {
    ...windowExtras,
    hostBridge: {
      request: async (name, payload) => {
        requests.push({ name, payload });
        const handler = handlers[name];
        if (handler === undefined) throw new Error(`未预期的请求：${name}`);
        return handler(payload);
      },
      onEvent: (name, handler) => events.set(name, handler)
    },
    addEventListener: () => undefined,
    setTimeout: (callback) => {
      callback();
      return 0;
    },
    clearTimeout: () => undefined
  };
  const voice = loadScript('stage/stage-storyboard-preview-voice.js', win).aiStoryboardVoice;
  return { voice, requests, events };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 记录创建、播放与暂停的假音频元素。 */
function fakeAudio(log) {
  return () => {
    log.push(['create']);
    const audio = {
      src: '',
      playbackRate: 1,
      play: () => {
        log.push(['play', audio.src, audio.playbackRate]);
        return Promise.resolve();
      },
      pause: () => log.push(['pause', audio.src])
    };
    return audio;
  };
}

const sound = (overrides = {}) => ({ id: 1, kind: 'dialogue', speakerEntityId: 11, text: '你好', delivery: '', start: 1, end: 3, ...overrides });
const frame = (shot, time, overrides = {}) => ({ timeline: { shots: [shot] }, shotIndex: 0, time, playing: true, rate: 1, ...overrides });

test('模型读取与选择：第一次订阅时读取，默认选第一个；选择不存在的模型被忽略', async () => {
  const { voice, requests } = setup({ 'voicePreview.options': () => ({ models: MODELS, unavailableHint: null }) });
  const seen = [];
  voice.subscribe((state) => seen.push([state.loading, state.selectedId]));
  await flush();

  assert.deepEqual(requests.map((request) => request.name), ['voicePreview.options']);
  assert.equal(voice.getState().selectedId, 5);
  assert.equal(voice.getState().selected.label, '甲 · 语音');
  assert.deepEqual(seen.at(-1), [false, 5]);
  voice.select(6);
  assert.equal(voice.getState().selectedId, 6);
  voice.select(99);
  assert.equal(voice.getState().selectedId, 6);
  voice.subscribe(() => undefined);
  await flush();
  assert.equal(requests.length, 1, '已读取后再订阅不重复读取');
});

test('模型变化事件：重新读取；所选模型被关闭时改选第一个，全部关闭后没有所选并带提示', async () => {
  let models = MODELS;
  const { voice, events } = setup({ 'voicePreview.options': () => ({ models, unavailableHint: models.length === 0 ? '请去配置' : null }) });
  voice.subscribe(() => undefined);
  await flush();
  voice.select(6);

  models = [MODELS[0]];
  events.get('models.changed')();
  await flush();
  assert.equal(voice.getState().selectedId, 5);

  models = [];
  events.get('models.changed')();
  await flush();
  assert.equal(voice.getState().selectedId, null);
  assert.equal(voice.getState().selected, null);
  assert.equal(voice.getState().hint, '请去配置');
});

test('模型读取失败：没有所选模型并带失败原因', async () => {
  const { voice } = setup({
    'voicePreview.options': () => {
      throw { message: '读取失败了。' };
    }
  });
  voice.subscribe(() => undefined);
  await flush();
  assert.equal(voice.getState().selected, null);
  assert.equal(voice.getState().error, '读取失败了。');
  assert.equal(voice.getState().loaded, true);
});

test('对白与旁白能否试听：必须有台词且说话人已有音色（角色的绑定或临时音色，旁白的作品音色或临时音色）', () => {
  const { voice } = setup();
  const bound = (entityId) => entityId === 11;
  assert.equal(voice.canPreview(sound(), bound), true);
  assert.equal(voice.canPreview(sound({ speakerEntityId: 12 }), bound), false, '没有音色');
  assert.equal(voice.canPreview(sound({ speakerEntityId: null }), bound), false, '对白没有说话人');
  assert.equal(voice.canPreview(sound({ text: '  ' }), bound), false, '没有台词');
  assert.equal(voice.canPreview(sound({ kind: 'sfx' }), bound), false);
  assert.equal(voice.canPreview(sound({ kind: 'narration', speakerEntityId: null }), bound), false, '旁白还没有音色');
  assert.equal(voice.canPreview(sound({ kind: 'narration', speakerEntityId: null }), (entityId) => entityId === null), true, '旁白用 null 询问');
  assert.equal(voice.canPreview(sound({ kind: 'narration', speakerEntityId: null, text: '' }), () => true), false);
});

test('生成音色的请求：原样转交给宿主；生成或采用后已合成的配音作废，读取状态与对话框信息不影响它', async () => {
  const { voice, requests } = setup({
    'voicePreview.options': () => ({ models: MODELS, unavailableHint: null }),
    'voicePreview.synthesize': () => ({ mime: 'audio/mpeg', data: 'SUQz', cached: false, note: null }),
    'voicePreview.speakers': () => ({ narrator: 'draft', narratorAssetName: null, draftEntityIds: [12] }),
    'voicePreview.draftInfo': () => ({ speakerName: '守夜人', description: '沙哑' }),
    'voicePreview.draft': () => ({ mime: 'audio/wav', data: 'UklG', cached: false, note: null, presetVoice: null }),
    'voicePreview.adopt': () => ({ assetId: 9, assetName: '音色', otherEpisodesBound: 0 })
  });
  voice.subscribe(() => undefined);
  await flush();
  const line = sound({ id: 1 });
  await voice.load({ workId: 1, episodeId: 7 }, line);
  assert.equal(voice.countReady([line]), 1);

  assert.deepEqual(await voice.loadSpeakers(1), { narrator: 'draft', narratorAssetName: null, draftEntityIds: [12] });
  assert.deepEqual(requests.at(-1), { name: 'voicePreview.speakers', payload: { workId: 1 } });
  await voice.getDraftInfo({ workId: 1, episodeId: 7, entityId: null });
  assert.deepEqual(requests.at(-1), { name: 'voicePreview.draftInfo', payload: { workId: 1, episodeId: 7, entityId: null } });
  assert.equal(voice.countReady([line]), 1, '只读取不影响已合成的结果');

  const draftPayload = { workId: 1, episodeId: 7, entityId: 12, modelId: 5, sampleText: '你好', regenerate: false };
  assert.equal((await voice.createDraft(draftPayload)).data, 'UklG');
  assert.deepEqual(requests.at(-1), { name: 'voicePreview.draft', payload: draftPayload });
  assert.equal(voice.countReady([line]), 0, '生成新的试听音色后旧的配音作废');

  await voice.load({ workId: 1, episodeId: 7 }, line);
  assert.equal((await voice.adopt({ workId: 1, episodeId: 7, entityId: 12, name: '音色' })).assetId, 9);
  assert.equal(voice.countReady([line]), 0, '采用后也作废');
});

test('生成或采用失败时原样抛出宿主错误，已合成的配音保留', async () => {
  const { voice } = setup({
    'voicePreview.options': () => ({ models: MODELS, unavailableHint: null }),
    'voicePreview.synthesize': () => ({ mime: 'audio/mpeg', data: 'SUQz', cached: false, note: null }),
    'voicePreview.draft': () => {
      throw { message: '余额不足。' };
    },
    'voicePreview.adopt': () => {
      throw { message: '已有同名资产。', fieldErrors: { name: '已有同名资产。' } };
    }
  });
  voice.subscribe(() => undefined);
  await flush();
  const line = sound({ id: 1 });
  await voice.load({ workId: 1, episodeId: 7 }, line);
  await assert.rejects(() => voice.createDraft({ workId: 1 }), (error) => error.message === '余额不足。');
  await assert.rejects(() => voice.adopt({ workId: 1 }), (error) => error.fieldErrors.name === '已有同名资产。');
  assert.equal(voice.countReady([line]), 1);
});

test('合成：带作品、集、版本、声音与所选模型请求；没有可用模型时直接失败；批量合成汇报进度并汇总失败', async () => {
  let fail = false;
  const { voice, requests } = setup({
    'voicePreview.options': () => ({ models: MODELS, unavailableHint: null }),
    'voicePreview.synthesize': (payload) => {
      if (fail && payload.soundId === 2) throw { message: '余额不足。' };
      return { mime: 'audio/mpeg', data: 'SUQz', cached: false, note: null };
    }
  });
  await assert.rejects(() => voice.load({ workId: 1, episodeId: 7 }, sound()), /还没有可用的声音模型/);

  voice.subscribe(() => undefined);
  await flush();
  await voice.load({ workId: 1, episodeId: 7, runId: 3 }, sound({ id: 9 }));
  assert.deepEqual(requests.at(-1), { name: 'voicePreview.synthesize', payload: { workId: 1, episodeId: 7, runId: 3, soundId: 9, modelId: 5 } });
  await voice.load({ workId: 1, episodeId: 7 }, sound({ id: 10 }));
  assert.equal('runId' in requests.at(-1).payload, false, '没有版本时不带 runId');

  fail = true;
  const progress = [];
  const result = await voice.loadAll({ workId: 1, episodeId: 7 }, [sound({ id: 1 }), sound({ id: 2 }), sound({ id: 3 })], (done, total) => progress.push([done, total]));
  assert.deepEqual(result, { done: 2, failed: 1, error: '余额不足。' });
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
  assert.equal(voice.countReady([sound({ id: 1 }), sound({ id: 2 }), sound({ id: 3 })]), 2, '失败的那条没有结果');
  assert.equal(voice.countReady([sound({ id: 1, text: '改过的台词' })]), 0, '台词变化后不算已合成');
});

test('同步播放：到开头时间就播放已合成的配音，每条只播一次，用当前倍速', async () => {
  const { voice } = setup({ 'voicePreview.options': () => ({ models: MODELS, unavailableHint: null }), 'voicePreview.synthesize': () => ({ mime: 'audio/mpeg', data: 'SUQz', cached: false, note: null }) });
  voice.subscribe(() => undefined);
  await flush();
  const line = sound({ id: 1, start: 1, end: 3 });
  await voice.load({ workId: 1, episodeId: 7 }, line);
  const shot = { start: 4, sounds: [line, sound({ id: 2, kind: 'sfx', start: 0 })] };
  const log = [];
  const sync = voice.createSync(fakeAudio(log));
  sync.setEnabled(true);

  sync.update(frame(shot, 4.5));
  assert.deepEqual(log, [], '还没到对白的开始时间（镜头内 0.5 秒）');
  sync.update(frame(shot, 5.05, { rate: 1.5 }));
  assert.deepEqual(log, [['create'], ['play', 'data:audio/mpeg;base64,SUQz', 1.5]]);
  sync.update(frame(shot, 5.1));
  sync.update(frame(shot, 5.2));
  assert.equal(log.filter((entry) => entry[0] === 'create').length, 1, '同一条只播一次');
});

test('同步播放：暂停时配音一并暂停、继续时接着播；回退、跳转、关闭会停止并清空记录后重新播放；拖到对白中间从该位置接着播，已说完的不播', async () => {
  const { voice } = setup({ 'voicePreview.options': () => ({ models: MODELS, unavailableHint: null }), 'voicePreview.synthesize': () => ({ mime: 'audio/mpeg', data: 'SUQz', cached: false, note: null }) });
  voice.subscribe(() => undefined);
  await flush();
  const line = sound({ id: 1, start: 1, end: 3 });
  await voice.load({ workId: 1, episodeId: 7 }, line);
  const shot = { start: 0, sounds: [line] };
  const plays = (log) => log.filter((entry) => entry[0] === 'create').length;
  const log = [];
  const sync = voice.createSync(fakeAudio(log));

  sync.update(frame(shot, 1.05));
  assert.equal(plays(log), 0, '没开启时不播放');
  sync.setEnabled(true);
  sync.update(frame(shot, 1.05));
  assert.equal(plays(log), 1);

  sync.update(frame(shot, 1.1, { playing: false }));
  assert.equal(log.filter((entry) => entry[0] === 'pause').length, 1, '动画暂停时配音也暂停');
  sync.update(frame(shot, 1.1));
  assert.equal(plays(log), 1, '继续播放接着原来的配音，不重新创建');
  assert.equal(log.filter((entry) => entry[0] === 'play').length, 2, '继续时再次调用播放');
  sync.update(frame(shot, 1.2));
  assert.equal(log.filter((entry) => entry[0] === 'play').length, 2, '连续播放时不重复调用');

  sync.update(frame(shot, 0.2));
  sync.update(frame(shot, 1.05));
  assert.equal(plays(log), 2, '回退后再次经过开头时重新播放');

  sync.update(frame(shot, 3));
  assert.equal(plays(log), 2, '拖到对白说完之后不播');
  sync.update(frame(shot, 1.6));
  assert.equal(plays(log), 3, '回到对白中间，从该位置接着播');

  sync.setEnabled(false);
  sync.update(frame(shot, 0));
  sync.setEnabled(true);
  sync.update(frame(shot, 0.9));
  sync.update(frame(shot, 1.05));
  assert.equal(plays(log), 4);
});

test('同步播放：台词改过、没有合成结果或没有所选模型时不播放', async () => {
  const { voice, events } = setup({ 'voicePreview.options': () => ({ models: [], unavailableHint: '请去配置' }) });
  voice.subscribe(() => undefined);
  await flush();
  const log = [];
  const sync = voice.createSync(fakeAudio(log));
  sync.setEnabled(true);
  sync.update(frame({ start: 0, sounds: [sound({ start: 0 })] }, 0.05));
  assert.deepEqual(log, [], '没有声音模型');
  assert.equal(typeof events.get('models.changed'), 'function');
});

test('同步播放：旁白与对白一样到开始时间播放已合成的配音，音效不播放', async () => {
  const { voice } = setup({ 'voicePreview.options': () => ({ models: MODELS, unavailableHint: null }), 'voicePreview.synthesize': () => ({ mime: 'audio/mpeg', data: 'SUQz', cached: false, note: null }) });
  voice.subscribe(() => undefined);
  await flush();
  const narration = sound({ id: 3, kind: 'narration', speakerEntityId: null, start: 1, end: 3 });
  await voice.load({ workId: 1, episodeId: 7 }, narration);
  const log = [];
  const sync = voice.createSync(fakeAudio(log));
  sync.setEnabled(true);
  const shot = { start: 0, sounds: [narration, sound({ id: 4, kind: 'sfx', start: 1 })] };
  sync.update(frame(shot, 1.05));
  assert.equal(log.filter((entry) => entry[0] === 'create').length, 1);
});

/** 记录每个音频元素的假工厂：可手动触发播放结束。 */
function trackedAudio(elements) {
  return () => {
    const audio = {
      src: '',
      playbackRate: 1,
      paused: false,
      play: () => Promise.resolve(),
      pause: () => {
        audio.paused = true;
      }
    };
    elements.push(audio);
    return audio;
  };
}

const SYNTH_HANDLERS = { 'voicePreview.options': () => ({ models: MODELS, unavailableHint: null }), 'voicePreview.synthesize': () => ({ mime: 'audio/mpeg', data: 'SUQz', cached: false, note: null }) };

test('读取已保存的配音：请求带作品、集、版本与所选模型；返回的对白登记为已合成，没返回的不算；失败时返回 0 不抛错', async () => {
  let clips = [{ soundId: 1, mime: 'audio/mpeg', data: 'SUQz' }, { soundId: 99, mime: 'audio/mpeg', data: 'SUQz' }];
  let fail = false;
  const { voice, requests } = setup({
    'voicePreview.options': () => ({ models: MODELS, unavailableHint: null }),
    'voicePreview.restore': () => {
      if (fail) throw { message: '模型不可用。' };
      return { clips };
    }
  });
  const context = { workId: 1, episodeId: 7, runId: 3 };
  assert.equal(await voice.restore(context, [sound({ id: 1 })]), 0, '没有可用模型时不请求');
  voice.subscribe(() => undefined);
  await flush();
  const first = sound({ id: 1 });
  const second = sound({ id: 2 });

  assert.equal(await voice.restore(context, [first, second]), 1, '只登记请求里有的对白');
  assert.deepEqual(requests.at(-1), { name: 'voicePreview.restore', payload: { workId: 1, episodeId: 7, runId: 3, modelId: 5 } });
  assert.equal(voice.countReady([first, second]), 1);
  assert.equal(voice.countReady([sound({ id: 1, text: '改过的台词' })]), 0, '台词变了不算已合成');
  assert.equal(voice.readyClip(5, first).data, 'SUQz');

  fail = true;
  assert.equal(await voice.restore(context, [second]), 0);
  assert.equal(await voice.restore({ workId: 1, episodeId: 7 }, []), 0, '没有对白不请求');
  clips = [];
  fail = false;
  assert.equal(await voice.restore({ workId: 1, episodeId: 7 }, [second]), 0);
  assert.equal('runId' in requests.at(-1).payload, false, '没有版本时不带 runId');
});

test('重新合成：load 与 loadAll 的 regenerate 为 true 时请求带 regenerate，缺省时不带', async () => {
  const { voice, requests } = setup(SYNTH_HANDLERS);
  voice.subscribe(() => undefined);
  await flush();
  const context = { workId: 1, episodeId: 7 };
  await voice.load(context, sound({ id: 1 }));
  assert.equal('regenerate' in requests.at(-1).payload, false);
  await voice.load(context, sound({ id: 1 }), true);
  assert.equal(requests.at(-1).payload.regenerate, true);

  await voice.loadAll(context, [sound({ id: 2 }), sound({ id: 3 })], undefined, true);
  assert.deepEqual(requests.filter((item) => item.name === 'voicePreview.synthesize').slice(-2).map((item) => item.payload.regenerate), [true, true]);
});

test('同步播放：点击时解锁一组音频元素，之后的配音循环使用它们，不再新建；没开启时不解锁', async () => {
  const { voice } = setup(SYNTH_HANDLERS);
  voice.subscribe(() => undefined);
  await flush();
  const first = sound({ id: 1, start: 0, end: 2 });
  const second = sound({ id: 2, start: 0, end: 2 });
  for (const line of [first, second]) await voice.load({ workId: 1, episodeId: 7 }, line);
  const timeline = { shots: [{ start: 0, duration: 3, sounds: [first] }, { start: 3, duration: 3, sounds: [second] }] };
  const at = (shotIndex, time) => ({ timeline, shotIndex, time, playing: true, rate: 1 });
  const elements = [];
  const sync = voice.createSync(trackedAudio(elements));

  sync.unlock();
  assert.equal(elements.length, 0, '没开启配音时不解锁');
  sync.setEnabled(true);
  sync.unlock();
  assert.equal(elements.length, 4);
  sync.unlock();
  assert.equal(elements.length, 4, '只解锁一次');

  sync.update(at(0, 0.05));
  assert.equal(elements.length, 4, '播放用的是已解锁的元素');
  const used = elements.filter((element) => element.src.startsWith('data:audio/mpeg'));
  assert.equal(used.length, 1);
  used[0].onended();
  for (let time = 0.5; time < 3.05; time += 0.5) sync.update(at(0, time));
  sync.update(at(1, 3.05));
  assert.equal(elements.length, 4, '播完的元素回到空闲组，下一条继续用它，不新建');
  assert.equal(elements.filter((element) => element.src.startsWith('data:audio/mpeg')).length, 1, '第二条用的还是同一个元素');
});

test('同步播放：浏览器拒绝播放时报告原因并放弃这条；自己停掉造成的中断不报告', async () => {
  const { voice } = setup(SYNTH_HANDLERS);
  voice.subscribe(() => undefined);
  await flush();
  const line = sound({ id: 1, start: 0, end: 2 });
  await voice.load({ workId: 1, episodeId: 7 }, line);
  const reasons = [];
  let reason = { name: 'NotAllowedError', message: '需要用户操作' };
  const create = () => ({ src: '', playbackRate: 1, play: () => Promise.reject(reason), pause: () => undefined });
  const sync = voice.createSync(create, (error) => reasons.push(error.name));
  sync.setEnabled(true);
  const shot = { start: 0, duration: 3, sounds: [line] };
  sync.update(frame(shot, 0.05));
  await flush();
  assert.deepEqual(reasons, ['NotAllowedError']);

  reason = { name: 'AbortError', message: '被停止' };
  sync.update(frame(shot, 0.1, { playing: false }));
  sync.update(frame(shot, 0));
  sync.update(frame(shot, 0.05));
  await flush();
  assert.deepEqual(reasons, ['NotAllowedError'], 'AbortError 不报告');
});

test('同步播放：多条配音按各自开始时间同时出声，互不截断，跨镜头也一样', async () => {
  const { voice } = setup(SYNTH_HANDLERS);
  voice.subscribe(() => undefined);
  await flush();
  const first = sound({ id: 1, start: 0, end: 2 });
  const second = sound({ id: 2, speakerEntityId: 12, start: 1, end: 3 });
  const third = sound({ id: 3, kind: 'narration', speakerEntityId: null, start: 0, end: 2 });
  for (const line of [first, second, third]) await voice.load({ workId: 1, episodeId: 7 }, line);
  const timeline = { shots: [{ start: 0, duration: 3, sounds: [first, second] }, { start: 3, duration: 3, sounds: [third] }] };
  const at = (shotIndex, time) => ({ timeline, shotIndex, time, playing: true, rate: 1 });
  const elements = [];
  const sync = voice.createSync(trackedAudio(elements));
  sync.setEnabled(true);

  sync.update(at(0, 0.05));
  sync.update(at(0, 0.55));
  sync.update(at(0, 1.05));
  assert.equal(elements.length, 2, '第二条到了开始时间就出声，不等第一条说完');
  assert.deepEqual(elements.map((element) => element.paused), [false, false], '谁也没有被截断');

  for (let time = 1.5; time < 3.05; time += 0.5) sync.update(at(0, time));
  sync.update(at(1, 3.05));
  assert.equal(elements.length, 3, '下一个镜头的配音照常播放');
  assert.deepEqual(elements.map((element) => element.paused), [false, false, false]);
});

test('同步播放：播放中勾选“播放时配音”，正在说的配音从当前位置接着播；取消勾选立即停止', async () => {
  const { voice } = setup(SYNTH_HANDLERS);
  voice.subscribe(() => undefined);
  await flush();
  const line = sound({ id: 1, start: 1, end: 3 });
  await voice.load({ workId: 1, episodeId: 7 }, line);
  const shot = { start: 0, duration: 6, sounds: [line] };
  const elements = [];
  const sync = voice.createSync(trackedAudio(elements));

  sync.update(frame(shot, 1.5));
  sync.update(frame(shot, 1.6));
  assert.equal(elements.length, 0, '没开启时不播放');
  sync.setEnabled(true);
  sync.update(frame(shot, 1.7));
  assert.equal(elements.length, 1, '对白已经开始 0.7 秒，仍然补播');
  assert.ok(Math.abs(elements[0].currentTime - 0.7) < 1e-6, '从对白进行到的位置接着播');

  sync.setEnabled(false);
  assert.equal(elements[0].paused, true, '取消勾选立即停止');
  sync.update(frame(shot, 1.8));
  assert.equal(elements.length, 1);
});

test('同步播放：对白已经说完时，播放中勾选也不补播', async () => {
  const decoder = class {
    decodeAudioData() {
      const samples = new Float32Array(200).fill(0.5);
      return Promise.resolve({ sampleRate: 100, length: 200, duration: 2, numberOfChannels: 1, getChannelData: () => samples });
    }
  };
  const { voice } = setup(SYNTH_HANDLERS, { OfflineAudioContext: decoder });
  voice.subscribe(() => undefined);
  await flush();
  const line = sound({ id: 1, start: 0, end: 2, estimated: false });
  await voice.load({ workId: 1, episodeId: 7 }, line);
  const elements = [];
  const sync = voice.createSync(trackedAudio(elements));
  const shot = { start: 0, duration: 6, sounds: [line] };
  sync.update(frame(shot, 4));
  sync.setEnabled(true);
  sync.update(frame(shot, 4.1));
  assert.equal(elements.length, 0);
});

test('同步播放：跳过配音开头的静音，比留给它的时间长时加快播放（最多 1.4 倍），说完不截断', async () => {
  // 假解码：6 秒音频，前 3 秒静音，3 到 5 秒有声音，之后静音。
  const samples = new Float32Array(600).map((_, index) => (index >= 300 && index < 500 ? 0.5 : 0));
  const decoder = class {
    decodeAudioData() {
      return Promise.resolve({ sampleRate: 100, length: 600, duration: 6, numberOfChannels: 1, getChannelData: () => samples });
    }
  };
  const { voice } = setup(SYNTH_HANDLERS, { OfflineAudioContext: decoder });
  voice.subscribe(() => undefined);
  await flush();
  const line = sound({ id: 1, start: 1, end: 2, estimated: false });
  await voice.load({ workId: 1, episodeId: 7 }, line);
  const clip = voice.readyClip(5, line);
  assert.equal(clip.lead, 0, '静音已经裁在音频里，播放不需要再定位');
  assert.equal(clip.mime, 'audio/wav');
  assert.ok(Math.abs(clip.length - 2.2) < 1e-6, '有效时长含开头 0.05 秒与结尾 0.15 秒余量');
  const wav = Buffer.from(clip.data, 'base64');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(40), 220 * 2, '裁剪后只剩 2.2 秒的样本（采样率 100、16 位）');

  const elements = [];
  const sync = voice.createSync(trackedAudio(elements));
  sync.setEnabled(true);
  sync.update(frame({ start: 0, duration: 5, sounds: [line] }, 1.05));
  assert.equal(elements.length, 1);
  assert.ok(Math.abs(elements[0].currentTime - 0.07) < 1e-6, '从裁剪后音频的开头播，已经开始的 0.05 秒按 1.4 倍换算');
  assert.equal(elements[0].playbackRate, 1.4, '留给它 0.95 秒、实际 2.2 秒，按最大倍数加快');

  elements[0].currentTime = 2.3;
  sync.update(frame({ start: 0, duration: 5, sounds: [line] }, 1.5));
  assert.equal(elements[0].paused, true, '播完有效部分就释放，不等结尾的静音');
});