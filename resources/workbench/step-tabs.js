// ------------------------------------------------------------------------
// 名称：step-tabs.js
// 说明：工作台右栏的步骤页签：顶部是带序号、名称和状态副文字的页签（完成时序号变为对勾），下面是各步骤的面板；每个面板顶部有一行“第 N 组 | 第 i 步 / 3：步骤名”，底部有固定的“上一步”“下一步”按钮；支持方向键、Home、End 切换页签。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-03
// 备注：必须先于 workbench.js 加载；对外是 window.aiStepTabs.create；页签条与切换、键盘导航由组件库的 aiUi.tabs（卡片式）提供；步骤面板创建后一直保留在页面里（只切换显示），所以各面板的状态不会因为切换步骤或页面刷新而丢失；最后一步的底部由面板自己提供（含“上一步”和主操作），其余步骤的底部由页签容器生成。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const STATE_NORMAL = 'normal';
  const STATE_DONE = 'done';
  const MARK_DONE = '✓';
  const CONTEXT_SEPARATOR = '　|　';

  /**
   * 创建步骤页签。
   * @param {{
   *   tabs: Array<{ id: string, label: string, icon?: string, build: () => { element: HTMLElement, refresh?: () => void } }>,
   *   initial?: string,
   *   ariaLabel?: string
   * }} options tabs 为步骤定义，label 是步骤名称，icon 是 Tabler 图标名称，build 创建面板内容。
   * @returns {{ element: HTMLElement, show: (id: string, focus?: boolean) => void, showPrevious: () => void, getActive: () => string, setContext: (text: string) => void, setStatus: (id: string, status: { note: string, state?: 'normal'|'done' }) => void, refresh: () => void }}
   */
  function create(options) {
    const items = options.tabs.map((tab, index) => {
      const controller = tab.build();
      const title = aiUi.h('span', { class: 'wb-steps__tab-title' });
      const head = aiUi.h('span', { class: 'wb-steps__tab-head' }, tab.icon ? aiUi.icon(tab.icon, 'wb-steps__tab-icon') : null, title);
      const note = aiUi.h('span', { class: 'wb-steps__tab-note' });
      const context = aiUi.h('p', { class: 'wb-steps__context' });
      const panel = aiUi.h('div', { class: 'wb-steps__panel' }, context, controller.element);
      return { id: tab.id, label: tab.label, index, controller, head, panel, title, note, context, state: STATE_NORMAL };
    });
    let active = options.initial || items[0].id;
    let contextText = '';

    /** 页签标题：序号（完成时为对勾）加步骤名称。 */
    function renderTitle(item) {
      item.title.textContent = `${item.state === STATE_DONE ? MARK_DONE : item.index + 1} ${item.label}`;
    }

    /** 面板顶部的一行：当前镜头组与第几步。 */
    function renderContext(item) {
      const step = `第 ${item.index + 1} 步 / ${items.length}：${item.label}`;
      item.context.textContent = contextText ? `${contextText}${CONTEXT_SEPARATOR}${step}` : step;
    }

    const tabs = aiUi.tabs({
      items: items.map((item) => ({ id: item.id, label: [item.head, item.note], className: 'wb-steps__tab', panel: item.panel })),
      activeId: active,
      ariaLabel: options.ariaLabel || '步骤',
      className: 'wb-steps__tabs',
      focusablePanels: true,
      onSelect: (id) => {
        active = id;
        const target = items.find((item) => item.id === id);
        if (target.controller.refresh) target.controller.refresh();
      }
    });

    function show(id, focus) {
      if (!items.some((item) => item.id === id)) return;
      tabs.activate(id);
      if (focus) tabs.buttons[id].focus();
    }

    /** 前几步的底部：“上一步”（第一步没有）和占满剩余宽度的“下一步”。 */
    function createFooter(index) {
      const previous = items[index - 1];
      const next = items[index + 1];
      const actions = aiUi.h('div', { class: 'wb-steps__actions' });
      if (previous) actions.append(aiUi.button({ text: '上一步', onClick: () => show(previous.id, true) }).element);
      actions.append(aiUi.button({ text: `下一步：${next.label}`, variant: 'primary', onClick: () => show(next.id, true) }).element);
      return aiUi.h('div', { class: 'wb-steps__footer' }, actions);
    }

    items.forEach((item, index) => {
      renderTitle(item);
      renderContext(item);
      if (index < items.length - 1) item.panel.append(createFooter(index));
    });

    const element = aiUi.h('aside', { class: 'wb-panel wb-steps', attrs: { 'aria-label': options.ariaLabel || '步骤' } }, tabs.element, tabs.panels);

    return {
      element,
      show,
      /** 回到上一步（当前已是第一步时不动）。 */
      showPrevious() {
        const index = items.findIndex((item) => item.id === active);
        if (index > 0) show(items[index - 1].id, true);
      },
      getActive: () => active,
      /** 设置面板顶部那一行里的镜头组说明，如“第 1 组”。 */
      setContext(text) {
        contextText = text;
        items.forEach(renderContext);
      },
      /** 更新一个步骤的状态：副文字，以及是否完成（序号变对勾，标题用成功色）。 */
      setStatus(id, status) {
        const target = items.find((item) => item.id === id);
        if (!target) return;
        target.state = status.state || STATE_NORMAL;
        target.note.textContent = status.note;
        tabs.buttons[id].classList.toggle('wb-steps__tab--done', target.state === STATE_DONE);
        renderTitle(target);
      },
      refresh() {
        for (const item of items) if (item.controller.refresh) item.controller.refresh();
      }
    };
  }

  window.aiStepTabs = { create };
})();
