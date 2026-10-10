// ------------------------------------------------------------------------
// 名称：minimax-audio-catalog.ts
// 说明：MiniMax 语音模型目录：speech-2.8、2.6、02 系列（HD 与 Turbo）的能力描述、可选系统音色（显示名称与音色标识），以及语音合成接口的路径与输出格式。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-09
// 备注：数值与音色来自 MiniMax 开放平台文档“同步语音合成”“系统音色列表”；只收录中文（普通话、粤语）与英文的系统音色，去掉与正式版重复的 beta 音色；语音合成只生成语音（音色参考），不生成配乐与音效；平台上新增或调整模型、音色时只改这里。
// ------------------------------------------------------------------------

import { AudioCapability } from '../../../domain/models/model-capability';
import { ModelDescriptor } from '../../../domain/models/model-provider';

/** 语音合成接口的路径，相对接口地址。 */
export const MINIMAX_SPEECH_PATH = '/v1/t2a_v2';

/** 输出音频的编码格式、采样率、比特率、声道数与对应的 MIME 类型。 */
export const MINIMAX_SPEECH_FORMAT = 'mp3';
export const MINIMAX_SPEECH_SAMPLE_RATE = 32_000;
export const MINIMAX_SPEECH_BITRATE = 128_000;
export const MINIMAX_SPEECH_CHANNEL = 1;
export const MINIMAX_SPEECH_MIME_TYPE = 'audio/mpeg';

/** 语言代码与平台 language_boost 取值的对应。 */
export const MINIMAX_LANGUAGE_BOOSTS: Readonly<Record<string, string>> = { zh: 'Chinese', en: 'English' };

/** 提示词（要朗读的文字）的长度上限：平台上限为 10000 字符，这里取一半，够一句台词或一段旁白。 */
const SPEECH_PROMPT_MAX_LENGTH = 5000;

/** 一个系统音色：界面显示名称与平台的音色标识（voice_id）。 */
export interface MinimaxVoice {
  readonly label: string;
  readonly voiceId: string;
}

/** 构造一个音色。 */
function voice(label: string, voiceId: string): MinimaxVoice {
  return { label, voiceId };
}

