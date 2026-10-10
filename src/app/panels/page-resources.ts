// ------------------------------------------------------------------------
// 名称：page-resources.ts
// 说明：各页面使用的样式与脚本清单：界面组件库（ui-kit/src）的文件按依赖顺序集中在此引用。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：路径相对应用资源根目录，使用 / 分隔；组件库顺序须与 ui-kit/manifest.json 一致（测试校验）。
// ------------------------------------------------------------------------

/** 一个页面需要加载的样式与脚本，按加载顺序排列。 */
export interface PageResources {
  readonly styles: readonly string[];
  readonly scripts: readonly string[];
}

/** 界面组件库源码目录（相对应用资源根目录）。 */
const UI_KIT_DIR = 'ui-kit/src';

/** 页面允许加载资源的目录（相对应用资源根目录）；下面清单中的文件都必须位于其中，测试会检查，协议处理也只放行这些目录。 */
export const PAGE_ROOT_PATHS = ['resources', UI_KIT_DIR] as const;

/** 界面组件库的令牌样式，其他样式依赖它，必须最先加载。 */
const UI_TOKENS_STYLE = `${UI_KIT_DIR}/ui-tokens.css`;
/** 应用主题变量（--host-* 的亮暗两套），紧随令牌样式加载。 */
const HOST_THEME_STYLE = 'resources/shared/host-theme.css';
/** 标签页页面的基础样式（页面外观、标题、状态文字）。 */
const TAB_PAGE_THEME_STYLE = 'resources/shared/theme.css';
/** 界面组件库的控件、反馈、表格、对话框与滚动条样式。 */
const UI_COMPONENT_STYLES = ['ui-controls.css', 'ui-feedback.css', 'ui-file-picker.css', 'ui-table.css', 'ui-dialog.css', 'ui-scrollbar.css'].map((name) => `${UI_KIT_DIR}/${name}`);

/** 页面共用的脚本：格式化与请求封装、业务按钮的图标规则；依赖界面组件库，必须在页面自己的脚本（包括表单引擎）之前加载。 */
const SHARED_PAGE_SCRIPTS = ['resources/shared/page-format.js', 'resources/shared/page-icons.js'];

/** 通信桥、界面组件库与页面共用脚本，按依赖顺序排列。 */
const UI_LIBRARY_SCRIPTS = [
  'resources/shared/host-bridge.js',
  ...[
    'ui-core.js',
    'ui-scrollbar.js',
    'ui-icons.js',
    'ui-icon-rules.js',
    'ui-button.js',
    'ui-audio-preview.js',
    'ui-input-controls.js',
    'ui-select.js',
    'ui-choice-controls.js',
    'ui-field.js',
    'ui-table.js',
    'ui-tabs.js',
    'ui-list.js',
    'ui-feedback.js',
    'ui-dialog.js',
    'ui-image.js',
    'ui-file-picker.js'
  ].map((name) => `${UI_KIT_DIR}/${name}`),
  ...SHARED_PAGE_SCRIPTS
];

/** 把相对 resources 目录的路径转换为相对应用资源根目录的路径。 */
function toResourcePath(path: string): string {
  return `resources/${path}`;
}

/**
 * 组装标签页页面的资源：组件库在前，页面自己的样式和脚本在后。
 * @param pageStyles 页面自己的样式，相对 resources 目录。
 * @param pageScripts 页面自己的脚本，相对 resources 目录。
 */
function createEditorPageResources(pageStyles: readonly string[], pageScripts: readonly string[]): PageResources {
  return {
    styles: [UI_TOKENS_STYLE, HOST_THEME_STYLE, TAB_PAGE_THEME_STYLE, ...UI_COMPONENT_STYLES, ...pageStyles.map(toResourcePath)],
    scripts: [...UI_LIBRARY_SCRIPTS, ...pageScripts.map(toResourcePath)]
  };
}

/** 项目列表页：新建与编辑表单在页内弹出，因此一并加载表单引擎。 */
export const PROJECT_LIST_PAGE_RESOURCES: PageResources = createEditorPageResources(
  ['form/form.css'],
  ['form/form-runtime.js', 'project-list/project-list.js']
);

/** 分镜动画预览层（P10）的样式与脚本，按依赖顺序排列：关键词规则、时间线编译与采样、检查、基础绘制、插画（人形、道具表、特效表、背景、入口）、扩展的道具与特效与背景、非人类角色图形、动物与微生物扩展、绘制、对照视图、播放时钟、台词配音、生成音色对话框，然后是页面的界面单元（舞台区先于信息栏，信息栏读取它的空状态文字）：舞台区、播放控制、时间线视图、配音面板、信息栏，最后是装配它们的页面；依赖 stage.js，必须在它之后加载。 */
const STORYBOARD_PREVIEW_STYLES = ['stage/stage-storyboard-preview.css'];
const STORYBOARD_PREVIEW_SCRIPTS = [
  'stage/stage-storyboard-preview-rules.js',
  'stage/stage-storyboard-preview-timeline.js',
  'stage/stage-storyboard-preview-timeline-sample.js',
  'stage/stage-storyboard-preview-checks.js',
  'stage/stage-storyboard-preview-draw.js',
  'stage/stage-storyboard-preview-art-figure.js',
  'stage/stage-storyboard-preview-art-props.js',
  'stage/stage-storyboard-preview-art-effects.js',
  'stage/stage-storyboard-preview-art-backdrops.js',
  'stage/stage-storyboard-preview-art.js',
  'stage/stage-storyboard-preview-props-home.js',
  'stage/stage-storyboard-preview-props-items.js',
  'stage/stage-storyboard-preview-props-effects.js',
  'stage/stage-storyboard-preview-props-backdrops.js',
  'stage/stage-storyboard-preview-creatures.js',
  'stage/stage-storyboard-preview-bestiary.js',
  'stage/stage-storyboard-preview-renderer.js',
  'stage/stage-storyboard-preview-modes.js',
  'stage/stage-storyboard-preview-player.js',
  'stage/stage-storyboard-preview-voice.js',
  'stage/stage-storyboard-preview-voice-draft.js',
  'stage/stage-storyboard-preview-stage-view.js',
  'stage/stage-storyboard-preview-controls.js',
  'stage/stage-storyboard-preview-timeline-view.js',
  'stage/stage-storyboard-preview-voice-panel.js',
  'stage/stage-storyboard-preview-info-panel.js',
  'stage/stage-storyboard-preview.js'
];

