// ------------------------------------------------------------------------
// 名称：ui-image.js
// 说明：界面组件库的图片组件：固定尺寸的缩略图（可点击、可显示占位文字）与在弹出页中查看原图。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：依赖 ui-core.js、ui-dialog.js（弹出页）；样式见 ui-controls.css 的 .ui-thumb、.ui-image 系列。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const aiUi = window.aiUi;

  const VIEWER_WIDTH = 640;
  const VIEWER_HEIGHT = 520;
  const VIEWER_MIN_WIDTH = 320;
  const VIEWER_MIN_HEIGHT = 240;
  const CLOSE_BUTTON_TEXT = '关闭';

  /**
   * 缩略图：有图片时用 cover 铺满；传了 onClick 则是可点击的按钮，没有图片时显示占位文字。
   * @param {{ src?: string, alt?: string, text?: string, title?: string, ariaLabel?: string, className?: string, onClick?: () => void }} options
   *   src 图片地址；alt 替代文字；text 没有图片时的占位文字；title 悬停提示；ariaLabel 按钮的可访问名称；
   *   className 追加的类名（页面用来改尺寸，如在元素上改写 --thumb-size）；onClick 点击回调。
   * @returns {HTMLElement}
   */
  aiUi.thumb = function (options) {
    const { src, alt, text, title, ariaLabel, className, onClick } = options;
    const extra = className ? ` ${className}` : '';
    if (!src) return aiUi.h('div', { class: `ui-thumb${extra}`, text });
    const image = aiUi.h('img', { class: 'ui-image ui-image--cover', attrs: { src, alt } });
    if (!onClick) return aiUi.h('div', { class: `ui-thumb${extra}` }, image);
    return aiUi.h(
      'button',
      { class: `ui-thumb ui-thumb--button${extra}`, attrs: { type: 'button', title, 'aria-label': ariaLabel }, on: { click: onClick } },
      image
    );
  };

  /**
   * 在弹出页中查看一张图片的原图：按页面大小缩放，过大时在页内滚动。
   * @param {{ title: string, src: string, alt?: string }} options title 弹出页标题；src 图片地址；alt 替代文字，默认同标题。
   * @returns 弹出页句柄（见 aiUi.openPage）。
   */
  aiUi.viewImage = function (options) {
    const image = aiUi.h('img', { class: 'ui-image ui-image--contain', attrs: { src: options.src, alt: options.alt || options.title } });
    return aiUi.openPage({
      title: options.title,
      content: aiUi.h('div', { class: 'ui-image-viewer' }, image),
      width: VIEWER_WIDTH,
      height: VIEWER_HEIGHT,
      minWidth: VIEWER_MIN_WIDTH,
      minHeight: VIEWER_MIN_HEIGHT,
      buttons: [{ id: 'close', text: CLOSE_BUTTON_TEXT, isCancel: true }]
    });
  };
})();
