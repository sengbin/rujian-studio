// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-voice-draft.js
// 说明：分镜动画预览里的“生成音色”对话框：说话人（角色或旁白）还没有音色时，按剧本里的音色描述让声音模型生成一段试听音色，满意后采用，保存为声音资产并绑定。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：通过 window.aiStoryboardVoiceDraft.open(options) 打开，同一时间只有一个；请求都经 aiStoryboardVoice 发出（名称与 src/app/pages/voice-preview-handlers.ts 一致）；每次生成都会调用声音模型并产生费用，只在用户点击“生成试听”“换一个”时才请求；试听音色只暂存在宿主内存里，动画预览把它当作临时音色播放，点“采用并绑定”后才写入声音资产与绑定；只有预置音色的模型不能按描述生成，改为选预置音色；依赖 aiUi 组件库与 stage-storyboard-preview-voice.js，样式在 stage-storyboard-preview.css。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const voiceApi = window.aiStoryboardVoice;

  const SAMPLE_MAX_LENGTH = 120;
  const GENERIC_ERROR_TEXT = '操作失败，请重试。';
  const COST_NOTICE = '每次生成都会调用声音模型，可能产生费用。试听音色只在这个动画预览里临时使用，点“采用并绑定”后才会保存为声音资产并绑定。';
  const DESCRIPTION_HINT = '来自剧本里角色的音色设定，可以修改；只用于这次生成，不会改动剧本。';
  const NARRATOR_HINT = '旁白没有角色设定，请写出想要的声音，例如“沉稳的中年男声，语速偏慢”。';
  const PRESET_ONLY_HINT = '所选模型只有预置音色，不能按描述生成，请从预置音色里选一个；想按描述生成可以换用支持的模型。';
  const SETTINGS_HINT = '在“模型设置”里启用后再来生成。';
  const PAGE_WIDTH = 520;
  const PAGE_HEIGHT = 640;

  /** 同一时间只打开一个。 */
  let active = false;

  /** 取错误载荷中的说明文字：有字段错误时列出各项，否则用错误说明。 */
  function errorText(error) {
    const fields = error && error.fieldErrors ? Object.values(error.fieldErrors) : [];
    return fields.length > 0 ? fields.join('\n') : (error && error.message) || GENERIC_ERROR_TEXT;
  }

  /**
   * 打开“生成音色”对话框。
   * @param {{ workId: number, episodeId: number, entityId: number|null, speakerName: string, sampleText: string,
   *   delivery?: string, onChanged?: (kind: 'drafted'|'adopted', result?: object) => void }} options
   *   entityId 为 null 表示旁白；sampleText 为试听用的台词（取自点开时的那条声音）；
   *   onChanged 在生成了新的试听音色（drafted）或采用音色（adopted，附采用结果）后调用。
   * @returns {Promise<void>} 对话框关闭后完成。
   */
  async function open(options) {
    if (active) return;
    active = true;
    try {
      await run(options);
    } finally {
      active = false;
    }
  }

  async function run(options) {
    const { workId, episodeId, entityId, speakerName } = options;
    const isNarrator = entityId === null;
    const speaker = { workId, episodeId, entityId };

    let info;
    try {
      info = await voiceApi.getDraftInfo(speaker);
    } catch (error) {
      await aiUi.alert({ title: '无法生成音色', message: errorText(error) });
      return;
    }
    let voice = voiceApi.getState();
    if (!voice.loaded) {
      await voiceApi.refresh();
      voice = voiceApi.getState();
    }
    if (voice.models.length === 0) {
      await aiUi.alert({ title: '暂时不能生成音色', message: `${voice.error || voice.hint} ${SETTINGS_HINT}` });
      return;
    }

    const stored = info.draft;
    const state = {
      draft: stored,
      modelId: String(stored !== null && voice.models.some((model) => model.id === stored.modelId) ? stored.modelId : voice.selectedId),
      description: stored !== null ? stored.description : info.description,
      sampleText: (stored !== null ? stored.sampleText : String(options.sampleText || '')).slice(0, SAMPLE_MAX_LENGTH),
      presetVoice: stored !== null && stored.presetVoice ? stored.presetVoice : '',
      busy: false,
      adopted: null
    };

    // ---------- 元素 ----------
    const intro = aiUi.h('p', { class: 'description', text: `为“${speakerName}”生成音色：让声音模型按描述生成一段试听，满意后采用，之后动画里这位${isNarrator ? '旁白' : '角色'}的台词就用这个音色播放。` });
    const modelSelect = aiUi.select({
      options: voice.models.map((model) => ({ value: String(model.id), label: model.label })),
      value: state.modelId,
      allowEmpty: false,
      ariaLabel: '声音模型',
      onChange: (value) => {
        state.modelId = value;
        renderParams();
      }
    });
    const paramsSlot = aiUi.h('div', { class: 'sbp-draft__params' });
    const sampleControl = aiUi.textArea({ value: state.sampleText, minRows: 1, maxRows: 3, ariaLabel: '试听台词', onChange: (text) => (state.sampleText = text) });
    const generateButton = aiUi.button({ text: '生成试听', icon: 'sparkles', onClick: () => void generate() });
    const messageElement = aiUi.h('p', { class: 'sbp-draft__message', attrs: { role: 'status' } });
    const playerSlot = aiUi.h('div', { class: 'sbp-draft__player' });

    // 采用区：有试听音色后才显示。
    const nameControl = aiUi.textInput({ value: info.suggestedName, ariaLabel: '声音资产名称' });
    const nameField = aiUi.field({ label: '声音资产名称', description: '采用后保存到“音频”资产里，名称不能和已有的音频资产重复。', required: true, control: nameControl });
    const applyOthers = !isNarrator && info.otherEpisodes > 0 ? aiUi.checkbox({ label: `同时用于本作品其他 ${info.otherEpisodes} 集（这些集里该角色还没有音色）`, checked: true }) : null;
    const adoptNotes = [];
    if (isNarrator) adoptNotes.push('旁白音色按作品保存，作品里所有集共用。');
    if (isNarrator && info.narratorAssetName) adoptNotes.push(`采用后会替换作品当前的旁白音色“${info.narratorAssetName}”。`);
    const adoptSection = aiUi.h(
      'div',
      { class: 'sbp-draft__adopt', hidden: state.draft === null },
      aiUi.h('h3', { class: 'ui-heading sbp-section__title', text: '采用这个音色' }),
      nameField.element,
      applyOthers === null ? null : applyOthers.element,
      ...adoptNotes.map((text) => aiUi.h('p', { class: 'description', text }))
    );

    const content = aiUi.h(
      'div',
      { class: 'sbp-draft' },
      intro,
      aiUi.field({ label: '声音模型', control: modelSelect }).element,
      paramsSlot,
      aiUi.field({ label: '试听台词', description: `用这句台词试听音色，最多 ${SAMPLE_MAX_LENGTH} 字。`, required: true, control: sampleControl }).element,
      aiUi.h('div', { class: 'sbp-draft__actions' }, generateButton.element, playerSlot),
      messageElement,
      aiUi.h('p', { class: 'description', text: COST_NOTICE }),
      adoptSection
    );

    // ---------- 行为 ----------
    function setMessage(text, isError) {
      messageElement.textContent = text;
      messageElement.classList.toggle('status-error', Boolean(isError));
    }

    function currentModel() {
      return voice.models.find((model) => String(model.id) === state.modelId);
    }

    /** 按所选模型重画参数：支持参考音频的模型按描述生成，只有预置音色的模型选预置音色。 */
    function renderParams() {
      paramsSlot.textContent = '';
      const model = currentModel();
      if (!model) return;
      if (model.supportsReference) {
        const description = aiUi.textArea({ value: state.description, minRows: 2, maxRows: 5, ariaLabel: '音色描述', onChange: (text) => (state.description = text) });
        paramsSlot.append(aiUi.field({ label: '音色描述', description: isNarrator ? NARRATOR_HINT : DESCRIPTION_HINT, control: description }).element);
        return;
      }
      const voices = model.voices || [];
      if (voices.length === 0) return;
      if (!voices.includes(state.presetVoice)) state.presetVoice = '';
      const preset = aiUi.select({
        options: voices.map((value) => ({ value, label: value })),
        value: state.presetVoice,
        placeholder: '由系统挑选',
        ariaLabel: '预置音色',
        onChange: (value) => (state.presetVoice = value)
      });
      paramsSlot.append(aiUi.field({ label: '预置音色', description: PRESET_ONLY_HINT, control: preset }).element);
    }

    /** 显示已有的试听音色：播放按钮、采用区，按钮文字变为“换一个”。 */
    function renderDraft() {
      playerSlot.textContent = '';
      adoptSection.hidden = state.draft === null;
      handle.setButtonDisabled('adopt', state.draft === null || state.busy);
      if (state.draft === null) return;
      const { mime, data } = state.draft;
      generateButton.setText('换一个');
      generateButton.setIcon('refresh');
      playerSlot.append(aiUi.audioPreview({ text: '试听', compact: false, ariaLabel: `试听${speakerName}的音色`, load: async () => ({ mime, data }) }).element);
    }

    function setBusy(busy) {
      state.busy = busy;
      generateButton.setDisabled(busy);
      handle.setButtonDisabled('adopt', busy || state.draft === null);
    }

    async function generate() {
      if (state.busy) return;
      if (state.sampleText.trim() === '') {
        setMessage('请先填写试听台词。', true);
        return;
      }
      const model = currentModel();
      if (!model) {
        setMessage('还没有可用的声音模型。', true);
        return;
      }
      setBusy(true);
      setMessage('正在生成试听音色…', false);
      try {
        const result = await voiceApi.createDraft({
          workId,
          episodeId,
          entityId,
          modelId: Number(state.modelId),
          sampleText: state.sampleText,
          delivery: String(options.delivery || ''),
          description: model && model.supportsReference ? state.description : '',
          presetVoice: state.presetVoice,
          // 已有试听音色时再点就是“换一个”：不用缓存，重新生成。
          regenerate: state.draft !== null
        });
        state.draft = result;
        renderDraft();
        const base = result.cached ? '没有重新调用模型，用的是之前生成的结果；想要不同的声音请点“换一个”。' : '已生成。不满意可以点“换一个”，满意就点“采用并绑定”。';
        setMessage(result.note ? `${base}${result.note}` : base, false);
        if (options.onChanged) options.onChanged('drafted');
      } catch (error) {
        setMessage(errorText(error), true);
      } finally {
        setBusy(false);
      }
    }

    /** 采用：保存为声音资产并绑定；失败时留在对话框里说明原因（重名显示在名称字段上）。 */
    async function adopt() {
      const name = nameControl.getValue().trim();
      if (name === '') {
        nameField.setError('名称不能为空。');
        return false;
      }
      nameField.setError('');
      try {
        state.adopted = await voiceApi.adopt({ workId, episodeId, entityId, name, applyToOtherEpisodes: applyOthers !== null && applyOthers.getValue() });
        return true;
      } catch (error) {
        const fields = error && error.fieldErrors ? error.fieldErrors : {};
        if (fields.name) nameField.setError(fields.name);
        else setMessage(errorText(error), true);
        return false;
      }
    }

    const handle = aiUi.openPage({
      title: `生成音色：${speakerName}`,
      content,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      minWidth: 400,
      minHeight: 360,
      buttons: [
        { id: 'adopt', text: '采用并绑定', variant: 'primary', disabled: true, onClick: adopt },
        { id: 'close', text: '关闭', isCancel: true }
      ]
    });
    renderParams();
    renderDraft();
    if (state.draft !== null) setMessage('这是上次生成的试听音色，可以直接采用，也可以点“换一个”重新生成。', false);

    // 声音模型随模型设置里的启用、密钥变化实时更新：所选模型不再可用时改选当前默认的模型。
    let modelKey = voice.models.map((model) => model.id).join(',');
    const unsubscribe = voiceApi.subscribe((latest) => {
      const latestKey = latest.models.map((model) => model.id).join(',');
      if (latest.loading || latestKey === modelKey) return;
      modelKey = latestKey;
      voice = latest;
      modelSelect.setOptions(latest.models.map((model) => ({ value: String(model.id), label: model.label })));
      if (!latest.models.some((model) => String(model.id) === state.modelId)) {
        state.modelId = latest.selectedId === null ? '' : String(latest.selectedId);
        modelSelect.setValue(state.modelId);
      }
      renderParams();
    });

    await handle.closed;
    unsubscribe();
    if (state.adopted !== null && options.onChanged) options.onChanged('adopted', state.adopted);
  }

  window.aiStoryboardVoiceDraft = { open };
})();
