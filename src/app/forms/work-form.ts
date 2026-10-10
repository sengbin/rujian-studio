// ------------------------------------------------------------------------
// 名称：work-form.ts
// 说明：作品相关表单的定义：创意阶段表单（F3）新建作品并开始生成、对已有作品重新生成创意，以及编辑作品的名称与形态；字段随素材来源变化；原创文稿没有生成参数，提交后直接导入原稿章节，不支持重新生成。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：素材来源由入口决定，所属项目在新建表单里选择（入口可传默认项目）；表单只解析并校验字段，创建作品、保存文本模型、启动生成的编排（启动失败会撤销刚创建的作品、恢复原文本模型选择）由服务层完成；作品原先单独选择的文本模型已不可用时，在文本模型字段的说明里提示，重新生成表单同样有该字段；节拍参考模式不是字段而是提交按钮“参考节拍表生成”，新建表单始终禁用，重新生成表单按是否已有确认节拍表决定是否可点。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, ValidationError } from '../../domain/errors';
import { CreativeParams } from '../../domain/models/creative';
import { GENRE_OPTIONS, TONE_OPTIONS } from '../../domain/models/option-sets';
import { ProjectSummary } from '../../domain/models/project';
import { WorkSourceType } from '../../domain/models/work';
import { readEntityId, readRecord } from '../../domain/rules/field-readers';
import { IMAGE_FILE_MAX_BYTES } from '../../domain/rules/image-size';
import { listSupportedFormats } from '../../domain/rules/production-profile-rules';
import {
  CREATIVE_CHOICE_MAX_LENGTH,
  CREATIVE_EXTRA_MAX_LENGTH,
  CREATIVE_IDEA_MAX_LENGTH,
  CREATIVE_PRESERVE_MAX_LENGTH,
  DEFAULT_CHAPTER_MAX_WORDS,
  DEFAULT_CHAPTER_MIN_WORDS,
  DEFAULT_MAX_CHAPTERS,
  normalizeCreativeParams
} from '../../domain/rules/creative-rules';
import {
  IMAGE_EXTENSIONS,
  IMAGE_FIELD_KEY,
  IMAGE_MAX_FILES,
  MANUSCRIPT_FILE_FIELD_KEY,
  MANUSCRIPT_TEXT_FIELD_KEY,
  MANUSCRIPT_TEXT_MAX_LENGTH,
  NOVEL_EXTENSIONS,
  NOVEL_FIELD_KEY,
  NOVEL_MAX_BYTES,
  SOURCE_TYPE_LABELS,
  WORK_KIND_LABELS,
  WORK_NAME_MAX_LENGTH,
  NormalizedWorkCreation,
  normalizeWorkCreation
} from '../../domain/rules/work-rules';
import { ProjectService } from '../services/project-service';
import { BeatSheetService } from '../services/beat-sheet-service';
import { StageService } from '../services/stage-service';
import { StageStartService } from '../services/stage-start-service';
import { WorkTextModelState } from '../services/text-settings-service';
import { DUPLICATE_WORK_NAME_MESSAGE, WorkService } from '../services/work-service';
import { WorkCreationService } from '../services/work-creation-service';
import { AsyncFormFactory, FormCatalog, FormDefinition, FormFactory, FormValues } from './form-definition';
import { FormFieldSchema, FormSubmitActionSchema } from './form-schema';
import { storedFilesToFieldValue } from './file-field-value';
import {
  TEXT_MODEL_FIELD_KEY,
  TEXT_MODEL_SAVED_NOTE,
  WorkTextModels,
  createTextModelField,
  readTextModelKey,
  textModelInitialValue
} from './text-model-field';

/** 作品表单在表单目录中的名称，页面据此请求打开。 */
export const WORK_FORM_NAMES = {
  create: 'work.create',
  regenerate: 'work.regenerate',
  edit: 'work.edit'
} as const;

/** 创意表单依赖的服务与回调。 */
export interface WorkFormDependencies {
  readonly projects: ProjectService;
  readonly works: WorkService;
  readonly stages: StageService;
  /** 读取已确认的节拍表，决定重新生成创意时能否选择“参考节拍表”。 */
  readonly beatSheets: BeatSheetService;
  readonly textModels: WorkTextModels;
  /** 新建作品并启动创意生成（原创文稿导入原稿）。 */
  readonly creations: WorkCreationService;
  /** 保存作品的文本模型并重新启动创意生成。 */
  readonly starts: Pick<StageStartService, 'startCreative'>;
  /** 生成已开始（创建作品并启动生成，或重新生成）后调用，用于打开阶段产出页。 */
  readonly onStarted: (workId: number) => void;
}

