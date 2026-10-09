// ------------------------------------------------------------------------
// 名称：volcengine-catalog.ts
// 说明：火山引擎的两个服务商声明：火山方舟（文本、图片、视频）与豆包语音（语音合成），各自的服务商代码、显示名称与接口地址设置项；方舟的文本与图片、视频分别设置接口地址。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：方舟与豆包语音是火山引擎两个独立的产品：接口地址、鉴权方式和访问密钥（API Key，在各自控制台创建）都不同，所以登记为两个服务商，各自保存一份访问密钥；各类型的模型目录见同目录下的 *-catalog.ts。
// ------------------------------------------------------------------------

import { ProviderDescriptor } from '../../../domain/models/model-provider';
import { VOLCENGINE_MODEL_PRICES, VOLCENGINE_SPEECH_MODEL_PRICES } from './volcengine-pricing';

/** 方舟服务商代码，同时用于数据库和密钥名称。 */
export const VOLCENGINE_PROVIDER_CODE = 'volcengine';

/** 方舟服务商显示名称。 */
export const VOLCENGINE_PROVIDER_NAME = '火山引擎';

/** 豆包语音服务商代码与显示名称。 */
export const VOLCENGINE_SPEECH_PROVIDER_CODE = 'volcengine-speech';
export const VOLCENGINE_SPEECH_PROVIDER_NAME = '豆包语音';

/** 接口地址设置项的键：方舟的图片、视频地址与豆包语音的地址使用同名键，分属两个服务商、各存各的。 */
export const VOLCENGINE_ENDPOINT_SETTING_KEY = 'endpoint';
export const VOLCENGINE_ENDPOINT_LABEL = '接口地址（图片、视频）';

/** 方舟文本接口地址设置项的键与显示名：文本可能使用与图片、视频不同的地址（如 Coding Plan 套餐的专用地址）。 */
export const VOLCENGINE_TEXT_ENDPOINT_SETTING_KEY = 'textEndpoint';
export const VOLCENGINE_TEXT_ENDPOINT_LABEL = '文本接口地址';

/** 方舟两个接口地址的默认值；地址格式不固定（可能是代理或编码套餐地址），不做格式校验。 */
const VOLCENGINE_DEFAULT_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3';
const VOLCENGINE_DEFAULT_TEXT_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3';

/** 语音合成接口地址的默认值：HTTP Chunked 单向流式接口；地址格式不固定，不做格式校验。 */
const VOLCENGINE_DEFAULT_SPEECH_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';

/** 火山引擎方舟（文本、图片、视频）的服务商声明。 */
export const VOLCENGINE_PROVIDER: ProviderDescriptor = {
  code: VOLCENGINE_PROVIDER_CODE,
  displayName: VOLCENGINE_PROVIDER_NAME,
  modelPrices: VOLCENGINE_MODEL_PRICES,
  settingFields: [
    {
      key: VOLCENGINE_ENDPOINT_SETTING_KEY,
      label: VOLCENGINE_ENDPOINT_LABEL,
      description: '火山方舟的 API 地址，图片、视频生成使用；留空使用默认地址。访问密钥在火山方舟控制台创建。',
      control: 'text',
      defaultValue: VOLCENGINE_DEFAULT_ENDPOINT,
      connectionCheckKind: 'video'
    },
    {
      key: VOLCENGINE_TEXT_ENDPOINT_SETTING_KEY,
      label: VOLCENGINE_TEXT_ENDPOINT_LABEL,
      description: '火山方舟的 API 地址，文本生成使用，与图片、视频共用同一份访问密钥；使用 Coding Plan 套餐时填写套餐专用地址；留空使用默认地址。',
      control: 'text',
      defaultValue: VOLCENGINE_DEFAULT_TEXT_ENDPOINT,
      connectionCheckKind: 'text'
    }
  ]
};

/** 豆包语音（语音合成）的服务商声明。 */
export const VOLCENGINE_SPEECH_PROVIDER: ProviderDescriptor = {
  code: VOLCENGINE_SPEECH_PROVIDER_CODE,
  displayName: VOLCENGINE_SPEECH_PROVIDER_NAME,
  modelPrices: VOLCENGINE_SPEECH_MODEL_PRICES,
  settingFields: [
    {
      key: VOLCENGINE_ENDPOINT_SETTING_KEY,
      label: '接口地址',
      description:
        '豆包语音合成（音频生成使用）的 HTTP 接口地址；留空使用默认地址。访问密钥（API Key）在豆包语音控制台创建，与火山方舟的密钥不通用。',
      control: 'text',
      defaultValue: VOLCENGINE_DEFAULT_SPEECH_ENDPOINT,
      connectionCheckKind: 'audio'
    }
  ]
};
