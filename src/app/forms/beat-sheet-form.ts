// ------------------------------------------------------------------------
// 名称：beat-sheet-form.ts
// 说明：节拍表阶段表单的定义：为作品选择节拍模板、目标时长（短剧还有集数）、语速与补充要求并开始生成；重新生成使用同一个表单，初始值为上次使用的参数。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：模板选项按作品形态自动过滤；文字灵感作品多一个“创作主题或灵感”字段，初始值取最近一次创意使用的灵感；所选文本模型保存为作品的文本模型，启动失败时恢复原选择（由阶段启动服务完成）；节拍表与创意、剧本互不依赖，可以在任何时候生成。
// ------------------------------------------------------------------------

import { BeatSheetParams } from '../../domain/models/beat-sheet';
import { BeatTemplate } from '../../domain/models/production-profile';
import { readEntityId, readRecord } from '../../domain/rules/field-readers';
import {
  BEAT_EXTRA_MAX_LENGTH,
  BEAT_IDEA_MAX_LENGTH,
  EPISODE_COUNT_MAX,
  TARGET_DURATION_MAX_SECONDS,
  TARGET_DURATION_MIN_SECONDS,
  WORDS_PER_SECOND_MAX,
  WORDS_PER_SECOND_MIN
} from '../../domain/rules/beat-sheet-rules';
import { getBeatTemplate, getProductionProfile, listBeatTemplates } from '../../domain/rules/production-profile-rules';
import { BeatSheetService } from '../services/beat-sheet-service';
import { StageService } from '../services/stage-service';
import { StageStartService } from '../services/stage-start-service';
import { WorkTextModelState } from '../services/text-settings-service';
import { WorkService } from '../services/work-service';
import { AsyncFormFactory, FormCatalog, FormDefinition, FormFactory, FormValues } from './form-definition';
import { FormFieldSchema } from './form-schema';
import {
  TEXT_MODEL_FIELD_KEY,
  TEXT_MODEL_SAVED_NOTE,
  TextModelStates,
  createTextModelField,
  readTextModelKey,
  textModelInitialValue
} from './text-model-field';

/** 节拍表表单在表单目录中的名称，页面据此请求打开。 */
export const BEAT_SHEET_FORM_NAMES = {
  start: 'beatSheet.start'
} as const;

/** 节拍表表单依赖的服务与回调。 */
export interface BeatSheetFormDependencies {
  readonly works: WorkService;
  readonly beatSheets: BeatSheetService;
  /** 读取最近一次创意参数里的灵感，作为文字灵感作品的初始值。 */
  readonly stages: StageService;
  readonly textModels: TextModelStates;
  /** 保存作品的文本模型并启动节拍表生成。 */
  readonly starts: Pick<StageStartService, 'startBeatSheet'>;
  /** 生成已开始后调用，用于打开阶段产出层。 */
  readonly onStarted: (workId: number) => void;
}

/** 提交按钮文字。 */
const SUBMIT_LABEL = '开始生成';
/** 文本模型字段说明里的用途前缀。 */
const TEXT_MODEL_PURPOSE = '生成节拍表时';
/** 灵感是主要输入，多行文本最多长到 8 行。 */
const IDEA_MAX_ROWS = 8;
/** 短剧集数参考值的默认值。 */
const DEFAULT_EPISODE_COUNT = 10;

/** 生成参数转表单初始值：数字转为文本，未设置的项为空串。 */
function paramsToValues(params: BeatSheetParams): FormValues {
  return {
    beatTemplateId: getBeatTemplate(params.beatTemplateId).label,
    targetDurationSeconds: String(params.targetDurationSeconds),
    episodeCount: String(params.episodeCount),
    wordsPerSecond: String(params.wordsPerSecond),
    idea: params.idea ?? '',
    extra: params.extra ?? ''
  };
}

/** 目标时长字段的说明：范围与所选模板的推荐时长。 */
function describeDuration(template: BeatTemplate): string {
  return `${TARGET_DURATION_MIN_SECONDS} 至 ${TARGET_DURATION_MAX_SECONDS}；推荐 ${template.minSeconds} 至 ${template.maxSeconds} 秒，切换模板时自动改为该模板的默认时长。创意阶段默认自由创作，剧本和分镜阶段据此对齐时长`;
}

/** 节拍模板字段的说明：适用场景与各节拍的先后顺序。 */
function describeTemplate(template: BeatTemplate): string {
  return `${template.summary}。共 ${template.items.length} 拍：${template.items.map((item) => item.label).join(' → ')}`;
}

/** 按模板名称建立“名称 → 内容”的对照表，供字段联动使用。 */
function byTemplateLabel(templates: readonly BeatTemplate[], pick: (template: BeatTemplate) => string): Record<string, string> {
  return Object.fromEntries(templates.map((template) => [template.label, pick(template)]));
}

