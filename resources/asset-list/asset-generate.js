// ------------------------------------------------------------------------
// 名称：asset-generate.js
// 说明：生成图片/音频对话框（F13）：按所选模型的能力选择图片数量、画幅、分辨率或音频的语言与音色，提交后产生新版本。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：请求名称与 src/app/pages/asset-list-handlers.ts 一致；字段随所选模型联动，因此不走表单引擎；必须先于 asset-list.js 加载；对外是 window.aiAssetGenerate.open；收到 models.changed 事件时重新读取模型清单并刷新模型下拉。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_CATALOG = 'assets.generateCatalog';
  const REQUEST_GENERATE = 'assets.generate';
  const EVENT_MODELS_CHANGED = 'models.changed';

  const LANGUAGE_LABELS = { zh: '中文', en: '英文' };
  const GENERIC_ERROR_TEXT = '操作失败，请重试。';
  const COST_NOTICE = '每次提交按平台规则计费；结果保存为新版本，采用后才会被使用。';
  const MODEL_DEFAULT_TEXT = '由模型决定';

  /** 取错误载荷中的说明文字：有字段错误时列出各项，否则用错误说明。 */
  function errorText(error) {
    const fields = error && error.fieldErrors ? Object.values(error.fieldErrors) : [];
    return fields.length > 0 ? fields.join('\n') : (error && error.message) || GENERIC_ERROR_TEXT;
  }

  /** 下拉选项：值与显示文字相同。 */
  function plainOptions(values) {
    return values.map((value) => ({ value, label: value }));
  }

  /** 当前打开的生成对话框；没有打开时为 null。 */
  let current = null;
  /** 重新读取模型清单并刷新对话框的函数；没有打开对话框时为 null。 */
  let refreshOpened = null;
  // 在“模型设置”里启用或关闭模型、改访问密钥后，对话框里的模型下拉实时更新。
  window.hostBridge.onEvent(EVENT_MODELS_CHANGED, () => {
    if (refreshOpened) void refreshOpened();
  });

  /** 按所选模型重绘随模型变化的字段，并更新 state。 */
  function renderParams(state) {
    const { catalog, paramsElement } = state;
    const model = catalog.models.find((item) => String(item.id) === state.modelId);
    paramsElement.textContent = '';
    if (!model) return;
    const capability = model.capability;

    if (catalog.modelKind === 'image') {
      const countOptions = Array.from({ length: capability.imagesPerRequestMax }, (_, index) => String(index + 1));
      if (Number(state.count) > capability.imagesPerRequestMax || !state.count) state.count = '1';
      paramsElement.append(
        aiUi.field({
          label: '生成数量',
          description: `一次生成的图片数量，最多 ${capability.imagesPerRequestMax} 张；它们属于同一个版本。`,
          control: aiUi.select({ options: plainOptions(countOptions), value: state.count, allowEmpty: false, ariaLabel: '生成数量', onChange: (value) => (state.count = value) })
        }).element
      );
      if (capability.aspectRatios.length > 0) {
        if (!capability.aspectRatios.includes(state.aspectRatio)) state.aspectRatio = '';
        paramsElement.append(
          aiUi.field({
            label: '画幅',
            description: '默认取资产的参考图画幅。',
            control: aiUi.select({ options: plainOptions(capability.aspectRatios), value: state.aspectRatio, placeholder: MODEL_DEFAULT_TEXT, ariaLabel: '画幅', onChange: (value) => (state.aspectRatio = value) })
          }).element
        );
      }
      if (capability.resolutions.length > 0) {
        if (!capability.resolutions.includes(state.resolution)) state.resolution = '';
        paramsElement.append(
          aiUi.field({
            label: '分辨率',
            control: aiUi.select({ options: plainOptions(capability.resolutions), value: state.resolution, placeholder: MODEL_DEFAULT_TEXT, ariaLabel: '分辨率', onChange: (value) => (state.resolution = value) })
          }).element
        );
      }
      if (capability.referenceImagesMax > 0 && catalog.referenceCount > 0) {
        paramsElement.append(
          aiUi.checkbox({
            label: `以当前参考图作为参考输入（最多 ${Math.min(catalog.referenceCount, capability.referenceImagesMax)} 张）`,
            checked: state.useReferenceImages,
            onChange: (value) => (state.useReferenceImages = value)
          }).element
        );
      } else {
        state.useReferenceImages = false;
      }
      return;
    }

    // 音频：每次固定生成 1 个，没有数量选项。
    if (capability.languages.length > 0) {
      if (!capability.languages.includes(state.language)) state.language = '';
      paramsElement.append(
        aiUi.field({
          label: '音频语言',
          control: aiUi.select({
            options: capability.languages.map((value) => ({ value, label: LANGUAGE_LABELS[value] || value })),
            value: state.language,
            placeholder: MODEL_DEFAULT_TEXT,
            ariaLabel: '音频语言',
            onChange: (value) => (state.language = value)
          })
        }).element
      );
    }
    if (capability.voices.length > 0) {
      if (!capability.voices.includes(state.voice)) state.voice = '';
      paramsElement.append(
        aiUi.field({
          label: '预置音色',
          control: aiUi.select({ options: plainOptions(capability.voices), value: state.voice, placeholder: MODEL_DEFAULT_TEXT, ariaLabel: '预置音色', onChange: (value) => (state.voice = value) })
        }).element
      );
    }
    paramsElement.append(aiUi.h('p', { class: 'description', text: '音频每次生成 1 个。' }));
  }

  /** 提交生成；成功返回 true 并关闭对话框，失败在对话框里显示原因并保持打开。 */
  async function submit(state) {
    const payload = {
      assetId: state.catalog.assetId,
      modelId: Number(state.modelId)
    };
    if (state.catalog.modelKind === 'image') {
      Object.assign(payload, { count: Number(state.count), aspectRatio: state.aspectRatio, resolution: state.resolution, useReferenceImages: state.useReferenceImages });
    } else {
      Object.assign(payload, { language: state.language, voice: state.voice });
    }
    try {
      await window.hostBridge.request(REQUEST_GENERATE, payload);
      return true;
    } catch (error) {
      state.messageElement.textContent = errorText(error);
      state.messageElement.hidden = false;
      return false;
    }
  }

  /**
   * 打开生成对话框；已打开时不重复打开。
   * @param {{ id: number, name: string, kind: string }} asset 要生成的资产。
   * @param {() => void} [onSubmitted] 提交成功后的回调。
   */
  async function open(asset, onSubmitted) {
    if (current) return;
    current = true;
    let catalog;
    try {
      catalog = await window.hostBridge.request(REQUEST_CATALOG, { assetId: asset.id });
    } catch (error) {
      current = null;
      await aiUi.alert({ title: '无法生成', message: errorText(error) });
      return;
    }
    if (!catalog.availability.available) {
      current = null;
      await aiUi.alert({ title: '暂时不能生成', message: catalog.availability.reason || GENERIC_ERROR_TEXT });
      return;
    }

    const noun = catalog.modelKind === 'audio' ? '音频' : '图片';
    const state = {
      catalog,
      modelId: catalog.defaults.modelId === null ? '' : String(catalog.defaults.modelId),
      count: String(catalog.defaults.count),
      aspectRatio: catalog.defaults.aspectRatio,
      resolution: catalog.defaults.resolution,
      language: catalog.defaults.language,
      voice: catalog.defaults.voice,
      useReferenceImages: catalog.defaults.useReferenceImages,
      paramsElement: aiUi.h('div'),
      messageElement: aiUi.h('p', { class: 'ui-message ui-message--flush status-error', hidden: true, attrs: { role: 'alert' } })
    };
    const modelSelect = aiUi.select({
      options: catalog.models.map((model) => ({ value: String(model.id), label: model.label })),
      value: state.modelId,
      allowEmpty: false,
      ariaLabel: '模型',
      onChange: (value) => {
        state.modelId = value;
        renderParams(state);
      }
    });
    const content = aiUi.h(
      'div',
      { class: 'ui-stack asset-gen' },
      aiUi.h('p', { class: 'description', text: `为“${asset.name}”生成${noun}。` }),
      aiUi.field({ label: '模型', control: modelSelect }).element,
      state.paramsElement,
      aiUi.h('p', { class: 'description', text: COST_NOTICE }),
      state.messageElement
    );
    renderParams(state);

    // 模型清单变化后更新下拉；所选模型不再可用时改选默认模型，已关闭所有模型时在对话框里说明原因。
    let isReasonShown = false;
    refreshOpened = async () => {
      let latest;
      try {
        latest = await window.hostBridge.request(REQUEST_CATALOG, { assetId: asset.id });
      } catch {
        return;
      }
      state.catalog = latest;
      modelSelect.setOptions(latest.models.map((model) => ({ value: String(model.id), label: model.label })));
      if (!latest.models.some((model) => String(model.id) === state.modelId)) {
        state.modelId = latest.defaults.modelId === null ? '' : String(latest.defaults.modelId);
        modelSelect.setValue(state.modelId);
      }
      renderParams(state);
      if (!latest.availability.available) {
        state.messageElement.textContent = latest.availability.reason || GENERIC_ERROR_TEXT;
        state.messageElement.hidden = false;
        isReasonShown = true;
      } else if (isReasonShown) {
        state.messageElement.hidden = true;
        isReasonShown = false;
      }
    };

    const page = aiUi.openPage({
      title: `生成${noun}`,
      content,
      width: 460,
      minWidth: 360,
      buttons: [
        { id: 'cancel', text: '取消', isCancel: true },
        {
          id: 'generate',
          text: '生成',
          variant: 'primary',
          isDefault: true,
          onClick: async () => {
            state.messageElement.hidden = true;
            return (await submit(state)) ? undefined : false;
          }
        }
      ]
    });
    const result = await page.closed;
    refreshOpened = null;
    current = null;
    if (result.buttonId === 'generate' && onSubmitted) onSubmitted();
  }

  window.aiAssetGenerate = { open };
})();