/** 作品列表页：新建、编辑、重新生成、生成剧本表单和各阶段产出层都在页内弹出，因此一并加载表单引擎与产出层（产出层的操作 stage-actions.js、头部与进度区 stage-header.js 先于 stage.js）；分镜动画预览层在分镜脚本产出层之后加载；各阶段共用的编辑区规则由 stage-editor-common.js 提供（在 stage.js 之后、各阶段脚本之前），剧本阶段拆成列表（-list）、三种编辑器（-editors）、改编取舍清单（-adaptation）三个子脚本，都先于 stage-screenplay.js。 */
export const WORK_LIST_PAGE_RESOURCES: PageResources = createEditorPageResources(
  ['form/form.css', 'stage/stage.css', 'stage/stage-storyboard.css', ...STORYBOARD_PREVIEW_STYLES, 'work-list/work-list.css'],
  [
    'form/form-runtime.js',
    'stage/stage-actions.js',
    'stage/stage-header.js',
    'stage/stage.js',
    'stage/stage-editor-common.js',
    'stage/stage-beat-sheet.js',
    'stage/stage-creative.js',
    'stage/stage-screenplay-list.js',
    'stage/stage-screenplay-editors.js',
    'stage/stage-screenplay-adaptation.js',
    'stage/stage-screenplay.js',
    'stage/stage-storyboard-panels.js',
    'stage/stage-storyboard.js',
    ...STORYBOARD_PREVIEW_SCRIPTS,
    'work-list/work-list.js'
  ]
);

/** 资产列表页：新建与编辑表单在页内弹出，因此一并加载表单引擎；生成图片（音频）、版本层与分类管理页在列表脚本之前加载。 */
export const ASSET_LIST_PAGE_RESOURCES: PageResources = createEditorPageResources(
  ['form/form.css', 'asset-list/asset-list.css'],
  [
    'form/form-runtime.js',
    'asset-list/asset-generate.js',
    'asset-list/asset-versions.js',
    'asset-list/asset-categories.js',
    'asset-list/asset-list.js'
  ]
);

/** 生成工作台页：镜头的编辑与分镜脚本确认复用阶段产出层，因此一并加载表单引擎与分镜脚本产出层；右栏的步骤页签由 step-tabs.js 提供，其中第 1 步的实体绑定面板由 bindings.js 提供、第 2 步的生成参数面板由 profile.js 提供、第 3 步的提交面板由 submit-panel.js 提供，结果版本页由 versions.js 提供，尾帧截取由 tail-frames.js 提供；任务展示规则、上下文栏、镜头组列表、详情、队列与任务操作分别由 job-display.js、context-bar.js、groups-panel.js、detail-panel.js、queue-panel.js、job-actions.js 提供（job-display.js 先于其余几个）。 */
export const WORKBENCH_PAGE_RESOURCES: PageResources = createEditorPageResources(
  ['form/form.css', 'stage/stage.css', 'stage/stage-storyboard.css', ...STORYBOARD_PREVIEW_STYLES, 'workbench/workbench.css'],
  ['form/form-runtime.js', 'stage/stage-actions.js', 'stage/stage-header.js', 'stage/stage.js', 'stage/stage-editor-common.js', 'stage/stage-storyboard-panels.js', 'stage/stage-storyboard.js', ...STORYBOARD_PREVIEW_SCRIPTS, 'workbench/step-tabs.js', 'workbench/bindings.js', 'workbench/profile.js', 'workbench/submit-panel.js', 'workbench/versions.js', 'workbench/tail-frames.js', 'workbench/job-display.js', 'workbench/context-bar.js', 'workbench/groups-panel.js', 'workbench/detail-panel.js', 'workbench/queue-panel.js', 'workbench/job-actions.js', 'workbench/workbench.js']
);

/** 模型设置页：设置即时保存，没有弹出表单；脚本按依赖顺序加载：共用控件、密钥表单、文本生成区、服务商设置区、账户区，最后是页面。 */
export const SETTINGS_PAGE_RESOURCES: PageResources = createEditorPageResources(
  ['settings/settings.css'],
  ['settings/settings-widgets.js', 'settings/settings-secret-form.js', 'settings/settings-text.js', 'settings/settings-provider.js', 'settings/settings-account.js', 'settings/settings.js']
);

/** 数据备份页：备份与恢复的确认都用组件库的对话框，没有表单。 */
export const BACKUP_PAGE_RESOURCES: PageResources = createEditorPageResources(['backup/backup.css'], ['backup/backup.js']);

/** 侧栏页面：有自己的布局，不加载标签页页面的基础样式。 */
export const SIDEBAR_PAGE_RESOURCES: PageResources = {
  styles: [UI_TOKENS_STYLE, HOST_THEME_STYLE, ...UI_COMPONENT_STYLES, toResourcePath('sidebar/sidebar.css')],
  scripts: [...UI_LIBRARY_SCRIPTS, toResourcePath('sidebar/sidebar.js')]
};
