// ------------------------------------------------------------------------
// 名称：minimax-catalog.ts
// 说明：MiniMax 服务商的声明：服务商代码、显示名称与接口地址设置项及其格式约束；文本、图像、音频、视频四类模型共用同一服务商与同一份访问密钥。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：数值来自 MiniMax 开放平台文档“接口概览”；接口地址只填域名，各接口的路径由各类型适配器自带；各类型的模型目录见同目录下的 *-catalog.ts。
// ------------------------------------------------------------------------

import { ProviderDescriptor } from '../../../domain/models/model-provider';
import { MINIMAX_MODEL_PRICES } from './minimax-pricing';

/** 服务商代码，同时用于数据库和密钥名称。 */
export const MINIMAX_PROVIDER_CODE = 'minimax';

/** 服务商显示名称。 */
export const MINIMAX_PROVIDER_NAME = 'MiniMax';

/** 接口地址设置项的键。 */
export const MINIMAX_ENDPOINT_SETTING_KEY = 'endpoint';

/** 接口地址的默认值；地址格式不固定，不做格式校验。 */
const MINIMAX_DEFAULT_ENDPOINT = 'https://api.minimax.cn';

/** MiniMax 的服务商声明。 */
export const MINIMAX_PROVIDER: ProviderDescriptor = {
  code: MINIMAX_PROVIDER_CODE,
  displayName: MINIMAX_PROVIDER_NAME,
  modelPrices: MINIMAX_MODEL_PRICES,
  settingFields: [
    {
      key: MINIMAX_ENDPOINT_SETTING_KEY,
      label: '接口地址',
      description:
        'MiniMax 开放平台的 API 地址（文本、图片、语音、视频共用）；留空使用默认地址。访问密钥在开放平台“接口密钥”中创建；M Plan 订阅 Key 与按量付费的 API Key 相互独立。',
      control: 'text',
      defaultValue: MINIMAX_DEFAULT_ENDPOINT,
      connectionCheckKind: 'video'
    }
  ]
};
