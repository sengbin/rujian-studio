// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-voice.js
// 说明：分镜动画的台词配音：读取可选的声音模型（随模型设置里的启用与密钥变化实时刷新）、请求宿主合成一条对白或旁白的语音、缓存已合成的结果，并提供播放时按时间同步播放配音的同步器；还封装“按描述生成音色”的请求：读取说话人的临时音色状态、生成试听音色、采用音色。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：通过 window.aiStoryboardVoice 暴露；请求名称与 src/app/pages/voice-preview-handlers.ts 一致，模型变化事件与 src/app/pages/model-events.ts 一致；声音模型的状态是页面级共享的（所有打开的预览层共用同一份，所选模型也共用）；合成会调用模型并产生费用，只在用户点“试听”或“合成本镜头配音”时才请求，播放时只播放已合成的结果；生成试听音色或采用音色后，说话人的音色变了，已合成的结果全部作废（宿主缓存按音色内容命中，没变的不会再调用模型）；依赖 host-bridge.js。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_OPTIONS = 'voicePreview.options';
  const REQUEST_SYNTHESIZE = 'voicePreview.synthesize';
  const REQUEST_RESTORE = 'voicePreview.restore';
  const REQUEST_SPEAKERS = 'voicePreview.speakers';
  const REQUEST_DRAFT_INFO = 'voicePreview.draftInfo';
  const REQUEST_DRAFT = 'voicePreview.draft';
  const REQUEST_ADOPT = 'voicePreview.adopt';
  const EVENT_MODELS_CHANGED = 'models.changed';
  /** 合并连续的模型变化事件后再刷新。 */
  const REFRESH_DELAY_MS = 200;
  const GENERIC_OPTIONS_ERROR = '声音模型读取失败。';
  /** 相邻两次更新的时间差超过这个值（秒）视为跳转，已播放记录清空。 */
  const JUMP_SECONDS = 0.6;
  const EPSILON = 1e-6;
  /** 测量静音：按这个窗口长度（秒）算均方根；低于“绝对下限”与“本段最响窗口的一定比例”两者中较大者的窗口视为静音（有底噪的音频也能找到开口处）。 */
  const SILENCE_WINDOW_SECONDS = 0.02;
  const SILENCE_RMS = 0.015;
  const SILENCE_RELATIVE = 0.12;
  /** 裁掉前导静音后保留的开头、结尾余量（秒）；前导静音短于 LEAD_MIN_SECONDS 时不裁。 */
  const LEAD_KEEP_SECONDS = 0.05;
  const TAIL_KEEP_SECONDS = 0.15;
  const LEAD_MIN_SECONDS = 0.15;
  /** 配音比留给它的时间长时，最多加快到这个倍数（再快就听不清）；超过的部分顺延播完，不截断。 */
  const MAX_FIT_RATE = 1.4;
  /** 配音只比留给它的时间长这么多（秒）以内不加速。 */
  const FIT_TOLERANCE_SECONDS = 0.2;
  /** 点击时预先解锁的音频元素个数（同时出声的配音条数上限，超过的临时创建）。 */
  const UNLOCK_POOL_SIZE = 4;

  /** 共享状态：声音模型选项、提示与当前所选。 */
  const state = { loaded: false, loading: false, models: [], hint: '', error: '', selectedId: null };
  const listeners = new Set();
  /** 已合成的结果：“模型:声音标识” → { mime, data, text, delivery }，播放时同步配音只读取这里。 */
  const ready = new Map();
  /** 已合成结果的代数：每次作废加 1；在途请求返回时代数已变，说明音色变了，结果不再适用，不能再写回。 */
  let readyEpoch = 0;
  let refreshTimer = 0;
  let requestToken = 0;

  /** 状态快照，附带当前所选模型。 */
  function getState() {
    return {
      loaded: state.loaded,
      loading: state.loading,
      models: state.models,
      hint: state.hint,
      error: state.error,
      selectedId: state.selectedId,
      selected: state.models.find((model) => model.id === state.selectedId) || null
    };
  }

  function emit() {
    for (const listener of [...listeners]) listener(getState());
  }

  /** 重新读取可选的声音模型；所选模型已不可用时改选第一个。 */
  async function refresh() {
    const token = ++requestToken;
    state.loading = true;
    emit();
    try {
      const options = await window.hostBridge.request(REQUEST_OPTIONS);
      if (token !== requestToken) return;
      state.models = options.models || [];
      state.hint = options.unavailableHint || '';
      state.error = '';
    } catch (error) {
      if (token !== requestToken) return;
      state.models = [];
      state.hint = '';
      state.error = (error && error.message) || GENERIC_OPTIONS_ERROR;
    }
    if (!state.models.some((model) => model.id === state.selectedId)) {
      state.selectedId = state.models.length > 0 ? state.models[0].id : null;
    }
    state.loaded = true;
    state.loading = false;
    emit();
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => void refresh(), REFRESH_DELAY_MS);
  }

  /**
   * 订阅状态变化；第一次订阅时读取声音模型。
   * @param {(state: object) => void} listener 状态变化时调用。
   * @returns {() => void} 取消订阅的函数。
   */
  function subscribe(listener) {
    listeners.add(listener);
    if (!state.loaded && !state.loading) void refresh();
    return () => listeners.delete(listener);
  }

  /** 选择声音模型；不在可选列表里的忽略。 */
  function select(modelId) {
    if (!state.models.some((model) => model.id === modelId) || state.selectedId === modelId) return;
    state.selectedId = modelId;
    emit();
  }

  /** 已合成结果的键。 */
  function clipKey(modelId, soundId) {
    return `${modelId}:${soundId}`;
  }

  /**
   * 对白或旁白能否试听：有台词，且说话人已有音色（绑定的音色参考、旁白的作品音色，或临时音色）。
   * @param {object} sound 时间线里的声音条目。
   * @param {(entityId: number|null) => boolean} hasVoice 说话人是否已有音色；旁白传入 null。
   */
  function canPreview(sound, hasVoice) {
    if (String(sound.text || '').trim() === '') return false;
    if (sound.kind === 'narration') return hasVoice(null);
    return sound.kind === 'dialogue' && sound.speakerEntityId !== null && hasVoice(sound.speakerEntityId);
  }

  /**
   * 请求宿主合成一条对白（宿主按内容缓存，内容没有变化时不会再调用模型）。
   * @param {{ workId: number, episodeId: number, runId?: number }} context 作品、集与分镜版本。
   * @param {object} sound 时间线里的声音条目。
   * @param {boolean} [regenerate] 为 true 时绕过宿主缓存重新调用模型（会产生费用），结果替换旧的。
   * @returns {Promise<{ mime: string, data: string, cached: boolean, note: string|null }>} 合成结果；失败时以宿主错误拒绝。
   */
  async function load(context, sound, regenerate) {
    const modelId = state.selectedId;
    if (modelId === null) throw new Error('还没有可用的声音模型。');
    const epoch = readyEpoch;
    const result = await window.hostBridge.request(REQUEST_SYNTHESIZE, {
      workId: context.workId,
      episodeId: context.episodeId,
      ...(context.runId === undefined ? {} : { runId: context.runId }),
      soundId: sound.id,
      modelId,
      ...(regenerate === true ? { regenerate: true } : {})
    });
    const prepared = await prepareClip(result);
    if (epoch === readyEpoch) store(modelId, sound, prepared);
    return result;
  }

  /** 把准备好的播放音频登记为这条声音的已合成结果。 */
  function store(modelId, sound, prepared) {
    ready.set(clipKey(modelId, sound.id), {
      mime: prepared.mime,
      data: prepared.data,
      text: sound.text,
      delivery: sound.delivery || '',
      lead: 0,
      length: prepared.length
    });
  }

  /**
   * 读取本集里已经合成并保存在本地的配音（只查宿主的缓存，不调用模型、不产生费用），登记为可同步播放的结果。
   * 台词、说话方式、音色或模型改过的对白宿主找不到缓存，不会返回，需要重新合成。
   * @param {{ workId: number, episodeId: number, runId?: number }} context 作品、集与分镜版本。
   * @param {object[]} sounds 要读取的对白（时间线里的声音条目）。
   * @returns {Promise<number>} 读到并登记的条数；模型不可用等导致读取失败时为 0。
   */
  async function restore(context, sounds) {
    const modelId = state.selectedId;
    if (modelId === null || sounds.length === 0) return 0;
    const epoch = readyEpoch;
    let result;
    try {
      result = await window.hostBridge.request(REQUEST_RESTORE, {
        workId: context.workId,
        episodeId: context.episodeId,
        ...(context.runId === undefined ? {} : { runId: context.runId }),
        modelId
      });
    } catch {
      return 0;
    }
    const byId = new Map(sounds.map((sound) => [sound.id, sound]));
    let restored = 0;
    for (const clip of (result && result.clips) || []) {
      const sound = byId.get(clip.soundId);
      if (!sound) continue;
      const prepared = await prepareClip(clip);
      // 在途期间音色变了（已作废），旧配音不能再写回。
      if (epoch !== readyEpoch) return restored;
      store(modelId, sound, prepared);
      restored += 1;
    }
    return restored;
  }

  /** 字节转 Base64（分段转换，避免一次展开太多参数）。 */
  function bytesToBase64(bytes) {
    let text = '';
    for (let from = 0; from < bytes.length; from += 0x8000) text += String.fromCharCode(...bytes.subarray(from, from + 0x8000));
    return btoa(text);
  }

  /** 把解码后的音频的一段样本编码成 16 位 PCM 的 WAV（Base64）。 */
  function encodeWav(buffer, fromSample, toSample) {
    const channels = buffer.numberOfChannels;
    const frames = toSample - fromSample;
    const bytes = new Uint8Array(44 + frames * channels * 2);
    const view = new DataView(bytes.buffer);
    const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, bytes.length - 8, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, frames * channels * 2, true);
    const data = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
    let offset = 44;
    for (let frame = 0; frame < frames; frame += 1) {
      for (const samples of data) {
        const value = Math.max(-1, Math.min(1, samples[fromSample + frame]));
        view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
        offset += 2;
      }
    }
    return bytesToBase64(bytes);
  }

  /**
   * 准备播放用的配音：解码后找出说话的起止位置，把开头的静音（模型合成的语音开头常有几秒）和结尾多余的静音直接裁掉，重新编码成 WAV；
   * 这样播放时不依赖音频元素的定位，第一次播放也不会有静音。不能解码、整段无声或几乎没有静音时原样使用。
   * @param {{ mime: string, data: string }} result 宿主返回的合成结果。
   * @returns {Promise<{ mime: string, data: string, length: number|null }>} 播放用的音频与有效时长（不知道时为 null）。
   */
  async function prepareClip(result) {
    const original = { mime: result.mime, data: result.data, length: null };
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (typeof Offline !== 'function') return original;
    try {
      const bytes = Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0));
      const buffer = await new Offline(1, 1, 44100).decodeAudioData(bytes.buffer);
      const size = Math.max(1, Math.round(buffer.sampleRate * SILENCE_WINDOW_SECONDS));
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
      const windows = [];
      for (let from = 0; from < buffer.length; from += size) {
        const to = Math.min(buffer.length, from + size);
        let sum = 0;
        for (const samples of channels) for (let index = from; index < to; index += 1) sum += samples[index] * samples[index];
        windows.push({ from, to, rms: Math.sqrt(sum / ((to - from) * channels.length)) });
      }
      const threshold = Math.max(SILENCE_RMS, SILENCE_RELATIVE * Math.max(...windows.map((item) => item.rms)));
      const loud = windows.filter((item) => item.rms >= threshold);
      if (loud.length === 0) return { ...original, length: buffer.duration };
      const lead = loud[0].from / buffer.sampleRate;
      const trimStart = lead >= LEAD_MIN_SECONDS ? lead - LEAD_KEEP_SECONDS : 0;
      const trimEnd = Math.min(buffer.duration, loud[loud.length - 1].to / buffer.sampleRate + TAIL_KEEP_SECONDS);
      if (trimStart === 0 && buffer.duration - trimEnd < LEAD_MIN_SECONDS) return { ...original, length: buffer.duration };
      const fromSample = Math.round(trimStart * buffer.sampleRate);
      const toSample = Math.min(buffer.length, Math.round(trimEnd * buffer.sampleRate));
      return { mime: 'audio/wav', data: encodeWav(buffer, fromSample, toSample), length: (toSample - fromSample) / buffer.sampleRate };
    } catch {
      return original;
    }
  }

  /** 已合成、可以同步播放的条目：台词与说话方式没有变化。 */
  function readyClip(modelId, sound) {
    const clip = ready.get(clipKey(modelId, sound.id));
    return clip && clip.text === sound.text && clip.delivery === (sound.delivery || '') ? clip : null;
  }

  /** 已合成的条目数。 */
  function countReady(sounds) {
    const modelId = state.selectedId;
    return modelId === null ? 0 : sounds.filter((sound) => readyClip(modelId, sound) !== null).length;
  }

  /**
   * 依次合成一批对白；已有结果的由宿主缓存返回，不会再调用模型。
   * @param {object} context 作品、集与分镜版本。
   * @param {object[]} sounds 要合成的对白。
   * @param {(done: number, total: number) => void} [onProgress] 每完成一条调用。
   * @param {boolean} [regenerate] 为 true 时全部绕过缓存重新调用模型。
   * @returns {Promise<{ done: number, failed: number, error: string }>} 成功与失败的条数，以及第一条失败的原因。
   */
  async function loadAll(context, sounds, onProgress, regenerate) {
    let done = 0;
    let failed = 0;
    let error = '';
    for (const sound of sounds) {
      try {
        await load(context, sound, regenerate);
        done += 1;
      } catch (reason) {
        failed += 1;
        if (error === '') error = (reason && reason.message) || '合成失败。';
      }
      if (onProgress) onProgress(done + failed, sounds.length);
    }
    return { done, failed, error };
  }

  /** 已合成的结果全部作废：说话人的音色变了，旧的配音不再适用。 */
  function clearReady() {
    readyEpoch += 1;
    ready.clear();
  }

  /**
   * 读取作品里各说话人的临时音色与旁白音色状态。
   * @param {number} workId 作品标识。
   * @returns {Promise<{ narrator: 'bound'|'draft'|'none', narratorAssetName: string|null, draftEntityIds: number[] }>}
   */
  function loadSpeakers(workId) {
    return window.hostBridge.request(REQUEST_SPEAKERS, { workId });
  }

  /**
   * 读取“生成音色”对话框所需的信息：音色描述、已暂存的试听音色、建议名称与其他还没有音色的集数。
   * @param {{ workId: number, episodeId: number, entityId: number|null }} speaker 说话人；旁白的 entityId 为 null。
   */
  function getDraftInfo(speaker) {
    return window.hostBridge.request(REQUEST_DRAFT_INFO, speaker);
  }

  /**
   * 按描述生成一段试听音色（会调用声音模型）；成功后已合成的配音作废。
   * @param {object} payload { workId, episodeId, entityId|null, modelId, sampleText, delivery, description, presetVoice, regenerate }。
   * @returns {Promise<{ mime: string, data: string, presetVoice: string|null, note: string|null, cached: boolean }>}
   */
  async function createDraft(payload) {
    const result = await window.hostBridge.request(REQUEST_DRAFT, payload);
    clearReady();
    return result;
  }

  /**
   * 采用试听音色：保存为音色参考资产并绑定；成功后已合成的配音作废。
   * @param {object} payload { workId, episodeId, entityId|null, name, applyToOtherEpisodes }。
   * @returns {Promise<{ assetId: number, assetName: string, otherEpisodesBound: number }>}
   */
  async function adopt(payload) {
    const result = await window.hostBridge.request(REQUEST_ADOPT, payload);
    clearReady();
    return result;
  }

  /** 配音留给这条对白的结束时间（动画秒）：到下一条人声开始、镜头结束或它自己的时长为止，取最早的。 */
  function slotEndOf(shot, sound) {
    let limit = typeof shot.duration === 'number' ? shot.duration : Infinity;
    for (const other of shot.sounds) {
      if ((other.kind === 'dialogue' || other.kind === 'narration') && other !== sound && other.start > sound.start + EPSILON) limit = Math.min(limit, other.start);
    }
    return shot.start + (sound.estimated ? limit : Math.min(sound.end, limit));
  }

  /** 配音比留给它的时间长时的加速倍数（1 表示不加速）；时间已被占用完时按最大倍数追赶。 */
  function fitRateOf(clip, remain) {
    if (clip.length === null || clip.length <= remain + FIT_TOLERANCE_SECONDS) return 1;
    return remain > EPSILON ? Math.min(MAX_FIT_RATE, clip.length / remain) : MAX_FIT_RATE;
  }

  /** 0.1 秒的静音 WAV（设置采样率 8000，8 位单声道），用来在用户点击时解锁音频元素。 */
  function silentWavUri() {
    const samples = 800;
    const bytes = new Uint8Array(44 + samples).fill(128);
    const view = new DataView(bytes.buffer);
    const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    text(36, 'data');
    view.setUint32(40, samples, true);
    return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
  }

  /**
   * 创建同步器：动画播放时，对白、旁白到了开始时间就播放它已合成的配音，多条配音可以同时出声（按各自的开始时间叠放，和时间线一致）。
   * 配音跳过开头的静音，比留给它的时间长时适当加快（超出的部分顺延播完，不截断）；在播放中勾选“播放时配音”时，正在说的配音从当前位置接着播。
   * 浏览器可能只允许在用户点击的当下播放新创建的音频元素，所以点击时调用 unlock：预先创建一组音频元素并播放一段静音解锁，之后的配音循环使用这些已解锁的元素，即使点击已经过去很久也能出声。
   * @param {() => HTMLAudioElement} [createAudio] 创建音频元素，缺省使用页面的 audio 元素。
   * @param {(error: Error) => void} [onPlayError] 浏览器拒绝或中断播放时调用（被自己停掉导致的中断不报告）。
   * @returns {{ setEnabled: (enabled: boolean) => void, isEnabled: () => boolean, unlock: () => void, update: (frame: object) => void, stop: () => void }}
   *   update 每帧调用，参数为 { timeline, shotIndex, time, playing, rate }；动画暂停时配音一并暂停、继续时接着播；被关闭、时间回退或跳转时停止并清空已播放记录。
   */
  function createSync(createAudio, onPlayError) {
    const create = createAudio || (() => document.createElement('audio'));
    let enabled = false;
    let lastTime = 0;
    /** 因动画暂停而暂停了配音，继续播放时要接着播。 */
    let halted = false;
    const spoken = new Set();
    /** 正在播放的配音：{ element, fit, endAt }，endAt 为有效部分的结束位置（音频内秒数）。 */
    let active = [];
    /** 已用用户点击解锁的音频元素：全部（识别回收对象）与空闲的。 */
    const unlockedElements = new Set();
    const idle = [];
    let unlocked = false;

    /** 播完或停止后，解锁过的元素回到空闲组供下一条使用。 */
    function recycle(entry) {
      const { element } = entry;
      if (!unlockedElements.has(element) || idle.includes(element)) return;
      element.onended = null;
      idle.push(element);
    }

    function remove(entry) {
      if (!active.includes(entry)) return;
      active = active.filter((candidate) => candidate !== entry);
      recycle(entry);
    }

    function reset() {
      const previous = active;
      active = [];
      for (const entry of previous) {
        entry.element.pause();
        recycle(entry);
      }
      spoken.clear();
      halted = false;
    }

    // 浏览器可能拒绝播放：放弃这条并报告原因，字幕与动画照常。
    function play(entry) {
      const played = entry.element.play();
      if (played && typeof played.catch === 'function') {
        played.catch((error) => {
          remove(entry);
          if (onPlayError && !(error && error.name === 'AbortError')) onPlayError(error);
        });
      }
    }

    /** 开始播放一条配音；elapsed 是它已经开始了多久（补播时用），说完了就不播。 */
    function start(clip, slotEnd, frame, elapsed) {
      const fit = fitRateOf(clip, slotEnd - (frame.time - elapsed));
      const position = clip.lead + elapsed * fit;
      const endAt = clip.length === null ? null : clip.lead + clip.length;
      if (endAt !== null && position >= endAt) return;
      const element = idle.pop() || create();
      const entry = { element, fit, endAt };
      active.push(entry);
      element.src = `data:${clip.mime};base64,${clip.data}`;
      element.preservesPitch = true;
      element.playbackRate = fit * frame.rate;
      if (position > 0) element.currentTime = position;
      // 播完后释放，之后的继续播放不会让它从头再来。
      element.onended = () => remove(entry);
      play(entry);
    }

    /** 用户点击时调用：开启配音后第一次调用会预先创建并解锁一组音频元素，之后不再重复。 */
    function unlock() {
      if (!enabled || unlocked) return;
      unlocked = true;
      const silence = silentWavUri();
      for (let count = 0; count < UNLOCK_POOL_SIZE; count += 1) {
        const element = create();
        element.src = silence;
        unlockedElements.add(element);
        idle.push(element);
        const played = element.play();
        if (played && typeof played.catch === 'function') played.catch(() => undefined);
      }
    }

    /** 释放已播完有效部分的配音（结尾的静音不再等），随动画倍速调整播放速度。 */
    function settle(rate) {
      for (const entry of [...active]) {
        const { element } = entry;
        if (element.ended === true || (entry.endAt !== null && typeof element.currentTime === 'number' && element.currentTime >= entry.endAt)) {
          element.pause();
          remove(entry);
          continue;
        }
        if (element.playbackRate !== entry.fit * rate) element.playbackRate = entry.fit * rate;
      }
    }

    function update(frame) {
      const modelId = state.selectedId;
      const shot = frame.timeline.shots[frame.shotIndex];
      if (!enabled || modelId === null || shot === undefined) {
        reset();
        lastTime = frame.time;
        return;
      }
      // 回退（循环、倒带）或大幅跳转：正在播的配音与已播放记录都作废。
      if (frame.time < lastTime - EPSILON || frame.time - lastTime > JUMP_SECONDS) reset();
      lastTime = frame.time;
      if (!frame.playing) {
        for (const entry of active) entry.element.pause();
        halted = true;
        return;
      }
      // 暂停后继续：接着播放暂停的配音。
      if (halted) for (const entry of [...active]) play(entry);
      halted = false;
      settle(frame.rate);
      const local = frame.time - shot.start;
      for (const sound of shot.sounds) {
        if ((sound.kind !== 'dialogue' && sound.kind !== 'narration') || local < sound.start) continue;
        const key = clipKey(modelId, sound.id);
        if (spoken.has(key)) continue;
        const clip = readyClip(modelId, sound);
        // 已经开始的配音从当前位置接着播（拖到中途、播放中勾选都一样），已说完的不播；不知道实际长度时以脚本里的结束时间为准。
        if (clip === null || (clip.length === null && local >= sound.end)) continue;
        spoken.add(key);
        start(clip, slotEndOf(shot, sound), frame, local - sound.start);
      }
    }

    return {
      setEnabled(value) {
        enabled = Boolean(value);
        if (!enabled) reset();
      },
      isEnabled: () => enabled,
      unlock,
      update,
      stop: reset
    };
  }

  window.hostBridge.onEvent(EVENT_MODELS_CHANGED, scheduleRefresh);

  window.aiStoryboardVoice = { getState, subscribe, select, refresh, canPreview, load, restore, loadAll, countReady, readyClip, clearReady, loadSpeakers, getDraftInfo, createDraft, adopt, createSync, clipKey };
})();
