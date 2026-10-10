// ------------------------------------------------------------------------
// 名称：work-list-pages.ts
// 说明：作品列表页（P3）的入口：每种素材来源一个面板，列出所有项目中该来源的作品；另有跨来源的“剧本”“分镜”面板；新建、编辑、重新生成、生成剧本与分镜脚本表单和阶段产出层都在页内弹出。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-01
// 备注：请求处理在 work-list-handlers.ts、form-handlers.ts 与 voice-preview-handlers.ts；把作品、项目、阶段与可用模型的变化推送给页面。
// ------------------------------------------------------------------------

import { StageKind } from '../../domain/models/stage-run';
import { readEntityId, readRecord } from '../../domain/rules/field-readers';
import { WorkListView } from '../../domain/rules/work-list-rules';
import { createBeatSheetFormCatalog } from '../forms/beat-sheet-form';
import { registerFormHandlers } from '../forms/form-handlers';
import { createScreenplayFormCatalog } from '../forms/screenplay-form';
import { createStoryboardFormCatalog } from '../forms/storyboard-form';
import { createWorkFormCatalog } from '../forms/work-form';
import { MessageRouter } from '../messaging/message-router';
import { WORK_LIST_PAGE_RESOURCES } from '../panels/page-resources';
import { OpenedPanel, PanelTabs } from '../panels/panel-tabs';
import { BeatSheetService } from '../services/beat-sheet-service';
import { DeletionService } from '../services/deletion-service';
import { GenerationProfileService } from '../services/generation-profile-service';
import { ProjectService } from '../services/project-service';
import { ProviderService } from '../services/provider-service';
import { ScreenplayService } from '../services/screenplay-service';
import { StageService } from '../services/stage-service';
import { StageStartService } from '../services/stage-start-service';
import { StoryboardService } from '../services/storyboard-service';
import { TextSettingsService } from '../services/text-settings-service';
import { VoiceDraftService } from '../services/voice-draft-service';
import { VoicePreviewService } from '../services/voice-preview-service';
import { WorkCreationService } from '../services/work-creation-service';
import { WorkService } from '../services/work-service';
import { STAGE_EVENTS } from './stage-handlers';
import { watchModelChanges } from './model-events';
import { registerVoicePreviewHandlers } from './voice-preview-handlers';
import { WORK_LIST_EVENTS, WorkListRequest, registerWorkListHandlers } from './work-list-handlers';

/** 各视图的页面标题，与侧栏“创作”“脚本”分区的条目名称一致。 */
const WORK_LIST_TITLES: Readonly<Record<WorkListView, string>> = {
  text: '文字灵感',
  image: '图片灵感',
  novel: '小说改编',
  original: '原创文稿',
  screenplay: '剧本',
  storyboard: '分镜'
};

/** 各视图的页面描述，显示在页面顶部标题栏里。 */
const WORK_LIST_DESCRIPTIONS: Readonly<Record<WorkListView, string>> = {
  text: '所有项目中以文字灵感为素材的作品，可新建作品、查看创意、修改和删除。',
  image: '所有项目中以灵感图片为素材的作品，可新建作品、查看创意、修改和删除。',
  novel: '所有项目中以小说原文为素材的作品，可新建作品、查看创意、修改和删除。',
  original: '所有项目中的原创文稿作品，原稿文字原样保留、不被改写，可新建作品、查看原稿章节、修改和删除。',
  screenplay: '创意已确认的作品，可生成、查看和编辑剧本，确认采用后合并集和实体。',
  storyboard: '剧本已确认的作品，可为每一集生成、查看和编辑分镜脚本，确认采用后供下游使用。'
};

/** 已打开的作品列表页。 */
interface OpenedWorkList {
  /** 面板句柄；面板创建完成前为 undefined。 */
  panel: OpenedPanel | undefined;
  /** 页面尚未加载完成时登记的请求，页面加载后主动取走。 */
  pending: WorkListRequest | undefined;
}

/** 作品列表页的入口集合。 */
export class WorkListPages {
  private readonly opened = new Map<WorkListView, OpenedWorkList>();