const SOURCE_TYPES: readonly WorkSourceType[] = ['text', 'image', 'novel', 'original'];
const SUBMIT_LABEL_CREATE = '创建并生成';
const SUBMIT_LABEL_IMPORT = '创建并导入';
const SUBMIT_LABEL_REGENERATE = '开始生成';
const SUBMIT_LABEL_EDIT = '保存';
const LABEL_SINGLE_KIND = WORK_KIND_LABELS.short_video;
/** 新建表单中“所属项目”字段的键；项目名称全局唯一，字段值就是项目名称。 */
const PROJECT_FIELD_KEY = 'projectName';
const NO_PROJECT_MESSAGE = '还没有项目，请先在“所有项目”中创建项目。';
const PROJECT_REQUIRED_MESSAGE = '请选择所属项目。';
const KIND_LOCKED_NOTE = '；剧本已确认，作品形态不能再修改';
/** 文本模型字段说明里的用途：作品的文本模型用于创意、剧本、分镜脚本的生成。 */
const TEXT_MODEL_PURPOSE = '生成创意、剧本、分镜脚本时';
/** 创作主题或灵感是主要输入，多行文本最多长到 8 行。 */
const IDEA_MAX_ROWS = 8;
/** 原稿文字是主要输入，多行文本最多长到 12 行。 */
const MANUSCRIPT_MAX_ROWS = 12;
const ORIGINAL_REGENERATE_MESSAGE = '原创文稿不支持重新生成，原稿已直接分段为章节，需要修改请直接编辑章节正文。';

/** 读取入口传来的素材来源，必须是四种之一。 */
function readSourceType(value: unknown): WorkSourceType {
  if (typeof value !== 'string' || !SOURCE_TYPES.includes(value as WorkSourceType)) {
    throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: '素材来源无效。' });
  }
  return value as WorkSourceType;
}

/** 按项目名称找到所选项目；没有选择或项目已不存在时报字段错误。 */
function readProject(projects: readonly ProjectSummary[], name: string | undefined): ProjectSummary {
  const project = projects.find((item) => item.name === name);
  if (project === undefined) {
    throw new ValidationError({ [PROJECT_FIELD_KEY]: PROJECT_REQUIRED_MESSAGE });
  }
  return project;
}

/** 作品名称字段；只有所属项目已确定时才能在失去焦点时检查重名。 */
function createNameField(checkUnique: boolean, note = ''): FormFieldSchema {
  return {
    key: 'workName',
    label: '作品名称',
    description: `作品在项目内的唯一名称，最多 ${WORK_NAME_MAX_LENGTH} 字${note}`,
    control: 'text',
    required: true,
    maxLength: WORK_NAME_MAX_LENGTH,
    placeholder: '例如：雨夜来客',
    checkUnique
  };
}

/** 作品形态字段：只展示制作方案注册表中已实现的形态。 */
function createKindField(): FormFieldSchema {
  return {
    key: 'kind',
    label: '作品形态',
    description: '单个短视频只有 1 集；多集短片在确认剧本后按剧情拆分为多集，剧本确认后不能再修改；作品形态决定节拍表模板和时长换算',
    control: 'radio',
    required: true,
    options: listSupportedFormats().map((profile) => WORK_KIND_LABELS[profile.formatType])
  };
}

/** 灵感图片字段：以缩略图预览，点击查看原图；新建与编辑作品共用。 */
function createImageField(): FormFieldSchema {
  return {
    key: IMAGE_FIELD_KEY,
    label: '灵感图片',
    description: `至少 1 张，最多 ${IMAGE_MAX_FILES} 张；PNG、JPEG、WebP，每张不超过 ${IMAGE_FILE_MAX_BYTES / (1024 * 1024)} MB，点击缩略图查看原图，可调整顺序`,
    control: 'file',
    required: true,
    accept: IMAGE_EXTENSIONS,
    multiple: true,
    maxFiles: IMAGE_MAX_FILES,
    maxFileBytes: IMAGE_FILE_MAX_BYTES,
    preview: 'image'
  };
}

