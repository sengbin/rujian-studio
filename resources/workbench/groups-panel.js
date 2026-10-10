// ------------------------------------------------------------------------
// 名称：groups-panel.js
// 说明：工作台左栏的镜头组列表：每组一行（序号、状态、镜头数与总时长），底部是镜头总数与按填写的单组最长时长重新分组。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 workbench.js 拆出；对外是 window.aiWorkbenchGroups.create(host)，返回 render(selectedId)；必须先于 workbench.js、晚于 job-display.js 加载；“重新分组”填写的时长由本面板保存，用户没改过时跟随当前模型与分镜脚本设定。
// ------------------------------------------------------------------------

'use strict';

(function () {
  /** 模型单次最长时长不超过该值（秒）时，重新分组默认按模型上限填写。 */
  const REGROUP_DEFAULT_LIMIT_SECONDS = 120;

  const { groupStatus, hasActiveJob } = window.aiWorkbenchJobs;

  /**
   * 创建镜头组列表面板；只创建一个实例。
   * @param {{
   *   getView: () => { groups: object[], groupMaxSeconds: number },
   *   modelMaxSeconds: () => number|null,
   *   selectGroup: (group: object) => void,
   *   regroup: (secondsText: string) => Promise<void>
   * }} host 宿主页面提供的状态与操作：modelMaxSeconds 是所选模型单次最长时长（没有上限信息时为 null），regroup 按填写的时长重新分组。
   * @returns {{ render: (selectedId: number) => HTMLElement }}
   */
  function create(host) {
    /** 重新分组时填写的单组最长时长；用户没改过时跟随当前模型与分镜脚本设定。 */
    let regroupSeconds = '';

    /** 左栏底部：镜头总数，以及按填写的单组最长时长重新分组（有进行中的任务时禁用）。 */
    function renderRegroup() {
      const view = host.getView();
      const shotTotal = view.groups.reduce((sum, group) => sum + group.shots.length, 0);
      const max = host.modelMaxSeconds();
      if (regroupSeconds === '') regroupSeconds = String(max !== null && max <= REGROUP_DEFAULT_LIMIT_SECONDS ? max : view.groupMaxSeconds);
      const secondsInput = aiUi.textInput({ value: regroupSeconds, ariaLabel: '重新分组时每组最长（秒）', onChange: (value) => (regroupSeconds = value) });
      return aiUi.h(
        'div',
        { class: 'wb-panel__footer' },
        aiUi.h('p', { class: 'description', text: `共 ${shotTotal} 个镜头` }),
        aiUi.h(
          'div',
          { class: 'wb-regroup' },
          aiUi.h('span', { class: 'description', text: '每组最长' }),
          aiUi.h('div', { class: 'wb-regroup__input' }, secondsInput.element),
          aiUi.h('span', { class: 'description', text: '秒' }),
          aiUi.button({ text: '重新分组', compact: true, disabled: view.groups.some(hasActiveJob), onClick: () => void host.regroup(secondsInput.getValue()) }).element
        )
      );
    }

    /** 左栏：镜头组列表（序号、状态、镜头数与总时长），底部是镜头总数与重新分组。 */
    function render(selectedId) {
      const view = host.getView();
      const items = view.groups.map((group) => {
        const isSelected = group.id === selectedId;
        const status = groupStatus(group);
        return aiUi.h(
          'li',
          {},
          aiUi.listItem(
            { selected: isSelected, className: 'wb-group-item', onClick: () => host.selectGroup(group) },
            aiUi.h('span', { class: 'wb-group-item__name', text: `第 ${group.seq} 组` }),
            aiUi.h('span', { class: `wb-group-item__status ${status.className}`, text: status.text }),
            aiUi.h('span', { class: 'wb-group-item__meta description', text: `${group.shots.length} 个镜头 · ${group.totalSeconds} 秒` })
          )
        );
      });
      return aiUi.h(
        'nav',
        { class: 'wb-panel wb-groups', attrs: { 'aria-label': '镜头组' } },
        aiUi.h(
          'div',
          { class: 'wb-panel__header' },
          aiUi.h('div', {}, aiUi.h('h2', { class: 'ui-title wb-panel__title', text: '镜头组' }), aiUi.h('p', { class: 'wb-panel__subtitle', text: '选择一组查看内容与进度' })),
          aiUi.h('span', { class: 'wb-count', text: `${view.groups.length} 组` })
        ),
        aiUi.h('ul', { class: 'wb-panel__body wb-groups__list' }, items),
        renderRegroup()
      );
    }

    return { render };
  }

  window.aiWorkbenchGroups = { create };
})();
