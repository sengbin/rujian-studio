// ------------------------------------------------------------------------
// 名称：application.ts
// 说明：应用装配根：打开数据库并升级结构，装配服务与页面入口，生成侧栏菜单页；数据库无法打开时降级为只含数据备份（恢复）入口的侧栏。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：迁自 VS Code 版 extension.ts；入口只做装配，业务逻辑位于 app、domain、infra 目录；宿主能力（对话框、通知、密钥等）由 ApplicationEnvironment 注入。
// ------------------------------------------------------------------------

import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { ShutdownSequence } from '../app/lifecycle/shutdown-sequence';
import { MessageRouter } from '../app/messaging/message-router';
import { AssetListPages } from '../app/pages/asset-list-pages';
import { BackupPages } from '../app/pages/backup-pages';
import { ProjectPages } from '../app/pages/project-pages';
import { SettingsPages } from '../app/pages/settings-pages';
import { WorkListPages } from '../app/pages/work-list-pages';
import { WorkbenchHost } from '../app/pages/workbench-handlers';
import { WorkbenchPages } from '../app/pages/workbench-pages';
import { PanelManager } from '../app/panels/panel-manager';
import { BackupHost, BackupService } from '../app/services/backup-service';
import { GenerationService } from '../app/services/generation-service';
import { ShellTheme } from '../app/shell/shell-channels';
import { ASSET_KINDS } from '../domain/models/asset';
import { WorkSourceType } from '../domain/models/work';
import { SecretStore } from '../domain/ports/secret-store';
import { openDatabase } from '../infra/database/database-connection';
import { DatabaseFilePaths, applyPendingRestore, resolveDatabaseFilePaths } from '../infra/database/database-restore';
import { MIGRATIONS } from '../infra/database/migrations';
import { SqliteBackupStorage } from '../infra/database/sqlite-backup-storage';
import { JsonTextGenerationSettings } from '../infra/settings/json-text-generation-settings';
import { ASSET_FILE_DIRECTORY_NAME } from '../infra/storage/local-asset-file-store';
import { RESULT_VIDEO_DIRECTORY_NAME } from '../infra/storage/local-result-store';
import { SidebarActionRegistry } from '../sidebar/sidebar-actions';
import { registerSidebarHandlers } from '../sidebar/sidebar-handlers';
import { DATABASE_UNAVAILABLE_NOTICE_PREFIX, DEGRADED_SIDEBAR_SECTIONS, SIDEBAR_SECTIONS } from '../sidebar/sidebar-menu-config';
import { SidebarContent, createSidebarPageHtml } from '../sidebar/sidebar-page';
import { SidebarStatusReader, buildSidebarStatus, countEnabledModels } from '../sidebar/sidebar-status';
import { DesktopNotifier } from './desktop-hosts';
import { createServiceContainer } from './service-container';

/** 数据库文件名，位于数据目录。 */
const DATABASE_FILE_NAME = 'rujian.sqlite';

/** 文本生成设置文件名，位于数据目录。 */
const SETTINGS_FILE_NAME = 'settings.json';

/** 任务完成通知的点击提示。 */
const WORKBENCH_ACTION_HINT = '点击打开工作台。';

/** 侧栏创作入口与素材来源的对应关系。 */
const CREATION_ENTRIES: ReadonlyArray<readonly [string, WorkSourceType]> = [
  ['text-inspiration', 'text'],
  ['image-inspiration', 'image'],
  ['novel-adaptation', 'novel'],
  ['original-manuscript', 'original']
];

/** 装配所需的运行环境，由主进程提供。 */
export interface ApplicationEnvironment {
  /** 数据目录：数据库、设置、资产文件、结果视频、配音缓存都在其下。 */
  readonly dataRoot: string;
  /** 应用资源根目录：resources 与 ui-kit 位于其下。 */
  readonly resourceRoot: string;
  readonly version: string;
  /** 读取当前界面主题，用于生成页面 HTML。 */
  readonly getTheme: () => ShellTheme;
  readonly panels: PanelManager;
  readonly secrets: SecretStore;
  readonly workbenchHost: WorkbenchHost;
  readonly backupHost: BackupHost;
  readonly notify: DesktopNotifier;
  /** 把应用窗口带到前台。 */
  readonly focusWindow: () => void;
  /** 向用户显示错误。 */
  readonly reportError: (message: string) => void;
  /** 导出用户手册 Skill。 */
  readonly exportManual: () => Promise<void>;
}

/** 装配结果。 */
export interface Application {
  /** 侧栏页面：请求路由器与完整 HTML。 */
  readonly sidebar: { readonly router: MessageRouter; readonly html: string };
  /** 退出时的收尾序列；降级装配时没有。 */
  readonly shutdown: ShutdownSequence | undefined;
}

/**
 * 装配应用：打开数据库并升级结构，装配服务与页面。数据库无法打开时不装配业务服务，只生成降级侧栏。
 * @param environment 宿主提供的运行环境。
 */