/** 所属项目、作品名称、形态与素材文件字段，只在新建作品时出现。 */
function createWorkFields(sourceType: WorkSourceType, projectNames: readonly string[]): FormFieldSchema[] {
  const fields: FormFieldSchema[] = [
    {
      key: PROJECT_FIELD_KEY,
      label: '所属项目',
      description: '作品所属的项目，创建后不能更改',
      control: 'select',
      required: true,
      options: projectNames
    },
    createNameField(false),
    createKindField()
  ];
  if (sourceType === 'image') {
    fields.push(createImageField());
  } else if (sourceType === 'novel') {
    fields.push({
      key: NOVEL_FIELD_KEY,
      label: '原作文件',
      description: `TXT 或 Markdown，UTF-8 编码，不超过 ${NOVEL_MAX_BYTES / (1024 * 1024)} MB；长篇会按“模型”设置中的分段方式逐段处理`,
      control: 'file',
      required: true,
      accept: NOVEL_EXTENSIONS,
      multiple: false,
      maxFileBytes: NOVEL_MAX_BYTES
    });
  } else if (sourceType === 'original') {
    fields.push(
      {
        key: MANUSCRIPT_FILE_FIELD_KEY,
        label: '原稿文件',
        description: `TXT 或 Markdown，UTF-8 编码，不超过 ${NOVEL_MAX_BYTES / (1024 * 1024)} MB；与下方“原稿文字”二选一`,
        control: 'file',
        required: false,
        accept: NOVEL_EXTENSIONS,
        multiple: false,
        maxFileBytes: NOVEL_MAX_BYTES
      },
      {
        key: MANUSCRIPT_TEXT_FIELD_KEY,
        label: '原稿文字',
        description: `直接粘贴原稿，最多 ${MANUSCRIPT_TEXT_MAX_LENGTH} 字；导入后文字原样保留，不会被改写`,
        control: 'textarea',
        required: false,
        maxLength: MANUSCRIPT_TEXT_MAX_LENGTH,
        maxRows: MANUSCRIPT_MAX_ROWS
      }
    );
  }
  return fields;
}

/** 影响生成的字段：随素材来源显示不同的字段与文案；原创文稿不生成创意，没有这些字段。
 * 节拍参考模式不再是字段里的单选项，改为提交按钮（见 createCreativeSubmitActions），这里只保留两种模式共用的字段。
 */
function createParamFields(sourceType: WorkSourceType): FormFieldSchema[] {
  const fields: FormFieldSchema[] = [];
  if (sourceType === 'original') {
    return fields;
  }
  if (sourceType === 'text') {
    fields.push({
      key: 'idea',
      label: '创作主题或灵感',
      description: `一句话或一段文字都可以，最多 ${CREATIVE_IDEA_MAX_LENGTH} 字；不填则依据题材、基调和补充要求创作`,
      control: 'textarea',
      required: false,
      maxLength: CREATIVE_IDEA_MAX_LENGTH,
      maxRows: IDEA_MAX_ROWS
    });
  }
  fields.push(
    {
      key: 'genre',
      label: '题材',
      description: '可选，也可选择“其他”手动输入',
      control: 'select',
      required: false,
      maxLength: CREATIVE_CHOICE_MAX_LENGTH,
      options: GENRE_OPTIONS,
      allowCustom: true
    },
    {
      key: 'tone',
      label: '基调',
      description: '可选，也可选择“其他”手动输入',
      control: 'select',
      required: false,
      maxLength: CREATIVE_CHOICE_MAX_LENGTH,
      options: TONE_OPTIONS,
      allowCustom: true
    },
    {
      key: 'chapterMinWords',
      label: '每章大约最少字数',
      description: '大致的下限，最低 100 字；常规叙事推荐约 1000 字；点“参考节拍表生成”时不生效',
      control: 'text',
      required: true
    },
    {
      key: 'chapterMaxWords',
      label: '每章大约最多字数',
      description: '大致的上限，至少比最少字数多 50 字；文本模型会根据内容实际情况生成，实际字数可能有出入，生成后会提示实际字数；点“参考节拍表生成”时不生效',
      control: 'text',
      required: true
    },
    {
      key: 'maxChapters',
      label: '章节数上限',
      description: '1 至 100；内容不足时不会为达到上限而扩写；点“参考节拍表生成”时不生效',
      control: 'text',
      required: true
    }
  );
  if (sourceType !== 'text') {
    fields.push({
      key: 'preserve',
      label: sourceType === 'image' ? '图片中必须保留的元素' : '必须保留的内容',
      description: `可选，最多 ${CREATIVE_PRESERVE_MAX_LENGTH} 字`,
      control: 'textarea',
      required: false,
      maxLength: CREATIVE_PRESERVE_MAX_LENGTH
    });
  }
  if (sourceType === 'novel') {
    fields.push({
      key: 'adjust',
      label: '允许调整的内容',
      description: `可选，最多 ${CREATIVE_PRESERVE_MAX_LENGTH} 字；不填则尽量忠实于原作`,
      control: 'textarea',
      required: false,
      maxLength: CREATIVE_PRESERVE_MAX_LENGTH
    });
  }
  fields.push({
    key: 'extra',
    label: '补充要求',
    description: `可选，最多 ${CREATIVE_EXTRA_MAX_LENGTH} 字`,
    control: 'textarea',
    required: false,
    maxLength: CREATIVE_EXTRA_MAX_LENGTH
  });
  return fields;
}

