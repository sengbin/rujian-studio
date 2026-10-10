// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-info-panel.js
// 说明：分镜动画预览的信息栏：按页签显示当前镜头的基本信息、画面描述、调度、声音，以及整集的质量检查列表。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 stage-storyboard-preview.js 拆出，通过 window.aiStoryboardPreviewInfoPanel.create(ctx) 创建；声音行里的配音控件由配音面板提供（ctx.voiceControl）；依赖 stage-storyboard-preview-timeline.js、-checks.js、-stage-view.js（空状态文字）、shared/page-format.js 与 aiUi 组件库（ui-tabs），样式在 stage-storyboard-preview.css。
// ------------------------------------------------------------------------

'use strict';

(function () {
  /** 信息栏按页签分类：镜头、画面、调度、声音、检查；面板一次创建，切换时只显示、隐藏。 */
  const INFO_TABS = [
    { id: 'shot', label: '镜头' },
    { id: 'prompt', label: '画面' },
    { id: 'blocking', label: '调度' },
    { id: 'sounds', label: '声音' },
    { id: 'checks', label: '检查' }
  ];
  const DEFAULT_INFO_TAB = 'shot';
  const SOUND_LABELS = { dialogue: '角色对白', narration: '旁白', sfx: '音效', music: '背景音乐' };
  const FIRST_FRAME_LABELS = { none: '不指定', prev_tail: '上一镜头尾帧', asset: '资产参考图', image: '指定图片' };

  const timelineApi = window.aiStoryboardTimeline;
  const checksApi = window.aiStoryboardChecks;
  const { EMPTY_LOADING, EMPTY_UNAVAILABLE } = window.aiStoryboardPreviewStageView;
  const { formatSeconds } = window.pageFormat;

  /**
   * 创建信息栏。
   * @param {{ state: object, player: object, voiceControl: (sound: object) => HTMLElement|null, clearVoiceStates: () => void, editShot: (shotId: number) => void }} ctx
   *   state 为预览层的页面状态（读 view、timeline、checks、shotIndex、loading）；player 用于点击检查项跳转；
   *   voiceControl 生成声音行里的配音控件；clearVoiceStates 在重建声音行前清掉“已合成”标记的登记；editShot 打开分镜编辑区并定位到镜头。
   * @returns {{ element: HTMLElement, renderShot: () => void, renderChecks: () => void, markCurrentChecks: () => void }}
   *   element 为信息栏；renderShot 重建当前镜头的各页签；renderChecks 重建检查列表；markCurrentChecks 给当前镜头的检查项加高亮。
   */
  function create(ctx) {
    const { state, player, voiceControl, clearVoiceStates, editShot } = ctx;

    // ---------- 元素 ----------
    // 信息栏按页签分类（INFO_TABS）；面板一次创建，切换时只显示、隐藏。
    const infoCounts = {};
    for (const tab of INFO_TABS) infoCounts[tab.id] = aiUi.h('span', { class: 'ui-tab__count' });
    // infoBody 保留为闭包变量：页签的 onSelect 要在切换时把它滚回顶部，而它的内容（页签面板）要等页签创建后才有，所以先声明、后赋值。
    let infoBody = null;
    const infoTabs = aiUi.tabs({
      items: INFO_TABS.map((tab) => ({ id: tab.id, label: tab.label, count: infoCounts[tab.id] })),
      activeId: DEFAULT_INFO_TAB,
      ariaLabel: '镜头信息类别',
      className: 'sbp-tabs',
      panelClass: 'sbp-panel',
      onSelect: () => {
        if (infoBody) infoBody.scrollTop = 0;
      }
    });
    const infoPanels = infoTabs.panelById;
    const infoTabButtons = infoTabs.buttons;
    const checkInfo = infoPanels.checks;
    checkInfo.classList.add('sbp-info__checks');
    infoBody = aiUi.h('div', { class: 'sbp-info__body' }, infoTabs.panels);
    const infoPanel = aiUi.h('aside', { class: 'sbp-info', attrs: { 'aria-label': '镜头信息与检查' } }, infoTabs.element, infoBody);

    // ---------- 信息栏 ----------
    function section(title, ...children) {
      return aiUi.h('section', { class: 'sbp-section' }, aiUi.h('h3', { class: 'ui-heading sbp-section__title', text: title }), ...children);
    }

    function factRow(label, value) {
      return aiUi.h('div', { class: 'sbp-fact' }, aiUi.h('dt', { text: label }), aiUi.h('dd', { text: value || '—' }));
    }

    /** 调度列表的一行：颜色点、名称与位置描述。 */
    function actorItem(actor, isFramedOut) {
      const dot = aiUi.h('span', { class: 'sbp-dot', attrs: { 'aria-hidden': 'true' } });
      dot.style.background = actor.color;
      const text = timelineApi.describeActor(actor) + (actor.action ? `；${actor.action}` : '') + (isFramedOut ? '（不在取景范围内，画面里看不到）' : '');
      return aiUi.h('li', { class: 'sbp-list__item' }, dot, aiUi.h('span', { text }));
    }

    /** 声音列表的一行：类型、说话人、内容与时间，附“估算”“超出镜头”标记。 */
    function soundItem(sound) {
      const kindLabel = (state.view.soundKinds || []).find((item) => item.kind === sound.kind);
      const label = kindLabel ? kindLabel.label : SOUND_LABELS[sound.kind] || sound.kind;
      const head = sound.speakerName ? `${label} · ${sound.speakerName}` : label;
      const notes = [sound.estimated ? '时间为估算' : '', sound.clipped ? '超出镜头时长' : ''].filter(Boolean).join('，');
      const isVoice = sound.kind === 'dialogue' || sound.kind === 'narration';
      const deliveryText = isVoice ? (sound.delivery ? `说话方式：${sound.delivery}` : '没有写说话方式（语气、语速、音量），配音按默认语气合成') : sound.delivery || '';
      return aiUi.h(
        'li',
        { class: 'sbp-list__item sbp-list__item--sound' },
        aiUi.h('span', { class: 'sbp-sound-head', text: head }),
        aiUi.h('span', { text: sound.text }),
        deliveryText === '' ? null : aiUi.h('span', { class: 'sbp-sound-delivery', text: deliveryText }),
        aiUi.h('span', { class: 'sbp-sound-time', text: `${sound.start.toFixed(1)}–${sound.end.toFixed(1)} 秒${notes ? `（${notes}）` : ''}` }),
        voiceControl(sound)
      );
    }

    /** 页签上的数量标记；0 或没有时不显示。 */
    function setTabCount(id, count) {
      infoCounts[id].textContent = count > 0 ? String(count) : '';
    }

    /** 重建当前镜头的信息：基本信息、画面描述、调度、声音，分别放进各自的页签。 */
    function renderShotInfo() {
      clearVoiceStates();
      for (const id of ['shot', 'prompt', 'blocking', 'sounds']) {
        infoPanels[id].textContent = '';
        setTabCount(id, 0);
      }
      const shot = state.timeline.shots[state.shotIndex];
      if (!shot) {
        infoPanels.shot.append(aiUi.h('p', { class: 'sbp-empty', text: state.loading ? EMPTY_LOADING : EMPTY_UNAVAILABLE }));
        return;
      }
      const cameraText = shot.cameraMovement ? (shot.camera.supported ? shot.cameraMovement : `${shot.cameraMovement}（预览未模拟）`) : '';
      infoPanels.shot.append(
        section(
          `第 ${shot.seq} 镜`,
          aiUi.h(
            'dl',
            { class: 'sbp-facts' },
            factRow('场次', shot.sceneLabel || shot.scene.name),
            factRow('景别', shot.shotSize),
            factRow('机位', shot.cameraAngle),
            factRow('运镜', cameraText),
            factRow('转场', shot.transition),
            factRow('时长', formatSeconds(shot.duration)),
            factRow('所属组', shot.groupSeq === null ? '' : `第 ${shot.groupSeq} 组`),
            factRow('首帧', FIRST_FRAME_LABELS[shot.firstFrameMode] || '')
          )
        )
      );
      infoPanels.prompt.append(aiUi.h('p', { class: 'sbp-prompt', text: shot.prompt || '—' }));
      const framedOut = timelineApi.framedOut(state.timeline, state.shotIndex);
      const actorItems = shot.actors.map((actor) => actorItem(actor, framedOut.has(actor.entityId)));
      for (const entity of shot.unplaced) {
        actorItems.push(aiUi.h('li', { class: 'sbp-list__item' }, aiUi.h('span', { text: `${entity.name}：未绘制（没有站位）` })));
      }
      infoPanels.blocking.append(actorItems.length > 0 ? aiUi.h('ul', { class: 'sbp-list' }, actorItems) : aiUi.h('p', { class: 'sbp-empty', text: '没有出场的角色、道具或特效。' }));
      infoPanels.sounds.append(shot.sounds.length > 0 ? aiUi.h('ul', { class: 'sbp-list' }, shot.sounds.map(soundItem)) : aiUi.h('p', { class: 'sbp-empty', text: '没有声音条目。' }));
      setTabCount('blocking', actorItems.length);
      setTabCount('sounds', shot.sounds.length);
    }

    /** 重建检查列表：汇总与各检查项（点击跳转，右侧按钮在分镜里编辑）。 */
    function renderChecks() {
      checkInfo.textContent = '';
      setTabCount('checks', state.checks.length);
      infoTabButtons.checks.classList.toggle('sbp-tab--warning', state.checks.some((entry) => entry.level === checksApi.LEVEL_WARNING));
      if (state.timeline.shots.length === 0) return;
      const { warnings, infos } = checksApi.summarize(state.checks);
      const summary = state.checks.length === 0 ? '没有发现问题' : `警告 ${warnings} 项，提示 ${infos} 项`;
      const items = state.checks.map((entry) => {
        const iconName = entry.level === checksApi.LEVEL_WARNING ? 'alert-triangle' : 'info-circle';
        const main = aiUi.h(
          'button',
          { class: 'sbp-check__main', attrs: { type: 'button', title: '跳转到该镜头' }, on: { click: () => player.seekToShot(entry.shotIndex) } },
          aiUi.icon(iconName, 'sbp-check__icon'),
          aiUi.h('span', { text: entry.text })
        );
        const edit = aiUi.button({ text: '在分镜里编辑', icon: 'pencil', iconOnly: true, compact: true, onClick: () => editShot(entry.shotId) });
        return aiUi.h('li', { class: `sbp-check sbp-check--${entry.level}`, attrs: { 'data-index': entry.shotIndex } }, main, edit.element);
      });
      checkInfo.append(section(`检查（${summary}）`, items.length > 0 ? aiUi.h('ul', { class: 'sbp-checks' }, items) : null));
      markCurrentChecks();
    }

    /** 当前镜头的检查项加高亮。 */
    function markCurrentChecks() {
      for (const item of checkInfo.querySelectorAll('.sbp-check')) {
        item.classList.toggle('sbp-check--current', Number(item.getAttribute('data-index')) === state.shotIndex);
      }
    }

    return { element: infoPanel, renderShot: renderShotInfo, renderChecks, markCurrentChecks };
  }

  window.aiStoryboardPreviewInfoPanel = { create };
})();
