// ------------------------------------------------------------------------
// 名称：qianwen-catalog.ts
// 说明：千问AI平台服务商的声明与模型目录：服务商代码、两个接口地址设置项（图片视频音频、文本），以及万相 3.0 视频模型的能力描述。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：能力数值来自千问AI平台文档“wan3.0-video 视频生成”；平台上新增或调整模型时只改这里。
// ------------------------------------------------------------------------

import { VideoCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor, ProviderDescriptor } from '../../../domain/models/model-provider';
import { QIANWEN_MODEL_PRICES } from './qianwen-pricing';

/** 服务商代码，同时用于数据库和密钥名称。 */
export const QIANWEN_PROVIDER_CODE = 'qianwen';

/** 图片、视频、音频接口地址设置项的键与显示名：三类共用平台原生接口的一个地址和访问密钥。 */
export const QIANWEN_ENDPOINT_SETTING_KEY = 'endpoint';
/** 千问图片、视频、音频接口地址设置项的界面名称。 */
export const QIANWEN_ENDPOINT_LABEL = '接口地址（图片、视频、音频）';

/** 文本接口地址设置项的键与显示名：文本走 OpenAI 兼容接口，地址与原生接口不同。 */
export const QIANWEN_TEXT_ENDPOINT_SETTING_KEY = 'textEndpoint';
/** 千问文本接口地址设置项的界面名称。 */
export const QIANWEN_TEXT_ENDPOINT_LABEL = '文本接口地址';

/** 两个接口地址的默认值；地址格式不固定（可能是代理或其他套餐地址），不做格式校验。 */
const QIANWEN_DEFAULT_ENDPOINT = 'https://maas.qianwenaiapi.com/api/v1';
const QIANWEN_DEFAULT_TEXT_ENDPOINT = 'https://maas.qianwenaiapi.com/compatible-mode/v1';

/** 千问AI平台的服务商声明。 */
export const QIANWEN_PROVIDER: ProviderDescriptor = {
  code: QIANWEN_PROVIDER_CODE,
  displayName: '千问AI平台',
  modelPrices: QIANWEN_MODEL_PRICES,
  settingFields: [
    {
      key: QIANWEN_ENDPOINT_SETTING_KEY,
      label: QIANWEN_ENDPOINT_LABEL,
      description: '千问AI平台原生 API 的地址，图片、视频、音频生成共用；留空使用默认地址。',
      control: 'text',
      defaultValue: QIANWEN_DEFAULT_ENDPOINT,
      connectionCheckKind: 'video'
    },
    {
      key: QIANWEN_TEXT_ENDPOINT_SETTING_KEY,
      label: QIANWEN_TEXT_ENDPOINT_LABEL,
      description: '千问AI平台 OpenAI 兼容接口的地址，文本生成使用；留空使用默认地址。',
      control: 'text',
      defaultValue: QIANWEN_DEFAULT_TEXT_ENDPOINT,
      connectionCheckKind: 'text'
    }
  ]
};

/** 万相 3.0 视频生成的单张参考图大小上限，单位为字节。 */
export const WAN3_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/** 万相 3.0 视频生成的单段参考音频大小上限，单位为字节。 */
export const WAN3_AUDIO_MAX_BYTES = 15 * 1024 * 1024;

/** 随机种子的取值上限。 */
export const WAN3_SEED_MAX = 2147483647;

/** 提示词长度上限。 */
const WAN3_PROMPT_MAX_LENGTH = 20000;

/** 万相 3.0 视频生成的能力。画幅不含 adaptive：不指定画幅时模型按输入素材自适应；有首帧时官方建议 ratio 用 adaptive（模型自动匹配首帧宽高比），所以有首帧时不传画幅。 */
const WAN3_VIDEO_CAPABILITY: VideoCapability = {
  aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  resolutions: ['480P', '720P', '1080P'],
  duration: { min: 2, max: 30, step: 1, allowAuto: true },
  fps: [30],
  audioModes: ['none', 'native'],
  audioElements: ['dialogue', 'narration', 'sfx', 'music'],
  voiceReference: true,
  audioInputMax: { count: 5, maxSeconds: 15 },
  firstFrame: true,
  lastFrame: true,
  referenceImagesMax: 10,
  seed: true,
  promptExtend: true,
  firstFrameDefinesAspect: true,
  promptMaxLength: WAN3_PROMPT_MAX_LENGTH
};

/** 千问AI平台提供的视频模型。 */
export const QIANWEN_VIDEO_MODELS: readonly ModelDescriptor<'video'>[] = [
  { code: 'wan3.0-video', displayName: '万相 3.0 视频', kind: 'video', capability: WAN3_VIDEO_CAPABILITY },
  { code: 'wan3.0-video-prime', displayName: '万相 3.0 视频（高速版）', kind: 'video', capability: WAN3_VIDEO_CAPABILITY }
];
