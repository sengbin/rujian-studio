// ------------------------------------------------------------------------
// 名称：stage-storyboard.js
// 说明：分镜脚本阶段的产出内容（工作区布局）：头部汇总、左侧镜头导航、右侧镜头编辑区（“调度”“镜头”“画面与声音”三个页签）、底部保存与前后切换，以及生成结束后的汇总。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：向 stage.js 的外壳登记；页签内容由 stage-storyboard-panels.js（aiStoryboardPanels）提供，必须先于本文件加载；样式在 stage-storyboard.css；请求名称与 src/app/pages/stage-handlers.ts、表单名称与 src/app/forms/storyboard-form.ts 一致；镜头的 ref 就是镜头标识，页面原样回传；支持在末尾新增、删除镜头以及与相邻镜头互换位置（上移、下移）；打开时可由 aiStage.open 的 focus 参数（镜头标识）定位到所选镜头：选中、滚动到可见；头部“分镜动画”与镜头编辑区“从此镜头预览”打开 stage-storyboard-preview.js 提供的预览层（aiStoryboardPreview.open，点击时才取用）。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_SAVE_SHOT = 'stage.saveShot';
  const REQUEST_READ_FIRST_FRAME = 'stage.readShotFirstFrame';
  const REQUEST_ADD_SHOT = 'stage.addShot';
  const REQUEST_DELETE_SHOT = 'stage.deleteShot';
  const REQUEST_MOVE_SHOT = 'stage.moveShot';
  const FORM_START = 'storyboard.start';
  const ADD_TEXT = '添加';
  const SAVE_TEXT = '保存镜头';
  const CREATE_TEXT = '添加镜头';
  const STATE_SAVED_TEXT = '已保存';
  const STATE_DIRTY_TEXT = '有未保存的修改';
  const STATE_NEW_TEXT = '新镜头，尚未保存';
  // 尚未保存的新镜头用这个标识。
  const NEW_SHOT = 'new';
  // 新镜头的默认时长（秒），生成时设了最短时长则取最短时长。
  const NEW_SHOT_SECONDS = 3;
  // 导航里镜头序号的位数，不足补 0。短剧镜头数通常不超过三位数，固定按三位数显示。
  const SHOT_NUMBER_WIDTH = 3;
  const TAB_BLOCKING = 'blocking';
  const TAB_SHOT = 'shot';
  const TAB_CONTENT = 'content';
  // 弹出页面的默认大小（像素），超出窗口时由组件库限制。
  const PAGE_WIDTH = 1200;
  const PAGE_HEIGHT = 780;
  /** 汇总里镜头连贯策略的文字。 */
  const CONTINUITY_LABELS = { cut: '组间硬切', none: '无', prev_tail: '尾帧接首帧', ai: '由 AI 判断是否接尾帧' };
  /** 还没有完整镜头的状态，这些状态下不能预览分镜动画。 */
  const PREVIEW_UNAVAILABLE_DISPLAYS = ['running', 'failed', 'canceled'];

  const panels = window.aiStoryboardPanels;

  /** 分镜动画是否可用：有镜头且生成已经结束。 */
  function canPreview(view) {
    return view.shots.length > 0 && !PREVIEW_UNAVAILABLE_DISPLAYS.includes(view.run.display);
  }

  /** 打开分镜动画预览；查看的是历史版本时预览该版本，否则始终预览最新版本。shotId 省略时从第 1 镜开始。 */
  function openPreview(view, shotId) {
    window.aiStoryboardPreview.open({
      workId: view.work.id,
      episodeId: view.episode.id,
      runId: view.versions[0].id === view.run.id ? null : view.run.id,
      shotId: shotId === undefined ? null : shotId
    });
  }

  /** 秒数显示：整数不带小数点。 */
  function formatSeconds(seconds) {
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} 秒`;
  }

  /** 镜头所在的镜头组；还没有分组时为 undefined。 */
  function findGroup(view, shot) {
    return (view.groups || []).find((group) => group.shotIds.includes(shot.id));
  }

  /** 汇总里的一项：说明文字加加粗的数值。 */
  function summaryItem(prefix, value, suffix = '') {
    return aiUi.h('span', { class: 'storyboard-summary__item' }, prefix, aiUi.h('strong', { text: value }), suffix);
  }

  /** 不能编辑时的原因。 */
  function readonlyReason(view) {
    const { run, actions } = view;
    if (actions.canEdit) return '';
    if (run.display === 'running') return '生成中，暂不能编辑。';
    if (run.display === 'failed' || run.display === 'canceled') return '生成尚未成功，暂不能编辑。';
    return '历史版本只读；如需修改，请切换到最新版本。';
  }

  /** 导航里的一个镜头按钮：序号、画面描述（过长时省略）与附加信息；isCurrent 为 true 时带当前标记。 */
  function createShotButton({ number, title, meta, isCurrent, label, onClick }) {
    return aiUi.h(
      'button',
      { class: 'storyboard-shot', attrs: { type: 'button', 'aria-current': isCurrent ? 'true' : undefined, 'aria-label': label }, on: { click: onClick } },
      aiUi.h('span', { class: 'storyboard-shot__number', text: String(number).padStart(SHOT_NUMBER_WIDTH, '0') }),
      aiUi.h('span', { class: 'storyboard-shot__copy' }, aiUi.h('span', { class: 'storyboard-shot__title', text: title }), aiUi.h('span', { class: 'storyboard-shot__meta', text: meta }))
    );
  }

  /**
   * 页签栏与对应的面板：面板一次创建，切换时只显示、隐藏，各页签里的输入因此保持原样；支持左右方向键、Home、End 切换。
   * @param items 页签 [{ id, label, count?, content }]：count 是跟在文字后的元素，content 是面板内容。
   * @param activeId 初始选中的页签。
   * @param onSelect 选中页签后调用，参数为页签标识。
   * @returns { tablist, panels }。
   */
  function createTabs(items, activeId, onSelect) {
    const tabs = items.map((item) => {
      const tabId = aiUi.uid('storyboard-tab');
      const panelId = aiUi.uid('storyboard-panel');
      return {
        id: item.id,
        button: aiUi.h(
          'button',
          { class: 'ui-tab storyboard-tab', attrs: { type: 'button', role: 'tab', id: tabId, 'aria-controls': panelId } },
          item.label,
          item.count
        ),
        panel: aiUi.h('div', { class: 'storyboard-panel', attrs: { role: 'tabpanel', id: panelId, 'aria-labelledby': tabId, tabindex: '0' } }, item.content)
      };
    });

    /** 只显示选中的页签面板，其余隐藏；只有选中的页签在键盘 Tab 顺序里。 */
    function activate(id) {
      for (const tab of tabs) {
        const isActive = tab.id === id;
        tab.button.setAttribute('aria-selected', String(isActive));
        tab.button.tabIndex = isActive ? 0 : -1;
        tab.panel.hidden = !isActive;
      }
      onSelect(id);
    }

    tabs.forEach((tab, index) => {
      tab.button.addEventListener('click', () => activate(tab.id));
      tab.button.addEventListener('keydown', (event) => {
        let target;
        if (event.key === 'ArrowLeft') target = tabs[(index - 1 + tabs.length) % tabs.length];
        else if (event.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length];
        else if (event.key === 'Home') target = tabs[0];
        else if (event.key === 'End') target = tabs[tabs.length - 1];
        else return;
        event.preventDefault();
        activate(target.id);
        target.button.focus();
      });
    });
    activate(activeId);
    return {
      tablist: aiUi.h('div', { class: 'ui-tabs storyboard-tabs', attrs: { role: 'tablist', 'aria-label': '镜头信息类别' } }, tabs.map((tab) => tab.button)),
      panels: tabs.map((tab) => tab.panel)
    };
  }

  /**
   * 创建分镜脚本阶段的内容。
   * @param context 外壳提供的 { runAction, showMessage, reload, getView, confirmDiscard }。
   */
  function create(context) {
    /** 当前选中的镜头标识；为 null 时选第一个。 */
    let selectedId = null;
    /** 打开时要定位的镜头标识；视图加载完成后的第一次渲染选中它并滚动到可见，之后清空。 */
    let pendingFocusId = null;
    /** 当前选中的页签；切换镜头后沿用。 */
    let selectedTab = TAB_BLOCKING;
    /** 编辑器当前对应的“版本:镜头:权限”，用来判断切换后是否需要重建。 */
    let editorKey = '';
    /** 编辑器创建时镜头内容的快照，用于判断宿主数据是否变了。 */
    let editorSignature = '';
    let editorDirty = false;
    let editorControls = null;
    let bodyContainer = null;

    /** 生成结束后的汇总：镜头数、总时长、分组与生成参数。 */
    function renderSummary(view) {
      if (view.shots.length === 0) return null;
      const { params, groups } = view;
      const items = [summaryItem('', String(view.shots.length), ' 个镜头'), summaryItem('总时长 ', formatSeconds(view.totalSeconds))];
      const { reference } = view;
      if (reference) {
        // 有节拍表时：参考目标、实测值与偏差；超出容差说明已达到自动重写上限，标红提示。
        const percent = Math.round(reference.deviationRatio * 100);
        const text = `参考 ${formatSeconds(reference.targetSeconds)}，偏差 ${percent > 0 ? '+' : ''}${percent}%（容差 ±${Math.round(reference.toleranceRatio * 100)}%）`;
        items.push(
          reference.withinTolerance
            ? summaryItem('', text)
            : aiUi.h('span', { class: 'storyboard-summary__item status-error', text: `${text}，已自动重写 ${reference.maxCalibrationRounds} 轮仍超出容差（已达上限），请检查或手动调整镜头时长` })
        );
      }
      if (groups && groups.length > 0) {
        items.push(summaryItem('分为 ', `${groups.length} 组`), summaryItem('单组最长 ', `${view.groupMaxSeconds} 秒`));
      }
      if (params) {
        items.push(summaryItem('声音 ', params.audioMode === 'none' ? '无声' : '含声音条目'));
        const continuity = CONTINUITY_LABELS[params.continuity];
        if (continuity) items.push(summaryItem('镜头连贯 ', continuity));
      }
      return aiUi.h('div', { class: 'storyboard-summary' }, items);
    }

    /** 选择镜头；有未保存的修改时先确认。 */
    async function select(id) {
      if (id === selectedId) return;
      if (!(await context.confirmDiscard())) return;
      editorDirty = false;
      selectedId = id;
      renderBody(context.getView(), bodyContainer);
    }

    /** 把导航中选中的镜头滚动到可见（导航自身有滚动条，镜头多时选中项可能在视口外）。 */
    function scrollSelectedIntoView() {
      const selected = bodyContainer && bodyContainer.querySelector('.storyboard-shot[aria-current="true"]');
      if (selected) selected.scrollIntoView({ block: 'nearest' });
    }

    /** 选中指定镜头并滚动到可见；镜头不在当前版本里，或用户选择保留未保存的修改时不变。 */
    async function focusShot(shotId) {
      if (!context.getView().shots.some((shot) => shot.id === shotId)) return;
      await select(shotId);
      if (selectedId === shotId) scrollSelectedIntoView();
    }

    /** 定位到指定镜头：视图已加载时立即定位，否则记下来，等第一次渲染时定位。 */
    function focus(shotId) {
      if (context.getView() === null) {
        pendingFocusId = shotId;
        return;
      }
      void focusShot(shotId);
    }

    /** 某个镜头上的组间衔接提醒。 */
    function noticesOf(view, shotId) {
      return (view.cutNotices || []).filter((notice) => notice.shotId === shotId);
    }

    /** 左侧导航：标题行（可编辑时带“添加”按钮）与镜头按钮，新增中的镜头排在末尾。 */
    function renderNav(view) {
      const items = view.shots.map((shot) => {
        const group = findGroup(view, shot);
        const duration = formatSeconds(shot.durationSeconds);
        const meta = [group ? `第 ${group.seq} 组` : '', duration, shot.sounds.length > 0 ? `${shot.sounds.length} 条声音` : '', noticesOf(view, shot.id).length > 0 ? '衔接提醒' : ''].filter(Boolean);
        return createShotButton({
          number: shot.seq,
          title: shot.prompt,
          meta: meta.join(' · '),
          isCurrent: shot.id === selectedId,
          label: `第 ${shot.seq} 镜，${shot.prompt}，${duration}`,
          onClick: () => void select(shot.id)
        });
      });
      if (selectedId === NEW_SHOT) {
        const number = view.shots.length + 1;
        items.push(createShotButton({ number, title: '新增镜头', meta: '未保存', isCurrent: true, label: `第 ${number} 镜，新增镜头，未保存`, onClick: () => undefined }));
      }
      return aiUi.h(
        'aside',
        { class: 'storyboard-nav' },
        aiUi.h(
          'div',
          { class: 'storyboard-nav__head' },
          aiUi.h('h2', { class: 'storyboard-nav__title', text: `镜头（${view.shots.length}）` }),
          view.actions.canEdit ? aiUi.button({ kind: 'add', text: ADD_TEXT, compact: true, onClick: () => void select(NEW_SHOT) }).element : null
        ),
        aiUi.h('div', { class: 'storyboard-nav__list', attrs: { role: 'group', 'aria-label': '本集全部镜头' } }, items)
      );
    }

    /** 保存当前镜头（新增中的镜头则添加）；已确认的版本被编辑时先提示会回到待确认。 */
    async function save() {
      const view = context.getView();
      const isNew = selectedId === NEW_SHOT;
      if (view.actions.editNeedsConfirm) {
        const confirmed = await aiUi.confirm({
          title: isNew ? '添加镜头' : '保存修改',
          message: `该版本已确认采用。${isNew ? '添加' : '保存'}后将回到待确认，需要重新确认。`,
          confirmText: isNew ? '添加' : '保存',
          cancelText: '取消'
        });
        if (!confirmed) return;
      }
      const payload = { id: view.run.id, ...editorControls.collect() };
      if (!isNew) payload.ref = selectedId;
      const result = await context.runAction(isNew ? REQUEST_ADD_SHOT : REQUEST_SAVE_SHOT, payload);
      if (result) {
        editorDirty = false;
        // 新增成功后选中刚加入的镜头。
        if (isNew) selectedId = result.ref;
        await context.reload();
        // 重新加载后编辑区会按最新内容重建，保存状态要在重建后再设置。
        if (editorControls) editorControls.setDirty(false);
        context.showMessage(isNew ? '已添加。' : '已保存。', false);
      }
    }

    /** 删除当前镜头；先确认，并说明影响范围。 */
    async function remove() {
      const view = context.getView();
      const shot = view.shots.find((candidate) => candidate.id === selectedId);
      const lines = [`删除第 ${shot.seq} 个镜头及其声音后，后面的镜头序号会前移。`];
      if (view.actions.editNeedsConfirm) lines.push('该版本已确认采用，删除后将回到待确认。');
      const confirmed = await aiUi.confirm({ title: '删除镜头', message: lines, confirmText: '删除', variant: 'danger' });
      if (!confirmed) return;
      if (await context.runAction(REQUEST_DELETE_SHOT, { id: view.run.id, ref: shot.id })) {
        editorDirty = false;
        selectedId = null;
        await context.reload();
        context.showMessage('已删除。', false);
      }
    }

    /** 把当前镜头与前一个（up）或后一个（down）镜头互换位置；有未保存的修改时先确认放弃，已确认的版本先提示会回到待确认。 */
    async function move(direction) {
      const view = context.getView();
      const index = view.shots.findIndex((candidate) => candidate.id === selectedId);
      const other = view.shots[index + (direction === 'up' ? -1 : 1)];
      if (index < 0 || !other) return;
      if (!(await context.confirmDiscard())) return;
      if (view.actions.editNeedsConfirm) {
        const confirmed = await aiUi.confirm({
          title: '调整镜头顺序',
          message: '该版本已确认采用。调整顺序后将回到待确认，需要重新确认。',
          confirmText: '调整',
          cancelText: '取消'
        });
        if (!confirmed) return;
      }
      const crossesGroups = findGroup(view, view.shots[index]) !== findGroup(view, other);
      if (await context.runAction(REQUEST_MOVE_SHOT, { id: view.run.id, ref: selectedId, direction })) {
        editorDirty = false;
        await context.reload();
        context.showMessage(crossesGroups ? '已调整顺序；两个镜头所在的镜头组一并互换。' : '已调整顺序。', false);
      }
    }

    /** 新增镜头的空白内容：接在末尾，默认不指定首帧。 */
    function blankShot(view) {
      return {
        id: NEW_SHOT,
        seq: view.shots.length + 1,
        sceneLabel: '',
        shotSize: '',
        cameraAngle: '',
        cameraMovement: '',
        durationSeconds: (view.params && view.params.minShotSeconds) || NEW_SHOT_SECONDS,
        transition: '',
        continuityNote: '',
        firstFrameMode: panels.FIRST_FRAME_NONE,
        firstFrameAssetId: null,
        firstFrameImage: null,
        entityIds: [],
        staging: [],
        sounds: [],
        prompt: ''
      };
    }

    /** 编辑区顶部：镜头标题、所属组与时长，右侧依次是保存状态、上移、下移、删除。 */
    function createTopline(view, shot, { isNew, canEdit }, stateElement) {
      const group = findGroup(view, shot);
      const durationTag = aiUi.h('span', { class: 'storyboard-tag', text: formatSeconds(shot.durationSeconds) });
      const notices = isNew ? [] : noticesOf(view, shot.id);
      const index = view.shots.findIndex((candidate) => candidate.id === shot.id);
      const canMove = canEdit && !isNew;
      // 至少保留 1 个镜头。
      const canRemove = canMove && view.shots.length > 1;
      const element = aiUi.h(
        'div',
        { class: 'storyboard-editor__top' },
        aiUi.h(
          'div',
          { class: 'storyboard-editor__heading' },
          aiUi.h('h2', { class: 'storyboard-editor__title', text: shot.sceneLabel ? `第 ${shot.seq} 镜 · ${shot.sceneLabel}` : `第 ${shot.seq} 镜` }),
          group ? aiUi.h('span', { class: 'storyboard-tag', text: `第 ${group.seq} 组` }) : null,
          durationTag
        ),
        aiUi.h(
          'div',
          { class: 'storyboard-editor__tools' },
          stateElement,
          isNew ? null : aiUi.button({ text: '从此镜头预览', icon: 'movie', compact: true, disabled: !canPreview(view), onClick: () => openPreview(view, shot.id) }).element,
          canMove ? aiUi.button({ text: '上移', compact: true, disabled: index === 0, onClick: () => void move('up') }).element : null,
          canMove ? aiUi.button({ text: '下移', compact: true, disabled: index === view.shots.length - 1, onClick: () => void move('down') }).element : null,
          canRemove ? aiUi.button({ kind: 'delete', text: '删除', compact: true, onClick: () => void remove() }).element : null
        ),
        notices.length > 0
          ? aiUi.h(
              'div',
              { class: 'storyboard-editor__notices', attrs: { role: 'status' } },
              notices.map((notice) => aiUi.h('p', { class: 'storyboard-editor__notice', text: notice.text }))
            )
          : null
      );
      return { element, durationTag };
    }

    /** 右侧编辑区：切换镜头时重建；同一镜头有未保存的修改时保留输入。 */
    function renderEditor(view, shot) {
      const canEdit = view.actions.canEdit;
      const isNew = shot.id === NEW_SHOT;
      const key = `${view.run.id}:${shot.id}:${canEdit}:${view.actions.editNeedsConfirm}:${JSON.stringify(noticesOf(view, shot.id))}`;
      const signature = JSON.stringify(shot);
      if (editorControls && editorKey === key && (editorDirty || editorSignature === signature)) return editorControls.element;

      editorKey = key;
      editorSignature = signature;
      editorDirty = false;
      const saveButton = aiUi.button({ text: isNew ? CREATE_TEXT : SAVE_TEXT, variant: 'primary', disabled: !isNew, onClick: () => void save() });
      const stateElement = aiUi.h('span', { class: 'storyboard-editor__state', attrs: { role: 'status' }, hidden: !canEdit });
      /** 保存按钮只在有修改时可点；新增的镜头始终可点“添加镜头”。 */
      const setDirty = (isDirty) => {
        stateElement.textContent = isNew ? STATE_NEW_TEXT : isDirty ? STATE_DIRTY_TEXT : STATE_SAVED_TEXT;
        stateElement.classList.toggle('is-dirty', isNew || isDirty);
        saveButton.setDisabled(!isNew && !isDirty);
      };
      const markDirty = () => {
        editorDirty = true;
        setDirty(true);
      };

      const blockingCountElement = aiUi.h('span', { class: 'ui-tab__count storyboard-tab__count' });
      const contentCountElement = aiUi.h('span', { class: 'ui-tab__count storyboard-tab__count' });
      /** 页签文字后的实体、站位、声音数量。 */
      const refreshCount = () => {
        blockingCountElement.textContent = `（${blocking.describe()}）`;
        contentCountElement.textContent = `（${content.describe()}）`;
      };
      const onChange = () => {
        markDirty();
        refreshCount();
      };
      const blocking = panels.buildBlockingPanel(view, shot, canEdit, onChange);
      const shotPanel = panels.buildShotPanel(
        view,
        shot,
        canEdit,
        markDirty,
        // 预览已保存的首帧图片：宿主从本地文件读出后以 Base64 返回。
        (shotId) => context.call(REQUEST_READ_FIRST_FRAME, { id: view.run.id, ref: shotId })
      );
      const content = panels.buildContentPanel(view, shot, canEdit, onChange);
      refreshCount();
      setDirty(false);

      const topline = createTopline(view, shot, { isNew, canEdit }, stateElement);
      // 时长改动时同步标题旁的时长；不是有效数字时保持原样。
      shotPanel.duration.onChange((value) => {
        const seconds = Number(value);
        if (value.trim() !== '' && Number.isFinite(seconds) && seconds > 0) topline.durationTag.textContent = formatSeconds(seconds);
      });
      const tabs = createTabs(
        [
          { id: TAB_BLOCKING, label: '调度', count: blockingCountElement, content: blocking.element },
          { id: TAB_SHOT, label: '镜头', content: shotPanel.element },
          { id: TAB_CONTENT, label: '画面与声音', count: contentCountElement, content: content.element }
        ],
        selectedTab,
        (id) => {
          selectedTab = id;
        }
      );
      const element = aiUi.h('section', { class: 'storyboard-editor', attrs: { 'aria-label': '镜头详情' } }, topline.element, tabs.tablist, tabs.panels);
      editorControls = { element, saveButton, setDirty, collect: () => ({ ...blocking.collect(), ...shotPanel.collect(), ...content.collect() }) };
      return element;
    }
    /** 底部操作栏：不能编辑的原因，保存按钮，以及切换到上一个、下一个镜头。 */
    function renderFooter(view, shot) {
      const isNew = shot.id === NEW_SHOT;
      const index = view.shots.findIndex((candidate) => candidate.id === shot.id);
      // 新增中的镜头排在末尾，它的上一个是最后一个已保存的镜头，没有下一个。
      const previousShot = isNew ? view.shots[view.shots.length - 1] : view.shots[index - 1];
      const nextShot = isNew ? undefined : view.shots[index + 1];
      const goButton = (text, label, target) => aiUi.button({ text, ariaLabel: label, disabled: !target, onClick: () => void focusShot(target.id) });
      const reason = readonlyReason(view);
      return aiUi.h(
        'footer',
        { class: 'storyboard-footer' },
        reason ? aiUi.h('span', { text: reason }) : null,
        aiUi.h(
          'div',
          { class: 'storyboard-footer__actions' },
          view.actions.canEdit ? editorControls.saveButton.element : null,
          goButton('上一个', '上一个镜头', previousShot).element,
          goButton('下一个', '下一个镜头', nextShot).element
        )
      );
    }

    /** 主体：左侧镜头导航、右侧编辑区与底部操作栏；还没有镜头时给出说明。 */
    function renderBody(view, container) {
      bodyContainer = container;
      // 重建前记下导航的滚动位置，重建后恢复，避免点选下方的镜头后列表跳回顶部。
      const previousList = container.querySelector('.storyboard-nav__list');
      const navScrollTop = previousList ? previousList.scrollTop : 0;
      container.textContent = '';
      if (view.shots.length === 0) {
        editorControls = null;
        editorKey = '';
        container.append(aiUi.h('p', { class: 'description', text: '分镜脚本生成完成后，镜头会显示在这里。' }));
        return;
      }
      const keepsNew = selectedId === NEW_SHOT && view.actions.canEdit;
      const focusId = pendingFocusId;
      pendingFocusId = null;
      if (focusId !== null && view.shots.some((shot) => shot.id === focusId)) {
        selectedId = focusId;
        editorDirty = false;
      } else if (!keepsNew && !view.shots.some((shot) => shot.id === selectedId)) {
        selectedId = view.shots[0].id;
        editorDirty = false;
      }
      const shot = selectedId === NEW_SHOT ? blankShot(view) : view.shots.find((candidate) => candidate.id === selectedId);
      const editor = renderEditor(view, shot);
      container.append(
        aiUi.h('div', { class: 'storyboard-workspace' }, aiUi.h('div', { class: 'storyboard-main' }, renderNav(view), editor), renderFooter(view, shot))
      );
      container.querySelector('.storyboard-nav__list').scrollTop = navScrollTop;
      if (focusId !== null) scrollSelectedIntoView();
    }

    return {
      render: renderBody,
      renderSummary,
      focus,
      isDirty: () => editorDirty,
      discard: () => {
        editorDirty = false;
      }
    };
  }

  window.aiStage.registerStage({
    stage: 'storyboard_script',
    label: '分镜脚本',
    layout: 'workspace',
    pageSize: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    modal: false,
    regenerateForm: FORM_START,
    keptNote: '本集已保存的内容不受影响',
    discardMessage: '当前镜头有未保存的修改，放弃这些修改？',
    approveNote: () => '确认后它将作为这一集后续制作（资产绑定、视频生成）的依据。',
    titleSuffix: (view) => ` › 第 ${view.episode.seq} 集`,
    headerActions: (view) => [aiUi.button({ text: '分镜动画', icon: 'movie', disabled: !canPreview(view), onClick: () => openPreview(view) })],
    create
  });
})();
