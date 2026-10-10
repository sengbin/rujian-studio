// ------------------------------------------------------------------------
// 名称：asset-prompt-output-tools.ts
// 说明：资产提示词的输出工具：模型必须通过它返回提示词。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：字段含义与 asset-prompt-rules 的解析一致；拒绝生成用可选的 refused 字段表达。
// ------------------------------------------------------------------------

import { OutputTool } from '../../../domain/ports/text-generation-port';

/** 资产提示词：{ prompt }。 */
export const SUBMIT_ASSET_PROMPTS_TOOL: OutputTool = {
  name: 'submit_asset_prompts',
  description: '提交资产参考图或音频的生成提示词。',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '提示词。' },
      refused: {
        type: 'string',
        description: '仅在因内容审查无法生成时填写拒绝原因；正常生成时不要填写，其他字段必须填写。'
      }
    },
    additionalProperties: false
  }
};
