// ------------------------------------------------------------------------
// 名称：ui-button.js
// 说明：界面组件库的按钮：主要、次要、危险三种样式，每个按钮带与文字匹配的图标，并提供“添加”“修改”“删除”预设。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：依赖 ui-core.js、ui-icons.js、ui-icon-rules.js；图标为 Tabler 内联 SVG，颜色跟随文字，按文字含义自动匹配；用法见 docs/ui-components.md。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const aiUi = window.aiUi;

  /** 操作预设：样式、默认文字和图标（Tabler 图标名称）。 */
  const KINDS = {
    add: { variant: 'primary', text: '添加', icon: 'plus' },
    edit: { variant: 'secondary', text: '修改', icon: 'pencil' },
    delete: { variant: 'danger', text: '删除', icon: 'trash' }
  };

  const POSITION_START = 'start';
  const POSITION_END = 'end';

  /**
   * 创建按钮。
   * @param {{ text?: string, kind?: 'add'|'edit'|'delete', variant?: 'primary'|'secondary'|'danger', icon?: string|false,
   *   iconPosition?: 'start'|'end', iconOnly?: boolean, compact?: boolean, type?: 'button'|'submit', ariaLabel?: string, disabled?: boolean,
   *   onClick?: (event: MouseEvent) => void }} options 选项：
   *   kind 使用“添加/修改/删除”预设（样式、默认文字、图标），text 与 variant 可覆盖；
   *   图标默认按文字含义自动匹配（见 ui-icon-rules.js），文字没有匹配项时使用 kind 预设的图标；
   *   icon 指定 Tabler 图标名称（见 ui-icons.js）覆盖自动匹配，或为 false 不显示图标；iconPosition 指定图标在文字前（start）或后（end）；
   *   iconOnly 只显示图标，文字作为可访问名称；variant 默认 secondary。
   * @returns {{ element: HTMLButtonElement, setDisabled: (disabled: boolean) => void, isDisabled: () => boolean,
   *   setText: (text: string) => void, setIcon: (name: string) => void, setAriaLabel: (label: string) => void, focus: () => void }}
   */
  aiUi.button = function (options) {
    const settings = options || {};
    const kind = settings.kind ? KINDS[settings.kind] : null;
    if (settings.kind && !kind) throw new Error(`未知的按钮预设：${settings.kind}`);

    const variant = settings.variant || (kind ? kind.variant : 'secondary');
    const text = settings.text !== undefined ? settings.text : kind ? kind.text : '';
    let explicitIcon = settings.icon || null;

    /** 按文字解析图标：显式指定优先，其次按文字含义匹配，最后是预设的图标。 */
    function resolveIcon(label) {
      if (settings.icon === false) return null;
      const matched = explicitIcon ? null : aiUi.iconForLabel(label);
      const name = explicitIcon || (matched && matched.name) || (kind && kind.icon) || null;
      if (!name) return null;
      return { name, position: settings.iconPosition || (matched && matched.position) || POSITION_START };
    }

    let icon = null;
    let iconSpec = null;
    const initialSpec = resolveIcon(text);
    const initialIcon = initialSpec ? aiUi.icon(initialSpec.name, 'ui-button__icon') : null;
    const iconOnly = Boolean(settings.iconOnly && initialIcon);

    const classNames = ['ui-button', `ui-button--${variant}`];
    if (settings.kind) classNames.push(`ui-button--${settings.kind}`);
    if (settings.compact) classNames.push('ui-button--compact');
    if (iconOnly) classNames.push('ui-button--icon-only');

    const textElement = aiUi.h('span', { text });
    const element = aiUi.h(
      'button',
      {
        class: classNames.join(' '),
        attrs: { type: settings.type || 'button', 'aria-label': settings.ariaLabel || (iconOnly ? text : undefined) }
      },
      iconOnly ? null : textElement
    );

    /** 显示指定的图标；规格为空时去掉图标；图标与位置都没变时不重建。 */
    function applyIcon(spec, prepared) {
      if (iconSpec && spec && iconSpec.name === spec.name && iconSpec.position === spec.position) return;
      const next = spec ? prepared || aiUi.icon(spec.name, 'ui-button__icon') : null;
      if (icon) icon.remove();
      icon = next;
      iconSpec = next ? spec : null;
      if (!next) return;
      if (spec.position === POSITION_END && !iconOnly) element.append(next);
      else element.prepend(next);
    }
    applyIcon(initialSpec, initialIcon);

    element.disabled = Boolean(settings.disabled);
    if (settings.onClick) element.addEventListener('click', settings.onClick);

    return {
      element,
      setDisabled(disabled) {
        element.disabled = disabled;
      },
      isDisabled: () => element.disabled,
      /** 更新文字；图标随文字含义重新匹配，纯图标按钮保持原图标。 */
      setText(value) {
        textElement.textContent = value;
        if (iconOnly) {
          element.setAttribute('aria-label', value);
          return;
        }
        applyIcon(resolveIcon(value));
      },
      /** 换成指定的图标并不再随文字变化；名称不在图标集中时忽略。 */
      setIcon(name) {
        if (!aiUi.icon(name)) return;
        explicitIcon = name;
        applyIcon({ name, position: iconSpec ? iconSpec.position : POSITION_START });
      },
      /** 更新可访问名称，用于状态切换后图标含义改变的按钮。 */
      setAriaLabel(label) {
        element.setAttribute('aria-label', label);
      },
      focus() {
        element.focus();
      }
    };
  };
})();
