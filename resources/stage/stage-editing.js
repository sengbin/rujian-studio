// ------------------------------------------------------------------------
// 名称：stage-editing.js
// 说明：各阶段产出内容（创意、节拍表、剧本、分镜脚本）编辑区共用的规则：不能编辑时的原因文案、保存按钮的“有修改才可点、保存后显示已保存”状态、已确认版本被编辑时的确认对话框、参考值偏差的文案、“最多列出 5 项再补总数”的写法。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 stage-creative.js、stage-beat-sheet.js、stage-screenplay.js、stage-storyboard.js 里重复的实现抽出；对外是 window.aiStageEditor；必须在 stage.js 之后、各阶段脚本之前加载；视图里的 run.display 与 actions.canEdit、actions.editNeedsConfirm 由宿主给出。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const SAVE_STATE_DIRTY = 'dirty';
  const SAVE_STATE_SAVED = 'saved';
  const SAVED_TEXT = '已保存';
  // 汇总文字里最多逐项列出的数量，超出的只补总数。
  const MAX_LISTED_ITEMS = 5;
  /** 删除条目的确认对话框里，已确认版本会回到待确认的提示。 */
  const DELETE_REOPEN_NOTE = '该版本已确认采用，删除后将回到待确认。';

  /**
   * 不能编辑时的原因；可以编辑时返回空串。
   * @param {{ run: { display: string }, actions: { canEdit: boolean } }} view 阶段视图。
   * @returns {string}
   */
  function readonlyReason(view) {
    const { run, actions } = view;
    if (actions.canEdit) return '';
    if (run.display === 'running') return '生成中，暂不能编辑。';
    if (run.display === 'failed' || run.display === 'canceled') return '生成尚未成功，暂不能编辑。';
    return '历史版本只读；如需修改，请切换到最新版本。';
  }

  /**
   * 创建保存按钮：只在有修改时可点，保存后显示“已保存”，再次修改后恢复；alwaysEnabled 为 true（新增的条目）时始终可点。
   * @param {{ text: string, alwaysEnabled?: boolean, onClick: () => void }} options text 是平时显示的文字。
   * @returns {{ button: object, setSaveState: (state: 'dirty'|'saved') => void }}
   */
  function createSaveButton(options) {
    const { text, alwaysEnabled = false, onClick } = options;
    const button = aiUi.button({ text, variant: 'primary', disabled: !alwaysEnabled, onClick });
    const setSaveState = (state) => {
      button.setText(state === SAVE_STATE_SAVED ? SAVED_TEXT : text);
      button.setDisabled(!alwaysEnabled && state !== SAVE_STATE_DIRTY);
    };
    return { button, setSaveState };
  }

  /**
   * 已确认采用的版本被编辑时，提示会回到待确认并征求确认；版本不是已确认状态时直接放行。
   * @param {{ actions: { editNeedsConfirm: boolean } }} view 阶段视图。
   * @param {{ title: string, action: string, confirmText: string }} options action 是动作名称（如“保存”“调整顺序”），拼进提示正文。
   * @returns {Promise<boolean>} 可以继续时为 true。
   */
  async function confirmReopening(view, options) {
    if (!view.actions.editNeedsConfirm) return true;
    return aiUi.confirm({
      title: options.title,
      message: `该版本已确认采用。${options.action}后将回到待确认，需要重新确认。`,
      confirmText: options.confirmText,
      cancelText: '取消'
    });
  }

  /** 偏差比例的文字，如“+8%”“-3%”“0%”。 */
  function formatDeviation(deviationRatio) {
    const percent = Math.round(deviationRatio * 100);
    return `${percent > 0 ? '+' : ''}${percent}%`;
  }

  /** “参考目标 / 实测值 / 偏差”的文字，如“参考 54 字，实测 55 字，偏差 +2%”。 */
  function describeReference(targetText, actualText, deviationRatio) {
    return `参考 ${targetText}，实测 ${actualText}，偏差 ${formatDeviation(deviationRatio)}`;
  }

  /**
   * 汇总里列出有问题的条目：最多逐项列出 MAX_LISTED_ITEMS 个，超出时 more 给出“（共 N 单位）”。
   * @param {any[]} items 全部有问题的条目。
   * @param {(item: any) => string} formatItem 单个条目的文字。
   * @param {string} unit 总数后的单位，如“章”。
   * @returns {{ listed: string, more: string }}
   */
  function limitedList(items, formatItem, unit) {
    return {
      listed: items.slice(0, MAX_LISTED_ITEMS).map(formatItem).join('、'),
      more: items.length > MAX_LISTED_ITEMS ? `（共 ${items.length} ${unit}）` : ''
    };
  }

  window.aiStageEditor = {
    SAVE_STATE_DIRTY,
    SAVE_STATE_SAVED,
    DELETE_REOPEN_NOTE,
    readonlyReason,
    createSaveButton,
    confirmReopening,
    formatDeviation,
    describeReference,
    limitedList
  };
})();
