// ------------------------------------------------------------------------
// 名称：volcengine-text-catalog.ts
// 说明：火山引擎（方舟）文本模型目录：豆包 Seed 系列文本模型及其能力，以及对话接口的路径。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：数值来自方舟文档“模型列表”：只收录支持工具调用与图片理解的豆包 Seed 推荐模型及同系列上一代 2.0 的 lite、mini；单次输出统一按 64K token 请求，低于各模型的最大回答长度；平台上新增或调整模型时只改这里。
// ------------------------------------------------------------------------

import { TextCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor } from '../../../domain/models/model-provider';

/** 对话接口的路径，相对文本接口地址。 */
export const VOLCENGINE_CHAT_PATH = '/chat/completions';

/** 单次请求的最大输出 token 数，所有文本模型统一。 */
const MAX_OUTPUT_TOKENS = 64_000;

/** 1024K 上下文的模型：Seed 2.1 Pro、Lite 与 Seed Evolving。 */
const CONTEXT_1024K_CAPABILITY: TextCapability = { contextTokens: 1_000_000, maxOutputTokens: MAX_OUTPUT_TOKENS, imageInput: true };

/** 256K 上下文的模型：Seed 2.1 Turbo 与 Seed 2.0 Lite、Mini。 */
const CONTEXT_256K_CAPABILITY: TextCapability = { contextTokens: 256_000, maxOutputTokens: MAX_OUTPUT_TOKENS, imageInput: true };

/** 火山引擎提供的文本模型。 */
export const VOLCENGINE_TEXT_MODELS: readonly ModelDescriptor<'text'>[] = [
  { code: 'doubao-seed-2-1-pro-260915', displayName: '豆包 Seed 2.1 Pro（旗舰）', kind: 'text', capability: CONTEXT_1024K_CAPABILITY },
  { code: 'doubao-seed-2-1-lite-260915', displayName: '豆包 Seed 2.1 Lite（均衡）', kind: 'text', capability: CONTEXT_1024K_CAPABILITY },
  { code: 'doubao-seed-2-1-turbo-260628', displayName: '豆包 Seed 2.1 Turbo（高速）', kind: 'text', capability: CONTEXT_256K_CAPABILITY },
  { code: 'doubao-seed-evolving', displayName: '豆包 Seed Evolving（快速迭代）', kind: 'text', capability: CONTEXT_1024K_CAPABILITY },
  { code: 'doubao-seed-2-0-lite-260428', displayName: '豆包 Seed 2.0 Lite', kind: 'text', capability: CONTEXT_256K_CAPABILITY },
  { code: 'doubao-seed-2-0-mini-260428', displayName: '豆包 Seed 2.0 Mini（轻量）', kind: 'text', capability: CONTEXT_256K_CAPABILITY }
];