/** 生成参数转表单初始值：数字转为文本，未设置的项为空串；节拍参考模式已改为提交按钮，不再写回字段。 */
function paramsToValues(params: CreativeParams): FormValues {
  return {
    idea: params.idea ?? '',
    genre: params.genre ?? '',
    tone: params.tone ?? '',
    chapterMinWords: String(params.chapterMinWords),
    chapterMaxWords: String(params.chapterMaxWords),
    maxChapters: String(params.maxChapters),
    preserve: params.preserve ?? '',
    adjust: params.adjust ?? '',
    extra: params.extra ?? ''
  };
}

/** 新建时的默认参数值。 */
const DEFAULT_PARAM_VALUES: FormValues = {
  chapterMinWords: String(DEFAULT_CHAPTER_MIN_WORDS),
  chapterMaxWords: String(DEFAULT_CHAPTER_MAX_WORDS),
  maxChapters: String(DEFAULT_MAX_CHAPTERS)
};

/** “参考节拍表生成”提交按钮的键；选用时强制节拍参考模式为 reference，忽略字数范围与章节数上限字段。 */
const SUBMIT_KEY_BEAT_REFERENCE = 'beatReference';
const BEAT_REFERENCE_SUBMIT_LABEL = '参考节拍表生成';
/** 新建作品表单：这个按钮始终禁用，因为作品还不存在，不可能有属于它的已确认节拍表。 */
const BEAT_REFERENCE_NOTE_NEW_WORK =
  '按已确认节拍表的节拍数和参考字数重新生成全部章节，当前内容会被替换，上面的字数范围与章节数上限不生效；新建作品时还没有节拍表，请先创建作品，再到作品列表为它生成并确认节拍表，之后用“重新生成”使用这个按钮。';
/** 重新生成表单：该作品还没有已确认节拍表时的说明。 */
const BEAT_REFERENCE_NOTE_UNAVAILABLE =
  '按已确认节拍表的节拍数和参考字数重新生成全部章节，当前内容会被替换，上面的字数范围与章节数上限不生效；这个作品还没有已确认的节拍表，请先到作品列表生成并确认节拍表。';
/** 重新生成表单：该作品已有已确认节拍表时的说明。 */
const BEAT_REFERENCE_NOTE_AVAILABLE =
  '按已确认节拍表的节拍数和参考字数重新生成全部章节，当前内容会被替换，上面的字数范围与章节数上限不生效。';

/** 合并多次校验的字段错误后一并抛出，让用户一次看到全部问题。 */
function collectFieldErrors(checks: ReadonlyArray<() => void>): void {
  const errors: Record<string, string> = {};
  for (const check of checks) {
    try {
      check();
    } catch (error) {
      if (!(error instanceof ValidationError)) {
        throw error;
      }
      Object.assign(errors, error.fieldErrors);
    }
  }
  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }
}

/**
 * 创建“新建作品并生成”表单的定义。
 * @param dependencies 服务与回调。
 * @param projects 可选的全部项目。
 * @param defaultProjectName 默认选中的项目名称；没有默认时为空串。
 * @param sourceType 素材来源。
 */
