// ------------------------------------------------------------------------
// 名称：stage-screenplay-editors.js
// 说明：剧本阶段右侧编辑区里三种条目的编辑器：剧本包正文（标题与梗概只读、正文可改）、集（标题、梗概、目标时长、本集剧本正文，原创文稿还有结构标注）、实体（名称、别名、摘要、按类型区分的设定、是否启用）。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 stage-screenplay.js 拆出；请求名称与 src/app/pages/stage-handlers.ts 一致；对外是 window.aiScreenplayEditors（buildTextEditor、buildEpisodeEditor、buildEntityEditor），每个编辑器返回 { fields, collect, refresh, request, note }，由 stage-screenplay.js 负责保存按钮、新增与删除；必须先于 stage-screenplay.js 加载。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_SAVE_TEXT = 'stage.saveScreenplayText';
  const REQUEST_SAVE_EPISODE = 'stage.saveEpisode';
  const REQUEST_SAVE_ENTITY = 'stage.saveEntity';
  // 正文按内容增高，最多长到这个行数再滚动（与阶段页的编辑区高度相当）。
  const BODY_MAX_ROWS = 20;
  const SEGMENT_KINDS = [
    { value: 'narration', label: '旁白' },
    { value: 'dialogue', label: '对白' },
    { value: 'thought', label: '心声' }
  ];
  const KIND_NARRATION = 'narration';
  const UNKNOWN_SPEAKER_LABEL = '（未知）';
  const FIDELITY_VERBATIM = 'verbatim';

  /** 带标签的字段。 */
  function field(label, control, description) {
    return aiUi.field({ label, description, control }).element;
  }

  /** 剧本包正文编辑：标题与梗概只读显示，正文可改。 */
  function buildTextEditor(view, canEdit, markDirty) {
    const fullText = aiUi.textArea({ value: view.screenplay.fullText, ariaLabel: '剧本包正文', maxRows: BODY_MAX_ROWS, disabled: !canEdit, onChange: markDirty });
    return {
      fields: [
        aiUi.h('p', { class: 'description', text: `标题：${view.screenplay.title}` }),
        aiUi.h('p', { class: 'description', text: `梗概：${view.screenplay.overview}` }),
        aiUi.h('div', { class: 'stage-editor__content' }, fullText.element)
      ],
      collect: () => ({ fullText: fullText.getValue() }),
      refresh: (latest) => fullText.setValue(latest.fullText),
      request: REQUEST_SAVE_TEXT,
      note: '正文保存后，已抽取的集和实体不会自动更新，需要时点“重新抽取”。'
    };
  }

  /**
   * 结构标注（原创文稿）：每个片段一行，可修改类型和说话人，片段文字只读；不是原稿保真的剧本不显示。
   * @returns { element, collect, refresh }，collect 返回附加到集保存请求的字段，没有标注时为空对象。
   */
  function buildSegmentsEditor(view, episode, canEdit, markDirty) {
    if (view.fidelity !== FIDELITY_VERBATIM) return null;
    const characters = view.entities.filter((entity) => entity.kind === 'character' && entity.isActive).map((entity) => entity.name);
    const note = aiUi.h('p', { class: 'description' });
    const list = aiUi.h('div', { class: 'stage-segments' });
    let rows = [];

    /** 一个片段的行：类型、说话人（旁白时隐藏）、片段文字与待核对提示。 */
    function buildRow(segment) {
      const names = segment.speaker && !characters.includes(segment.speaker) ? [...characters, segment.speaker] : characters;
      const speaker = aiUi.select({
        options: [{ value: '', label: UNKNOWN_SPEAKER_LABEL }, ...names.map((name) => ({ value: name, label: name }))],
        value: segment.speaker || '',
        allowEmpty: false,
        ariaLabel: '说话人',
        disabled: !canEdit,
        onChange: markDirty
      });
      const speakerSlot = aiUi.h('div', { class: 'stage-segment__speaker', hidden: segment.kind === KIND_NARRATION }, speaker.element);
      const kind = aiUi.select({
        options: SEGMENT_KINDS,
        value: segment.kind,
        allowEmpty: false,
        ariaLabel: '片段类型',
        disabled: !canEdit,
        onChange: () => {
          speakerSlot.hidden = kind.getValue() === KIND_NARRATION;
          markDirty();
        }
      });
      const element = aiUi.h(
        'div',
        { class: segment.uncertain ? 'stage-segment is-uncertain' : 'stage-segment' },
        aiUi.h('div', { class: 'stage-segment__kind' }, kind.element),
        speakerSlot,
        aiUi.h('p', { class: 'stage-segment__text', text: segment.text.trim() }),
        segment.uncertain ? aiUi.h('span', { class: 'status-warning stage-segment__flag', text: '待核对' }) : null
      );
      return { element, kind, speaker };
    }

    /** 用最新的标注重建列表。 */
    function refresh(latest) {
      const segments = latest.segments || [];
      list.textContent = '';
      rows = segments.map(buildRow);
      list.append(...rows.map((row) => row.element));
      const uncertain = segments.filter((segment) => segment.uncertain).length;
      note.textContent =
        segments.length === 0
          ? '本集还没有结构标注。标注在抽取集和实体后自动生成；修改本集正文并保存会清除标注。'
          : `结构标注：共 ${segments.length} 个片段${uncertain > 0 ? `，其中 ${uncertain} 个待核对` : ''}。只能修改类型和说话人，片段文字不会改变；修改上面的本集正文并保存会清除标注。`;
    }

    refresh(episode);
    return {
      element: aiUi.h('div', { class: 'stage-editor__content' }, note, list),
      collect: () => (rows.length === 0 ? {} : { segments: rows.map((row) => ({ kind: row.kind.getValue(), speaker: row.speaker.getValue() })) }),
      refresh
    };
  }

  /** 集编辑：标题、梗概、目标时长、本集剧本正文，原创文稿还有结构标注。 */
  function buildEpisodeEditor(view, episode, canEdit, markDirty) {
    const title = aiUi.textInput({ value: episode.title, disabled: !canEdit, onChange: markDirty });
    const synopsis = aiUi.textArea({ value: episode.synopsis, maxRows: 4, disabled: !canEdit, onChange: markDirty });
    const duration = aiUi.textInput({
      value: episode.targetDurationSeconds === null ? '' : String(episode.targetDurationSeconds),
      disabled: !canEdit,
      onChange: markDirty
    });
    const text = aiUi.textArea({ value: episode.screenplayText, maxRows: BODY_MAX_ROWS, disabled: !canEdit, onChange: markDirty });
    const segments = buildSegmentsEditor(view, episode, canEdit, markDirty);
    return {
      fields: [
        field('集标题', title),
        field('本集梗概', synopsis),
        field('本集目标时长（秒）', duration, '可选，正整数。分镜阶段用作本集镜头总时长上限，留空不限制；已有节拍表时以节拍表为准'),
        aiUi.h('div', { class: 'stage-editor__content' }, field('本集剧本正文', text)),
        segments ? segments.element : null
      ],
      collect: () => ({
        title: title.getValue(),
        synopsis: synopsis.getValue(),
        targetDurationSeconds: duration.getValue(),
        screenplayText: text.getValue(),
        ...(segments ? segments.collect() : {})
      }),
      refresh: (latest) => {
        title.setValue(latest.title);
        synopsis.setValue(latest.synopsis);
        duration.setValue(latest.targetDurationSeconds === null ? '' : String(latest.targetDurationSeconds));
        text.setValue(latest.screenplayText);
        if (segments) segments.refresh(latest);
      },
      request: REQUEST_SAVE_EPISODE,
      note: ''
    };
  }

  /** 实体编辑：名称、别名、摘要、按类型区分的设定、是否启用；新增时可选类型，切换类型由 onKindChange 重建编辑区。 */
  function buildEntityEditor(view, entity, canEdit, markDirty, onKindChange) {
    const kind = view.entityKinds.find((candidate) => candidate.kind === entity.kind);
    const kindControl = onKindChange
      ? aiUi.select({
          options: view.entityKinds.map((item) => ({ value: item.kind, label: item.label })),
          value: entity.kind,
          allowEmpty: false,
          ariaLabel: '实体类型',
          onChange: () => onKindChange(kindControl.getValue())
        })
      : null;
    const name = aiUi.textInput({ value: entity.name, disabled: !canEdit, onChange: markDirty });
    const aliases = aiUi.textInput({ value: entity.aliases.join('，'), disabled: !canEdit, onChange: markDirty });
    const description = aiUi.textArea({ value: entity.description, minRows: 1, maxRows: 3, disabled: !canEdit, onChange: markDirty });
    const active = aiUi.switchControl({ label: '启用', checked: entity.isActive, disabled: !canEdit, onChange: markDirty });
    const attributes = new Map(
      kind.attributes.map((attribute) => [
        attribute.key,
        // 表演与动作按情绪分条，内容长，多给几行。
        aiUi.textArea({ value: entity.attributes[attribute.key] || '', minRows: 1, maxRows: attribute.key === 'performance' ? 8 : 3, disabled: !canEdit, onChange: markDirty })
      ])
    );
    return {
      fields: [
        kindControl ? field('类型', kindControl, '切换类型会重置下面的设定字段') : aiUi.h('p', { class: 'description', text: `类型：${kind.label}（不能修改）` }),
        field('名称', name, '同类型内不能重复；改名不影响已有绑定和镜头引用'),
        field('别名', aliases, '多个别名用逗号分隔'),
        field('设定摘要', description),
        ...kind.attributes.map((attribute) => field(attribute.label, attributes.get(attribute.key))),
        active.element
      ],
      collect: () => ({
        name: name.getValue(),
        aliases: aliases.getValue(),
        description: description.getValue(),
        attributes: Object.fromEntries([...attributes].map(([key, control]) => [key, control.getValue()])),
        isActive: active.getValue()
      }),
      refresh: (latest) => {
        name.setValue(latest.name);
        aliases.setValue(latest.aliases.join('，'));
        description.setValue(latest.description);
        active.setValue(latest.isActive);
        for (const [key, control] of attributes) control.setValue(latest.attributes[key] || '');
      },
      request: REQUEST_SAVE_ENTITY,
      note: ''
    };
  }

  window.aiScreenplayEditors = { buildTextEditor, buildEpisodeEditor, buildEntityEditor };
})();
