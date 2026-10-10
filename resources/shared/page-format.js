// ------------------------------------------------------------------------
// 名称：page-format.js
// 说明：页面共用的格式化与请求封装：相对时间、日期时间、字节大小、秒数、阶段状态文字与样式类（及是否未完成）、Base64 转字节，错误说明文字、“已有表单打开时忽略”的表单打开器，“发请求并在提示区显示失败原因”的封装，以及取走页面打开前已登记的请求。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：必须先于使用它的页面脚本（包括 form/form-runtime.js）加载，依赖界面组件库（aiUi.formatBytes）和通信桥（hostBridge，请求时才使用）；状态取值与 src/domain/models/stage-run.ts 的展示状态一致，另加 none（尚未开始）。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const JUST_NOW_TEXT = '刚刚';
  const RELATIVE_TIME_LIMIT_DAYS = 30;
  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;
  const DECODE_CHUNK = 0x8000;
  const GENERIC_ERROR_TEXT = '操作失败，请重试。';

  /** 阶段状态：界面文字与状态样式类（颜色之外必须带文字）。 */
  const STAGE_STATUSES = {
    none: { label: '未开始', className: 'description' },
    running: { label: '生成中', className: 'status-warning' },
    pending: { label: '待确认', className: 'status-warning' },
    approved: { label: '已确认', className: 'status-success' },
    history: { label: '历史版本', className: 'description' },
    failed: { label: '失败', className: 'status-error' },
    canceled: { label: '已取消', className: 'description' }
  };
  /** 还没有完整内容的阶段状态。 */
  const UNFINISHED_DISPLAYS = ['running', 'failed', 'canceled'];

  /**
   * 相对时间：一分钟内“刚刚”，30 天内用相对表述，更早显示日期。
   * @param {string} isoText ISO 8601 时间文本。
   */
  function formatRelativeTime(isoText) {
    const elapsed = Date.now() - Date.parse(isoText);
    if (Number.isNaN(elapsed) || elapsed < MINUTE_MS) return JUST_NOW_TEXT;
    const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
    if (elapsed < HOUR_MS) return formatter.format(-Math.floor(elapsed / MINUTE_MS), 'minute');
    if (elapsed < DAY_MS) return formatter.format(-Math.floor(elapsed / HOUR_MS), 'hour');
    if (elapsed < RELATIVE_TIME_LIMIT_DAYS * DAY_MS) return formatter.format(-Math.floor(elapsed / DAY_MS), 'day');
    return new Date(isoText).toLocaleDateString('zh-CN');
  }

  /**
   * 日期时间：按中文本地格式显示年月日与时分秒。
   * @param {string} isoText ISO 8601 时间文本。
   */
  function formatDateTime(isoText) {
    return new Date(isoText).toLocaleString('zh-CN');
  }

  /**
   * 字节大小的可读文字（规则见组件库的 aiUi.formatBytes）。
   * @param {number} size 字节数。
   */
  function formatBytes(size) {
    return window.aiUi.formatBytes(size);
  }

  /**
   * 秒数显示：最多一位小数，整数不带小数点，带“秒”单位。
   * @param {number} seconds 秒数。
   */
  function formatSeconds(seconds) {
    return `${Number(seconds.toFixed(1))} 秒`;
  }

  /**
   * 阶段记录是否尚未产出完整的内容（生成中、失败、已取消），这些状态下不能预览分镜动画。
   * @param {string} display 阶段记录的展示状态。
   */
  function isStageUnfinished(display) {
    return UNFINISHED_DISPLAYS.includes(display);
  }

  /** 阶段状态的界面文字；未知状态原样返回。 */
  function stageStatusLabel(display) {
    const status = STAGE_STATUSES[display];
    return status ? status.label : String(display);
  }

  /** 阶段状态的样式类；未知状态使用说明文字样式。 */
  function stageStatusClass(display) {
    const status = STAGE_STATUSES[display];
    return status ? status.className : 'description';
  }

  /**
   * 取宿主返回的错误说明文字：有字段错误时逐项列出，否则用错误说明，都没有时用通用提示。
   * @param {{ message?: string, fieldErrors?: Record<string, string> }|undefined} error 请求失败时抓到的错误。
   * @returns {string}
   */
  function errorText(error) {
    const fields = error && error.fieldErrors ? Object.values(error.fieldErrors) : [];
    return fields.length > 0 ? fields.join('\n') : (error && error.message) || GENERIC_ERROR_TEXT;
  }

  /**
   * 执行一个请求；失败时把错误说明文字交给 onError，并返回 undefined。
   * @param {() => Promise<any>} request 发起请求的函数。
   * @param {(text: string) => void} onError 失败时显示原因的函数。
   * @returns {Promise<any>} 成功时是响应数据，失败时是 undefined。
   */
  async function requestAction(request, onError) {
    try {
      return await request();
    } catch (error) {
      onError(errorText(error));
      return undefined;
    }
  }

  /**
   * 创建“先清除提示、再发请求、失败时在提示区显示原因”的函数。
   * @param {{ show: (text: string, isError?: boolean) => void }|(() => ({ show: Function }|null))} messageOrGetter
   *   提示区（aiUi.message 返回的对象），或返回当前提示区的函数（没有提示区时返回 null，不显示）。
   * @returns {(name: string, payload?: unknown) => Promise<any>} 成功返回响应数据，失败返回 undefined。
   */
  function createActionRunner(messageOrGetter) {
    const current = () => (typeof messageOrGetter === 'function' ? messageOrGetter() : messageOrGetter);
    return async function runAction(name, payload) {
      const message = current();
      if (message) message.show('', false);
      return requestAction(
        () => window.hostBridge.request(name, payload),
        (text) => {
          const target = current();
          if (target) target.show(text, true);
        }
      );
    };
  }

  /**
   * 创建表单打开器：已有表单（或由 runExclusive 跑着的流程）打开时忽略新的请求，避免重复点击叠出多个。
   * @param {{ open: (options: object) => Promise<boolean> }} forms 表单引擎（aiForm）。
   * @returns {{ open: (options: object) => Promise<boolean|undefined>, runExclusive: (task: () => Promise<any>) => Promise<any>, isOpen: () => boolean }}
   *   open 打开表单并等待关闭，已有打开时返回 undefined；runExclusive 独占地跑一个异步流程（如先选择再打开表单）；isOpen 是否有打开的。
   */
  function createFormOpener(forms) {
    let isOpen = false;
    async function runExclusive(task) {
      if (isOpen) return undefined;
      isOpen = true;
      try {
        return await task();
      } finally {
        isOpen = false;
      }
    }
    return { open: (options) => runExclusive(() => forms.open(options)), runExclusive, isOpen: () => isOpen };
  }

  /**
   * 取走页面打开前已登记的请求（如侧栏点“添加”）并交给处理函数；取不到或处理失败只记录警告，不影响页面使用。
   * @param {string} requestName 取走请求的宿主请求名。
   * @param {(request: any) => any} handleRequest 处理请求的函数，可以是异步的。
   * @param {(result: any) => any} [pickRequest] 从宿主返回值里取出请求，缺省取 result.request。
   * @returns {Promise<void>}
   */
  async function takePendingRequest(requestName, handleRequest, pickRequest = (result) => result && result.request) {
    try {
      await handleRequest(pickRequest(await window.hostBridge.request(requestName)));
    } catch (error) {
      console.warn('取页面打开前登记的请求失败：', error);
    }
  }

  /** Base64 转字节；分块转换，避免大文件一次占用过多内存。 */
  function decodeBase64(text) {
    const binary = window.atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let start = 0; start < binary.length; start += DECODE_CHUNK) {
      const end = Math.min(start + DECODE_CHUNK, binary.length);
      for (let index = start; index < end; index += 1) bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  window.pageFormat = {
    formatRelativeTime,
    formatDateTime,
    formatBytes,
    formatSeconds,
    isStageUnfinished,
    stageStatusLabel,
    stageStatusClass,
    decodeBase64,
    genericErrorText: GENERIC_ERROR_TEXT,
    errorText,
    requestAction,
    createActionRunner,
    createFormOpener,
    takePendingRequest
  };
})();
