// ------------------------------------------------------------------------
// 名称：ui-list.js
// 说明：界面组件库的可选择列表：列表容器与列表项，选中状态用 aria-current 表达，多个页面的列表共用。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：依赖 ui-core.js；样式见 ui-controls.css 的 ui-list、ui-list__item；项内排版由页面自己的类名决定。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const aiUi = window.aiUi;

  /**
   * 创建列表容器。
   * @param {{ tag?: string, className?: string, ariaLabel?: string }} [options] tag 默认 div；className 是页面自己的钩子类名。
   * @param {...(Node|string|null|undefined|false|Array)} children 列表项或其他子节点。
   */
  aiUi.list = function (options, ...children) {
    const settings = options || {};
    return aiUi.h(settings.tag || 'div', { class: ['ui-list', settings.className].filter(Boolean).join(' '), attrs: { 'aria-label': settings.ariaLabel } }, ...children);
  };

  /**
   * 创建列表项按钮。
   * @param {{ selected?: boolean, className?: string, ariaLabel?: string, onClick?: () => void }} [options]
   *   selected 为 true 时标为当前项（aria-current）；className 是页面自己的钩子类名。
   * @param {...(Node|string|null|undefined|false|Array)} children 项内内容。
   */
  aiUi.listItem = function (options, ...children) {
    const settings = options || {};
    return aiUi.h(
      'button',
      {
        class: ['ui-list__item', settings.className].filter(Boolean).join(' '),
        attrs: { type: 'button', 'aria-current': settings.selected ? 'true' : undefined, 'aria-label': settings.ariaLabel },
        on: settings.onClick ? { click: settings.onClick } : undefined
      },
      ...children
    );
  };
})();
