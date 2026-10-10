// ------------------------------------------------------------------------
// 名称：tab-bar.ts
// 说明：标签栏界面：按标签状态渲染标签，处理点击切换、关闭按钮、中键关闭和滚轮横向滚动。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：每次状态变化整体重绘，标签数量很少，不做差量更新；样式见 index.css。
// ------------------------------------------------------------------------

import { TabState } from './tab-state';

/** 关闭按钮的图标（Tabler 的 x）。 */
const CLOSE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6l-12 12"/><path d="M6 6l12 12"/></svg>';

/** 标签栏的用户操作回调。 */
export interface TabBarHandlers {
  readonly onActivate: (key: string) => void;
  readonly onClose: (key: string) => void;
}

/** 标签栏。 */
export class TabBar {
  /**
   * @param element 标签栏容器。
   * @param state 标签状态。
   * @param handlers 用户操作回调。
   */
  constructor(
    private readonly element: HTMLElement,
    private readonly state: TabState,
    private readonly handlers: TabBarHandlers
  ) {
    // 鼠标滚轮的纵向滚动转成标签栏的横向滚动。
    element.addEventListener('wheel', (event) => {
      element.scrollLeft += event.deltaY;
    });
  }

  /** 按当前状态重绘，并把激活的标签滚动到可见位置。 */
  render(): void {
    const items = this.state.list().map((tab) => {
      const isActive = tab.key === this.state.active;
      const item = document.createElement('div');
      item.className = isActive ? 'tab is-active' : 'tab';
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-selected', String(isActive));
      item.tabIndex = 0;
      item.title = tab.title;

      const label = document.createElement('span');
      label.className = 'tab__label';
      label.textContent = tab.title;

      const close = document.createElement('button');
      close.className = 'tab__close';
      close.type = 'button';
      close.setAttribute('aria-label', `关闭 ${tab.title}`);
      close.innerHTML = CLOSE_ICON;
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        this.handlers.onClose(tab.key);
      });

      item.append(label, close);
      item.addEventListener('click', () => this.handlers.onActivate(tab.key));
      // 中键点击关闭。
      item.addEventListener('auxclick', (event) => {
        if (event.button === 1) {
          event.preventDefault();
          this.handlers.onClose(tab.key);
        }
      });
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.handlers.onActivate(tab.key);
        }
      });
      return item;
    });
    this.element.replaceChildren(...items);
    this.element.querySelector('.tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
