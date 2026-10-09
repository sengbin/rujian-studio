// ------------------------------------------------------------------------
// 名称：service-container.ts
// 说明：服务装配：在已打开的数据库上构造仓库、服务商、阶段与生成队列、应用服务，并把需要等待的收尾步骤登记到收尾序列。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：迁自 VS Code 版 extension.ts 的 activate，装配顺序不变；只做装配，业务逻辑位于 app、domain、infra 目录。
// ------------------------------------------------------------------------

import * as path from 'node:path';
import { ShutdownSequence } from '../app/lifecycle/shutdown-sequence';
import { JobChange, JobQueue } from '../app/queue/job-queue';
import { AssetGenerationQueue } from '../app/queue/asset-generation-queue';
import { AssetGenerationService } from '../app/services/asset-generation-service';
import { AssetPromptService } from '../app/services/asset-prompt-service';
import { AssetService } from '../app/services/asset-service';
import { AssetCategoryService } from '../app/services/asset-category-service';
import { BeatSheetService } from '../app/services/beat-sheet-service';
import { BindingService } from '../app/services/binding-service';
import { ChangeNotifier } from '../app/services/change-notifier';
import { GenerationProfileService } from '../app/services/generation-profile-service';
import { GenerationService } from '../app/services/generation-service';
import { ProjectService } from '../app/services/project-service';
import { ProviderService } from '../app/services/provider-service';
import { ProviderAccountService } from '../app/services/provider-account-service';
import { ScreenplayService } from '../app/services/screenplay-service';
import { StageChange, StageService } from '../app/services/stage-service';
import { StoryboardService } from '../app/services/storyboard-service';
import { TextGenerationRouter } from '../app/services/text-generation-router';
import { TextSettingsService } from '../app/services/text-settings-service';
import { VoiceDraftService } from '../app/services/voice-draft-service';
import { VoiceDraftStore } from '../app/services/voice-draft-store';
import { VoicePreviewService } from '../app/services/voice-preview-service';
import { WorkService } from '../app/services/work-service';
import { BeatSheetWorkflow } from '../app/stages/beat-sheet-workflow';
import { createApprovedBeatSheetReader } from '../app/stages/approved-beat-sheet';
import { CreativeWorkflow } from '../app/stages/creative-workflow';
import { OriginalImporter } from '../app/stages/original-importer';
import { ScreenplayWorkflow } from '../app/stages/screenplay-workflow';
import { StageRunner } from '../app/stages/stage-runner';
import { StoryboardWorkflow } from '../app/stages/storyboard-workflow';
import { SecretStore } from '../domain/ports/secret-store';
import { openDatabase } from '../infra/database/database-connection';
import { SqliteAdaptationChecklistRepository } from '../infra/database/sqlite-adaptation-checklist-repository';
import { SqliteAssetRepository } from '../infra/database/sqlite-asset-repository';
import { SqliteAssetCategoryRepository } from '../infra/database/sqlite-asset-category-repository';
import { SqliteAssetVersionRepository } from '../infra/database/sqlite-asset-version-repository';
import { SqliteBeatSheetRepository } from '../infra/database/sqlite-beat-sheet-repository';
import { SqliteBindingRepository } from '../infra/database/sqlite-binding-repository';
import { SqliteNarratorVoiceRepository } from '../infra/database/sqlite-narrator-voice-repository';
import { SqliteGenerationProfileRepository } from '../infra/database/sqlite-generation-profile-repository';
import { SqliteGenerationRepository } from '../infra/database/sqlite-generation-repository';
import { SqliteProjectRepository } from '../infra/database/sqlite-project-repository';
import { SqliteProviderRepository } from '../infra/database/sqlite-provider-repository';
import { SqliteScreenplayRepository } from '../infra/database/sqlite-screenplay-repository';
import { SqliteChapterRepository, SqliteStageRunRepository } from '../infra/database/sqlite-stage-run-repository';
import { SqliteStoryboardRepository } from '../infra/database/sqlite-storyboard-repository';
import { SqliteWorkRepository } from '../infra/database/sqlite-work-repository';
import { SqliteWorkTextModelRepository } from '../infra/database/sqlite-work-text-model-repository';
import { SqliteWorkSourceReader } from '../infra/database/sqlite-work-source-reader';
import { FilePromptTemplates } from '../infra/prompts/file-prompt-templates';
import { createBuiltinAccountAdapters, createBuiltinProviderRegistry } from '../infra/providers/builtin-providers';
import { JsonTextGenerationSettings } from '../infra/settings/json-text-generation-settings';
import { ASSET_FILE_DIRECTORY_NAME, LocalAssetFileStore } from '../infra/storage/local-asset-file-store';
import { LocalVoiceCache, VOICE_CACHE_DIRECTORY_NAME } from '../infra/storage/local-voice-cache';
import { LocalResultStore } from '../infra/storage/local-result-store';
import { HttpMediaDownloader } from '../infra/storage/http-media-downloader';

