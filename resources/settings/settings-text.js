// ------------------------------------------------------------------------
// 名称：settings-text.js
// 说明：模型设置页的“文本生成”区：全局默认文本模型，以及对所有文本模型通用的小说分段方式与每段字数上限，全部即时保存并在字段旁反馈保存状态。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 settings.js 拆出；请求名称与 src/app/pages/settings-handlers.ts 一致；对外是 window.aiSettingsText.render(view)；必须晚于 settings-widgets.js、先于 settings.js 加载；文本模型在服务商设置页中启用。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_UPDATE = 'settings.update';

  const SPLIT_MODE_OPTIONS = [
    { value: 'chapter', label: '按章节' },
    { value: 'length', label: '按字数' }
  ];

  const { SAVING_TEXT, SAVED_TEXT, createSaveStatus } = window.aiSettingsWidgets;
  const { errorText } = window.pageFormat;

  /** 保存一项文本生成设置，并在状态文字中反馈结果。 */
  async function saveSetting(patch, status) {
    status.show(SAVING_TEXT, false);
    try {
      await window.hostBridge.request(REQUEST_UPDATE, patch);
      status.show(SAVED_TEXT, false);
    } catch (error) {
      status.show(`保存失败：${errorText(error)}`, true);
    }
  }

  /** 文本模型区：全局默认文本模型；文本模型在服务商设置页中启用。 */
  function renderEngineSettings(view) {
    const elements = [];
    if (view.choices.length > 0) {
      const modelStatus = createSaveStatus();
      const modelSelect = aiUi.select({
        options: view.choices.map((choice) => ({ value: choice.key, label: choice.label })),
        value: view.defaultModel,
        placeholder: '请重新选择',
        allowEmpty: false,
        ariaLabel: '默认文本模型',
        onChange: (value) => void saveSetting({ defaultModel: value }, modelStatus)
      });
      const modelField = aiUi.field({
        label: '默认文本模型',
        description: '生成创意、剧本、分镜脚本和资产提示词时使用；作品可以在“编辑作品”中单独选择，不选则沿用这里。',
        control: modelSelect
      });
      elements.push(modelField.element);
      if (view.modelNote) elements.push(aiUi.h('p', { class: 'status-warning settings-note', text: view.modelNote }));
      elements.push(modelStatus.element);
    }
    if (view.engineNote) elements.push(aiUi.h('p', { class: 'status-warning settings-note', text: view.engineNote }));
    return elements;
  }

  /** 文本生成设置区：先设置文本模型，再设置对所有文本模型通用的小说分段。 */
  function render(view) {
    const splitStatus = createSaveStatus();
    const splitRadio = aiUi.radioGroup({
      options: SPLIT_MODE_OPTIONS,
      value: view.splitMode,
      direction: 'horizontal',
      ariaLabel: '小说分段方式',
      onChange: (value) => {
        updateCharsDescription(value);
        void saveSetting({ splitMode: value }, splitStatus);
      }
    });
    const splitField = aiUi.field({
      label: '小说分段方式',
      description: '按章节时识别不到章节标题，会自动改为按字数。',
      control: splitRadio
    });

    const { min, max } = view.segmentCharsRange;
    const charsStatus = createSaveStatus();
    const charsInput = aiUi.textInput({ value: String(view.maxSegmentChars), ariaLabel: '每段字数上限' });
    const charsField = aiUi.field({
      label: '每段字数上限',
      description: charsDescription(view.splitMode),
      control: charsInput
    });
    /** 说明文字随分段方式切换：两种方式下这个值都会用，作用不同。 */
    function charsDescription(mode) {
      const effect = mode === 'chapter' ? '按章节时，单章超过此值会在段落处再切分。' : '按字数时，每段按此字数切分。';
      return `${min} 至 ${max} 的整数；${effect}`;
    }
    function updateCharsDescription(mode) {
      charsField.element.querySelector('.ui-field__description').textContent = charsDescription(mode);
    }
    // 输入框失去焦点且内容有变化时才保存；格式不对时不请求宿主，直接在字段下方提示。
    let savedChars = String(view.maxSegmentChars);
    charsInput.focusTarget.addEventListener('change', () => {
      const text = charsInput.getValue().trim();
      if (text === savedChars) return;
      const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
      if (!Number.isInteger(value) || value < min || value > max) {
        charsField.setError(`必须是 ${min} 到 ${max} 之间的整数。`);
        charsStatus.show('', false);
        return;
      }
      charsField.setError('');
      savedChars = text;
      void saveSetting({ maxSegmentChars: value }, charsStatus);
    });

    return aiUi.h(
      'section',
      { class: 'settings-section' },
      aiUi.h('h2', { class: 'ui-title', text: '文本生成' }),
      renderEngineSettings(view),
      aiUi.h('h3', { class: 'ui-heading settings-subtitle', text: '小说分段（所有文本模型通用）' }),
      splitField.element,
      splitStatus.element,
      charsField.element,
      charsStatus.element
    );
  }

  window.aiSettingsText = { render };
})();