function createNewWorkForm(
  dependencies: WorkFormDependencies,
  projects: readonly ProjectSummary[],
  defaultProjectName: string,
  sourceType: WorkSourceType,
  textModelState: WorkTextModelState
): FormDefinition {
  const { creations, onStarted } = dependencies;
  const imports = sourceType === 'original';
  return {
    schema: {
      title: `新建作品（${SOURCE_TYPE_LABELS[sourceType]}）`,
      submitLabel: imports ? SUBMIT_LABEL_IMPORT : SUBMIT_LABEL_CREATE,
      fields: [
        ...createWorkFields(sourceType, projects.map((project) => project.name)),
        createTextModelField(textModelState, TEXT_MODEL_PURPOSE),
        ...createParamFields(sourceType)
      ],
      // 原创文稿导入没有创意生成，不涉及节拍参考模式；其余来源额外提供“参考节拍表生成”按钮，
      // 新建时作品还不存在，不可能有已确认的节拍表，按钮始终禁用。
      ...(imports
        ? {}
        : {
            submitActions: [
              { key: '', label: SUBMIT_LABEL_CREATE, primary: true },
              { key: SUBMIT_KEY_BEAT_REFERENCE, label: BEAT_REFERENCE_SUBMIT_LABEL, tone: 'accent', disabled: true, note: BEAT_REFERENCE_NOTE_NEW_WORK }
            ] as readonly FormSubmitActionSchema[]
          })
    },
    initialValues: {
      [PROJECT_FIELD_KEY]: defaultProjectName,
      kind: LABEL_SINGLE_KIND,
      [TEXT_MODEL_FIELD_KEY]: textModelInitialValue(textModelState),
      ...(imports ? {} : DEFAULT_PARAM_VALUES)
    },
    submit: async (values, submitKey) => {
      const parsed: { project?: ProjectSummary; creation?: NormalizedWorkCreation; params?: CreativeParams; textModel?: string | null } = {};
      collectFieldErrors([
        () => {
          parsed.project = readProject(projects, values[PROJECT_FIELD_KEY]);
        },
        () => {
          parsed.creation = normalizeWorkCreation(values, sourceType);
        },
        () => {
          parsed.textModel = readTextModelKey(textModelState, values);
        },
        () => {
          if (!imports) {
            // 新建表单的“参考节拍表生成”按钮始终禁用，这里仍按按钮键决定模式，避免绕过禁用态时静默回退成自由创作。
            const forcedMode = submitKey === SUBMIT_KEY_BEAT_REFERENCE ? 'reference' : 'free';
            parsed.params = normalizeCreativeParams(values, forcedMode);
          }
        }
      ]);
      const { project, creation, params, textModel } = parsed;
      if (project === undefined || creation === undefined || textModel === undefined || (!imports && params === undefined)) {
        return;
      }

      const work = await creations.createAndStart({
        projectId: project.id,
        creation,
        textModelKey: textModel,
        ...(imports ? {} : { params })
      });
      onStarted(work.id);
    }
  };
}

/**
 * 创建“重新生成创意”表单的定义：作品与素材沿用，只调整生成参数；初始值为上次使用的参数。
 * @param dependencies 服务与回调。
 * @param workId 作品标识。
 * @param textModelState 作品的文本模型选择状态，用于文本模型字段的选项与初始值。
 */
function createRegenerateForm(dependencies: WorkFormDependencies, workId: number, textModelState: WorkTextModelState): FormDefinition {
  const { works, stages, beatSheets, starts, onStarted } = dependencies;
  const work = works.getWork(workId);
  if (work.sourceType === 'original') {
    throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: ORIGINAL_REGENERATE_MESSAGE });
  }
  const lastParams = stages.getLastCreativeParams(workId);
  const beatReferenceAvailable = beatSheets.findApproved(workId) !== undefined;
  return {
    schema: {
      title: `重新生成创意：${work.name}`,
      submitLabel: SUBMIT_LABEL_REGENERATE,
      fields: [
        createTextModelField(textModelState, TEXT_MODEL_PURPOSE, TEXT_MODEL_SAVED_NOTE),
        ...createParamFields(work.sourceType)
      ],
      submitActions: [
        { key: '', label: SUBMIT_LABEL_REGENERATE, primary: true },
        {
          key: SUBMIT_KEY_BEAT_REFERENCE,
          label: BEAT_REFERENCE_SUBMIT_LABEL,
          tone: 'accent',
          disabled: !beatReferenceAvailable,
          note: beatReferenceAvailable ? BEAT_REFERENCE_NOTE_AVAILABLE : BEAT_REFERENCE_NOTE_UNAVAILABLE
        }
      ]
    },
    initialValues: {
      [TEXT_MODEL_FIELD_KEY]: textModelInitialValue(textModelState),
      ...(lastParams === undefined ? DEFAULT_PARAM_VALUES : paramsToValues(lastParams))
    },
    submit: async (values, submitKey) => {
      const forcedMode = submitKey === SUBMIT_KEY_BEAT_REFERENCE ? 'reference' : 'free';
      const params = normalizeCreativeParams(values, forcedMode);
      const textModel = readTextModelKey(textModelState, values);
      await starts.startCreative(workId, textModel, params);
      onStarted(workId);
    }
  };
}