/** 生成队列的处理间隔：平台生成通常需要一到几分钟，每几秒查询一次足够及时。 */
const JOB_QUEUE_INTERVAL_MS = 5000;

/** 退出时等待后台阶段生成结束的最长时间（毫秒）：给短任务收尾的机会，又不让长时间的模型调用拖住退出。 */
const STAGE_RUN_SHUTDOWN_WAIT_MS = 3000;

/** 装配服务所需的输入。 */
export interface ServiceContainerInput {
  readonly database: ReturnType<typeof openDatabase>;
  /** 数据目录：数据库、资产文件、结果视频和配音缓存都在其下。 */
  readonly dataRoot: string;
  /** 应用资源根目录：提示词模板在其 resources/prompts 下。 */
  readonly resourceRoot: string;
  readonly secrets: SecretStore;
  readonly settings: JsonTextGenerationSettings;
  /** 收尾序列：装配过程中登记需要等待的步骤。 */
  readonly shutdown: ShutdownSequence;
}

/**
 * 装配全部仓库与服务。
 * @param input 数据库、目录与宿主提供的存储。
 */
export function createServiceContainer(input: ServiceContainerInput) {
  const { database, dataRoot, shutdown, secrets: secretStore, settings: settingsStore } = input;

  // 存储与外部服务。图片、音频、小说等文件保存在数据目录下，数据库只记路径。
  const assetFileStore = new LocalAssetFileStore(path.join(dataRoot, ASSET_FILE_DIRECTORY_NAME));
  const runs = new SqliteStageRunRepository(database);
  const chapters = new SqliteChapterRepository(database);
  const beatSheets = new SqliteBeatSheetRepository(database);
  const checklists = new SqliteAdaptationChecklistRepository(database);
  const screenplays = new SqliteScreenplayRepository(database, assetFileStore);
  const storyboards = new SqliteStoryboardRepository(database, assetFileStore);
  const prompts = new FilePromptTemplates(path.join(input.resourceRoot, 'resources', 'prompts'));
  // 服务商服务先于文本生成创建：文本生成按作品的选择、全局默认决定使用哪个服务商的文本模型。
  const providerRepository = new SqliteProviderRepository(database);
  const providerRegistry = createBuiltinProviderRegistry();
  const providerService = new ProviderService({
    repository: providerRepository,
    registry: providerRegistry,
    secrets: secretStore
  });
  const providerAccountService = new ProviderAccountService({
    repository: providerRepository,
    registry: providerRegistry,
    secrets: secretStore,
    adapters: createBuiltinAccountAdapters()
  });
  const workTextModels = new SqliteWorkTextModelRepository(database);
  const textRouter = new TextGenerationRouter({
    settings: settingsStore,
    providers: providerService,
    workModels: workTextModels
  });

  // 应用服务。
  const projectService = new ProjectService(new SqliteProjectRepository(database, assetFileStore));
  const workService = new WorkService(new SqliteWorkRepository(database, assetFileStore), runs);
  const stageChanges = new ChangeNotifier<StageChange>();
  const approvedBeatSheet = createApprovedBeatSheetReader(runs, beatSheets);
  const sourceReader = new SqliteWorkSourceReader(database, assetFileStore);
  const runner = new StageRunner({
    runs,
    texts: textRouter,
    workflows: [
      new BeatSheetWorkflow({ beatSheets, sources: sourceReader, prompts, getSplitSettings: () => settingsStore.getSplitSettings() }),
      new CreativeWorkflow({
        chapters,
        sources: sourceReader,
        prompts,
        getSplitSettings: () => settingsStore.getSplitSettings()
      }),
      new ScreenplayWorkflow({ chapters, screenplays, checklists, prompts }),
      new StoryboardWorkflow({ screenplays, storyboards, prompts })
    ],
    notify: (run) => stageChanges.notify({ workId: run.workId, runId: run.id, stage: run.stage })
  });
  // 上次退出时还在生成的记录已经无法继续，置为失败，用户可以在产出页点“重试”。
  runner.recoverInterrupted();
  shutdown.add(() => waitForStageRuns(runner));
  const stageService = new StageService({
    works: workService,
    runs,
    chapters,
    screenplays,
    runner,
    approvedBeatSheet,
    originals: new OriginalImporter({
      runs,
      chapters,
      sources: new SqliteWorkSourceReader(database, assetFileStore),
      getSplitSettings: () => settingsStore.getSplitSettings()
    }),
    changes: stageChanges
  });
  const screenplayService = new ScreenplayService({ works: workService, runs, screenplays, checklists, approvedBeatSheet, runner, stages: stageService });
  const beatSheetService = new BeatSheetService({ works: workService, runs, beatSheets, runner, stages: stageService });
  const assetRepository = new SqliteAssetRepository(database, assetFileStore);
  const bindingRepository = new SqliteBindingRepository(database);
  const storyboardService = new StoryboardService({
    works: workService,
    projects: projectService,
    runs,
    screenplays,
    storyboards,
    assets: assetRepository,
    bindings: bindingRepository,
    runner,
    approvedBeatSheet,
    stages: stageService
  });
  const textSettingsService = new TextSettingsService(settingsStore, providerService, workTextModels);
  const assetService = new AssetService(assetRepository);
  const assetCategoryService = new AssetCategoryService(new SqliteAssetCategoryRepository(database));
  const bindingService = new BindingService(bindingRepository, assetRepository);
  // 把适配器声明的服务商和模型同步到数据库，设置页和后续的参数选择都从数据库读取。
  providerService.syncCatalog();

  // 资产生成：提示词由文本模型在后台生成，图片、音频经队列交给图像、音频模型生成；状态变化后通过资产变化事件刷新页面。
  const assetVersionRepository = new SqliteAssetVersionRepository(database, assetFileStore);
  const notifyAssetsChanged = (): void => assetService.notifyChanged();
  const assetPromptService = new AssetPromptService({
    texts: textRouter,
    prompts,
    assets: assetRepository,
    notify: notifyAssetsChanged
  });
  // 上次退出时还在生成的提示词无法继续，置为失败，用户可以在列表里重试。
  assetPromptService.recoverInterrupted();
  const assetQueue = new AssetGenerationQueue({
    versions: assetVersionRepository,
    assets: assetRepository,
    calls: providerService,
    downloader: new HttpMediaDownloader(),
    notify: notifyAssetsChanged
  });
  assetQueue.recover();
  shutdown.add(assetQueue.start(JOB_QUEUE_INTERVAL_MS));
  const assetGenerationService = new AssetGenerationService({
    assets: assetRepository,
    versions: assetVersionRepository,
    providers: providerService,
    scheduler: assetQueue,
    notify: notifyAssetsChanged
  });

  // 视频生成：结果视频保存在数据目录；队列启动时先处理上次退出时遗留的任务。
  const generationRepository = new SqliteGenerationRepository(database, assetFileStore);
  const resultStore = new LocalResultStore(dataRoot);
  const jobChanges = new ChangeNotifier<JobChange>();
  const generationProfileRepository = new SqliteGenerationProfileRepository(database);
  const jobQueue = new JobQueue({
    jobs: generationRepository,
    media: generationRepository,
    calls: providerService,
    results: resultStore,
    notify: (change) => jobChanges.notify(change)
  });
  jobQueue.recover();
  shutdown.add(jobQueue.start(JOB_QUEUE_INTERVAL_MS));
  const generationService = new GenerationService({
    works: workService,
    projects: projectService,
    storyboardService,
    runs,
    screenplays,
    storyboards,
    bindings: new SqliteBindingRepository(database),
    assets: assetRepository,
    jobs: generationRepository,
    media: generationRepository,
    results: resultStore,
    models: providerRepository,
    providers: providerService,
    profiles: generationProfileRepository,
    scheduler: jobQueue,
    changes: jobChanges
  });
  const profileService = new GenerationProfileService({
    profiles: generationProfileRepository,
    works: workService,
    projects: projectService,
    screenplays,
    models: providerRepository
  });

  // 分镜动画的台词试听：用说话人的音色（绑定的音色参考、作品的旁白音色或暂存的试听音色）和所选的音频模型合成对白；没有音色的说话人可按描述生成试听音色，满意后采用。
  const narratorVoiceRepository = new SqliteNarratorVoiceRepository(database);
  const voiceDraftStore = new VoiceDraftStore();
  const voicePreviewService = new VoicePreviewService({
    storyboards: storyboardService,
    bindings: bindingRepository,
    assets: assetRepository,
    narrators: narratorVoiceRepository,
    drafts: voiceDraftStore,
    providers: providerService,
    downloader: new HttpMediaDownloader(),
    diskCache: new LocalVoiceCache(path.join(dataRoot, VOICE_CACHE_DIRECTORY_NAME))
  });
  const voiceDraftService = new VoiceDraftService({
    storyboards: storyboardService,
    bindings: bindingService,
    assets: assetService,
    narrators: narratorVoiceRepository,
    drafts: voiceDraftStore,
    providers: providerService,
    voices: voicePreviewService
  });

  return {
    projectService,
    workService,
    beatSheetService,
    stageService,
    screenplayService,
    storyboardService,
    profileService,
    providerRepository,
    providerService,
    providerAccountService,
    textSettingsService,
    voicePreviewService,
    voiceDraftService,
    assetService,
    assetCategoryService,
    assetPromptService,
    assetGenerationService,
    bindingService,
    generationService
  };
}

/** 等待后台阶段生成结束，最多等 STAGE_RUN_SHUTDOWN_WAIT_MS；超时不再等待（模型调用仍在进行时无法强行结束），也不视为失败。 */
async function waitForStageRuns(runner: StageRunner): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, STAGE_RUN_SHUTDOWN_WAIT_MS);
  });
  try {
    // 某次生成的失败已由执行器记录，这里只关心是否结束。
    await Promise.race([runner.whenIdle().catch(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
