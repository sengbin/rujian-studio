// ------------------------------------------------------------------------
// 名称：stage-screenplay-list.js
// 说明：剧本阶段左侧的列表导航：剧本包正文、集、实体三组条目（可编辑时集与实体带“添加”按钮，超出参考时长容差的集标红），以及选中条目的定位规则（findItem）。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 stage-screenplay.js 拆出；对外是 window.aiScreenplayList（条目类型与新增定位值常量、findItem、render）；集与实体的 ref 由宿主给出，页面只原样回传；必须先于 stage-screenplay.js 加载。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const ADD_TEXT = '添加';
  const TYPE_TEXT = 'text';
  const TYPE_EPISODE = 'episode';
  const TYPE_ENTITY = 'entity';
  // 尚未保存的新条目用这个定位值。
  const NEW_REF = 'new';

  /** 在最新视图中找到选中的集或实体；新增中的条目返回空白内容；找不到返回 undefined。 */
  function findItem(view, current) {
    if (current.ref === NEW_REF) {
      if (current.type === TYPE_EPISODE) return { title: '', synopsis: '', screenplayText: '', targetDurationSeconds: null };
      const draft = current.draft || {};
      return { kind: current.kind, name: draft.name || '', aliases: draft.aliases || [], description: draft.description || '', attributes: {}, isActive: true };
    }
    if (current.type === TYPE_EPISODE) return view.episodes.find((episode) => episode.ref === current.ref);
    if (current.type === TYPE_ENTITY) return view.entities.find((entity) => entity.ref === current.ref);
    return view.screenplay || undefined;
  }

  /** 实体类型的界面名称。 */
  function kindLabel(view, kind) {
    const item = view.entityKinds.find((candidate) => candidate.kind === kind);
    return item ? item.label : kind;
  }

  /** 集在左侧列表里的补充文字：有参考目标时显示“实测 / 参考 秒”，否则显示目标时长。 */
  function episodeMeta(episode) {
    if (episode.reference) return `${episode.reference.actualSeconds} / ${episode.reference.targetSeconds} 秒`;
    return episode.targetDurationSeconds ? `${episode.targetDurationSeconds} 秒` : '';
  }

  /**
   * 左侧列表：剧本包正文、集、实体。
   * @param view 阶段视图。
   * @param selection 当前选中的条目：{ type, ref }。
   * @param onSelect 点击条目（或“添加”）时调用，参数是要选中的条目；有未保存的修改时由调用方先确认。
   */
  function render(view, selection, onSelect) {
    /** 左侧列表中的一个按钮；warn 为 true 时补充文字标红（超出参考容差）。 */
    function renderItem(next, title, meta, warn) {
      const isSelected = next.type === selection.type && next.ref === selection.ref;
      return aiUi.listItem(
        { selected: isSelected, className: 'stage-item', onClick: () => void onSelect(next) },
        aiUi.h('span', { class: 'stage-item__title', text: title }),
        meta ? aiUi.h('span', { class: warn ? 'stage-item__meta status-error' : 'stage-item__meta', text: meta }) : null
      );
    }

    /** 左侧列表的分组标题；可编辑时右侧带“添加”按钮。 */
    function renderHeading(text, onAdd) {
      return aiUi.h(
        'div',
        { class: 'stage-list__head' },
        aiUi.h('p', { class: 'ui-heading stage-list__heading', text }),
        onAdd ? aiUi.button({ kind: 'add', text: ADD_TEXT, compact: true, onClick: onAdd }).element : null
      );
    }

    const hasStructure = view.episodes.length > 0 || view.entities.length > 0;
    const canEdit = view.actions.canEdit;
    const isNew = (type) => selection.type === type && selection.ref === NEW_REF;
    // 单个短视频只有 1 集，不能增删集。
    const canAddEpisode = canEdit && view.work.multiEpisode;
    return aiUi.list(
      { tag: 'aside', className: 'stage-list' },
      renderItem({ type: TYPE_TEXT, ref: null }, '剧本包正文', view.screenplay ? `${view.screenplay.fullText.length} 字` : ''),
      hasStructure ? null : aiUi.h('p', { class: 'description', text: '集和实体抽取完成后会显示在这里。' }),
      hasStructure
        ? renderHeading(`集（${view.episodes.length}）`, canAddEpisode ? () => void onSelect({ type: TYPE_EPISODE, ref: NEW_REF }) : null)
        : null,
      view.episodes.map((episode) =>
        renderItem(
          { type: TYPE_EPISODE, ref: episode.ref },
          `${episode.seq}. ${episode.title}`,
          episodeMeta(episode),
          Boolean(episode.reference) && !episode.reference.withinTolerance
        )
      ),
      isNew(TYPE_EPISODE) ? renderItem({ type: TYPE_EPISODE, ref: NEW_REF }, '新增集', '未保存') : null,
      hasStructure
        ? renderHeading(
            `实体（${view.entities.length}）`,
            canEdit ? () => void onSelect({ type: TYPE_ENTITY, ref: NEW_REF, kind: view.entityKinds[0].kind }) : null
          )
        : null,
      view.entities.map((entity) =>
        renderItem({ type: TYPE_ENTITY, ref: entity.ref }, `[${kindLabel(view, entity.kind)}] ${entity.name}`, entity.isActive ? '' : '已停用')
      ),
      isNew(TYPE_ENTITY) ? renderItem({ type: TYPE_ENTITY, ref: NEW_REF }, '新增实体', '未保存') : null
    );
  }

  window.aiScreenplayList = { ADD_TEXT, TYPE_TEXT, TYPE_EPISODE, TYPE_ENTITY, NEW_REF, findItem, render };
})();
