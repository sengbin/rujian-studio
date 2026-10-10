// ------------------------------------------------------------------------
// 名称：form-runtime.js
// 说明：表单引擎：向宿主打开表单，在页内弹出页面中用界面组件库渲染控件，负责即时校验、唯一性检查、提交与放弃修改确认。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：请求名称与 src/app/forms/form-handlers.ts 一致；依赖 shared/page-format.js（pageFormat.decodeBase64，须先于本文件加载）；字段值一律以文本传输（多选为 JSON 数组文本）；页面通过 aiForm.open 使用；字段可随另一个字段的值联动：说明（descriptionByValue）、值（valueByValue）、显示与隐藏（visibleWhen，隐藏的字段不校验、提交时仍带值）、下拉选项（optionsByValue，可逐级联动）；收到 models.changed 事件（名称与 src/app/pages/model-events.ts 一致）后，向宿主重新取表单定义，更新下拉选项与说明、增删字段，保留用户已填的内容。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_OPEN = 'form.open';
  const REQUEST_CHECK_FIELD = 'form.checkField';
  const REQUEST_SUBMIT = 'form.submit';
  const REQUEST_CLOSE = 'form.close';
  const REQUEST_REFRESH = 'form.refresh';
  const EVENT_MODELS_CHANGED = 'models.changed';
  // 合并连续的模型变化事件后再刷新。
  const REFRESH_DELAY_MS = 200;

  const FORM_LEVEL_ERROR_KEY = '';
  const FORM_PAGE_WIDTH = 560;
  const FORM_PAGE_MIN_WIDTH = 400;
  const CANCEL_LABEL = '取消';
  const SUBMITTING_LABEL = '保存中…';
  const LOAD_FAILED_TITLE = '无法打开表单';
  const GENERIC_ERROR_MESSAGE = '操作失败，请重试。';
  const DISCARD_TITLE = '放弃修改';
  const DISCARD_MESSAGE = '放弃未保存的修改？';
  const DISCARD_CONFIRM_TEXT = '放弃修改';
  const DISCARD_CANCEL_TEXT = '继续编辑';
  const OVERWRITE_CONFIRM_TEXT = '覆盖';
  const OVERWRITE_CANCEL_TEXT = '保留现有内容';
  const CHOOSE_ONE_CONTROLS = ['select', 'radio'];
  // 多行文本的默认最大行数：内容只有一行时就是一行高，最多长到这个行数再滚动。
  const DEFAULT_TEXTAREA_MAX_ROWS = 4;
  // 缩略图最长边的像素数与 JPEG 质量。
  const THUMBNAIL_MAX_SIDE = 256;
  const THUMBNAIL_QUALITY = 0.82;
  const AUDIO_SAMPLE_RATE = 44100;

  /** 加载图片；无法解码时抛出带文件名的错误。 */
  function loadImage(item) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`无法读取“${item.name}”，请换一张图片。`));
      image.src = `data:${item.mimeType};base64,${item.data}`;
    });
  }

  /** 把图片缩小到最长边不超过缩略图上限（透明底色填充为白色），返回宽高与 JPEG 的 Base64 内容。 */
  function renderJpeg(image) {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY);
    return { width, height, data: url.slice(url.indexOf(',') + 1) };
  }

  /** 为图片读取宽高并生成 JPEG 缩略图。 */
  async function deriveImage(item) {
    const image = await loadImage(item);
    const { width, height, data } = renderJpeg(image);
    return { ...item, width, height, thumbnail: { mimeType: 'image/jpeg', data } };
  }

  /** 解码音频读取时长（秒）；无法解码时抛出带文件名的错误。 */
  async function deriveAudio(item) {
    try {
      const bytes = window.pageFormat.decodeBase64(item.data);
      const buffer = await new window.OfflineAudioContext(1, 1, AUDIO_SAMPLE_RATE).decodeAudioData(bytes.buffer);
      return { ...item, durationSeconds: buffer.duration };
    } catch {
      throw new Error(`无法解码“${item.name}”，请换一个文件。`);
    }
  }

  /** 提交前按字段的 derive 设置，为每个文件补充缩略图、宽高或时长。 */
  function deriveFiles(derive, items) {
    return Promise.all(items.map((item) => (derive === 'audio' ? deriveAudio(item) : deriveImage(item))));
  }

  /** 解析多选值文本为数组；无法解析时按空数组。 */
  function parseList(text) {
    try {
      const value = JSON.parse(text || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  /** 按字段描述创建控件，并说明其值的种类：text、list 或 files。 */
  function createControl(fieldSchema, initialText) {
    const options = fieldSchema.options || [];
    switch (fieldSchema.control) {
      case 'textarea':
        return {
          kind: 'text',
          control: aiUi.textArea({
            value: initialText,
            placeholder: fieldSchema.placeholder,
            minRows: 1,
            maxRows: fieldSchema.maxRows || DEFAULT_TEXTAREA_MAX_ROWS
          })
        };
      case 'select':
        return {
          kind: 'text',
          control: aiUi.select({
            options,
            value: initialText,
            allowEmpty: !fieldSchema.required,
            placeholder: fieldSchema.placeholder,
            allowCustom: Boolean(fieldSchema.allowCustom)
          })
        };
      case 'radio':
        return { kind: 'text', control: aiUi.radioGroup({ options, value: initialText }) };
      case 'checkboxes':
        return { kind: 'list', control: aiUi.checkboxGroup({ options, value: parseList(initialText) }) };
      case 'file': {
        const control = aiUi.filePicker({
          accept: fieldSchema.accept || [],
          multiple: Boolean(fieldSchema.multiple),
          maxFiles: fieldSchema.maxFiles,
          maxFileBytes: fieldSchema.maxFileBytes,
          preview: fieldSchema.preview,
          ariaLabel: fieldSchema.label
        });
        // 编辑时带出已保存的文件（与提交格式相同的 JSON 数组）。
        control.setValue(parseList(initialText));
        return { kind: 'files', control };
      }
      default:
        return { kind: 'text', control: aiUi.textInput({ value: initialText, placeholder: fieldSchema.placeholder }) };
    }
  }

  /**
   * 本地校验一个字段：必填与长度。
   * @returns {string} 错误提示；无错误返回空串。
   */
  function validateLocally(entry) {
    const fieldSchema = entry.schema;
    if (entry.kind === 'list' || entry.kind === 'files') {
      const unit = entry.kind === 'files' ? '个文件' : '项';
      return fieldSchema.required && entry.control.getValue().length === 0 ? `${fieldSchema.label}至少选择一${unit}。` : '';
    }
    const text = entry.control.getValue().trim();
    if (text.length === 0) {
      if (!fieldSchema.required) return '';
      return CHOOSE_ONE_CONTROLS.includes(fieldSchema.control) ? `${fieldSchema.label}必须选择。` : `${fieldSchema.label}不能为空。`;
    }
    if (fieldSchema.maxLength !== undefined && text.length > fieldSchema.maxLength) {
      return `${fieldSchema.label}不能超过 ${fieldSchema.maxLength} 字（当前 ${text.length} 字）。`;
    }
    return '';
  }

  /** 读取字段当前值，转换为提交用的文本。 */
  function readText(entry) {
    const value = entry.control.getValue();
    if (entry.kind === 'list' || entry.kind === 'files') return JSON.stringify(value);
    return value;
  }

  /**
   * 为一次打开的表单创建界面与状态。
   * @param {{ formId: number, schema: object, values?: object }} session 宿主返回的表单会话。
   * @param {{ onCancel: () => void, onSaved: () => void }} handlers 点“取消”与保存成功后的动作。
   * @returns {{ element: HTMLElement, isDirty: () => boolean, isSubmitting: () => boolean }}
   */
  function createForm(session, handlers) {
    const { formId, schema } = session;
    const values = session.values || {};
    /** 字段键 → 字段条目，按渲染顺序保存。 */
    const entries = new Map();
    let initialSnapshot = '';
    let isSubmitting = false;

    const summaryElement = aiUi.h('div', {
      class: 'form-error-summary status-error',
      hidden: true,
      attrs: { role: 'alert', tabindex: '-1' }
    });

    function collectValues() {
      const collected = {};
      for (const [key, entry] of entries) collected[key] = readText(entry);
      return collected;
    }

    /** 显示或清除表单顶部的错误摘要。 */
    function showSummary(message) {
      summaryElement.textContent = message;
      summaryElement.hidden = message === '';
      if (message) summaryElement.focus();
    }

    /** 字段失去焦点：先本地校验，再按需向宿主检查唯一性。 */
    async function validateOnBlur(entry) {
      const localError = validateLocally(entry);
      if (localError) {
        entry.field.setError(localError);
        return;
      }
      if (!entry.schema.checkUnique || entry.kind !== 'text') return;
      const value = entry.control.getValue().trim();
      if (value === '' || entry.uniqueCheckedValue === value) return;

      try {
        const result = await window.hostBridge.request(REQUEST_CHECK_FIELD, { formId, key: entry.schema.key, value });
        // 等待期间用户又改了内容时，丢弃过期结果。
        if (entry.control.getValue().trim() !== value) return;
        entry.uniqueCheckedValue = value;
        entry.uniqueError = result && result.error ? result.error : '';
        entry.field.setError(entry.uniqueError);
      } catch {
        // 检查失败不阻止继续填写，提交时宿主会再次校验。
      }
    }

    /** 说明文字随其他字段取值变化的字段，按来源字段的当前值更新说明。 */
    function syncDescriptions() {
      for (const entry of entries.values()) {
        const binding = entry.schema.descriptionByValue;
        const source = binding && entries.get(binding.sourceKey);
        if (!source) continue;
        const text = binding.byValue[source.control.getValue()];
        entry.field.setDescription(typeof text === 'string' ? text : entry.schema.description);
      }
    }

    /** 来源字段被用户改变后，把依赖它取值的字段换成对应的值。 */
    function syncValues(changedKey) {
      for (const entry of entries.values()) {
        const binding = entry.schema.valueByValue;
        if (!binding || binding.sourceKey !== changedKey) continue;
        const next = binding.byValue[entries.get(changedKey).control.getValue()];
        if (typeof next === 'string') entry.control.setValue(next);
      }
    }

    /** 按 visibleWhen 显示或隐藏字段：来源字段的当前值属于指定值时才显示。 */
    function syncVisibility() {
      for (const entry of entries.values()) {
        const rule = entry.schema.visibleWhen;
        if (!rule) continue;
        const source = entries.get(rule.sourceKey);
        entry.field.element.hidden = !(source && rule.values.includes(String(source.control.getValue())));
      }
    }

    /** 依赖来源字段的下拉应有的选项：按来源字段当前值取，没有对应选项时为空。 */
    function optionsFor(rule) {
      const source = entries.get(rule.sourceKey);
      return rule.byValue[source ? String(source.control.getValue()) : ''] || [];
    }

    /** 用来源字段当前值对应的选项替换下拉选项；原来所选的值不在新选项里时清空，字段声明了 followsFirstOption 则改选新的第一项。 */
    function replaceOptions(entry, rule) {
      const nextOptions = optionsFor(rule);
      entry.control.setOptions(nextOptions);
      if (entry.schema.followsFirstOption && entry.control.getValue() === '' && nextOptions.length > 0) entry.control.setValue(nextOptions[0]);
    }

    /** 来源字段变化后，更换依赖它的下拉选项，并让再下一级的字段继续跟着变。 */
    function syncOptions(changedKey) {
      for (const entry of entries.values()) {
        const rule = entry.schema.optionsByValue;
        if (!rule || rule.sourceKey !== changedKey) continue;
        replaceOptions(entry, rule);
        entry.field.setError('');
        syncOptions(entry.schema.key);
      }
    }

    /** 按每个来源字段的当前值重算全部联动下拉的选项；字段按渲染顺序排列，来源总在依赖它的字段之前。 */
    function syncAllOptions() {
      for (const entry of entries.values()) {
        const rule = entry.schema.optionsByValue;
        if (rule) replaceOptions(entry, rule);
      }
    }

    /** 渲染一个字段并登记条目。 */
    function renderField(fieldSchema, initialText) {
      const { kind, control } = createControl(fieldSchema, initialText);
      if (fieldSchema.disabled) control.setDisabled(true);
      const field = aiUi.field({
        label: fieldSchema.label,
        description: fieldSchema.description,
        required: fieldSchema.required,
        control
      });
      const entry = { schema: fieldSchema, kind, control, field, uniqueError: '', uniqueCheckedValue: null };
      entries.set(fieldSchema.key, entry);

      // 内容变化后，此前的错误不再适用，等下次失去焦点或提交时重新校验。
      control.onChange(() => {
        entry.uniqueError = '';
        entry.uniqueCheckedValue = null;
        field.setError('');
        syncDescriptions();
        syncValues(fieldSchema.key);
        syncOptions(fieldSchema.key);
        syncVisibility();
      });
      // 焦点在字段内部的控件之间移动时不算离开字段。
      field.element.addEventListener('focusout', (event) => {
        if (event.relatedTarget && field.element.contains(event.relatedTarget)) return;
        // 焦点移向“取消”时不校验，避免关闭前闪现错误提示。
        if (event.relatedTarget && event.relatedTarget === cancelButton.element) return;
        void validateOnBlur(entry);
      });
      return field.element;
    }

    /** 校验全部字段，返回有错误的字段条目；被 visibleWhen 隐藏的字段不校验。 */
    function validateAll() {
      const invalid = [];
      for (const entry of entries.values()) {
        if (entry.field.element.hidden) {
          entry.field.setError('');
          continue;
        }
        const message = validateLocally(entry) || entry.uniqueError;
        entry.field.setError(message);
        if (message) invalid.push(entry);
      }
      return invalid;
    }

    /** 应用宿主返回的错误。 */
    function applyServerError(error) {
      const fieldErrors = (error && error.fieldErrors) || {};
      let hasFieldError = false;
      for (const [key, message] of Object.entries(fieldErrors)) {
        const entry = entries.get(key);
        if (entry) {
          entry.field.setError(message);
          hasFieldError = true;
        }
      }
      const summary = fieldErrors[FORM_LEVEL_ERROR_KEY] || (!hasFieldError && error && error.message) || '';
      showSummary(hasFieldError && !summary ? '请修改标出的字段后重新保存。' : summary || GENERIC_ERROR_MESSAGE);
    }

    const cancelButton = aiUi.button({ text: CANCEL_LABEL, onClick: handlers.onCancel });
    // 没有额外提交按钮时只有一个提交按钮；有时主按钮负责回车提交，其他按钮点击提交。
    const submitSchemas =
      schema.submitActions && schema.submitActions.length > 0 ? schema.submitActions : [{ key: '', label: schema.submitLabel, primary: true }];
    const defaultSubmit = submitSchemas.find((action) => action.primary) || submitSchemas[submitSchemas.length - 1];
    const submitButtons = submitSchemas.map((action) => ({
      action,
      button: aiUi.button({
        text: action.label,
        // 非主按钮按 tone 选强调色（如“accent”警示黄），不填仍是默认的次要灰。
        variant: action.primary ? 'primary' : action.tone || 'secondary',
        type: action === defaultSubmit ? 'submit' : 'button',
        disabled: action.disabled === true,
        onClick: action === defaultSubmit ? undefined : () => void handleSubmit(action)
      })
    }));

    /** 切换提交中状态：禁止重复提交，当前按钮显示“保存中…”；永久禁用的按钮提交结束后保持禁用。 */
    function setSubmitting(value, activeAction) {
      isSubmitting = value;
      for (const { action, button } of submitButtons) {
        button.setDisabled(value || action.disabled === true);
        button.setText(value && action === activeAction ? SUBMITTING_LABEL : action.label);
      }
    }

    /** 所选提交按钮要求覆盖确认时，目标字段已有内容则询问；返回是否继续提交。 */
    async function confirmSubmitOverwrite(action) {
      const overwrite = action.confirmOverwrite;
      if (!overwrite) return true;
      const filled = overwrite.fields.length === 0 || overwrite.fields.some((key) => entries.has(key) && String(entries.get(key).control.getValue()).trim() !== '');
      if (!filled) return true;
      return aiUi.confirm({
        title: overwrite.title,
        message: overwrite.message,
        confirmText: overwrite.confirmText || OVERWRITE_CONFIRM_TEXT,
        cancelText: OVERWRITE_CANCEL_TEXT
      });
    }

    /** 校验并提交：成功后由页面关闭弹出页面；失败时保留输入并显示错误。 */
    async function handleSubmit(action) {
      if (isSubmitting) return;
      showSummary('');
      // 文件还在读取时先等它读完，避免提交不完整的内容。
      await Promise.all([...entries.values()].map((entry) => (entry.control.whenReady ? entry.control.whenReady() : undefined)));
      const invalid = validateAll();
      if (invalid.length > 0) {
        showSummary(`有 ${invalid.length} 项需要修改，请检查标出的字段。`);
        invalid[0].control.focus();
        return;
      }
      if (!(await confirmSubmitOverwrite(action))) return;
      setSubmitting(true, action);
      try {
        // 需要补充文件信息的字段（缩略图、宽高、时长）：读取失败时标在字段上，不提交。
        const submitted = collectValues();
        for (const [key, entry] of entries) {
          if (entry.kind !== 'files' || !entry.schema.derive) continue;
          try {
            submitted[key] = JSON.stringify(await deriveFiles(entry.schema.derive, entry.control.getValue()));
          } catch (error) {
            setSubmitting(false);
            entry.field.setError((error && error.message) || GENERIC_ERROR_MESSAGE);
            showSummary('有 1 项需要修改，请检查标出的字段。');
            return;
          }
        }
        await window.hostBridge.request(REQUEST_SUBMIT, { formId, values: submitted, submitKey: action.key });
        // 保持禁用直到弹出页面关闭，避免重复提交。
        handlers.onSaved();
      } catch (error) {
        setSubmitting(false);
        applyServerError(error);
      }
    }

    /** 提交按钮的说明文字：渲染在整行按钮上方，带提示图标；没有说明的按钮不出现在这里。 */
    const actionNotes = submitButtons
      .filter((item) => item.action.note)
      .map((item) =>
        aiUi.h(
          'p',
          { class: 'form-actions-note' },
          aiUi.icon('info-circle', 'form-actions-note__icon'),
          aiUi.h('span', { text: item.action.note })
        )
      );

    /** 说明文字和按钮行：字段总是插在它们之前。 */
    const footerElements = [
      actionNotes.length > 0 ? aiUi.h('div', { class: 'form-actions-notes' }, actionNotes) : null,
      aiUi.h('div', { class: 'form-actions' }, cancelButton.element, submitButtons.map((item) => item.button.element))
    ];

    /** 选项或说明变化的下拉字段：更换选项、保留仍有效的所选值，否则改选宜方的新初始值。 */
    function refreshSelect(entry, fieldSchema, nextValues, snapshot) {
      if (entry.schema.control !== 'select' || fieldSchema.control !== 'select') return;
      // 选项随来源字段变化的下拉：只更新定义与说明，选项稍后统一按来源字段的当前值重算。
      if (entry.schema.optionsByValue || fieldSchema.optionsByValue) {
        entry.schema = fieldSchema;
        entry.field.setDescription(fieldSchema.description);
        return;
      }
      const oldOptions = entry.schema.options || [];
      const nextOptions = fieldSchema.options || [];
      const sameOptions = oldOptions.length === nextOptions.length && oldOptions.every((option, index) => option === nextOptions[index]);
      if (sameOptions && entry.schema.description === fieldSchema.description) return;
      entry.schema = fieldSchema;
      entry.field.setDescription(fieldSchema.description);
      if (sameOptions) return;

      const oldValue = entry.control.getValue();
      entry.control.setOptions(nextOptions);
      const keepsValue = nextOptions.includes(oldValue) || fieldSchema.allowCustom || (oldValue === '' && !fieldSchema.required);
      if (keepsValue) return;
      const nextValue = fieldSchema.followsFirstOption && oldValue === oldOptions[0] ? nextOptions[0] : nextValues[fieldSchema.key] || '';
      entry.control.setValue(nextValue);
      entry.field.setError('');
      snapshot[fieldSchema.key] = nextValue;
    }

    /** 按宿主重新生成的表单定义刷新：更新下拉选项，字段增减时增删并重排；用户已填的内容和“是否有修改”的判断不受影响。 */
    function applyRefresh(latest) {
      const nextValues = latest.values || {};
      const snapshot = JSON.parse(initialSnapshot);
      const previousKeys = [...entries.keys()];
      const ordered = new Map();
      for (const fieldSchema of latest.schema.fields) {
        const existing = entries.get(fieldSchema.key);
        if (existing === undefined) {
          renderField(fieldSchema, nextValues[fieldSchema.key] || '');
          ordered.set(fieldSchema.key, entries.get(fieldSchema.key));
        } else {
          refreshSelect(existing, fieldSchema, nextValues, snapshot);
          ordered.set(fieldSchema.key, existing);
        }
      }
      for (const key of previousKeys) {
        if (ordered.has(key)) continue;
        entries.get(key).field.element.remove();
      }
      const nextKeys = [...ordered.keys()];
      const isRestructured = nextKeys.length !== previousKeys.length || nextKeys.some((key, index) => key !== previousKeys[index]);
      entries.clear();
      for (const [key, entry] of ordered) entries.set(key, entry);
      if (isRestructured) {
        // 已在页面里的元素重新插入会被移动，按新顺序逐个插到说明和按钮行之前。
        const anchor = footerElements.find(Boolean);
        for (const entry of entries.values()) form.insertBefore(entry.field.element, anchor);
      }
      const rebuilt = {};
      for (const [key, entry] of entries) rebuilt[key] = key in snapshot ? snapshot[key] : readText(entry);
      initialSnapshot = JSON.stringify(rebuilt);
      syncDescriptions();
      syncAllOptions();
      syncVisibility();
    }

    let refreshSerial = 0;
    /** 可用模型变化后向宿主要最新的表单定义并应用；读取失败（如作品已删除）或正在提交时保持原样。 */
    async function refresh() {
      if (isSubmitting) return;
      const serial = ++refreshSerial;
      let latest;
      try {
        latest = await window.hostBridge.request(REQUEST_REFRESH, { formId });
      } catch {
        return;
      }
      if (serial !== refreshSerial || isSubmitting) return;
      applyRefresh(latest);
    }

    const form = aiUi.h(
      'form',
      {
        attrs: { novalidate: 'novalidate' },
        on: {
          submit: (event) => {
            event.preventDefault();
            if (defaultSubmit.disabled === true) return;
            void handleSubmit(defaultSubmit);
          }
        }
      },
      schema.fields.map((fieldSchema) => renderField(fieldSchema, values[fieldSchema.key] || '')),
      // 说明文字在上面单独一块，按钮都在下面同一行（取消 + 全部提交按钮），不再按是否有说明拆成两行。
      footerElements
    );
    const element = aiUi.h('div', {}, summaryElement, form);
    syncDescriptions();
    syncVisibility();
    initialSnapshot = JSON.stringify(collectValues());

    return {
      element,
      isDirty: () => JSON.stringify(collectValues()) !== initialSnapshot,
      isSubmitting: () => isSubmitting,
      refresh
    };
  }

  /** 提交中不允许关闭；有修改时用页内确认框询问是否放弃，返回 true 表示可以关闭。 */
  async function confirmDiscard(form) {
    if (form.isSubmitting()) return false;
    if (!form.isDirty()) return true;
    return aiUi.confirm({
      title: DISCARD_TITLE,
      message: DISCARD_MESSAGE,
      confirmText: DISCARD_CONFIRM_TEXT,
      cancelText: DISCARD_CANCEL_TEXT,
      variant: 'danger'
    });
  }

  /**
   * 打开表单：向宿主请求表单会话，成功后弹出页面；点“取消”、右上角 × 或按 Esc 时，有修改先确认放弃。
   * @param {{ form: string, params?: unknown }} options 表单名称与打开参数（如编辑时的 { id }）。
   * @returns {Promise<boolean>} 弹出页面关闭后 resolve：已保存为 true，否则为 false；表单打开失败时提示并返回 false。
   */
  async function open(options) {
    let session;
    try {
      session = await window.hostBridge.request(REQUEST_OPEN, { form: options.form, params: options.params });
    } catch (error) {
      await aiUi.alert({ title: LOAD_FAILED_TITLE, message: (error && error.message) || GENERIC_ERROR_MESSAGE });
      return false;
    }

    let isSaved = false;
    /** 弹出页面的句柄；按钮回调只在页面创建后才会被触发。 */
    let page = null;
    const form = createForm(session, {
      onCancel: () => void page.requestClose('cancel'),
      onSaved: () => {
        isSaved = true;
        page.close('button');
      }
    });
    page = aiUi.openPage({
      title: session.schema.title,
      content: form.element,
      width: FORM_PAGE_WIDTH,
      minWidth: FORM_PAGE_MIN_WIDTH,
      beforeClose: () => confirmDiscard(form)
    });
    openForms.add(form);
    await page.closed;
    openForms.delete(form);
    // 已提交的会话宿主已释放；这里通知宿主释放未提交的会话，失败不影响界面。
    window.hostBridge.request(REQUEST_CLOSE, { formId: session.formId }).catch(() => undefined);
    return isSaved;
  }

  /** 当前打开着的表单，可用模型变化时逐个刷新。 */
  const openForms = new Set();
  let refreshTimer = 0;
  window.hostBridge.onEvent(EVENT_MODELS_CHANGED, () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      for (const form of [...openForms]) void form.refresh();
    }, REFRESH_DELAY_MS);
  });

  window.aiForm = { open };
})();
