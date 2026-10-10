// ------------------------------------------------------------------------
// 名称：ui-tabs.js
// 说明：界面组件库的页签：页签条与对应面板的创建、选中切换和键盘导航，多个页面共用。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：依赖 ui-core.js；按 ARIA tablist 语义实现；样式见 ui-controls.css 的 ui-tabs、ui-tab。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const aiUi = window.aiUi;

  /**
   * 创建页签。
   * @param {{ items: Array<{ id: string, label: string, count?: Node, className?: string, panel?: HTMLElement, content?: any }>,
   *   activeId?: string, ariaLabel?: string, className?: string, panelClass?: string, focusablePanels?: boolean,
   *   onSelect?: (id: string) => void }} options
   *   items 每项的 count 是页签文字后面的数量节点（由调用方持有并更新），panel 传入已有面板元素，否则用 content 新建；
   *   className、panelClass 是页面自己的钩子类名；focusablePanels 为 true 时面板可用 Tab 键聚焦；onSelect 在每次选中（含初始选中）后调用。
   * @returns {{ element: HTMLElement, panels: HTMLElement[], buttons: Record<string, HTMLElement>, panelById: Record<string, HTMLElement>,
   *   activate: (id: string) => void, getActiveId: () => string }}
   *   element 是页签条；panels 按顺序排列，由调用方放到页面里。
   */
  aiUi.tabs = function (options) {
    const settings = options || {};
    const items = settings.items || [];
    if (items.length === 0) throw new Error('页签至少需要一项');

    const tabs = items.map((item) => {
      const tabId = aiUi.uid('ui-tab');
      const panelId = aiUi.uid('ui-tabpanel');
      const button = aiUi.h(
        'button',
        { class: ['ui-tab', item.className].filter(Boolean).join(' '), attrs: { type: 'button', role: 'tab', id: tabId, 'aria-controls': panelId } },
        item.label,
        item.count || null
      );
      const panel = item.panel || aiUi.h('div', { class: settings.panelClass }, item.content);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('id', panelId);
      panel.setAttribute('aria-labelledby', tabId);
      if (settings.focusablePanels) panel.setAttribute('tabindex', '0');
      return { id: item.id, button, panel };
    });

    let activeId = tabs[0].id;

    /** 只显示选中页签的面板；只有选中的页签在键盘 Tab 顺序里。 */
    function activate(id) {
      activeId = id;
      for (const tab of tabs) {
        const isActive = tab.id === id;
        tab.button.setAttribute('aria-selected', String(isActive));
        tab.button.tabIndex = isActive ? 0 : -1;
        tab.panel.hidden = !isActive;
      }
      if (settings.onSelect) settings.onSelect(id);
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

    const element = aiUi.h(
      'div',
      { class: ['ui-tabs', settings.className].filter(Boolean).join(' '), attrs: { role: 'tablist', 'aria-label': settings.ariaLabel } },
      tabs.map((tab) => tab.button)
    );
    activate(tabs.some((tab) => tab.id === settings.activeId) ? settings.activeId : tabs[0].id);

    return {
      element,
      panels: tabs.map((tab) => tab.panel),
      buttons: Object.fromEntries(tabs.map((tab) => [tab.id, tab.button])),
      panelById: Object.fromEntries(tabs.map((tab) => [tab.id, tab.panel])),
      activate,
      getActiveId: () => activeId
    };
  };
})();
