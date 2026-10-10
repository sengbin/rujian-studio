// ------------------------------------------------------------------------
// 名称：screenplay-output-tools.ts
// 说明：剧本阶段各类输出的工具定义：模型必须通过工具返回剧本包、改编取舍清单、抽取结果与片段标注，参数的 JSON Schema 约束输出结构。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：字段含义与 screenplay-rules 的解析一致；拒绝生成用可选的 refused 字段表达，所以顶层不设 required。
// ------------------------------------------------------------------------

import { ENTITY_ATTRIBUTES, ENTITY_KIND_LABELS, EntityKind, PERFORMANCE_ATTRIBUTE_KEY, SEGMENT_KIND_LABELS } from '../../../domain/models/screenplay';
import { ENTITY_PERFORMANCE_MAX_LENGTH } from '../../../domain/rules/screenplay-rules';
import { OutputTool } from '../../../domain/ports/text-generation-port';

/** 输出工具里的拒绝原因属性：因内容审查无法生成时才填写。 */
const REFUSED_PROPERTY = {
  type: 'string',
  description: '仅在因内容审查无法生成时填写拒绝原因；正常生成时不要填写，其他字段必须填写。'
} as const;

/** 剧本包：{ title, overview, fullText }。 */
export const SUBMIT_SCREENPLAY_TOOL: OutputTool = {
  name: 'submit_screenplay',
  description: '提交剧本包：作品标题、作品信息与梗概、完整剧本正文。',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '作品标题。' },
      overview: { type: 'string', description: '作品信息与改编梗概：题材、基调、故事主线、主要人物关系。' },
      fullText: { type: 'string', description: '完整剧本正文，不含标题和梗概。' },
      refused: REFUSED_PROPERTY
    },
    additionalProperties: false
  }
};

/** 改编取舍清单：{ options: [{ kind, label, reason, affectedRefs, estimatedWordsSaved, recommended }] }，没有可取舍的内容时为空数组。 */
export const SUBMIT_ADAPTATION_OPTIONS_TOOL: OutputTool = {
  name: 'submit_adaptation_options',
  description: '提交改编取舍清单：可删减的支线、可合并的人物、可跳过的场次等候选项，没有可取舍的内容时给空数组。',
  inputSchema: {
    type: 'object',
    properties: {
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['subplot', 'character_merge', 'scene_skip', 'other'], description: '取舍类型：支线、人物合并、场次跳过、其他。' },
            label: { type: 'string', description: '简述，如“配角 A 感情线”。' },
            reason: { type: 'string', description: '取舍理由。' },
            affectedRefs: { type: 'array', items: { type: 'string' }, description: '关联的章节、场景或人物的简短名称（如 "第3章"、"灰耳"），供界面定位；不得是 JSON 或长描述。' },
            estimatedWordsSaved: { type: 'integer', minimum: 0, description: '按该部分在原文中的实际篇幅估算的节省字数。' },
            recommended: { type: 'boolean', description: '是否默认建议勾选。' }
          },
          required: ['kind', 'label', 'reason', 'estimatedWordsSaved', 'recommended'],
          additionalProperties: false
        },
        description: '候选取舍项。'
      },
      refused: REFUSED_PROPERTY
    },
    additionalProperties: false
  }
};

/** 片段标注：{ labels: [{ index, kind, speaker?, uncertain? }] }，每个片段一项、按序号排列。 */
export const SUBMIT_SEGMENT_LABELS_TOOL: OutputTool = {
  name: 'submit_segment_labels',
  description: '提交每个片段的类型和说话人；只引用片段序号，不要复制片段文字。',
  inputSchema: {
    type: 'object',
    properties: {
      labels: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', minimum: 1, description: '片段序号，与输入一致，按顺序排列。' },
            kind: { type: 'string', enum: Object.keys(SEGMENT_KIND_LABELS), description: '片段类型：narration 旁白（叙述与描写）、dialogue 对白、thought 心声。' },
            speaker: { type: 'string', description: '说话人，必须是角色清单中的名称或别名；旁白不填，无法确定时不填。' },
            uncertain: { type: 'boolean', description: '没有把握、需要人工核对时填 true。' }
          },
          required: ['index', 'kind'],
          additionalProperties: false
        },
        description: '与输入片段一一对应的标注。'
      },
      refused: REFUSED_PROPERTY
    },
    additionalProperties: false
  }
};

