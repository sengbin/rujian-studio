// ------------------------------------------------------------------------
// 名称：storyboard-output-tools.ts
// 说明：分镜脚本阶段的输出工具定义：模型必须通过工具返回整集的镜头，参数的 JSON Schema 按生成参数裁剪（首帧来源、声音类型）。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：字段含义与 storyboard-output-rules 的解析一致；拒绝生成用可选的 refused 字段表达，所以顶层不设 required。
// ------------------------------------------------------------------------

import { ENTITY_KIND_LABELS } from '../../../domain/models/screenplay';
import { SOUND_KIND_LABELS, STAGE_DEPTH_LABELS, STAGE_FACING_LABELS, STAGE_X_LABELS, StoryboardParams } from '../../../domain/models/storyboard';
import { STAGING_ACTION_MAX_LENGTH } from '../../../domain/rules/staging-rules';
import { OutputTool } from '../../../domain/ports/text-generation-port';

/** 输出工具里的拒绝原因属性：因内容审查无法生成时才填写。 */
const REFUSED_PROPERTY = {
  type: 'string',
  description: '仅在因内容审查无法生成时填写拒绝原因；正常生成时不要填写，其他字段必须填写。'
} as const;

/** 声音条目的 Schema：类型限于参数中启用的声音内容。 */
function createSoundSchema(params: StoryboardParams): Record<string, unknown> {
  return {
    type: 'array',
    description: '镜头内按出现顺序排列的声音条目；没有声音时给空数组。',
    items: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [...params.audioElements],
          description: params.audioElements.map((kind) => `${kind}：${SOUND_KIND_LABELS[kind]}`).join('；')
        },
        speaker: { type: 'string', description: '说话的角色名称，仅角色对白（dialogue）填写，必须是已有的角色。任何角色（包括动物、拟人角色）说的话都是对白，不能写成旁白。' },
        text: { type: 'string', description: '对白、旁白的台词；音效按“发声材质 + 动作 + 环境音”描述；背景音乐按“背景音乐/配乐 + 风格”描述。' },
        delivery: { type: 'string', description: '人声（对白、旁白）必填：情绪、语气与音量（悄悄话、低声、大声喊叫等）、语速（慢、适中、快）、音色、口音，如“压低声音的悄悄话、语速偏慢、带着紧张”；音效、背景音乐可补充声音质感，如“紧张的弦乐”。' },
        startOffsetSeconds: { type: 'number', minimum: 0, description: '相对镜头起点的开始时间（秒）；人声必填，同一镜头里的人声按顺序排列、互不重叠。' },
        durationSeconds: { type: 'number', exclusiveMinimum: 0, description: '持续时长（秒）；人声必填，中文按每秒约 4 个字估算，开始时间加时长不得超过镜头时长。' }
      },
      required: ['kind', 'text'],
      additionalProperties: false
    }
  };
}

/** 站位条目的 Schema：实体只能是角色、道具、特效，位置、朝向都是枚举，以观众看到的画面为准。 */
function createStagingSchema(): Record<string, unknown> {
  const describe = (labels: Readonly<Record<string, string>>): string => Object.entries(labels).map(([key, label]) => `${key}：${label}`).join('；');
  return {
    type: 'array',
    description:
      '本镜头出场的角色、道具、特效的站位与调度；位置、朝向都以观众看到的画面为准（画面左侧是观众的左边）。每个出场的角色必须有一条；道具和特效只写需要明确摆放位置的；场景不需要站位；没有时给空数组。',
    items: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['character', 'prop', 'effect'], description: '实体类型，场景不需要站位。' },
        name: { type: 'string', description: '实体清单中的主名称（不含“（别名：…）”），必须是 entities 里出场的实体。' },
        startX: { type: 'string', enum: Object.keys(STAGE_X_LABELS), description: `镜头开始时的横向位置。${describe(STAGE_X_LABELS)}；画面左外、画面右外表示从画面外进入。` },
        startDepth: { type: 'string', enum: Object.keys(STAGE_DEPTH_LABELS), description: `镜头开始时的纵深位置。${describe(STAGE_DEPTH_LABELS)}。` },
        endX: { type: 'string', enum: Object.keys(STAGE_X_LABELS), description: '镜头结束时的横向位置；整个镜头里不移动时不填；画面左外、画面右外表示走出画面。' },
        endDepth: { type: 'string', enum: Object.keys(STAGE_DEPTH_LABELS), description: '镜头结束时的纵深位置；整个镜头里不移动时不填。' },
        facing: { type: 'string', enum: Object.keys(STAGE_FACING_LABELS), description: `朝向。${describe(STAGE_FACING_LABELS)}。` },
        action: { type: 'string', description: `姿态或动作，如“坐在桌边”“端起茶杯”“向右转身”，不超过 ${STAGING_ACTION_MAX_LENGTH} 字；没有可不填。` }
      },
      required: ['kind', 'name'],
      additionalProperties: false
    }
  };
}

