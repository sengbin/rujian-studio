// ------------------------------------------------------------------------
// 名称：work-pick-form.ts
// 说明：“选择作品”表单的共用实现：剧本、分镜脚本列表的“添加”先用它选出符合条件的作品，选好后由调用方打开该作品的生成表单。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：选项标签为“项目 › 作品”；只选择、不启动生成；没有符合条件的作品时抛出校验错误；打开表单的参数 { projectId? } 的读取也在这里。
// ------------------------------------------------------------------------

import { FORM_LEVEL_ERROR_KEY, ValidationError } from '../../domain/errors';
import { readEntityId, readRecord } from '../../domain/rules/field-readers';
import { ProjectService } from '../services/project-service';
import { WorkListItem, WorkService } from '../services/work-service';
import { FormDefinition } from './form-definition';
import { FormFieldSchema } from './form-schema';

/** 选择作品表单的提交按钮文字。 */
const PICK_SUBMIT_LABEL = '下一步';
/** 选择作品字段的表单键。 */
const PICK_FIELD_KEY = 'work';
/** 选项文字里项目名与作品名之间的分隔符。 */
const PICK_SEPARATOR = ' › ';
/** 没有选择作品时的校验提示。 */
const PICK_REQUIRED_MESSAGE = '请选择所属作品。';

/** “选择作品”表单的定制部分。 */
export interface WorkPickOptions {
  readonly projects: Pick<ProjectService, 'listProjects'>;
  readonly works: Pick<WorkService, 'listAllWorks'>;
  /** 限定在该项目内选择；缺省列出全部项目。 */
  readonly projectId: number | undefined;
  /** 作品是否符合条件。 */
  readonly isCandidate: (work: WorkListItem) => boolean;
  /** 表单标题。 */
  readonly title: string;
  /** 选择字段下的说明，如“只列出创意已确认的作品”。 */
  readonly description: string;
  /** 没有符合条件的作品时的提示。 */
  readonly emptyMessage: string;
  /** 提交后调用，参数为所选作品。 */
  readonly onPicked: (workId: number) => void;
}

/**
 * 读取打开“选择作品”表单的参数 { projectId? }。
 * @param params 打开表单的参数，格式未经校验。
 * @returns 项目标识；没有传时为 undefined。
 * @throws ValidationError 参数不是对象，或项目标识不是整数。
 */
export function readPickProjectId(params: unknown): number | undefined {
  const projectId = readRecord(params ?? {}).projectId;
  return projectId === undefined || projectId === null ? undefined : readEntityId({ id: projectId }, '项目');
}

/**
 * 创建“选择作品”表单的定义：只列符合条件的作品，选项标签为“项目 › 作品”。
 * @param options 可选作品与项目名称等创建选项。
 * @throws ValidationError 没有符合条件的作品。
 */
export function createWorkPickForm(options: WorkPickOptions): FormDefinition {
  const { projects, works, projectId, isCandidate, title, description, emptyMessage, onPicked } = options;
  const names = new Map(projects.listProjects().map((project) => [project.id, project.name]));
  const candidates = works
    .listAllWorks()
    .filter((work) => (projectId === undefined || work.projectId === projectId) && isCandidate(work))
    .map((work) => ({ id: work.id, label: `${names.get(work.projectId) ?? ''}${PICK_SEPARATOR}${work.name}` }));
  if (candidates.length === 0) {
    throw new ValidationError({ [FORM_LEVEL_ERROR_KEY]: emptyMessage });
  }
  const field: FormFieldSchema = {
    key: PICK_FIELD_KEY,
    label: '所属作品',
    description,
    control: 'select',
    required: true,
    options: candidates.map((candidate) => candidate.label)
  };
  return {
    schema: { title, submitLabel: PICK_SUBMIT_LABEL, fields: [field] },
    initialValues: candidates.length === 1 ? { [PICK_FIELD_KEY]: candidates[0].label } : {},
    submit: (values) => {
      const picked = candidates.find((candidate) => candidate.label === values[PICK_FIELD_KEY]);
      if (picked === undefined) {
        throw new ValidationError({ [PICK_FIELD_KEY]: PICK_REQUIRED_MESSAGE });
      }
      onPicked(picked.id);
    }
  };
}