/** 系统音色，第一个为未指定音色时的默认音色。 */
export const MINIMAX_VOICES: readonly MinimaxVoice[] = [
  voice('甜美女性', 'female-tianmei'),
  voice('少女', 'female-shaonv'),
  voice('御姐', 'female-yujie'),
  voice('成熟女性', 'female-chengshu'),
  voice('青涩青年', 'male-qn-qingse'),
  voice('精英青年', 'male-qn-jingying'),
  voice('霸道青年', 'male-qn-badao'),
  voice('青年大学生', 'male-qn-daxuesheng'),
  voice('聪明男童', 'clever_boy'),
  voice('可爱男童', 'cute_boy'),
  voice('萌萌女童', 'lovely_girl'),
  voice('卡通猪小琪', 'cartoon_pig'),
  voice('病娇弟弟', 'bingjiao_didi'),
  voice('俊朗男友', 'junlang_nanyou'),
  voice('纯真学弟', 'chunzhen_xuedi'),
  voice('冷淡学长', 'lengdan_xiongzhang'),
  voice('霸道少爷', 'badao_shaoye'),
  voice('甜心小玲', 'tianxin_xiaoling'),
  voice('俏皮萌妹', 'qiaopi_mengmei'),
  voice('妩媚御姐', 'wumei_yujie'),
  voice('嗲嗲学妹', 'diadia_xuemei'),
  voice('淡雅学姐', 'danya_xuejie'),
  voice('沉稳高管', 'Chinese (Mandarin)_Reliable_Executive'),
  voice('新闻女声', 'Chinese (Mandarin)_News_Anchor'),
  voice('傲娇御姐', 'Chinese (Mandarin)_Mature_Woman'),
  voice('不羁青年', 'Chinese (Mandarin)_Unrestrained_Young_Man'),
  voice('嚣张小姐', 'Arrogant_Miss'),
  voice('机械战甲', 'Robot_Armor'),
  voice('热心大婶', 'Chinese (Mandarin)_Kind-hearted_Antie'),
  voice('港普空姐', 'Chinese (Mandarin)_HK_Flight_Attendant'),
  voice('搞笑大爷', 'Chinese (Mandarin)_Humorous_Elder'),
  voice('温润男声', 'Chinese (Mandarin)_Gentleman'),
  voice('温暖闺蜜', 'Chinese (Mandarin)_Warm_Bestie'),
  voice('播报男声', 'Chinese (Mandarin)_Male_Announcer'),
  voice('甜美女声', 'Chinese (Mandarin)_Sweet_Lady'),
  voice('南方小哥', 'Chinese (Mandarin)_Southern_Young_Man'),
  voice('阅历姐姐', 'Chinese (Mandarin)_Wise_Women'),
  voice('温润青年', 'Chinese (Mandarin)_Gentle_Youth'),
  voice('温暖少女', 'Chinese (Mandarin)_Warm_Girl'),
  voice('花甲奶奶', 'Chinese (Mandarin)_Kind-hearted_Elder'),
  voice('憨憨萌兽', 'Chinese (Mandarin)_Cute_Spirit'),
  voice('电台男主播', 'Chinese (Mandarin)_Radio_Host'),
  voice('抒情男声', 'Chinese (Mandarin)_Lyrical_Voice'),
  voice('率真弟弟', 'Chinese (Mandarin)_Straightforward_Boy'),
  voice('真诚青年', 'Chinese (Mandarin)_Sincere_Adult'),
  voice('温柔学姐', 'Chinese (Mandarin)_Gentle_Senior'),
  voice('嘴硬竹马', 'Chinese (Mandarin)_Stubborn_Friend'),
  voice('清脆少女', 'Chinese (Mandarin)_Crisp_Girl'),
  voice('清澈邻家弟弟', 'Chinese (Mandarin)_Pure-hearted_Boy'),
  voice('柔和少女', 'Chinese (Mandarin)_Soft_Girl'),
  voice('粤语·专业女主持', 'Cantonese_ProfessionalHost（F)'),
  voice('粤语·专业男主持', 'Cantonese_ProfessionalHost（M)'),
  voice('粤语·温柔女声', 'Cantonese_GentleLady'),
  voice('粤语·活泼男声', 'Cantonese_PlayfulMan'),
  voice('粤语·可爱女孩', 'Cantonese_CuteGirl'),
  voice('粤语·善良女声', 'Cantonese_KindWoman'),
  voice('英文·Trustworthy Man（男声）', 'English_Trustworthy_Man'),
  voice('英文·Graceful Lady（女声）', 'English_Graceful_Lady'),
  voice('英文·Aussie Bloke（男声）', 'English_Aussie_Bloke'),
  voice('英文·Whispering Girl（女声）', 'English_Whispering_girl'),
  voice('英文·Diligent Man（男声）', 'English_Diligent_Man'),
  voice('英文·Gentle-voiced Man（男声）', 'English_Gentle-voiced_man'),
  voice('英文·Charming Lady（女声）', 'Charming_Lady'),
  voice('英文·Sweet Girl（女声）', 'Sweet_Girl'),
  voice('英文·Attractive Girl（女声）', 'Attractive_Girl'),
  voice('英文·Serene Woman（女声）', 'Serene_Woman'),
  voice('英文·Charming Santa（男声）', 'Charming_Santa'),
  voice('英文·Cute Elf', 'Cute_Elf'),
  voice('英文·Arnold（男声）', 'Arnold'),
  voice('英文·Rudolph', 'Rudolph'),
  voice('英文·Grinch', 'Grinch')
];

/** 请求没有指定音色时使用的默认音色：音色目录里的第一个。 */
export const MINIMAX_DEFAULT_VOICE: MinimaxVoice = MINIMAX_VOICES[0];

/** 语音合成：只生成语音，文字内容决定时长，不支持参考音频；语速与音量可按说话方式调整，语言选项用于增强识别。 */
const SPEECH_CAPABILITY: AudioCapability = {
  audioKinds: ['voice'],
  duration: {},
  languages: ['zh', 'en'],
  voices: MINIMAX_VOICES.map((item) => item.label),
  referenceAudio: false,
  deliveryControl: true,
  promptMaxLength: SPEECH_PROMPT_MAX_LENGTH
};

/** MiniMax 提供的语音模型。 */
export const MINIMAX_AUDIO_MODELS: readonly ModelDescriptor<'audio'>[] = [
  { code: 'speech-2.8-hd', displayName: 'MiniMax 语音 2.8 HD', kind: 'audio', capability: SPEECH_CAPABILITY },
  { code: 'speech-2.8-turbo', displayName: 'MiniMax 语音 2.8 Turbo', kind: 'audio', capability: SPEECH_CAPABILITY },
  { code: 'speech-2.6-hd', displayName: 'MiniMax 语音 2.6 HD', kind: 'audio', capability: SPEECH_CAPABILITY },
  { code: 'speech-2.6-turbo', displayName: 'MiniMax 语音 2.6 Turbo', kind: 'audio', capability: SPEECH_CAPABILITY },
  { code: 'speech-02-hd', displayName: 'MiniMax 语音 02 HD', kind: 'audio', capability: SPEECH_CAPABILITY },
  { code: 'speech-02-turbo', displayName: 'MiniMax 语音 02 Turbo', kind: 'audio', capability: SPEECH_CAPABILITY }
];