/**
 * 创建“编辑作品”表单的定义：改名称和形态（剧本确认后形态锁定），灵感图片作品还可以增删、排序图片；所属项目和素材来源不能改。
 * @param dependencies 服务与回调。
 * @param workId 作品标识。
 */
function createEditWorkForm(dependencies: WorkFormDependencies, workId: number, textModelState: WorkTextModelState): FormDefinition {
  const { works, textModels } = dependencies;
  const work = works.getWork(workId);
  const canChangeKind = works.canChangeKind(workId);
  const hasImages = work.sourceType === 'image';
  const fields: FormFieldSchema[] = canChangeKind ? [createNameField(true), createKindField()] : [createNameField(true, KIND_LOCKED_NOTE)];
  fields.push(createTextModelField(textModelState, TEXT_MODEL_PURPOSE));
  if (hasImages) {
    fields.push(createImageField());
  }
  return {
    schema: {
      title: `编辑作品：${work.name}`,
      submitLabel: SUBMIT_LABEL_EDIT,
      fields
    },
    initialValues: {
      workName: work.name,
      kind: WORK_KIND_LABELS[work.kind],
      [TEXT_MODEL_FIELD_KEY]: textModelInitialValue(textModelState),
      ...(hasImages ? { [IMAGE_FIELD_KEY]: storedFilesToFieldValue(works.listImageSources(workId)) } : {})
    },
    checkField: (key, value) =>
      key === 'workName' && !works.isWorkNameAvailable(work.projectId, value, work.id) ? DUPLICATE_WORK_NAME_MESSAGE : undefined,
    submit: (values) => {
      const textModel = readTextModelKey(textModelState, values);
      works.updateWork(work.id, values);
      textModels.setWorkModel(work.id, textModel);
    }
  };
}

/**
 * 创建作品表单目录：新建的参数为 `{ sourceType, projectId? }`（projectId 为默认选中的项目），重新生成和编辑的参数为 `{ workId }`。
 * @param dependencies 服务与回调。
 */
export function createWorkFormCatalog(dependencies: WorkFormDependencies): FormCatalog {
  return new Map<string, FormFactory | AsyncFormFactory>([
    [
      WORK_FORM_NAMES.create,
      async (params) => {
        const source = readRecord(params);
        const sourceType = readSourceType(source.sourceType);
        const projects = dependencies.projects.listProjects();
        if (projects.length === 0) {
          throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: NO_PROJECT_MESSAGE });
        }
        // 默认项目：入口指定的项目；没有指定且只有一个项目时选它；否则让用户选。
        const preferred = projects.find((project) => project.id === source.projectId);
        const defaultProject = preferred ?? (projects.length === 1 ? projects[0] : undefined);
        const textModelState = await dependencies.textModels.getWorkState(null);
        return createNewWorkForm(dependencies, projects, defaultProject?.name ?? '', sourceType, textModelState);
      }
    ],
    [
      WORK_FORM_NAMES.regenerate,
      async (params) => {
        const workId = readEntityId({ id: readRecord(params).workId }, '作品');
        return createRegenerateForm(dependencies, workId, await dependencies.textModels.getWorkState(workId));
      }
    ],
    [
      WORK_FORM_NAMES.edit,
      async (params) => {
        const workId = readEntityId({ id: readRecord(params).workId }, '作品');
        return createEditWorkForm(dependencies, workId, await dependencies.textModels.getWorkState(workId));
      }
    ]
  ]);
}
