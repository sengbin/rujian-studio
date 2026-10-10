// ------------------------------------------------------------------------
// 名称：job-actions.js
// 说明：工作台上对生成任务与结果视频的操作：取消任务、打开、导出、在文件夹中显示结果视频、采用某个结果版本、读取并弹出一组的结果版本页。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：从 workbench.js 拆出；请求名称与 src/app/pages/workbench-handlers.ts 一致；对外是 window.aiWorkbenchActions.create(host)；必须先于 workbench.js、晚于 job-display.js 与 versions.js 加载；依赖 shared/page-format.js（pageFormat）。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_CANCEL = 'workbench.cancel';
  const REQUEST_SELECT_RESULT = 'workbench.selectResult';
  const REQUEST_GROUP_VERSIONS = 'workbench.groupVersions';
  const REQUEST_OPEN_RESULT = 'workbench.openResult';
  const REQUEST_EXPORT_RESULT = 'workbench.exportResult';
  const REQUEST_REVEAL_RESULT = 'workbench.revealResult';

  const { describeResult, describeJobParams, describeJobFields } = window.aiWorkbenchJobs;
  const { errorText } = window.pageFormat;

  /**
   * 创建任务与结果操作；只创建一个实例。
   * @param {{
   *   getView: () => { groups: object[] }|null,
   *   getEpisodeTarget: () => { workId: number, episodeId: number },
   *   runAction: (name: string, payload?: object) => Promise<any>,
   *   message: { show: (text: string, isError: boolean) => void },
   *   reload: () => Promise<void>
   * }} host 宿主页面提供的状态与操作：runAction 发起请求并把失败显示在提示区，reload 重新读取当前集。
   * @returns {{ cancelJob: Function, openResult: Function, exportResult: Function, revealResult: Function, openVersions: Function }}
   */
  function create(host) {
    /** 取消进行中的任务；生成中的任务说明平台上可能仍会继续。 */
    async function cancelJob(job) {
      const isRunning = job.status === 'running';
      const confirmed = await aiUi.confirm({
        title: '取消任务',
        message: isRunning
          ? '确认取消这个任务？取消后不再等待结果；如果平台不支持取消，平台上的任务可能仍会继续生成并计费。'
          : '确认取消这个排队中的任务？',
        confirmText: '取消任务',
        cancelText: '保留',
        variant: 'danger'
      });
      if (!confirmed) return;
      const result = await host.runAction(REQUEST_CANCEL, { jobId: job.id });
      if (result && result.remoteCancelError) {
        host.message.show(`已停止等待这个任务的结果，但通知平台取消失败（${result.remoteCancelError}）。平台上的任务可能仍在继续并计费，请到平台控制台确认。`, true);
      } else if (result && isRunning && !result.remoteCanceled) {
        host.message.show('已停止等待这个任务的结果。平台不支持取消，平台上的任务可能仍会继续生成并计费。', false);
      }
      await host.reload();
    }

    /** 用系统播放器打开结果视频。 */
    async function openResult(result) {
      await host.runAction(REQUEST_OPEN_RESULT, { resultId: result.id });
    }

    /** 导出结果视频：宿主弹出“另存为”对话框，完成后在右下角通知。 */
    async function exportResult(result) {
      await host.runAction(REQUEST_EXPORT_RESULT, { resultId: result.id });
    }

    async function revealResult(result) {
      await host.runAction(REQUEST_REVEAL_RESULT, { resultId: result.id });
    }

    /** 采用一个结果版本；下一组采用的视频是接在这一组尾帧之后生成的，先征求确认。 */
    async function selectResult(result, groupId) {
      const view = host.getView();
      const index = view.groups.findIndex((group) => group.id === groupId);
      const next = view.groups[index + 1];
      const dependsOnTail = next && next.jobs.some((job) => job.result && job.result.isSelected && job.usesPreviousTail);
      if (dependsOnTail) {
        const confirmed = await aiUi.confirm({
          title: '采用此版本',
          message: `第 ${next.seq} 组采用的视频是接在这一组当前采用版本的尾帧之后生成的。改用其他版本后这两组的画面可能不连贯，需要重新生成第 ${next.seq} 组（不会自动重做）。确认采用？`,
          confirmText: '采用',
          cancelText: '取消'
        });
        if (!confirmed) return { ok: false, cancelled: true };
      }
      try {
        await window.hostBridge.request(REQUEST_SELECT_RESULT, { resultId: result.id });
      } catch (error) {
        return { ok: false, message: errorText(error) };
      }
      await host.reload();
      return { ok: true };
    }

    /** 向宿主读取这一组全部历史成功版本（工作台列表只带最近若干条任务）；失败时返回原因。 */
    async function loadGroupVersions(groupId) {
      const { workId, episodeId } = host.getEpisodeTarget();
      try {
        return { ok: true, jobs: await window.hostBridge.request(REQUEST_GROUP_VERSIONS, { workId, episodeId, groupId }) };
      } catch (error) {
        return { ok: false, message: errorText(error) };
      }
    }

    /** 弹出这一组的结果版本页：采用、打开、导出、对比。 */
    function openVersions(group) {
      aiVersions.open(group.id, {
        getState: () => ({ view: host.getView() }),
        loadVersions: loadGroupVersions,
        select: selectResult,
        describeParams: describeJobParams,
        describeResult,
        describeFields: describeJobFields,
        openResult,
        exportResult,
        revealResult
      });
    }

    return { cancelJob, openResult, exportResult, revealResult, openVersions };
  }

  window.aiWorkbenchActions = { create };
})();