/** 创建“生成节拍表”表单的定义。 */
function createStartForm(dependencies: BeatSheetFormDependencies, workId: number, textModelState: WorkTextModelState): FormDefinition {
  const { works, beatSheets, stages, starts, onStarted } = dependencies;
  const work = works.getWork(workId);
  const profile = getProductionProfile(work.kind);
  const templates = listBeatTemplates(work.kind);
  const lastParams = beatSheets.getLastParams(workId);
  const defaultTemplate = templates[0];

  const fields: FormFieldSchema[] = [
    createTextModelField(textModelState, TEXT_MODEL_PURPOSE, TEXT_MODEL_SAVED_NOTE),
    {
      key: 'beatTemplateId',
      label: '节拍模板',
      description: describeTemplate(defaultTemplate),
      descriptionByValue: { sourceKey: 'beatTemplateId', byValue: byTemplateLabel(templates, describeTemplate) },
      control: 'select',
      required: true,
      options: templates.map((template) => template.label)
    },
    {
      key: 'targetDurationSeconds',
      label: profile.multiEpisode ? '单集目标时长（秒）' : '目标时长（秒）',
      description: describeDuration(defaultTemplate),
      descriptionByValue: { sourceKey: 'beatTemplateId', byValue: byTemplateLabel(templates, describeDuration) },
      valueByValue: { sourceKey: 'beatTemplateId', byValue: byTemplateLabel(templates, (template) => String(template.defaultSeconds)) },
      control: 'text',
      required: true
    }
  ];
  if (profile.multiEpisode) {
    fields.push({
      key: 'episodeCount',
      label: '集数（参考）',
      description: `1 至 ${EPISODE_COUNT_MAX}；只是参考值，具体分集由剧本阶段按剧情决定`,
      control: 'text',
      required: true
    });
  }
  fields.push({
    key: 'wordsPerSecond',
    label: '语速（字/秒）',
    description: `${WORDS_PER_SECOND_MIN} 至 ${WORDS_PER_SECOND_MAX}，最多一位小数；用于把目标时长换算为字数，不填默认 ${profile.wordsPerSecond}`,
    control: 'text',
    required: false
  });
  if (work.sourceType === 'text') {
    fields.push({
      key: 'idea',
      label: '创作主题或灵感',
      description: `一句话或一段文字都可以，最多 ${BEAT_IDEA_MAX_LENGTH} 字；节拍表据此分配剧情，不填则只依据补充要求`,
      control: 'textarea',
      required: false,
      maxLength: BEAT_IDEA_MAX_LENGTH,
      maxRows: IDEA_MAX_ROWS
    });
  }
  fields.push({
    key: 'extra',
    label: '补充要求',
    description: `可选，最多 ${BEAT_EXTRA_MAX_LENGTH} 字`,
    control: 'textarea',
    required: false,
    maxLength: BEAT_EXTRA_MAX_LENGTH
  });

  // 初始值只带表单里有的字段（短视频没有集数，只有文字灵感作品有灵感）。
  const fieldKeys = new Set(fields.map((field) => field.key));
  const initial: FormValues = {
    beatTemplateId: defaultTemplate.label,
    targetDurationSeconds: String(defaultTemplate.defaultSeconds),
    episodeCount: String(DEFAULT_EPISODE_COUNT),
    wordsPerSecond: String(profile.wordsPerSecond),
    idea: stages.getLastCreativeParams(workId)?.idea ?? '',
    ...(lastParams === undefined ? {} : paramsToValues(lastParams))
  };
  return {
    schema: { title: `生成节拍表：${work.name}`, submitLabel: SUBMIT_LABEL, fields },
    initialValues: {
      [TEXT_MODEL_FIELD_KEY]: textModelInitialValue(textModelState),
      ...Object.fromEntries(Object.entries(initial).filter(([key]) => fieldKeys.has(key)))
    },
    submit: async (values) => {
      const textModel = readTextModelKey(textModelState, values);
      await starts.startBeatSheet(workId, textModel, values);
      onStarted(workId);
    }
  };
}

/**
 * 创建节拍表表单目录：`beatSheet.start` 的参数为 `{ workId }`。
 * @param dependencies 服务与回调。
 */
export function createBeatSheetFormCatalog(dependencies: BeatSheetFormDependencies): FormCatalog {
  return new Map<string, FormFactory | AsyncFormFactory>([
    [
      BEAT_SHEET_FORM_NAMES.start,
      async (params) => {
        const workId = readEntityId({ id: readRecord(params).workId }, '作品');
        return createStartForm(dependencies, workId, await dependencies.textModels.getWorkState(workId));
      }
    ]
  ]);
}