  /**
   * @param services 项目、作品、阶段、剧本与分镜脚本服务。
   * @param panels 面板管理器。
   */
  constructor(
    private readonly services: {
      readonly projects: ProjectService;
      readonly works: WorkService;
      readonly deletion: DeletionService;
      readonly beatSheets: BeatSheetService;
      readonly stages: StageService;
      readonly screenplays: ScreenplayService;
      readonly storyboards: StoryboardService;
      readonly profiles: GenerationProfileService;
      readonly providers: ProviderService;
      readonly textModels: TextSettingsService;
      readonly creations: WorkCreationService;
      readonly starts: StageStartService;
      readonly voices: VoicePreviewService;
      readonly voiceDrafts: VoiceDraftService;
    },
    private readonly panels: PanelTabs
  ) {}

  /**
   * 打开或聚焦某个视图的作品列表页。
   * @param view 素材来源，或剧本视图。
   * @param request 需要页面处理的请求，如弹出新建作品表单。
   */
  show(view: WorkListView, request?: WorkListRequest): void {
    const key = panelKey(view);
    const existing = this.opened.get(view);
    if (existing !== undefined && this.panels.reveal(key)) {
      if (request !== undefined) {
        existing.panel?.postEvent(WORK_LIST_EVENTS.action, request);
      }
      return;
    }

    const { projects, works, beatSheets, stages, screenplays, storyboards, profiles, providers, textModels, creations, starts, voices, voiceDrafts } = this.services;
    const entry: OpenedWorkList = { panel: undefined, pending: request };
    const router = new MessageRouter();
    registerWorkListHandlers(router, view, this.services, {
      takePending: () => {
        const taken = entry.pending;
        entry.pending = undefined;
        return taken;
      }
    });
    const openStage = (workId: number, stage: StageKind, episodeId?: number): void =>
      entry.panel?.postEvent(WORK_LIST_EVENTS.openStage, { workId, stage, episodeId });
    // 分镜动画预览的台词试听与音色生成：与阶段产出请求一样按作品校验归属。
    registerVoicePreviewHandlers(router, voices, voiceDrafts, (payload) => works.getWork(readEntityId({ id: readRecord(payload).workId }, '作品')).id);
    registerFormHandlers(
      router,
      new Map([
        ...createWorkFormCatalog({ projects, works, stages, beatSheets, textModels, creations, starts, onStarted: (workId) => openStage(workId, 'creative') }),
        ...createBeatSheetFormCatalog({ works, beatSheets, stages, textModels, starts, onStarted: (workId) => openStage(workId, 'beat_sheet') }),
        ...createScreenplayFormCatalog({
          projects,
          works,
          screenplays,
          textModels,
          starts,
          onStarted: (workId) => openStage(workId, 'screenplay'),
          onPicked: (workId) => entry.panel?.postEvent(WORK_LIST_EVENTS.startScreenplay, { workId })
        }),
        ...createStoryboardFormCatalog({
          projects,
          works,
          storyboards,
          textModels,
          starts,
          profiles,
          providers,
          onStarted: (workId, episodeIds) =>
            episodeIds.length === 1
              ? openStage(workId, 'storyboard_script', episodeIds[0])
              : entry.panel?.postEvent(WORK_LIST_EVENTS.openStoryboardList, { workId }),
          onPicked: (workId) => entry.panel?.postEvent(WORK_LIST_EVENTS.startStoryboard, { workId })
        })
      ])
    );

    const panel = this.panels.open({
      key,
      title: WORK_LIST_TITLES[view],
      description: WORK_LIST_DESCRIPTIONS[view],
      styles: WORK_LIST_PAGE_RESOURCES.styles,
      scripts: WORK_LIST_PAGE_RESOURCES.scripts,
      router
    });
    entry.panel = panel;
    this.opened.set(view, entry);

    const notifyChanged = () => panel.postEvent(WORK_LIST_EVENTS.changed);
    const unsubscribes = [
      // 项目改名或删除（连同作品）也会影响列表。
      projects.onDidChangeProjects(notifyChanged),
      works.onDidChangeWorks(notifyChanged),
      // 在“模型设置”里改了模型、默认文本模型或访问密钥后，打开的表单与预览层里的模型下拉随之刷新。
      watchModelChanges(providers, textModels, (name) => panel.postEvent(name)),
      stages.onDidChange((change) => {
        notifyChanged();
        panel.postEvent(STAGE_EVENTS.changed, { workId: change.workId, runId: change.runId });
      })
    ];
    panel.onDidClose(() => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      this.opened.delete(view);
    });
  }
}

/** 作品列表页的面板键。 */
function panelKey(view: WorkListView): string {
  return `work-list:${view}`;
}