export function createApplication(environment: ApplicationEnvironment): Application {
  const databasePaths = resolveDatabaseFilePaths(environment.dataRoot, DATABASE_FILE_NAME);
  const opened = openDatabaseOrReport(environment, databasePaths);
  if (opened.database === undefined) {
    return createDegradedApplication(environment, databasePaths, opened.failure);
  }
  const database = opened.database;

  // 退出收尾：按登记顺序等阶段生成结束、停止两个队列，最后关闭数据库（殿后步骤，与登记先后无关）。
  const shutdown = new ShutdownSequence();
  shutdown.addFinal(() => {
    if (database.isOpen) {
      database.close();
    }
  });

  const container = createServiceContainer({
    database,
    dataRoot: environment.dataRoot,
    resourceRoot: environment.resourceRoot,
    secrets: environment.secrets,
    settings: new JsonTextGenerationSettings(path.join(environment.dataRoot, SETTINGS_FILE_NAME)),
    shutdown
  });
  const panels = environment.panels;

  // 页面。
  const services = {
    projects: container.projectService,
    works: container.workService,
    beatSheets: container.beatSheetService,
    stages: container.stageService,
    screenplays: container.screenplayService,
    storyboards: container.storyboardService
  };
  const projectPages = new ProjectPages(container.projectService, panels);
  const workListPages = new WorkListPages(
    { ...services, profiles: container.profileService, providers: container.providerService, textModels: container.textSettingsService, voices: container.voicePreviewService, voiceDrafts: container.voiceDraftService },
    panels
  );
  const assetListPages = new AssetListPages(
    { projects: container.projectService, assets: container.assetService, categories: container.assetCategoryService, prompts: container.assetPromptService, textModels: container.textSettingsService, providers: container.providerService, generation: container.assetGenerationService },
    panels
  );
  const settingsPages = new SettingsPages({ text: container.textSettingsService, providers: container.providerService, accounts: container.providerAccountService }, panels);
  // 数据备份：备份文件只含数据库，数据库引用的本地文件（asset-files 子目录：资产、素材、镜头首帧、尾帧）在备份时复制到备份文件旁，结果视频（videos 子目录）不在备份内；恢复在重启应用时生效。
  const backupService = new BackupService({
    storage: new SqliteBackupStorage(
      database,
      databasePaths,
      path.join(environment.dataRoot, RESULT_VIDEO_DIRECTORY_NAME),
      path.join(environment.dataRoot, ASSET_FILE_DIRECTORY_NAME)
    ),
    host: environment.backupHost,
    latestSchemaVersion: MIGRATIONS.length
  });
  const backupPages = new BackupPages(backupService, panels);
  const workbenchPages = new WorkbenchPages(
    {
      generation: container.generationService,
      profiles: container.profileService,
      bindings: container.bindingService,
      assets: container.assetService,
      assetGeneration: container.assetGenerationService,
      categories: container.assetCategoryService,
      prompts: container.assetPromptService,
      providers: container.providerService,
      textModels: container.textSettingsService,
      voices: container.voicePreviewService,
      voiceDrafts: container.voiceDraftService,
      ...services
    },
    // 结果视频用系统默认的视频播放器打开，也可导出到用户选择的位置或在文件夹中显示。
    environment.workbenchHost,
    panels
  );
  shutdown.add(notifyFinishedJobs(environment, container.generationService, () => workbenchPages.show()));

  // 侧栏：尚未实现的入口不注册动作，点击时由侧栏提示“该功能尚未开放”。
  const actionRegistry = new SidebarActionRegistry(SIDEBAR_SECTIONS)
    .register('project-list', 'main', () => projectPages.showProjectList())
    .register('project-list', 'action', () => projectPages.showCreateForm())
    .register('model-settings', 'main', () => settingsPages.show())
    .register('data-backup', 'main', () => backupPages.show())
    .register('manual-export', 'main', () => exportManualReportingErrors(environment))
    .register('video-workbench', 'main', () => workbenchPages.show());
  for (const [itemId, sourceType] of CREATION_ENTRIES) {
    // 主入口：打开该素材来源的作品列表页；尾部操作：打开列表页并弹出新建作品表单。
    actionRegistry
      .register(itemId, 'main', () => workListPages.show(sourceType))
      .register(itemId, 'action', () => workListPages.show(sourceType, { action: 'create' }));
  }
  // 剧本：主入口打开跨素材来源的剧本列表；添加打开列表并弹出“选择作品”。
  actionRegistry
    .register('screenplay', 'main', () => workListPages.show('screenplay'))
    .register('screenplay', 'action', () => workListPages.show('screenplay', { action: 'create' }));
  // 分镜：主入口打开分镜脚本列表；添加打开列表并弹出“选择作品”。
  actionRegistry
    .register('storyboard-script', 'main', () => workListPages.show('storyboard'))
    .register('storyboard-script', 'action', () => workListPages.show('storyboard', { action: 'create' }));
  // 资产：主入口打开该类型的资产列表；添加打开列表并弹出新建资产表单。侧栏条目标识与资产类型同名。
  for (const kind of ASSET_KINDS) {
    actionRegistry
      .register(kind, 'main', () => assetListPages.show(kind))
      .register(kind, 'action', () => assetListPages.show(kind, { action: 'create' }));
  }
  const readStatus: SidebarStatusReader = () => buildSidebarStatus({ databaseReady: true, enabledModelCount: countEnabledModels(container.providerRepository) });
  return { sidebar: createSidebarPage(environment, actionRegistry, readStatus, { sections: SIDEBAR_SECTIONS }), shutdown };
}

