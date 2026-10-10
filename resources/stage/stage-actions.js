// ------------------------------------------------------------------------
// 名称：stage-actions.js
// 说明：阶段产出层的操作集合：确认采用、取消生成、重试、重新生成、查看原始输出、切换版本。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 stage.js 拆出，通过 window.aiStageActions.create(ctx) 创建；视图、固定版本等页面状态仍由 stage.js 持有，通过 ctx 里的访问器读写；请求名称与 src/app/pages/stage-handlers.ts 一致；依赖 aiUi 组件库，必须在 stage.js 之前加载。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_APPROVE = 'stage.approve';
  const REQUEST_CANCEL = 'stage.cancel';
  const REQUEST_RETRY = 'stage.retry';
  const REQUEST_RAW_OUTPUT = 'stage.rawOutput';

  /**
   * 创建一个产出层的操作集合。
   * @param {{ provider: object, episodeId: number|null, forms: object, content: object, getView: () => object|null,
   *   getLatestRunId: () => number|null, setPinnedRunId: (runId: number|null) => void,
   *   runAction: (name: string, payload?: object) => Promise<unknown>, showMessage: (text: string, isError: boolean) => void,
   *   titleSuffix: () => string, reload: () => Promise<void>, confirmDiscardEdits: () => Promise<boolean>, renderHeader: () => void }} ctx
   *   provider 为阶段登记的内容，content 为它创建的内容区；forms 为“重新生成”表单的打开器；
   *   getView、getLatestRunId、setPinnedRunId 读写 stage.js 持有的当前视图与版本状态；runAction 发起带作品与阶段的请求并在失败时提示；
   *   reload 在后台重新读取视图；confirmDiscardEdits 在有未保存修改时询问是否放弃；renderHeader 重绘头部（取消切换版本时恢复下拉的选中项）。
   * @returns {{ approve: () => Promise<void>, cancelGeneration: () => Promise<void>, retryGeneration: () => Promise<void>,
   *   regenerate: () => Promise<void>, showRawOutput: () => Promise<void>, switchVersion: (runId: number) => Promise<void> }}
   */
  function create(ctx) {
    const { provider, episodeId, forms, content, getView, getLatestRunId, setPinnedRunId, runAction, showMessage, titleSuffix, reload, confirmDiscardEdits, renderHeader } = ctx;

    /** 确认采用：说明影响后请求宿主。 */
    async function approve() {
      const confirmed = await aiUi.confirm({
        title: '确认采用',
        message: `确认采用“${getView().work.name}”的${provider.label}${titleSuffix().replace(' › ', ' ')} v${getView().run.version}？${provider.approveNote(getView())}`,
        confirmText: '确认采用'
      });
      if (!confirmed) return;
      if (await runAction(REQUEST_APPROVE, { id: getView().run.id })) {
        await reload();
        showMessage('已确认采用。', false);
      }
    }

    async function cancelGeneration() {
      await runAction(REQUEST_CANCEL, { id: getView().run.id });
    }

    async function retryGeneration() {
      if (await runAction(REQUEST_RETRY, { id: getView().run.id })) await reload();
    }

    /** 弹出“重新生成”表单，初始值为上次使用的参数。 */
    async function regenerate() {
      if (forms.isOpen() || !(await confirmDiscardEdits())) return;
      if (provider.confirmRegenerate && !(await provider.confirmRegenerate(getView()))) return;
      await forms.open({ form: provider.regenerateForm, params: { workId: getView().work.id, ...(episodeId ? { episodeId } : {}) } });
    }

    /** 在弹出页面中显示失败时保留的模型原始输出。 */
    async function showRawOutput() {
      const result = await runAction(REQUEST_RAW_OUTPUT, { id: getView().run.id });
      if (!result) return;
      aiUi.openPage({
        title: '模型原始输出',
        content: aiUi.h('pre', { class: 'stage-raw', text: result.text || '（没有保留原始输出）' }),
        width: 640,
        height: 420,
        buttons: [{ id: 'close', text: '关闭', variant: 'primary', isDefault: true, isCancel: true }]
      });
    }

    /** 切换版本：固定查看所选版本；选择最新版本等于取消固定。 */
    async function switchVersion(runId) {
      if (!(await confirmDiscardEdits())) {
        renderHeader();
        return;
      }
      content.discard();
      setPinnedRunId(runId === getLatestRunId() ? null : runId);
      await reload();
    }

    return { approve, cancelGeneration, retryGeneration, regenerate, showRawOutput, switchVersion };
  }

  window.aiStageActions = { create };
})();
