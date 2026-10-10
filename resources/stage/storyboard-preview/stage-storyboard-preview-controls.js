// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-controls.js
// 说明：分镜动画预览的播放控制：播放、上一镜、下一镜、回到开头、循环当前镜头、倍速、时间显示、画面显示选项，以及舞台上的键盘操作。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 stage-storyboard-preview.js 拆出，通过 window.aiStoryboardPreviewControls.create(ctx) 创建；控件只调用播放器，显示选项变化后通过 paint 回调让舞台重画；依赖 stage-storyboard-preview-player.js（倍速档位）与 aiUi 组件库，样式在 stage-storyboard-preview.css。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const DISPLAY_OPTIONS = [
    ['names', '名称'],
    ['actions', '动作'],
    ['trail', '轨迹与朝向'],
    ['grid', '站位网格'],
    ['captions', '字幕'],
    ['description', '画面描述'],
    ['camera', '景别与运镜'],
    ['frame', '取景框']
  ];

  const playerApi = window.aiStoryboardPlayer;
  const RATE_OPTIONS = playerApi.RATES.map((rate) => ({ value: String(rate), label: `${rate}×` }));

  /** 时间显示：分:秒.十分之一秒。 */
  function formatClock(seconds) {
    const tenths = Math.round(Math.max(0, seconds) * 10);
    const minutes = Math.floor(tenths / 600);
    const rest = (tenths % 600) / 10;
    return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`;
  }

  /**
   * 创建播放控制行。
   * @param {{ state: object, player: object, paint: () => void }} ctx
   *   state 为预览层的页面状态（读 display、playable、timeline，读写 controlsKey）；player 为播放器；paint 在显示选项变化后重画舞台。
   * @returns {{ element: HTMLElement, update: (playerState: object) => void, bindKeyboard: (root: HTMLElement) => void }}
   *   element 为控制行；update 按播放状态刷新时间、按钮与倍速（状态没变时不改 DOM）；bindKeyboard 在根元素上绑定空格、方向键、Home、End。
   */
  function create(ctx) {
    const { state, player, paint } = ctx;

    // ---------- 元素 ----------
    const timeLabel = aiUi.h('span', { class: 'sbp-time', text: `${formatClock(0)} / ${formatClock(0)}` });
    const playButton = aiUi.button({ text: '播放', icon: 'player-play', iconOnly: true, ariaLabel: '播放', onClick: () => player.toggle() });
    const prevButton = aiUi.button({ text: '上一镜', icon: 'player-skip-back', iconOnly: true, onClick: () => player.prevShot() });
    const nextButton = aiUi.button({ text: '下一镜', icon: 'player-skip-forward', iconOnly: true, onClick: () => player.nextShot() });
    const stopButton = aiUi.button({ text: '回到开头', icon: 'player-stop', iconOnly: true, onClick: () => player.stop() });
    const loopButton = aiUi.button({ text: '循环当前镜头', icon: 'repeat', iconOnly: true, onClick: () => player.setLoopShot(!player.getState().loopShot) });
    loopButton.element.setAttribute('aria-pressed', 'false');
    const rateSelect = aiUi.select({ options: RATE_OPTIONS, value: '1', allowEmpty: false, ariaLabel: '倍速', onChange: (value) => player.setRate(Number(value)) });
    const displayControls = DISPLAY_OPTIONS.map(([name, label]) =>
      aiUi.checkbox({
        label,
        checked: state.display[name],
        onChange: (checked) => {
          state.display[name] = checked;
          paint();
        }
      })
    );
    const transportButtons = [playButton, prevButton, nextButton, stopButton, loopButton];
    const controlsRow = aiUi.h(
      'div',
      { class: 'sbp-controls' },
      aiUi.h('div', { class: 'sbp-controls__transport' }, transportButtons.map((button) => button.element)),
      timeLabel,
      aiUi.h('div', { class: 'sbp-controls__rate' }, rateSelect.element),
      aiUi.h('div', { class: 'sbp-controls__display', attrs: { role: 'group', 'aria-label': '显示选项' } }, displayControls.map((control) => control.element))
    );

    // ---------- 播放状态 ----------
    function updateControls(playerState) {
      timeLabel.textContent = `${formatClock(playerState.time)} / ${formatClock(playerState.total)}`;
      const key = `${playerState.playing}|${playerState.loopShot}|${state.playable}|${state.timeline.shots.length}`;
      if (key === state.controlsKey) return;
      state.controlsKey = key;
      playButton.setIcon(playerState.playing ? 'player-pause' : 'player-play');
      playButton.setAriaLabel(playerState.playing ? '暂停' : '播放');
      loopButton.element.setAttribute('aria-pressed', String(playerState.loopShot));
      const disabled = !state.playable || state.timeline.shots.length === 0;
      for (const button of transportButtons) button.setDisabled(disabled);
      rateSelect.setDisabled(disabled);
    }

    /** 在根元素上绑定键盘操作：空格播放或暂停，方向键前进后退，Shift 加方向键切换镜头，Home、End 跳到开头、末尾。 */
    function bindKeyboard(root) {
    root.addEventListener('keydown', (event) => {
      // 控件自己处理空格、方向键与回车。
      if (event.target.closest('button, select, input, textarea, [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="listbox"], [role="option"]')) return;
      if (state.timeline.shots.length === 0) return;
      let handled = true;
      if (event.key === ' ') player.toggle();
      else if (event.key === 'ArrowLeft') (event.shiftKey ? player.prevShot : () => player.step(-1))();
      else if (event.key === 'ArrowRight') (event.shiftKey ? player.nextShot : () => player.step(1))();
      else if (event.key === 'Home') player.seek(0);
      else if (event.key === 'End') player.seek(state.timeline.totalSeconds);
      else handled = false;
      if (handled) event.preventDefault();
    });
    }

    return { element: controlsRow, update: updateControls, bindKeyboard };
  }

  window.aiStoryboardPreviewControls = { create };
})();
