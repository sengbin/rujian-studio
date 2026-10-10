// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-voice-panel.js
// 说明：分镜动画预览的台词配音面板：声音模型选择、播放时同步配音、合成与重新合成、声音行里的试听与“生成音色”入口，以及已合成配音的读回。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 stage-storyboard-preview.js 拆出，通过 window.aiStoryboardPreviewVoicePanel.create(ctx) 创建；配音状态存放在页面状态的 state.voice，页面级的声音模型状态由 stage-storyboard-preview-voice.js 共享；依赖 -voice.js、-voice-draft.js 与 aiUi 组件库，样式在 stage-storyboard-preview.css。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const VOICE_COST_TIP = '试听和合成会调用声音模型，可能产生费用；台词、说话方式、音色绑定或模型变化后会重新合成，没有变化则直接用已合成的结果。';
  const VOICE_DRAFT_TIP = '按剧本里的音色描述让声音模型生成一段试听音色，满意后可以采用并绑定；会调用声音模型，可能产生费用。';
  const VOICE_ADOPT_TIP = '这是还没保存的临时音色，满意后采用，保存为声音资产并绑定。';
  const VOICE_REDO_TIP = '忽略已合成的结果，重新调用声音模型合成，新结果替换旧的；会产生费用，想换一种读法或对结果不满意时使用。';
  const VOICE_SETTINGS_HINT = '在“模型设置”里启用后，这里会自动出现。';

  const voiceApi = window.aiStoryboardVoice;
  const voiceDraftApi = window.aiStoryboardVoiceDraft;

  /**
   * 创建台词配音面板。
   * @param {{ state: object, workId: number, episodeId: number, renderShotInfo: () => void, reload: () => Promise<void> }} ctx
   *   state 为预览层的页面状态（读 view、timeline、shotIndex、disposed，读写 voice）；
   *   renderShotInfo 在说话人音色或所选模型变化后重建信息栏的镜头信息；reload 重新读取分镜（采用音色后角色的音色绑定变了）。
   * @returns {{ element: HTMLElement, start: () => void, dispose: () => void, bindUnlock: (root: HTMLElement) => void, render: () => void,
   *   update: (frame: object) => void, control: (sound: object) => HTMLElement|null, clearStateTags: () => void,
   *   refreshSpeakers: () => Promise<void>, restoreVoices: () => Promise<void> }}
   *   element 为配音行；start 开始订阅声音模型状态，dispose 取消订阅并停止同步播放；bindUnlock 让根元素上的操作解锁音频；
   *   render 重建配音行；update 把播放状态交给同步器；control 生成声音行里的配音控件；clearStateTags 在重建声音行前清掉“已合成”标记的登记。
   */
  function create(ctx) {
    const { state, workId, episodeId, renderShotInfo, reload } = ctx;

    // ---------- 元素 ----------
    const voiceSync = voiceApi.createSync(undefined, (error) => setVoiceMessage(`配音播放失败：${(error && (error.message || error.name)) || '浏览器拒绝了播放'}。`, true));
    const voiceSlot = aiUi.h('span', { class: 'sbp-voice__model' });
    const voiceHint = aiUi.h('span', { class: 'status-warning sbp-voice__hint', attrs: { role: 'status' }, hidden: true });
    const voiceStatus = aiUi.h('span', { class: 'sbp-voice__status', attrs: { role: 'status' } });
    const voiceSummary = aiUi.h('span', { class: 'sbp-voice__summary' });
    const voiceProgressText = aiUi.h('span', { class: 'sbp-voice__progress', attrs: { role: 'status' } });
    const voiceInfo = aiUi.h('div', { class: 'sbp-voice__info' }, voiceSummary, voiceProgressText, voiceStatus);
    const voiceSyncBox = aiUi.checkbox({
      label: '播放时配音',
      checked: false,
      disabled: true,
      onChange: (checked) => {
        voiceSync.setEnabled(checked);
        voiceSync.unlock();
      }
    });
    const voiceBatchButton = aiUi.button({ text: '合成本镜头配音', icon: 'microphone', compact: true, disabled: true, onClick: () => void synthesizeShot() });
    voiceBatchButton.element.title = VOICE_COST_TIP;
    const voiceAllButton = aiUi.button({ text: '合成整集配音', icon: 'microphone', compact: true, disabled: true, onClick: () => void synthesizeEpisode() });
    voiceAllButton.element.title = VOICE_COST_TIP;
    const voiceRedoShotButton = aiUi.button({ text: '重新合成本镜头', icon: 'refresh', compact: true, disabled: true, onClick: () => void resynthesize(shotVoiceSounds(), '本镜头') });
    voiceRedoShotButton.element.title = VOICE_REDO_TIP;
    const voiceRedoAllButton = aiUi.button({ text: '重新合成整集', icon: 'refresh', compact: true, disabled: true, onClick: () => void resynthesize(episodeVoiceSounds(), '整集') });
    voiceRedoAllButton.element.title = VOICE_REDO_TIP;
    const voiceRow = aiUi.h(
      'div',
      { class: 'sbp-voice', attrs: { role: 'group', 'aria-label': '台词配音' } },
      aiUi.h('span', { class: 'sbp-voice__label', text: '台词配音', attrs: { title: VOICE_COST_TIP } }),
      voiceSlot,
      voiceHint,
      voiceSyncBox.element,
      voiceBatchButton.element,
      voiceAllButton.element,
      voiceRedoShotButton.element,
      voiceRedoAllButton.element,
      voiceInfo
    );

    // ---------- 台词配音 ----------
    /** 请求宿主时带的作品、集与分镜版本（即当前显示的版本，声音标识只在该版本内有效）。 */
    function voiceContext() {
      return { workId, episodeId, runId: state.view ? state.view.run.id : undefined };
    }

    /** 实体本集是否已绑定音色参考。 */
    function entityHasVoice(entityId) {
      const entity = state.view && (state.view.entities || []).find((item) => item.id === entityId);
      return Boolean(entity && entity.hasVoice);
    }

    /** 说话人是否已有音色：角色看本集的绑定与临时音色，旁白（null）看作品的旁白音色与临时音色。 */
    function speakerReady(entityId) {
      if (entityId === null) return state.voice.speakers.narrator !== 'none';
      return entityHasVoice(entityId) || state.voice.speakers.draftEntityIds.includes(entityId);
    }

    /** 说话人用的是还没保存的临时音色。 */
    function usesDraftVoice(entityId) {
      return entityId === null ? state.voice.speakers.narrator === 'draft' : !entityHasVoice(entityId) && state.voice.speakers.draftEntityIds.includes(entityId);
    }

    /** 当前镜头里可以试听的对白与旁白。 */
    function shotVoiceSounds() {
      const shot = state.timeline.shots[state.shotIndex];
      return shot ? shot.sounds.filter((sound) => voiceApi.canPreview(sound, speakerReady)) : [];
    }

    function setVoiceMessage(text, isError) {
      state.voice.message = { text, isError: Boolean(isError) };
      renderVoice();
    }

    function setVoiceProgress(text) {
      state.voice.progress = text;
      renderVoice();
    }

    /**
     * 声音行里的配音控件：没有音色的说话人给“生成音色”入口；有音色的带试听按钮（没有可用的声音模型时不显示，配音行已提示去配置）；用临时音色的标明并提供“采用”，作品的旁白音色提供“更换”。
     */
    function voiceControl(sound) {
      const isNarration = sound.kind === 'narration';
      if ((!isNarration && (sound.kind !== 'dialogue' || sound.speakerEntityId === null)) || String(sound.text || '').trim() === '') return null;
      const speakerId = isNarration ? null : sound.speakerEntityId;
      const speakerName = isNarration ? '旁白' : sound.speakerName || '角色';
      if (!speakerReady(speakerId)) {
        const create = aiUi.button({ text: '生成音色', icon: 'microphone', compact: true, ariaLabel: `为${speakerName}生成音色`, onClick: () => openVoiceDraft(sound, speakerId, speakerName) });
        create.element.title = VOICE_DRAFT_TIP;
        return aiUi.h('span', { class: 'sbp-sound-voice sbp-sound-voice--none' }, aiUi.h('span', { text: `${speakerName}还没有音色` }), create.element);
      }
      const parts = [];
      if (voiceApi.getState().selected !== null) {
        const preview = aiUi.audioPreview({ iconOnly: true, ariaLabel: `试听${speakerName}的台词`, load: () => loadVoice(sound) });
        preview.button.element.title = VOICE_COST_TIP;
        parts.push(preview.element);
        const stateTag = aiUi.h('span', { class: 'sbp-sound-voice__state' });
        voiceStateTags.set(sound.id, { element: stateTag, sound });
        applyVoiceState(stateTag, sound);
        parts.push(stateTag);
      }
      if (usesDraftVoice(speakerId)) {
        const adopt = aiUi.button({ text: '采用…', compact: true, ariaLabel: `采用${speakerName}的临时音色`, onClick: () => openVoiceDraft(sound, speakerId, speakerName) });
        adopt.element.title = VOICE_ADOPT_TIP;
        parts.push(aiUi.h('span', { class: 'sbp-sound-voice__tag', text: '临时音色' }), adopt.element);
      } else if (speakerId === null) {
        const change = aiUi.button({ text: '更换音色', compact: true, ariaLabel: '更换旁白音色', onClick: () => openVoiceDraft(sound, speakerId, speakerName) });
        change.element.title = VOICE_DRAFT_TIP;
        parts.push(change.element);
      }
      return parts.length === 0 ? null : aiUi.h('span', { class: 'sbp-sound-voice' }, ...parts);
    }

    /** 打开“生成音色”对话框：试听台词取这一条声音的台词。 */
    function openVoiceDraft(sound, speakerId, speakerName) {
      void voiceDraftApi.open({
        workId,
        episodeId,
        entityId: speakerId,
        speakerName,
        sampleText: sound.text,
        delivery: sound.delivery || '',
        onChanged: (kind, result) => void onVoiceDraftChanged(kind, result)
      });
    }

    /** 读取宿主里各说话人的临时音色与旁白音色状态，并重建依赖它的界面。 */
    async function refreshSpeakers() {
      try {
        const speakers = await voiceApi.loadSpeakers(workId);
        state.voice.speakers = { narrator: speakers.narrator || 'none', draftEntityIds: speakers.draftEntityIds || [] };
      } catch {
        state.voice.speakers = { narrator: 'none', draftEntityIds: [] };
      }
      if (state.disposed) return;
      renderShotInfo();
      renderVoice();
      void restoreVoices();
    }

    /** 生成了新的试听音色或采用了音色：采用后重新读取分镜（角色的音色绑定变了），再刷新临时音色状态并说明结果。 */
    async function onVoiceDraftChanged(kind, result) {
      if (kind === 'adopted') await reload();
      await refreshSpeakers();
      if (state.disposed) return;
      if (kind === 'adopted') {
        const others = result.otherEpisodesBound > 0 ? `，并同时用于其他 ${result.otherEpisodesBound} 集` : '';
        setVoiceMessage(`已保存为声音资产“${result.assetName}”并绑定${others}。`, false);
      } else {
        setVoiceMessage('试听音色已更新，重新合成本镜头配音即可用它试听；满意后点“采用…”。', false);
      }
    }

    /** 试听一条对白：请求宿主合成（内容没变时宿主直接用缓存），失败时在配音行说明原因。 */
    async function loadVoice(sound) {
      try {
        const clip = await voiceApi.load(voiceContext(), sound);
        const base = clip.cached ? '没有重新调用模型，用的是已合成的结果。' : '已调用模型合成。';
        setVoiceMessage(clip.note ? `${base}${clip.note}` : base, false);
        return { mime: clip.mime, data: clip.data };
      } catch (error) {
        setVoiceMessage((error && error.message) || '试听失败。', true);
        return undefined;
      }
    }

    /** 声音标识 → 对白行里的“已合成/需要合成”标记，合成、读取结果后原地更新，不重建对白行（正在试听的不被打断）。 */
    const voiceStateTags = new Map();

    /** 按是否已有可用的合成结果设置标记：没有结果说明还没合成，或台词、说话方式改过。 */
    function applyVoiceState(element, sound) {
      const modelId = voiceApi.getState().selectedId;
      const isReady = modelId !== null && voiceApi.readyClip(modelId, sound) !== null;
      element.textContent = isReady ? '已合成' : '需要合成';
      element.title = isReady ? '' : '还没有合成，或台词、说话方式改过。点“合成本镜头配音”“合成整集配音”或这条的“试听”才会合成（会调用模型）。';
      element.classList.toggle('sbp-sound-voice__state--pending', !isReady);
    }

    function updateVoiceStates() {
      for (const { element, sound } of voiceStateTags.values()) applyVoiceState(element, sound);
    }

    /**
     * 打开预览、重新读取分镜、换模型后，把宿主本地已保存的配音读回来（只读缓存，不调用模型，不产生费用）。
     * 台词、说话方式改过的读不到，显示“需要合成”，由用户点合成或重新合成。
     */
    async function restoreVoices() {
      if (state.disposed) return;
      if (state.voice.restoring) {
        state.voice.restoreAgain = true;
        return;
      }
      const modelId = voiceApi.getState().selectedId;
      if (modelId === null || !state.view) return;
      const missing = episodeVoiceSounds().filter((sound) => voiceApi.readyClip(modelId, sound) === null);
      if (missing.length === 0) return;
      state.voice.restoring = true;
      try {
        if ((await voiceApi.restore(voiceContext(), missing)) > 0 && !state.disposed) renderVoice();
      } finally {
        state.voice.restoring = false;
        if (state.voice.restoreAgain) {
          state.voice.restoreAgain = false;
          void restoreVoices();
        }
      }
    }

    /** 合成一批对白，之后“播放时配音”即可听到；scope 是提示里的范围名称，regenerate 为 true 时绕过缓存全部重新合成。 */
    async function synthesizeSounds(sounds, scope, regenerate) {
      if (sounds.length === 0 || state.voice.busy) return;
      state.voice.busy = true;
      setVoiceProgress(`正在合成配音 0/${sounds.length}…`);
      const result = await voiceApi.loadAll(voiceContext(), sounds, (done, total) => setVoiceProgress(`正在合成配音 ${done}/${total}…`), regenerate);
      state.voice.busy = false;
      state.voice.progress = null;
      if (result.failed > 0) setVoiceMessage(`已合成 ${result.done} 条，${result.failed} 条失败：${result.error}`, true);
      else setVoiceMessage(`${scope} ${result.done} 条配音已${regenerate ? '重新' : ''}合成，勾选“播放时配音”后播放即可听到。`, false);
    }

    /** 合成当前镜头里全部可试听的对白。 */
    function synthesizeShot() {
      return synthesizeSounds(shotVoiceSounds(), '本镜头');
    }

    /** 整集里全部可试听的对白与旁白。 */
    function episodeVoiceSounds() {
      return state.timeline.shots.flatMap((shot) => shot.sounds.filter((sound) => voiceApi.canPreview(sound, speakerReady)));
    }

    /** 合成整集的配音：条数多、会产生费用，先确认；已合成且没有变化的不会再调用模型。 */
    async function synthesizeEpisode() {
      const sounds = episodeVoiceSounds();
      if (sounds.length === 0 || state.voice.busy) return;
      const pending = sounds.length - voiceApi.countReady(sounds);
      const confirmed = await aiUi.confirm({
        title: '合成整集配音',
        message: pending === 0 ? `整集 ${sounds.length} 条配音都已合成，没有变化的不会再调用模型。继续吗？` : `整集共 ${sounds.length} 条配音，其中 ${pending} 条还没合成，将逐条调用声音模型，可能产生费用。继续吗？`,
        confirmText: '合成'
      });
      if (confirmed) await synthesizeSounds(sounds, '整集');
    }

    /** 重新合成：不管有没有变化都重新调用模型，结果替换已合成的；会产生费用，先确认。 */
    async function resynthesize(sounds, scope) {
      if (sounds.length === 0 || state.voice.busy) return;
      const confirmed = await aiUi.confirm({
        title: `重新合成${scope}配音`,
        message: `将忽略已合成的结果，逐条重新调用声音模型合成${scope}的 ${sounds.length} 条配音，新结果会替换旧的，可能产生费用。继续吗？`,
        confirmText: '重新合成'
      });
      if (confirmed) await synthesizeSounds(sounds, scope, true);
    }

    /** 重建配音行：声音模型下拉（没有可用模型时提示去“模型设置”配置）、同步播放开关、合成按钮与状态文字。 */
    function renderVoice() {
      const voice = voiceApi.getState();
      const selectKey = `${voice.models.map((model) => model.id).join(',')}|${voice.selectedId}`;
      if (selectKey !== state.voice.selectKey) {
        state.voice.selectKey = selectKey;
        voiceSlot.textContent = '';
        if (voice.models.length > 0) {
          const modelSelect = aiUi.select({
            options: voice.models.map((model) => ({ value: String(model.id), label: model.label })),
            value: String(voice.selectedId),
            allowEmpty: false,
            ariaLabel: '声音模型',
            onChange: (value) => voiceApi.select(Number(value))
          });
          modelSelect.element.title = '配音使用的声音模型，列表是“模型设置”里已启用并配置了访问密钥的语音模型';
          voiceSlot.append(modelSelect.element);
        }
      }
      const unavailable = voice.loaded && voice.selected === null;
      voiceHint.hidden = !unavailable;
      voiceHint.textContent = unavailable ? `${voice.error || voice.hint} ${VOICE_SETTINGS_HINT}` : '';
      voiceSyncBox.setDisabled(voice.selected === null);
      if (voice.selected === null) {
        voiceSyncBox.setValue(false);
        voiceSync.setEnabled(false);
      }
      const sounds = shotVoiceSounds();
      voiceBatchButton.setDisabled(voice.selected === null || sounds.length === 0 || state.voice.busy);
      const episodeSounds = voice.selected === null ? [] : episodeVoiceSounds();
      voiceAllButton.setDisabled(episodeSounds.length === 0 || state.voice.busy);
      voiceRedoShotButton.setDisabled(voice.selected === null || sounds.length === 0 || state.voice.busy);
      voiceRedoAllButton.setDisabled(episodeSounds.length === 0 || state.voice.busy);
      let summary = '';
      if (voice.selected !== null && episodeSounds.length > 0) {
        const readyAll = voiceApi.countReady(episodeSounds);
        const missing = episodeSounds.length - readyAll;
        const hint = missing > 0 ? `，${missing} 条需要合成（还没合成，或台词、说话方式改过）` : '';
        summary = `本镜头 ${sounds.length} 条对白可配音，已合成 ${voiceApi.countReady(sounds)} 条；整集已合成 ${readyAll}/${episodeSounds.length} 条${hint}。`;
      }
      voiceSummary.textContent = summary;
      voiceProgressText.textContent = state.voice.progress === null ? '' : state.voice.progress;
      voiceStatus.textContent = state.voice.message === null ? '' : state.voice.message.text;
      voiceStatus.classList.toggle('status-error', state.voice.message !== null && state.voice.message.isError);
      updateVoiceStates();
    }

    /** 声音模型状态变化（读取完成、模型在设置里被启用或关闭、换了所选模型）：刷新配音行，模型变化时连同对白行的试听按钮一起重建。 */
    function onVoiceChange(voice) {
      const key = voice.selectedId === null ? '' : String(voice.selectedId);
      const modelChanged = key !== state.voice.modelKey;
      state.voice.modelKey = key;
      if (modelChanged) state.voice.message = null;
      renderVoice();
      if (modelChanged) {
        renderShotInfo();
        void restoreVoices();
      }
    }

    /** 声音模型状态的取消订阅函数；start 之前为 null。 */
    let unsubscribeVoice = null;

    /** 订阅声音模型状态；第一次订阅会触发读取，并立即回调一次，所以要等预览层的各部分都建好后再调用。 */
    function start() {
      unsubscribeVoice = voiceApi.subscribe(onVoiceChange);
    }

    /** 取消订阅并停止同步播放，预览层关闭时调用。 */
    function dispose() {
      if (unsubscribeVoice) unsubscribeVoice();
      voiceSync.stop();
    }

    /** 浏览器只允许在用户操作的当下启动新的音频，所以根元素上的每次点击或按键都让配音同步器解锁它的音频元素（开启配音后只做一次）。 */
    function bindUnlock(root) {
      for (const name of ['mousedown', 'pointerup', 'keydown', 'touchend']) root.addEventListener(name, () => voiceSync.unlock(), true);
    }

    return {
      element: voiceRow,
      start,
      dispose,
      bindUnlock,
      render: renderVoice,
      update: (frame) => voiceSync.update(frame),
      control: voiceControl,
      clearStateTags: () => voiceStateTags.clear(),
      refreshSpeakers,
      restoreVoices
    };
  }

  window.aiStoryboardPreviewVoicePanel = { create };
})();
