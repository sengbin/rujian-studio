// ------------------------------------------------------------------------
// 名称：minimax-text-catalog.ts
// 说明：MiniMax 文本模型目录：MiniMax M3.1、M3 与 M2.x 系列语言模型及其能力、思考控制方式，以及对话接口的路径。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：数值来自 MiniMax 开放平台文档“接口概览”“OpenAI SDK”：只有 M3.1-Flash-Preview 与 M3 支持图片输入；M3.1-Flash-Preview 的思考无法关闭（只能调低深度），M3 可以关闭，M2.x 不能关闭；思考 token 也计入 max_tokens，所以单次输出上限取得较保守；平台上新增或调整模型时只改这里。
// ------------------------------------------------------------------------

import { TextCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor } from '../../../domain/models/model-provider';

/** 对话接口的路径，相对接口地址。 */
export const MINIMAX_CHAT_PATH = '/v1/chat/completions';

/** 单次请求的最大输出 token 数（含思考 token）：M3 系列。 */
const MAX_OUTPUT_TOKENS_M3 = 64_000;

/** 单次请求的最大输出 token 数（含思考 token）：M2.x 系列。 */
const MAX_OUTPUT_TOKENS_M2 = 32_000;

/** 思考的控制方式：disabled 请求里关闭思考；low-effort 把思考深度调到最低；always-on 无法控制，不传参数。 */
export type MinimaxThinkingControl = 'disabled' | 'low-effort' | 'always-on';

/** 一个文本模型的声明及其在请求构造上的差异。 */
export interface MinimaxTextModel {
  readonly descriptor: ModelDescriptor<'text'>;
  readonly thinking: MinimaxThinkingControl;
}

/** M3 系列：1M 上下文，支持图片输入。 */
const M3_CAPABILITY: TextCapability = { contextTokens: 1_000_000, maxOutputTokens: MAX_OUTPUT_TOKENS_M3, imageInput: true };

/** M2.x 系列：204,800 上下文，不支持图片输入。 */
const M2_CAPABILITY: TextCapability = { contextTokens: 204_800, maxOutputTokens: MAX_OUTPUT_TOKENS_M2, imageInput: false };

/** MiniMax 提供的文本模型。 */
export const MINIMAX_TEXT_MODELS: readonly MinimaxTextModel[] = [
  {
    descriptor: { code: 'MiniMax-M3.1-Flash-Preview', displayName: 'MiniMax M3.1 Flash 预览（仅 M Plan）', kind: 'text', capability: M3_CAPABILITY },
    thinking: 'low-effort'
  },
  { descriptor: { code: 'MiniMax-M3', displayName: 'MiniMax M3（旗舰）', kind: 'text', capability: M3_CAPABILITY }, thinking: 'disabled' },
  m2Model('MiniMax-M2.7', 'MiniMax M2.7'),
  m2Model('MiniMax-M2.7-highspeed', 'MiniMax M2.7 极速版'),
  m2Model('MiniMax-M2.5', 'MiniMax M2.5'),
  m2Model('MiniMax-M2.5-highspeed', 'MiniMax M2.5 极速版'),
  m2Model('MiniMax-M2.1', 'MiniMax M2.1'),
  m2Model('MiniMax-M2.1-highspeed', 'MiniMax M2.1 极速版'),
  m2Model('MiniMax-M2', 'MiniMax M2')
];

/** 构造一个 M2.x 模型。 */
function m2Model(code: string, displayName: string): MinimaxTextModel {
  return { descriptor: { code, displayName, kind: 'text', capability: M2_CAPABILITY }, thinking: 'always-on' };
}
