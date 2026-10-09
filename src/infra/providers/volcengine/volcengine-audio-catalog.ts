// ------------------------------------------------------------------------
// 名称：volcengine-audio-catalog.ts
// 说明：豆包语音音频模型目录：豆包语音合成 2.0 的能力描述、资源标识、可选音色（显示名称与音色标识），以及输出音频的格式。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：数值与音色来自火山引擎文档“HTTP Chunked/SSE 单向流式-V3”“音色列表”（豆包语音合成模型 2.0）；语音合成只生成语音（音色参考），不生成配乐与音效；音频内容经任务引用内联保存，所以提示词长度限制得较短；平台上新增或调整音色时只改这里。
// ------------------------------------------------------------------------

import { AudioCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor } from '../../../domain/models/model-provider';

/** 语音合成的资源标识（X-Api-Resource-Id），决定模型版本与计费方式。 */
export const VOLCENGINE_SPEECH_RESOURCE_ID = 'seed-tts-2.0';

/** 输出音频的编码格式、采样率与对应的 MIME 类型。 */
export const VOLCENGINE_SPEECH_FORMAT = 'mp3';
export const VOLCENGINE_SPEECH_SAMPLE_RATE = 24_000;
export const VOLCENGINE_SPEECH_MIME_TYPE = 'audio/mpeg';

/** 提示词（要朗读的文字）的长度上限。 */
const SPEECH_PROMPT_MAX_LENGTH = 500;

/** 一个预置音色：界面显示名称与平台的音色标识（speaker）。 */
export interface VolcengineVoice {
  readonly label: string;
  readonly speaker: string;
}

/** 豆包语音合成 2.0 的预置音色，第一个为未指定音色时的默认音色。 */
export const VOLCENGINE_VOICES: readonly VolcengineVoice[] = [
  { label: 'Vivi 2.0（女声，通用）', speaker: 'zh_female_vv_uranus_bigtts' },
  { label: '小何 2.0（女声，通用）', speaker: 'zh_female_xiaohe_uranus_bigtts' },
  { label: '清新女声 2.0', speaker: 'zh_female_qingxinnvsheng_uranus_bigtts' },
  { label: '魅力苏菲 2.0（女声）', speaker: 'zh_female_sophie_uranus_bigtts' },
  { label: '知性灿灿 2.0（女声，角色扮演）', speaker: 'zh_female_cancan_uranus_bigtts' },
  { label: '撒娇学妹 2.0（女声，角色扮演）', speaker: 'zh_female_sajiaoxuemei_uranus_bigtts' },
  { label: '甜美小源 2.0（女声）', speaker: 'zh_female_tianmeixiaoyuan_uranus_bigtts' },
  { label: '甜美桃子 2.0（女声）', speaker: 'zh_female_tianmeitaozi_uranus_bigtts' },
  { label: '爽快思思 2.0（女声）', speaker: 'zh_female_shuangkuaisisi_uranus_bigtts' },
  { label: '邻家女孩 2.0（女声）', speaker: 'zh_female_linjianvhai_uranus_bigtts' },
  { label: '流畅女声 2.0（视频配音）', speaker: 'zh_female_liuchangnv_uranus_bigtts' },
  { label: '魅力女友 2.0（女声）', speaker: 'zh_female_meilinvyou_uranus_bigtts' },
  { label: '佩奇猪 2.0（视频配音）', speaker: 'zh_female_peiqi_uranus_bigtts' },
  { label: '云舟 2.0（男声，通用）', speaker: 'zh_male_m191_uranus_bigtts' },
  { label: '小天 2.0（男声，通用）', speaker: 'zh_male_taocheng_uranus_bigtts' },
  { label: '刘飞 2.0（男声，通用）', speaker: 'zh_male_liufei_uranus_bigtts' },
  { label: '少年梓辛 2.0（男声）', speaker: 'zh_male_shaonianzixin_uranus_bigtts' },
  { label: '儒雅逸辰 2.0（男声，视频配音）', speaker: 'zh_male_ruyayichen_uranus_bigtts' },
  { label: '大壹 2.0（男声，视频配音）', speaker: 'zh_male_dayi_uranus_bigtts' },
  { label: '猴哥 2.0（男声，视频配音）', speaker: 'zh_male_sunwukong_uranus_bigtts' },
  { label: 'Tim（英文男声）', speaker: 'en_male_tim_uranus_bigtts' },
  { label: 'Alex（英文男声）', speaker: 'en_male_alex_uranus_bigtts' },
  { label: 'Alberto（英文男声）', speaker: 'en_male_alberto_uranus_bigtts' },
  { label: 'Dacey（英文女声）', speaker: 'en_female_dacey_uranus_bigtts' },
  { label: 'Stokie（英文女声）', speaker: 'en_female_stokie_uranus_bigtts' }
];

/** 语音合成 2.0：只生成语音，文字内容决定时长，不支持参考音频；音色自带 30 多种语种识别，语言选项仅作标注。 */
const SPEECH_CAPABILITY: AudioCapability = {
  audioKinds: ['voice'],
  duration: {},
  languages: ['zh', 'en'],
  voices: VOLCENGINE_VOICES.map((voice) => voice.label),
  referenceAudio: false,
  deliveryControl: true,
  promptMaxLength: SPEECH_PROMPT_MAX_LENGTH
};

/** 豆包语音提供的音频模型。 */
export const VOLCENGINE_AUDIO_MODELS: readonly ModelDescriptor<'audio'>[] = [
  { code: 'doubao-seed-tts-2.0', displayName: '豆包语音合成 2.0', kind: 'audio', capability: SPEECH_CAPABILITY }
];