/** 设定字段的并集：各类型的键合并，说明写明适用类型。 */
function createAttributeProperties(): Record<string, unknown> {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const kind of Object.keys(ENTITY_ATTRIBUTES) as EntityKind[]) {
    for (const { key, label } of ENTITY_ATTRIBUTES[kind]) {
      const scope = `${ENTITY_KIND_LABELS[kind]}：${label}`;
      const previous = properties[key];
      properties[key] = { type: 'string', description: previous === undefined ? scope : `${previous.description}；${scope}` };
    }
  }
  properties[PERFORMANCE_ATTRIBUTE_KEY] = {
    type: 'string',
    description: `角色：表演与动作。按情绪或情境分条，每条“情境：表情与微表情；眼神；肢体动作”，不超过 ${ENTITY_PERFORMANCE_MAX_LENGTH} 字；不要复述剧情。`
  };
  return properties;
}

/**
 * 抽取结果：{ episodes: [{ title, synopsis, screenplayText?, targetDurationSeconds? }], entities: [{ kind, name, aliases?, description, attributes? }] }。
 * @param single 单个短视频：只有一集，不需要标题与本集正文。
 */
export function createStructureTool(single: boolean): OutputTool {
  const episodeProperties: Record<string, unknown> = {
    synopsis: { type: 'string', description: '本集梗概。' },
    targetDurationSeconds: { type: 'integer', minimum: 1, description: '本集预计时长（秒），不得超过单集最大时长。' }
  };
  if (!single) {
    episodeProperties.title = { type: 'string', description: '集标题。' };
    episodeProperties.screenplayText = { type: 'string', description: '本集剧本正文：从剧本正文中原样摘录属于本集的部分。' };
  }
  return createStructureToolFrom(episodeProperties, single ? ['synopsis'] : ['title', 'synopsis', 'screenplayText']);
}

/**
 * 原稿保真模式的抽取结果：多集的每集只给出起止段落序号，不复制原文；实体与普通抽取相同。
 * @param single 单个短视频：只有一集，不需要标题与段落序号。
 */
export function createVerbatimStructureTool(single: boolean): OutputTool {
  const episodeProperties: Record<string, unknown> = {
    synopsis: { type: 'string', description: '本集梗概。' },
    targetDurationSeconds: { type: 'integer', minimum: 1, description: '本集预计时长（秒），不得超过单集最大时长。' }
  };
  if (!single) {
    episodeProperties.title = { type: 'string', description: '集标题。' };
    episodeProperties.startParagraph = { type: 'integer', minimum: 1, description: '本集第一个段落的序号。' };
    episodeProperties.endParagraph = { type: 'integer', minimum: 1, description: '本集最后一个段落的序号。' };
  }
  return createStructureToolFrom(episodeProperties, single ? ['synopsis'] : ['title', 'synopsis', 'startParagraph', 'endParagraph']);
}

/** 组装抽取工具：集的字段由调用方给出，实体的结构固定。 */
function createStructureToolFrom(episodeProperties: Record<string, unknown>, episodeRequired: readonly string[]): OutputTool {
  return {
    name: 'submit_structure',
    description: '提交从剧本正文抽取的集和实体。',
    inputSchema: {
      type: 'object',
      properties: {
        episodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: episodeProperties,
            required: episodeRequired,
            additionalProperties: false
          },
          description: '按顺序排列的集。'
        },
        entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: Object.keys(ENTITY_KIND_LABELS), description: '实体类型。' },
              name: { type: 'string', description: '稳定名称，同类型内不重复。' },
              aliases: { type: 'array', items: { type: 'string' }, description: '剧本中出现的别名、称呼。' },
              description: { type: 'string', description: '设定摘要。' },
              attributes: {
                type: 'object',
                properties: createAttributeProperties(),
                additionalProperties: false,
                description: '按类型区分的设定，只填写该类型适用的字段。'
              }
            },
            required: ['kind', 'name', 'description'],
            additionalProperties: false
          },
          description: '剧本中出现的角色、场景、道具和特效。'
        },
        refused: REFUSED_PROPERTY
      },
      additionalProperties: false
    }
  };
}
