// ------------------------------------------------------------------------
// 名称：ui-icon-rules.js
// 说明：按钮文字与图标的匹配规则：根据文字含义选出最贴切的图标，使整个应用里同一种操作使用同一个图标；通用规则内置，应用自己的规则由页面通过 aiUi.registerIconRules 登记。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：规则按顺序匹配，先匹配到的生效，所以更具体的规则必须排在前面；登记的规则先于内置规则匹配；图标名称须存在于 ui-icons.js；依赖 ui-icons.js。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const POSITION_START = window.aiUi.iconPosition.start;
  const POSITION_END = window.aiUi.iconPosition.end;

  /** 文字与图标的内置匹配规则：[文字匹配式, 图标名称, 图标位置（缺省在文字前）]。 */
  const LABEL_ICON_RULES = [
    // 步骤与顺序
    [/^上一步/, 'arrow-left'],
    [/^下一步/, 'arrow-right', POSITION_END],
    [/^前移/, 'arrow-left'],
    [/^后移/, 'arrow-right', POSITION_END],
    [/^上移/, 'arrow-up'],
    [/^下移/, 'arrow-down'],
    [/^展开/, 'chevron-down'],
    [/^收起/, 'chevron-up'],

    // 设置与重启
    [/^重启应用/, 'refresh'],
    [/^设置$/, 'settings'],

    // 保存、确认与采用
    [/^保存/, 'device-floppy'],
    [/^(确认采用|采用)/, 'circle-check'],
    [/^(确定|确认|已保存|已采用)$/, 'check'],
    [/^覆盖/, 'replace'],
    [/^改用上传/, 'upload'],
    [/^改用生成/, 'sparkles'],
    [/^改用/, 'replace'],
    [/^(放弃修改|恢复沿用上一级)/, 'arrow-back-up'],
    [/^继续编辑/, 'pencil'],
    [/^继续/, 'arrow-right', POSITION_END],
    [/^保留/, 'check'],

    // 取消与关闭（取消生成是停止任务，单独用停止图标）
    [/^取消生成/, 'player-stop'],
    [/^(取消|关闭)/, 'x'],

    // 重试与重新生成
    [/^重试/, 'reload'],
    [/^重新(生成|抽取)/, 'refresh'],

    // 生成（含前面带限定词、以“生成”结尾的按钮）
    [/^(开始生成|AI 生成|创建并生成|生成)/, 'sparkles'],
    [/生成$/, 'sparkles'],

    // 提交
    [/^提交/, 'send'],

    // 查看、播放与导出
    [/^查看/, 'eye'],
    [/^对比/, 'arrows-diff'],
    [/^(播放|试听)/, 'player-play'],
    [/^停止/, 'player-stop'],
    [/^导出/, 'file-export'],
    [/^在文件夹中显示/, 'folder-open'],

    // 选择与调整
    [/^解除/, 'unlink'],
    [/^(选择|再选一个)$/, 'hand-click'],
    [/^(管理|调整)/, 'adjustments'],

    // 文件
    [/^(添加文件|选择文件)/, 'file-upload'],

    // 选择与清理
    [/^全选/, 'select-all'],
    [/^仅未完成/, 'filter'],
    [/^(清空|清除)/, 'eraser'],

    // 通用的新建、修改、删除
    [/^(添加|新建|创建|仅创建)/, 'plus'],
    [/^(修改|编辑)/, 'pencil'],
    [/^(删除|移除)/, 'trash']
  ];

  /** 页面登记的规则，先于内置规则匹配；后登记的排在先登记的后面。 */
  const registeredRules = [];

  /**
   * 登记应用自己的图标规则（如与具体业务对象相关的按钮文字）；格式同内置规则，登记的规则先于内置规则匹配，所以可以覆盖通用规则。
   * @param {Array<[RegExp, string, ('start'|'end')?]>} rules 规则列表：[文字匹配式, 图标名称, 图标位置（缺省在文字前）]。
   */
  window.aiUi.registerIconRules = function (rules) {
    registeredRules.push(...rules);
  };

  /**
   * 按文字含义匹配图标。
   * @param {string} text 按钮文字。
   * @returns {{ name: string, position: 'start'|'end' }|null} 图标名称与位置；没有匹配的规则时返回 null。
   */
  window.aiUi.iconForLabel = function (text) {
    const label = String(text || '').trim();
    for (const [pattern, name, position] of [...registeredRules, ...LABEL_ICON_RULES]) {
      if (pattern.test(label)) return { name, position: position || POSITION_START };
    }
    return null;
  };
})();
