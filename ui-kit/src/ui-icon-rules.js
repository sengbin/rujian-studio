// ------------------------------------------------------------------------
// 名称：ui-icon-rules.js
// 说明：按钮文字与图标的匹配规则：根据文字含义选出最贴切的图标，使整个应用里同一种操作使用同一个图标。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：规则按顺序匹配，先匹配到的生效，所以更具体的规则必须排在前面；图标名称须存在于 ui-icons.js；依赖 ui-icons.js。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const POSITION_START = 'start';
  const POSITION_END = 'end';

  /** 文字与图标的匹配规则：[文字匹配式, 图标名称, 图标位置（缺省在文字前）]。 */
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

    // 数据备份与设置
    [/^备份到文件/, 'database-export'],
    [/^从文件恢复/, 'database-import'],
    [/^取消恢复/, 'arrow-back-up'],
    [/^重启应用/, 'refresh'],
    [/^测试连接/, 'plug-connected'],
    [/^清除密钥/, 'key-off'],
    [/密钥$/, 'key'],
    [/^设置$/, 'settings'],

    // 新建（带对象的新建先于通用的新建）
    [/^创建项目/, 'folder-plus'],
    [/^(创建|新建)分类/, 'category-plus'],
    [/^新建作品/, 'video-plus'],
    [/^新建资产/, 'photo-plus'],
    [/^分类管理/, 'category'],

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
    [/^重新分组/, 'layout-grid'],
    [/^重新(生成|抽取)/, 'refresh'],

    // 生成（含“参考节拍表生成”这类前面带限定词、以“生成”结尾的按钮）
    [/^(开始生成|AI 生成|创建并生成|生成)/, 'sparkles'],
    [/生成$/, 'sparkles'],

    // 提示词
    [/^(编辑提示词|提示词)/, 'writing'],

    // 提交
    [/^提交/, 'send'],

    // 查看、版本与结果
    [/^查看结果/, 'player-play'],
    [/^查看原始输出/, 'file-code'],
    [/^查看/, 'eye'],
    [/^(版本|结果版本)/, 'versions'],
    [/^对比/, 'arrows-diff'],
    [/^(播放|试听)/, 'player-play'],
    [/^停止/, 'player-stop'],
    [/^打开视频/, 'movie'],
    [/^导出/, 'file-export'],
    [/^在文件夹中显示/, 'folder-open'],
    [/^第 \d+ 组$/, 'current-location'],

    // 镜头分组
    [/^从这里拆开/, 'scissors'],
    [/^并入上一组/, 'arrows-join'],

    // 素材绑定
    [/^设为主资产/, 'star'],
    [/^解除/, 'unlink'],
    [/^建立绑定/, 'link'],
    [/^按名称自动匹配/, 'wand'],
    [/^(选择|再选一个)$/, 'hand-click'],
    [/^选择资产/, 'photo-search'],
    [/^(选择|更换)音色/, 'microphone'],
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

  /**
   * 按文字含义匹配图标。
   * @param {string} text 按钮文字。
   * @returns {{ name: string, position: 'start'|'end' }|null} 图标名称与位置；没有匹配的规则时返回 null。
   */
  window.aiUi.iconForLabel = function (text) {
    const label = String(text || '').trim();
    for (const [pattern, name, position] of LABEL_ICON_RULES) {
      if (pattern.test(label)) return { name, position: position || POSITION_START };
    }
    return null;
  };
})();
