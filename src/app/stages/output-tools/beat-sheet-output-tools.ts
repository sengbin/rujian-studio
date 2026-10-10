// ------------------------------------------------------------------------
// 名称：beat-sheet-output-tools.ts
// 说明：节拍表阶段输出的工具定义：模型必须通过工具返回各节拍的剧情内容，参数的 JSON Schema 约束输出结构。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：字段含义与 beat-sheet-rules 的 parseBeatSheet 一致；拒绝生成用可选的 refused 字段表达，所以顶层不设 required。
// ------------------------------------------------------------------------

import { OutputTool } from '../../../domain/ports/text-generation-port';

const REFUSED_PROPERTY = {
  type: 'string',
  description: '仅在因内容审查无法生成时填写拒绝原因；正常生成时不要填写，其他字段必须填写。'
} as const;

/**
 * 节拍表：{ beats: [{ seq, synopsis, sourceRefs? }] }。
 * @param novel 素材为小说时，每个节拍要带 sourceRefs（依据的原文分段序号，没有依据时给空数组）。
 * @param beatCount 模板的节拍数，限定数组长度。
 */
export function createBeatSheetTool(novel: boolean, beatCount: number): OutputTool {
  const beatProperties: Record<string, unknown> = {
    seq: { type: 'integer', minimum: 1, description: '节拍序号，按给定顺序从 1 开始。' },
    synopsis: { type: 'string', description: '本节拍对应的具体剧情内容梗概。' }
  };
  if (novel) {
    beatProperties.sourceRefs = {
      type: 'array',
      items: { type: 'integer', minimum: 1 },
      description: '本节拍依据的原文分段序号，没有依据时给空数组。'
    };
  }
  return {
    name: 'submit_beat_sheet',
    description: '提交节拍表：每个节拍的剧情内容。',
    inputSchema: {
      type: 'object',
      properties: {
        beats: {
          type: 'array',
          items: {
            type: 'object',
            properties: beatProperties,
            required: novel ? ['seq', 'synopsis', 'sourceRefs'] : ['seq', 'synopsis'],
            additionalProperties: false
          },
          minItems: beatCount,
          maxItems: beatCount,
          description: `按给定顺序排列的 ${beatCount} 个节拍。`
        },
        refused: REFUSED_PROPERTY
      },
      additionalProperties: false
    }
  };
}
