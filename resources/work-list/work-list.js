// ------------------------------------------------------------------------
// 名称：work-list.js
// 说明：作品列表页脚本：列出某种素材来源下所有项目的作品（或跨来源的剧本、分镜视图），按项目与名称关键字筛选，在页内弹出页面中新建、编辑作品、生成剧本与分镜脚本，弹出创意、剧本、分镜脚本产出层，带名称确认地删除作品。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-01
// 备注：请求与事件名称与 src/app/pages/work-list-handlers.ts、src/app/forms/work-form.ts、src/app/forms/screenplay-form.ts、src/app/forms/storyboard-form.ts 一致；依赖 form/form-runtime.js（aiForm）、stage/stage.js（aiStage）与 shared/page-format.js（pageFormat）。
// ------------------------------------------------------------------------

'use strict';

(function () {
  const REQUEST_LOAD = 'works.load';
  const REQUEST_TAKE_PENDING = 'works.takePending';
  const REQUEST_PREPARE_DELETE = 'works.prepareDelete';
  const REQUEST_DELETE = 'works.delete';
  const REQUEST_STORYBOARD_EPISODES = 'works.storyboardEpisodes';
  const EVENT_CHANGED = 'works.changed';
  const EVENT_ACTION = 'works.action';
  const EVENT_OPEN_STAGE = 'works.openStage';
  const EVENT_START_SCREENPLAY = 'works.startScreenplay';
  const EVENT_START_STORYBOARD = 'works.startStoryboard';
  const EVENT_OPEN_STORYBOARD_LIST = 'works.openStoryboardList';
  const ACTION_CREATE = 'create';
  const FORM_CREATE = 'work.create';
  const FORM_EDIT = 'work.edit';
  const FORM_START_BEAT_SHEET = 'beatSheet.start';
  const FORM_START_SCREENPLAY = 'screenplay.start';
  const FORM_PICK_SCREENPLAY = 'screenplay.pick';
  const FORM_START_STORYBOARD = 'storyboard.start';
  const FORM_PICK_STORYBOARD = 'storyboard.pick';
  const STAGE_BEAT_SHEET = 'beat_sheet';
  const STAGE_CREATIVE = 'creative';
  const STAGE_SCREENPLAY = 'screenplay';
  const STAGE_STORYBOARD = 'storyboard_script';
  const VIEW_SCREENPLAY = 'screenplay';
  const VIEW_STORYBOARD = 'storyboard';
  const VIEW_ORIGINAL = 'original';

  const FILTER_ALL = 'all';
  const REFRESH_DELAY_MS = 150;
  const SOURCE_LABELS = { text: '文字灵感', image: '灵感图片', novel: '小说原文', original: '原创文稿' };
  /** 剧本视图的状态筛选：值为剧本阶段的展示状态，none 表示还没开始。 */
  const STATUS_FILTER_OPTIONS = [
    { value: FILTER_ALL, label: '全部状态' },
    { value: 'none', label: '未开始' },
    { value: 'running', label: '生成中' },
    { value: 'pending', label: '待确认' },
    { value: 'approved', label: '已确认' },
    { value: 'failed', label: '失败' },
    { value: 'canceled', label: '已取消' }
  ];

  const { formatRelativeTime, formatDateTime, stageStatusLabel, stageStatusClass, errorText, createActionRunner, createFormOpener } = window.pageFormat;

  const root = document.getElementById('app');
  /** 页面绑定的视图（素材来源或剧本），首次加载成功后由宿主告知。 */
  let view = '';
  let projects = [];
  let works = [];
  let loadError = '';
  let isLoading = true;
  /** 表单还开着时收到的「稍后执行」请求（如弹出产出层、打开下一个表单），表单关闭后执行。 */
  let afterFormClosed = null;
  let filterProjectId = FILTER_ALL;
  let filterStatus = FILTER_ALL;
  let keyword = '';
  let refreshTimer = 0;
  /** 项目下拉当前对应的项目清单标记，清单变化时才重建下拉；为 null 表示还没有渲染过。 */
  let projectOptionsKey = null;
  let projectSlot = null;
  let statusSlot = null;
  let contentElement = null;
  /** 操作结果提示区。 */
  const message = aiUi.message();
  const runAction = createActionRunner(message);
  const forms = createFormOpener(aiForm);

  /** 项目下拉：全部项目加各个项目；项目被删除时回到“全部项目”。 */
  function renderProjectFilter() {
    const key = projects.map((project) => `${project.id}:${project.name}`).join('|');
    if (!projects.some((project) => String(project.id) === filterProjectId)) filterProjectId = FILTER_ALL;
    if (key === projectOptionsKey) return;
    projectOptionsKey = key;
    const select = aiUi.select({
      options: [{ value: FILTER_ALL, label: '全部项目' }, ...projects.map((project) => ({ value: String(project.id), label: project.name }))],
      value: filterProjectId,
      allowEmpty: false,
      ariaLabel: '按项目筛选',
      onChange: (value) => {
        filterProjectId = value;
        renderContent();
      }
    });
    projectSlot.textContent = '';
    projectSlot.append(select.element);
  }

  /** 状态下拉：只在剧本视图显示，知道视图后建一次。 */
  function renderStatusFilter() {
    if (view !== VIEW_SCREENPLAY || statusSlot.childElementCount > 0) return;
    const select = aiUi.select({
      options: STATUS_FILTER_OPTIONS,
      value: filterStatus,
      allowEmpty: false,
      ariaLabel: '按剧本状态筛选',
      onChange: (value) => {
        filterStatus = value;
        renderContent();
      }
    });
    statusSlot.append(select.element);
    statusSlot.hidden = false;
  }

  /** 加载请求的序号，只采纳最后一次请求的响应。 */
  let loadSerial = 0;

  /** 加载作品并刷新界面；showLoading 为 false 时保留现有内容（后台刷新）。 */
  async function loadWorks(showLoading) {
    loadSerial += 1;
    const serial = loadSerial;
    if (showLoading) {
      isLoading = true;
      renderContent();
    }
    let data = null;
    let failure = '';
    try {
      data = await window.hostBridge.request(REQUEST_LOAD);
    } catch (error) {
      failure = (error && error.message) || '作品加载失败。';
    }
    if (serial !== loadSerial) return;
    loadError = failure;
    if (data !== null) {
      view = data.view;
      projects = data.projects;
      works = data.works;
      // 作品被删除（或随所属项目一起删除）后，它的产出层没有意义，自动关闭。
      aiStage.closeMissing(works.map((work) => work.id));
    }
    isLoading = false;
    renderProjectFilter();
    renderStatusFilter();
    renderContent();
  }

  /** 数据变化后稍作合并再刷新，生成进度频繁推送时避免反复重绘。 */
  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      void loadWorks(false);
      if (episodeListRefresh) void episodeListRefresh();
    }, REFRESH_DELAY_MS);
  }

  /** 弹出表单；已有表单打开时忽略，避免重复点击叠出多个；表单关闭后执行等待中的动作。 */
  async function showForm(options) {
    if (forms.isOpen()) return;
    try {
      await forms.open(options);
    } finally {
      const next = afterFormClosed;
      afterFormClosed = null;
      if (next) next();
    }
  }

  /** 执行一个动作；表单还开着时等它关闭后再执行，避免两个弹出页同时出现。 */
  function runAfterForm(action) {
    if (forms.isOpen()) afterFormClosed = action;
    else action();
  }

  /** 弹出作品某个阶段的产出层；分镜脚本阶段还要指定集。 */
  function openStage(workId, stage, episodeId) {
    runAfterForm(() => aiStage.open(workId, stage, episodeId || null));
  }

  /** 弹出“新建作品”表单（剧本、分镜视图中为“选择作品”）；筛选了某个项目时把它作为默认值或限定范围。 */
  function openCreateForm() {
    const isPickView = view === VIEW_SCREENPLAY || view === VIEW_STORYBOARD;
    const params = isPickView ? {} : { sourceType: view };
    if (filterProjectId !== FILTER_ALL) params.projectId = Number(filterProjectId);
    const form = view === VIEW_SCREENPLAY ? FORM_PICK_SCREENPLAY : view === VIEW_STORYBOARD ? FORM_PICK_STORYBOARD : FORM_CREATE;
    void showForm({ form, params });
  }

  /** 弹出“编辑作品”表单。 */
  function openEditForm(work) {
    void showForm({ form: FORM_EDIT, params: { workId: work.id } });
  }

  /** 弹出“生成节拍表”表单。 */
  function openBeatSheetForm(work) {
    void showForm({ form: FORM_START_BEAT_SHEET, params: { workId: work.id } });
  }

  /** 弹出“生成剧本”表单；创意已确认才能打开。 */
  function openScreenplayForm(work) {
    void showForm({ form: FORM_START_SCREENPLAY, params: { workId: work.id } });
  }

  /** 弹出“生成分镜脚本”表单；剧本已确认才能打开，指定集时只为这一集生成。 */
  function openStoryboardForm(workId, episodeId) {
    void showForm({ form: FORM_START_STORYBOARD, params: episodeId ? { workId, episodeId } : { workId } });
  }

  /** 查看作品的分镜脚本：单个短视频直接打开那一集，多集短片先弹出各集的状态列表。 */
  async function viewStoryboards(work) {
    if (!work.multiEpisode) {
      const result = await runAction(REQUEST_STORYBOARD_EPISODES, { workId: work.id });
      const episode = result && result.episodes.find((item) => item.runId !== null);
      if (episode) openStage(work.id, STAGE_STORYBOARD, episode.episodeId);
      return;
    }
    openEpisodeList(work);
  }

  /** 某一集是否有可播放动画的分镜脚本：有镜头且生成已经结束。 */
  function canPreviewEpisode(item) {
    return item.runId !== null && item.shotCount > 0 && !['running', 'failed', 'canceled'].includes(item.display);
  }

  /** 预览作品的分镜动画：单个短视频直接播放那一集，多集短片先弹出各集的列表，在列表里选集。 */
  async function previewStoryboards(work) {
    if (!work.multiEpisode) {
      const result = await runAction(REQUEST_STORYBOARD_EPISODES, { workId: work.id });
      const episode = result && result.episodes.find(canPreviewEpisode);
      if (episode) aiStoryboardPreview.open({ workId: work.id, episodeId: episode.episodeId });
      return;
    }
    openEpisodeList(work);
  }

  /** 同一时间只显示一个“各集分镜脚本”列表，数据变化时原地刷新。 */
  let episodeListRefresh = null;

  /** 弹出作品各集的分镜脚本状态，可查看或重新生成某一集。 */
  function openEpisodeList(work) {
    if (episodeListRefresh) return;
    const content = aiUi.h('div');
    const columns = [
      { title: '集', width: '34%', minWidth: 140, render: (item) => aiUi.tableMainCell({ text: `第 ${item.seq} 集 ${item.title}` }) },
      { title: '分镜脚本', width: '28%', minWidth: 120, render: (item) => renderStageStatus(item) },
      { title: '镜头数', width: 70, nowrap: true, muted: true, render: (item) => (item.runId === null ? '—' : String(item.shotCount)) },
      {
        title: '操作',
        type: 'actions',
        render: (item) => [
          aiUi.button({
            text: '查看',
            compact: true,
            disabled: item.runId === null,
            ariaLabel: `查看第 ${item.seq} 集的分镜脚本`,
            onClick: () => openStage(work.id, STAGE_STORYBOARD, item.episodeId)
          }).element,
          aiUi.button({
            text: '动画',
            icon: 'movie',
            compact: true,
            disabled: !canPreviewEpisode(item),
            ariaLabel: `预览第 ${item.seq} 集的分镜动画`,
            onClick: () => aiStoryboardPreview.open({ workId: work.id, episodeId: item.episodeId })
          }).element,
          aiUi.button({
            text: item.runId === null ? '生成' : '重新生成',
            compact: true,
            disabled: item.display === 'running',
            ariaLabel: `生成第 ${item.seq} 集的分镜脚本`,
            onClick: () => openStoryboardForm(work.id, item.episodeId)
          }).element
        ]
      }
    ];
    /** 读取作品各集的分镜脚本状态并刷新弹出页内容。 */
    async function load() {
      try {
        const result = await window.hostBridge.request(REQUEST_STORYBOARD_EPISODES, { workId: work.id });
        content.textContent = '';
        content.append(
          result.episodes.length === 0
            ? aiUi.h('p', { class: 'description', text: '这个作品还没有集。' })
            : aiUi.table({ columns, rows: result.episodes, ariaLabel: '各集分镜脚本' }).element
        );
      } catch (error) {
        content.textContent = '';
        content.append(aiUi.h('p', { class: 'status-error', text: errorText(error) }));
      }
    }
    episodeListRefresh = load;
    const handle = aiUi.openPage({
      title: `${work.name} › 分镜脚本`,
      content,
      width: 640,
      height: 360,
      minWidth: 420,
      minHeight: 240,
      buttons: [{ id: 'close', text: '关闭', variant: 'primary', isDefault: true, isCancel: true }]
    });
    void handle.closed.then(() => {
      episodeListRefresh = null;
    });
    void load();
  }

  /** 删除作品：先取名称，再用页内删除对话框要求输入作品名称，最后请求删除。 */
  async function deleteWork(work) {
    const prepared = await runAction(REQUEST_PREPARE_DELETE, { id: work.id });
    if (!prepared) return;

    const confirmed = await aiUi.confirmDelete({
      title: '删除作品',
      message: `将删除作品“${prepared.name}”及其素材、创意、剧本等全部内容，且无法恢复。`,
      confirmName: prepared.name,
      nameLabel: '作品名称'
    });
    if (!confirmed) return;

    const result = await runAction(REQUEST_DELETE, { id: work.id, confirmName: prepared.name });
    if (result) message.show(`已删除作品“${result.name}”。`, false);
  }

  /** 处理宿主带来的请求：弹出“新建作品”或“选择作品”表单；页面还没加载完时先等一次加载，才知道视图。 */
  async function handleRequest(request) {
    if (!request || request.action !== ACTION_CREATE) return;
    if (!view) await initialLoad;
    if (view) openCreateForm();
  }

  /** 阶段状态单元格：状态文字加版本号，生成中附带进度，上游已变更时加标记。 */
  function renderStageStatus(summary) {
    if (summary.display === 'none') {
      return aiUi.h('span', { class: stageStatusClass('none'), text: stageStatusLabel('none') });
    }
    const progress = summary.progressText ? `（${summary.progressText}）` : '';
    const stale = summary.stale ? '，上游已变更' : '';
    return aiUi.h('span', {
      class: summary.stale ? 'status-warning' : stageStatusClass(summary.display),
      text: `v${summary.version} ${stageStatusLabel(summary.display)}${progress}${stale}`
    });
  }

  /** 剧本操作按钮（仅剧本视图）：已有剧本记录时查看；没有时创意已确认才能生成。 */
  function renderScreenplayButton(work) {
    if (work.screenplay.runId !== null) {
      return aiUi.button({
        text: '查看剧本',
        compact: true,
        ariaLabel: `查看剧本：${work.name}`,
        onClick: () => openStage(work.id, STAGE_SCREENPLAY)
      }).element;
    }
    return aiUi.button({
      text: '生成剧本',
      compact: true,
      disabled: !work.canStartScreenplay,
      ariaLabel: `生成剧本：${work.name}`,
      onClick: () => openScreenplayForm(work)
    }).element;
  }

  /** 节拍表操作按钮（素材来源视图）：已有记录时查看，没有时生成。 */
  function renderBeatSheetButton(work) {
    const exists = work.beatSheet.runId !== null;
    return aiUi.button({
      text: exists ? '查看节拍表' : '生成节拍表',
      compact: true,
      ariaLabel: `${exists ? '查看' : '生成'}节拍表：${work.name}`,
      onClick: () => (exists ? openStage(work.id, STAGE_BEAT_SHEET) : openBeatSheetForm(work))
    }).element;
  }

  /** 作品表格的列（素材来源视图）。 */
  const WORK_COLUMNS = [
    {
      title: '作品名称',
      width: '22%',
      minWidth: 170,
      render: (work) => aiUi.tableMainCell({ text: work.name, description: work.kindLabel || '' })
    },
    { title: '所属项目', width: '14%', minWidth: 110, render: (work) => aiUi.chip({ text: work.projectName }) },
    { title: '节拍表', width: '14%', minWidth: 110, render: (work) => renderStageStatus(work.beatSheet) },
    { title: '创意', width: '14%', minWidth: 110, render: (work) => renderStageStatus(work.creative) },
    { title: '剧本', width: '14%', minWidth: 110, render: (work) => renderStageStatus(work.screenplay) },
    {
      title: '创建时间',
      width: 110,
      nowrap: true,
      muted: true,
      render: (work) => formatRelativeTime(work.createdAt),
      tooltip: (work) => formatDateTime(work.createdAt)
    },
    {
      title: '操作',
      type: 'actions',
      render: (work) => [
        renderBeatSheetButton(work),
        aiUi.button({
          text: '查看创意',
          compact: true,
          disabled: work.creative.runId === null,
          ariaLabel: `查看创意：${work.name}`,
          onClick: () => openStage(work.id, STAGE_CREATIVE)
        }).element,
        aiUi.button({
          kind: 'edit',
          compact: true,
          ariaLabel: `修改：${work.name}`,
          onClick: () => openEditForm(work)
        }).element,
        aiUi.button({
          kind: 'delete',
          compact: true,
          ariaLabel: `删除：${work.name}`,
          onClick: () => void deleteWork(work)
        }).element
      ]
    }
  ];

  /** 集数与实体数；还没有抽取结果时显示破折号。 */
  function formatContentCounts(counts) {
    return counts ? `${counts.episodes} 集 · ${counts.entities} 个实体` : '—';
  }

  /** 作品表格的列（原创文稿视图）：原稿导入后即已确认。 */
  const ORIGINAL_COLUMNS = [
    {
      title: '作品名称',
      width: '22%',
      minWidth: 170,
      render: (work) => aiUi.tableMainCell({ text: work.name, description: work.kindLabel || '' })
    },
    { title: '所属项目', width: '14%', minWidth: 110, render: (work) => aiUi.chip({ text: work.projectName }) },
    { title: '节拍表', width: '14%', minWidth: 110, render: (work) => renderStageStatus(work.beatSheet) },
    { title: '原稿', width: '14%', minWidth: 110, render: (work) => renderStageStatus(work.creative) },
    { title: '剧本', width: '14%', minWidth: 110, render: (work) => renderStageStatus(work.screenplay) },
    {
      title: '创建时间',
      width: 110,
      nowrap: true,
      muted: true,
      render: (work) => formatRelativeTime(work.createdAt),
      tooltip: (work) => formatDateTime(work.createdAt)
    },
    {
      title: '操作',
      type: 'actions',
      render: (work) => [
        renderBeatSheetButton(work),
        aiUi.button({
          text: '查看原稿',
          compact: true,
          disabled: work.creative.runId === null,
          ariaLabel: `查看原稿：${work.name}`,
          onClick: () => openStage(work.id, STAGE_CREATIVE)
        }).element,
        aiUi.button({
          kind: 'edit',
          compact: true,
          ariaLabel: `修改：${work.name}`,
          onClick: () => openEditForm(work)
        }).element,
        aiUi.button({
          kind: 'delete',
          compact: true,
          ariaLabel: `删除：${work.name}`,
          onClick: () => void deleteWork(work)
        }).element
      ]
    }
  ];

  /** 作品表格的列（剧本视图）：跨素材来源，只有剧本相关的操作。 */
  const SCREENPLAY_COLUMNS = [
    {
      title: '作品名称',
      width: '26%',
      minWidth: 180,
      render: (work) => aiUi.tableMainCell({ text: work.name, description: work.kindLabel || '' })
    },
    { title: '所属项目', width: '16%', minWidth: 120, render: (work) => aiUi.chip({ text: work.projectName }) },
    { title: '素材来源', width: '12%', minWidth: 100, render: (work) => aiUi.chip({ text: SOURCE_LABELS[work.sourceType] || work.sourceType }) },
    { title: '剧本', width: '18%', minWidth: 140, render: (work) => renderStageStatus(work.screenplay) },
    { title: '内容', width: '14%', minWidth: 120, muted: true, nowrap: true, render: (work) => formatContentCounts(work.contentCounts) },
    {
      title: '创建时间',
      width: 110,
      nowrap: true,
      muted: true,
      render: (work) => formatRelativeTime(work.createdAt),
      tooltip: (work) => formatDateTime(work.createdAt)
    },
    { title: '操作', type: 'actions', render: (work) => [renderScreenplayButton(work)] }
  ];

  /** 分镜脚本进度：有集在生成、失败或取消时先列出这些状态，再附已确认集数；全部确认为绿色，尚未开始为说明文字。 */
  function renderStoryboardProgress(work) {
    const { episodes, approved, started, running, failed, canceled } = work.storyboard;
    if (started === 0) return aiUi.h('span', { class: stageStatusClass('none'), text: stageStatusLabel('none') });
    const abnormal = [
      [running, 'running'],
      [failed, 'failed'],
      [canceled, 'canceled']
    ].filter(([count]) => count > 0);
    if (abnormal.length > 0) {
      const parts = abnormal.map(([count, display]) => `${count} 集${stageStatusLabel(display)}`);
      if (approved > 0) parts.push(`${approved} / ${episodes} 集已确认`);
      return aiUi.h('span', {
        class: failed > 0 ? stageStatusClass('failed') : stageStatusClass('running'),
        text: parts.join('，')
      });
    }
    return aiUi.h('span', {
      class: approved === episodes ? 'status-success' : 'status-warning',
      text: `${approved} / ${episodes} 集已确认`
    });
  }

  /** 分镜脚本操作按钮（分镜视图）：已有记录时可查看；剧本已确认才能生成。 */
  function renderStoryboardButtons(work) {
    return [
      aiUi.button({
        text: '查看分镜',
        compact: true,
        disabled: work.storyboard.started === 0,
        ariaLabel: `查看分镜脚本：${work.name}`,
        onClick: () => void viewStoryboards(work)
      }).element,
      aiUi.button({
        text: '分镜动画',
        icon: 'movie',
        compact: true,
        disabled: work.storyboard.started === 0,
        ariaLabel: `预览分镜动画：${work.name}`,
        onClick: () => void previewStoryboards(work)
      }).element,
      aiUi.button({
        text: '生成分镜',
        compact: true,
        disabled: !work.storyboard.canStart,
        ariaLabel: `生成分镜脚本：${work.name}`,
        onClick: () => openStoryboardForm(work.id)
      }).element
    ];
  }

  /** 作品表格的列（分镜视图）：跨素材来源，只有分镜脚本相关的操作。 */
  const STORYBOARD_COLUMNS = [
    {
      title: '作品名称',
      width: '26%',
      minWidth: 180,
      render: (work) => aiUi.tableMainCell({ text: work.name, description: work.kindLabel || '' })
    },
    { title: '所属项目', width: '16%', minWidth: 120, render: (work) => aiUi.chip({ text: work.projectName }) },
    { title: '剧本', width: '16%', minWidth: 120, render: (work) => renderStageStatus(work.screenplay) },
    { title: '分镜脚本', width: '18%', minWidth: 140, render: (work) => renderStoryboardProgress(work) },
    {
      title: '创建时间',
      width: 110,
      nowrap: true,
      muted: true,
      render: (work) => formatRelativeTime(work.createdAt),
      tooltip: (work) => formatDateTime(work.createdAt)
    },
    { title: '操作', type: 'actions', render: (work) => renderStoryboardButtons(work) }
  ];

  /** 按当前状态刷新内容区：先按项目、再按名称关键字筛选。 */
  function renderContent() {
    contentElement.textContent = '';
    if (isLoading) {
      contentElement.append(aiUi.state({ text: '加载中…' }));
      return;
    }
    if (loadError) {
      contentElement.append(aiUi.state({ text: loadError, button: aiUi.button({ text: '重试', onClick: () => void loadWorks(true) }) }));
      return;
    }
    if (works.length === 0) {
      contentElement.append(
        view === VIEW_SCREENPLAY
          ? aiUi.state({ text: '还没有可生成剧本的作品。请先在“创作”列表中新建作品并确认创意。' })
          : view === VIEW_STORYBOARD
            ? aiUi.state({ text: '还没有可生成分镜脚本的作品。请先在“剧本”列表中确认剧本。' })
            : aiUi.state({ text: '还没有作品。', button: aiUi.button({ text: '新建作品', kind: 'add', onClick: openCreateForm }) })
      );
      return;
    }
    const text = keyword.trim().toLowerCase();
    const visible = works.filter(
      (work) =>
        (filterProjectId === FILTER_ALL || String(work.projectId) === filterProjectId) &&
        (filterStatus === FILTER_ALL || work.screenplay.display === filterStatus) &&
        work.name.toLowerCase().includes(text)
    );
    const columns =
      view === VIEW_SCREENPLAY
        ? SCREENPLAY_COLUMNS
        : view === VIEW_STORYBOARD
          ? STORYBOARD_COLUMNS
          : view === VIEW_ORIGINAL
            ? ORIGINAL_COLUMNS
            : WORK_COLUMNS;
    contentElement.append(
      visible.length === 0
        ? aiUi.state({ text: '没有匹配的作品。' })
        : aiUi.table({ columns, rows: visible, ariaLabel: '作品' }).element
    );
  }

  /** 渲染页面骨架：搜索框与项目筛选、操作结果、作品区。 */
  function renderPage() {
    const search = aiUi.textInput({
      type: 'search',
      placeholder: '搜索作品名称',
      ariaLabel: '搜索作品名称',
      onChange: (value) => {
        keyword = value;
        renderContent();
      }
    });
    projectSlot = aiUi.h('div', { class: 'works-filter' });
    statusSlot = aiUi.h('div', { class: 'works-filter works-filter--status', hidden: true });
    document
      .getElementById('page-toolbar')
      .append(aiUi.h('div', { class: 'page-search' }, search.element), projectSlot, statusSlot);

    contentElement = aiUi.h('div');
    root.append(message.element, contentElement);
    renderProjectFilter();
  }

  renderPage();
  window.hostBridge.onEvent(EVENT_CHANGED, scheduleRefresh);
  window.hostBridge.onEvent(EVENT_ACTION, (request) => void handleRequest(request));
  window.hostBridge.onEvent(EVENT_OPEN_STAGE, (payload) => {
    if (payload) openStage(payload.workId, payload.stage, payload.episodeId);
  });
  // “选择作品”表单提交后，表单关闭再打开该作品的“生成剧本”“生成分镜脚本”表单。
  window.hostBridge.onEvent(EVENT_START_SCREENPLAY, (payload) => {
    if (payload) runAfterForm(() => void showForm({ form: FORM_START_SCREENPLAY, params: { workId: payload.workId } }));
  });
  window.hostBridge.onEvent(EVENT_START_STORYBOARD, (payload) => {
    if (payload) runAfterForm(() => openStoryboardForm(payload.workId));
  });
  // 多集开始生成后，弹出各集的状态列表，可看到每集的进度。
  window.hostBridge.onEvent(EVENT_OPEN_STORYBOARD_LIST, (payload) => {
    const work = payload && works.find((item) => item.id === payload.workId);
    if (work) runAfterForm(() => openEpisodeList(work));
  });
  // 页面打开前已登记的请求（如侧栏点“添加”），加载完成后主动取走。
  void loadWorks(true).then(() => window.pageFormat.takePendingRequest(REQUEST_TAKE_PENDING, handleRequest));
})();