/**
 * 分镜脚本：{ shots: [{ sceneLabel, shotSize, cameraAngle, cameraMovement, durationSeconds, transition, continuityNote,
 * firstFrameMode?, entities, staging, sounds?, prompt }] }。
 * @param params 生成参数：连贯策略为“由 AI 判断”时才有 firstFrameMode；声音模式为无声时没有 sounds。
 * @param continuesFromPrevious 为 true 表示这一批接在前面已生成的镜头之后，第 1 个镜头可以接上一批最后一个镜头的尾帧。
 */
export function createStoryboardTool(params: StoryboardParams, continuesFromPrevious = false): OutputTool {
  const shotProperties: Record<string, unknown> = {
    sceneLabel: { type: 'string', description: '所属场次，如“第01场”。' },
    shotSize: { type: 'string', description: '景别，用口语写，如大远景、远景、中景、近景、特写。生成视频时程序会把它写在提示词开头。' },
    cameraAngle: { type: 'string', description: '机位与视角，如平视、低角度仰拍、俯拍、过肩。可带焦段，如“24mm 广角”“85mm 长焦，浅景深”。' },
    cameraMovement: { type: 'string', description: '摄影机运动，用大白话写，如“固定镜头，摄影机静止”“推近”“拉远”“环绕”“手持跟拍”“缓慢上摇”。' },
    durationSeconds: { type: 'number', exclusiveMinimum: 0, description: '镜头时长（秒）。' },
    transition: { type: 'string', description: '与下一镜头的转场，如“切”“叠化”；没有特别要求时填“切”（硬切，不写进提示词）。' },
    continuityNote: { type: 'string', description: '与前后镜头保持一致的要求，如服装、光线、位置。' },
    entities: {
      type: 'array',
      description: '本镜头出场的实体，只能引用实体清单中已有的实体。',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: Object.keys(ENTITY_KIND_LABELS), description: '实体类型。' },
          name: { type: 'string', description: '实体清单中的主名称，不含“（别名：…）”。' }
        },
        required: ['kind', 'name'],
        additionalProperties: false
      }
    },
    prompt: {
      type: 'string',
      description: '画面描述（中文视频提示词）：第一句先概括主体与主要动作（同时用作镜头列表的标题），再按“主体（描述）+ 场景（描述）+ 运动（描述）+ 审美控制”写成连贯短句，主体写外观细节，场景写背景与前景，运动写幅度、速度和效果，审美控制写光线、构图、色调；只写能看到的内容，正向表达；不含景别、机位、运镜（它们在各自字段里）、站位（在 staging 里）、风格（程序统一写在开头）和台词。以上一镜头尾帧作首帧的镜头重点写运动，主体和场景一句话延续首帧。'
    },
    staging: createStagingSchema()
  };
  const required = ['shotSize', 'cameraAngle', 'cameraMovement', 'durationSeconds', 'entities', 'staging', 'prompt'];
  if (params.continuity === 'ai') {
    shotProperties.firstFrameMode = {
      type: 'string',
      enum: ['none', 'prev_tail'],
      description: 'none：不指定首帧；prev_tail：以上一镜头的尾帧作为本镜头首帧，用于画面连续的镜头。' + (continuesFromPrevious ? '本批第 1 个镜头的上一镜头是前面已生成的最后一个镜头。' : '第 1 个镜头只能是 none。')
    };
    required.push('firstFrameMode');
  }
  if (params.audioMode !== 'none') {
    shotProperties.sounds = createSoundSchema(params);
    required.push('sounds');
  }
  return {
    name: 'submit_storyboard',
    description: '提交一集的分镜脚本：按顺序排列的镜头。',
    inputSchema: {
      type: 'object',
      properties: {
        shots: {
          type: 'array',
          items: { type: 'object', properties: shotProperties, required, additionalProperties: false },
          description: '按顺序排列的镜头。'
        },
        refused: REFUSED_PROPERTY
      },
      additionalProperties: false
    }
  };
}