/**
 * 数据库无法打开时的降级装配：不装配任何依赖数据库的服务，只生成降级侧栏。
 * 侧栏显示“数据库无法打开：原因”和“数据备份（恢复）”入口；备份页复用同一套备份服务与待恢复机制，
 * 备份服务不带数据库连接，只能选择备份文件、校验、确认并准备恢复，重启应用后由启动流程应用恢复。
 */
function createDegradedApplication(environment: ApplicationEnvironment, paths: DatabaseFilePaths, failure: string): Application {
  const backupService = new BackupService({
    storage: new SqliteBackupStorage(
      undefined,
      paths,
      path.join(environment.dataRoot, RESULT_VIDEO_DIRECTORY_NAME),
      path.join(environment.dataRoot, ASSET_FILE_DIRECTORY_NAME)
    ),
    host: environment.backupHost,
    latestSchemaVersion: MIGRATIONS.length,
    databaseUnavailableReason: failure
  });
  const backupPages = new BackupPages(backupService, environment.panels);
  const actionRegistry = new SidebarActionRegistry(DEGRADED_SIDEBAR_SECTIONS).register('data-backup', 'main', () => backupPages.show());
  const readStatus: SidebarStatusReader = () => buildSidebarStatus({ databaseReady: false });
  const content: SidebarContent = { sections: DEGRADED_SIDEBAR_SECTIONS, notice: `${DATABASE_UNAVAILABLE_NOTICE_PREFIX}${failure}` };
  return { sidebar: createSidebarPage(environment, actionRegistry, readStatus, content), shutdown: undefined };
}

/** 生成侧栏页面：请求处理器接入动作注册表，HTML 带上初始状态条。 */
function createSidebarPage(environment: ApplicationEnvironment, registry: SidebarActionRegistry, readStatus: SidebarStatusReader, content: SidebarContent): Application['sidebar'] {
  const router = new MessageRouter();
  registerSidebarHandlers(router, registry, readStatus);
  const html = createSidebarPageHtml({ content, version: environment.version, status: readStatus(), theme: environment.getTheme() });
  return { router, html };
}

/** 导出手册 Skill，失败时向用户显示原因。 */
function exportManualReportingErrors(environment: ApplicationEnvironment): void {
  environment.exportManual().catch((error: unknown) => {
    environment.reportError(`导出用户手册 Skill 失败：${error instanceof Error ? error.message : String(error)}`);
  });
}

/**
 * 视频任务成功或失败时发系统通知（每个任务每种结果只通知一次），点击通知打开工作台。
 * @returns 取消订阅的函数。
 */
function notifyFinishedJobs(environment: ApplicationEnvironment, generation: GenerationService, openWorkbench: () => void): () => void {
  const notified = new Set<string>();
  return generation.onDidChangeJobs((change) => {
    if (change.quiet === true) {
      return;
    }
    const outcome = generation.describeFinishedJob(change.jobId);
    if (outcome === undefined) {
      return;
    }
    const key = `${change.jobId}:${outcome.status}`;
    if (notified.has(key)) {
      return;
    }
    notified.add(key);
    environment.notify({
      body: `${outcome.message}${WORKBENCH_ACTION_HINT}`,
      onClick: () => {
        environment.focusWindow();
        openWorkbench();
      }
    });
  });
}

/** 打开数据库的结果：成功时有 database；失败时 database 为 undefined，failure 说明原因。 */
type OpenDatabaseResult = { readonly database: ReturnType<typeof openDatabase>; readonly failure?: undefined } | { readonly database?: undefined; readonly failure: string };

/**
 * 在数据目录中打开数据库；失败时提示用户并返回原因（调用方据此降级装配）。打开前先应用数据备份页准备好的恢复。
 */
function openDatabaseOrReport(environment: ApplicationEnvironment, paths: DatabaseFilePaths): OpenDatabaseResult {
  try {
    mkdirSync(environment.dataRoot, { recursive: true });
    applyPendingRestoreAndReport(environment, paths);
    return { database: openDatabase(paths.databasePath) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    environment.reportError(`如见 Studio 无法打开数据库：${detail}。可以在侧栏“数据备份（恢复）”中从备份文件恢复。`);
    return { failure: detail };
  }
}

/** 应用数据备份页准备好的恢复，并提示结果；恢复失败时当前数据库保持不变，应用继续使用它。 */
function applyPendingRestoreAndReport(environment: ApplicationEnvironment, paths: DatabaseFilePaths): void {
  try {
    const autoBackupPath = applyPendingRestore(paths, new Date());
    if (autoBackupPath !== undefined) {
      environment.notify({ body: `如见 Studio 已从备份恢复数据，恢复前的数据库已自动备份到 ${autoBackupPath}。` });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    environment.reportError(`如见 Studio 从备份恢复失败，已继续使用当前数据：${detail}`);
  }
}
