// ------------------------------------------------------------------------
// 名称：beat-template-registry.ts
// 说明：节拍模板的内置定义：按作品形态分组的固定叙事结构（节拍名称、戏剧目的、时长占比）。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：新增模板只需在对应分组追加一条 defineTemplate；同一形态内第一个模板是默认模板，顺序即界面下拉顺序；id 与 label 在全部模板内必须唯一，占比之和必须为 1（单元测试会检查）。
// ------------------------------------------------------------------------

import { BeatTemplate, ProductionFormatType } from '../models/production-profile';

/** 一个节拍的简写：名称、戏剧目的、时长占比。 */
type BeatSpec = readonly [label: string, purpose: string, targetRatio: number];

/** 模板的基本信息：标识、形态、界面名称、适用场景、推荐时长范围与默认时长（秒）。 */
interface TemplateSpec {
  readonly id: string;
  readonly formatType: ProductionFormatType;
  readonly label: string;
  readonly summary: string;
  readonly seconds: readonly [min: number, max: number, defaultValue: number];
}

/** 单个短视频的默认模板标识。 */
export const DEFAULT_SHORT_VIDEO_TEMPLATE_ID = 'short_video_single_hook';
/** 多集短片的默认模板标识。 */
export const DEFAULT_SHORT_DRAMA_TEMPLATE_ID = 'short_drama_episode';
/** 单个短视频的节拍模板。 */
const SHORT_VIDEO_TEMPLATES: readonly BeatTemplate[] = [
  defineTemplate(
    { id: DEFAULT_SHORT_VIDEO_TEMPLATE_ID, formatType: 'short_video', label: '单集短视频（钩子型）', summary: '通用的短剧情结构，开场抛悬念、中段推进、结尾有记忆点', seconds: [10, 60, 30] },
    [
      ['钩子', '用最强画面或台词在开场抓住注意力，抛出核心悬念', 0.15],
      ['展开', '交代起因，推进冲突，信息量最大的一拍', 0.45],
      ['转折', '反转或情绪顶点，故事的最高点', 0.25],
      ['收尾', '收束结局，留下记忆点或情绪落点', 0.15]
    ]
  ),
  defineTemplate(
    { id: 'short_video_reversal', formatType: 'short_video', label: '单集短视频（反转型）', summary: '先让观众形成一个判断，再用结局推翻它', seconds: [10, 45, 20] },
    [
      ['铺垫', '建立人物与情境，埋下让观众形成错误判断的线索', 0.4],
      ['反转', '关键信息揭晓，推翻此前的判断，是全片最大的冲击点', 0.35],
      ['回味', '用一个画面或一句话点明反转的意义，让观众回头重新理解前面的内容', 0.25]
    ]
  ),
  defineTemplate(
    { id: 'short_video_comedy', formatType: 'short_video', label: '单集短视频（搞笑段子型）', summary: '设定、升级、爆梗、回扣的喜剧节奏', seconds: [10, 60, 25] },
    [
      ['设定', '用最短的时间交代人物和一个有笑点潜力的情境', 0.3],
      ['升级', '让误会、失误或荒诞逐步加码，笑点层层叠加', 0.35],
      ['爆梗', '最大的笑点集中爆发，反差越强越好', 0.25],
      ['回扣', '呼应开头的设定或加一个小彩蛋，让笑点收得漂亮', 0.1]
    ]
  ),
  defineTemplate(
    { id: 'short_video_suspense', formatType: 'short_video', label: '单集短视频（悬疑惊悚型）', summary: '异常出现、疑云加深、真相逼近、惊悚反转', seconds: [20, 120, 45] },
    [
      ['异常出现', '日常中出现一个说不通的细节，勾起不安和好奇', 0.2],
      ['疑云加深', '更多异常接连出现，线索互相矛盾，气氛持续收紧', 0.35],
      ['真相逼近', '主角靠近答案，危险同步升级，节奏明显加快', 0.3],
      ['惊悚反转', '揭晓令人意外的真相，或留下一个让人背后发凉的结尾', 0.15]
    ]
  ),
  defineTemplate(
    { id: 'short_video_warm_story', formatType: 'short_video', label: '单集短视频（温情治愈型）', summary: '日常切入、细节触动、情感共鸣、价值升华', seconds: [30, 120, 60] },
    [
      ['日常切入', '从平凡的生活场景进入，建立人物与关系', 0.2],
      ['细节触动', '一个小事件或小细节让人心头一软，是情感的起点', 0.3],
      ['情感共鸣', '情绪充分释放，让观众联想到自己的经历', 0.3],
      ['价值升华', '用一句话或一个画面提炼主题，留下温暖的余味', 0.2]
    ]
  ),
  defineTemplate(
    { id: 'short_video_micro_film', formatType: 'short_video', label: '微短片（三幕型）', summary: '有完整起承转合的微电影，适合 1 到 5 分钟的短片', seconds: [60, 300, 120] },
    [
      ['开场', '交代人物、环境和日常状态，确立影片的基调', 0.1],
      ['触发事件', '打破日常的事件发生，主角被迫做出选择', 0.15],
      ['对抗', '主角为目标行动，遇到层层阻碍，关系和处境不断变化', 0.4],
      ['高潮', '矛盾集中爆发，主角面对最难的抉择或最大的对手', 0.2],
      ['结局', '给出结果与代价，留下情绪余韵或开放式的思考', 0.15]
    ]
  ),
  defineTemplate(
    { id: 'short_video_emotion', formatType: 'short_video', label: '单集短视频（情绪氛围型）', summary: '少台词、重画面，适合抒情短片、意境片和歌曲配图', seconds: [15, 90, 45] },
    [
      ['氛围建立', '用环境、光线和声音建立情绪基调，不急于叙事', 0.2],
      ['情绪递进', '画面和动作逐步累积情绪，细节越来越具体', 0.35],
      ['高潮', '情绪达到顶点，用最有力的画面或一句台词释放', 0.3],
      ['余韵', '节奏放缓，留白收束，让情绪慢慢沉下来', 0.15]
    ]
  ),
  defineTemplate(
    { id: 'short_video_mv', formatType: 'short_video', label: '音乐 MV（歌曲结构型）', summary: '按前奏、主歌、副歌、间奏、尾声的歌曲结构安排画面', seconds: [60, 300, 180] },
    [
      ['前奏', '用一个有辨识度的画面建立 MV 的视觉风格和世界', 0.1],
      ['主歌', '铺陈人物与故事线索，画面叙事为主，情绪克制', 0.3],
      ['副歌', '情绪与视觉冲击最强的段落，是全片最有记忆点的画面', 0.35],
      ['间奏', '节奏变化或情节转折，为最后的情绪释放蓄力', 0.15],
      ['尾声', '收束主题，回到开场意象或留下一个定格', 0.1]
    ]
  ),
  defineTemplate(
    { id: 'short_video_ad', formatType: 'short_video', label: '产品广告（痛点方案型）', summary: '痛点、方案、证明、行动号召的转化型结构', seconds: [15, 60, 30] },
    [
      ['痛点', '用一个具体场景让目标观众立刻代入问题和烦恼', 0.2],
      ['方案', '产品登场，用一句话讲清它如何解决问题', 0.3],
      ['证明', '用演示、对比、数据或口碑证明效果，让人相信', 0.3],
      ['行动号召', '给出明确的下一步（购买、关注、领取）和一个记住品牌的理由', 0.2]
    ]
  ),
  defineTemplate(
    { id: 'short_video_seeding', formatType: 'short_video', label: '探店种草（体验推荐型）', summary: '探店、体验、好物分享：先惊艳、再体验、后推荐', seconds: [15, 90, 40] },
    [
      ['开场惊艳', '用最有吸引力的一个画面或结论抓住注意力', 0.15],
      ['环境氛围', '展示地点、外观或产品的整体气质，建立期待', 0.2],
      ['重点体验', '集中展示最值得推荐的几个细节，写出真实感受', 0.45],
      ['推荐结语', '给出明确评价、适合人群或注意事项，引导收藏或到店', 0.2]
    ]
  ),
  defineTemplate(
    { id: 'short_video_brand', formatType: 'short_video', label: '品牌宣传片（品牌故事型）', summary: '愿景、起源、价值、号召的品牌叙事', seconds: [30, 180, 60] },
    [
      ['开场愿景', '用一个有格局的画面或一句话点出品牌所关心的问题', 0.15],
      ['品牌起源', '讲述品牌的创始故事或初心，建立信任与情感连接', 0.25],
      ['价值呈现', '通过产品、人物或场景展示品牌给用户带来的具体改变', 0.35],
      ['号召收尾', '回扣愿景，用口号和品牌标识收束，引导认同与行动', 0.25]
    ]
  ),
  defineTemplate(
    { id: 'short_video_trailer', formatType: 'short_video', label: '预告片（悬念蒙太奇型）', summary: '为剧集、电影、游戏或活动制作的预告，不剧透结局', seconds: [20, 120, 45] },
    [
      ['世界观', '用几个画面快速交代时间、地点和世界的规则，建立期待', 0.25],
      ['人物与冲突', '主要人物亮相，点明他们面对的矛盾和代价', 0.3],
      ['高潮蒙太奇', '节奏越来越快，最精彩的场面快速剪接，情绪层层推高', 0.3],
      ['片名与悬念', '节奏突然收住，抛出最后一个悬念，随后给出片名和上线信息', 0.15]
    ]
  ),
  defineTemplate(
    { id: 'short_video_knowledge', formatType: 'short_video', label: '知识科普（问答讲解型）', summary: '提问、讲解、举例、总结，适合知识、财经和科技类内容', seconds: [30, 180, 60] },
    [
      ['提问', '抛出一个让人好奇或存在误解的问题，给出继续看的理由', 0.15],
      ['讲解', '用最简单的话讲清核心原理，一次只讲一个要点', 0.4],
      ['举例', '用贴近生活的例子或对比验证讲解，降低理解门槛', 0.3],
      ['总结', '用一句话提炼结论，并给出可以带走的建议或延伸问题', 0.15]
    ]
  ),
  defineTemplate(
    { id: 'short_video_tutorial', formatType: 'short_video', label: '教程演示（步骤教学型）', summary: '先展示成果，再讲准备和步骤，适合手工、美食和软件教程', seconds: [30, 180, 60] },
    [
      ['成果展示', '先给出最终效果，让观众知道学完能得到什么', 0.15],
      ['准备', '说明需要的材料、工具或前置条件', 0.2],
      ['步骤演示', '按顺序逐步演示，每一步只做一件事，关键处给出提示', 0.45],
      ['成果与提示', '展示最终成果，补充常见错误和小技巧', 0.2]
    ]
  ),
  defineTemplate(
    { id: 'short_video_before_after', formatType: 'short_video', label: '前后对比（变身型）', summary: '改造、装修、健身、化妆等有明显前后差异的内容', seconds: [15, 90, 30] },
    [
      ['现状', '展示改造前的问题和不如意，对比越明显越好', 0.25],
      ['转变过程', '用快节奏的关键步骤展示变化是如何发生的', 0.4],
      ['效果揭晓', '用最强的对比画面展示结果，这是全片的高潮', 0.25],
      ['感受总结', '说出改变带来的感受或经验，一句话收束', 0.1]
    ]
  ),
  defineTemplate(
    { id: 'short_video_vlog', formatType: 'short_video', label: '日常记录（Vlog 型）', summary: '按时间顺序记录一天或一次经历，有一个亮点时刻', seconds: [30, 180, 60] },
    [
      ['开场引入', '说明今天要做什么、去哪里，用一个有趣的画面开头', 0.15],
      ['过程记录', '按时间顺序记录经过，穿插有信息量的细节和真实反应', 0.45],
      ['亮点时刻', '整次经历中最有趣、最意外或最感动的一刻', 0.25],
      ['结尾总结', '用一句感受或下一次的预告收束', 0.15]
    ]
  )
];
/** 多集短片（单集）的节拍模板；节拍表以故事的第一集为对象。 */
const SHORT_DRAMA_TEMPLATES: readonly BeatTemplate[] = [
  defineTemplate(
    { id: DEFAULT_SHORT_DRAMA_TEMPLATE_ID, formatType: 'short_drama', label: '短剧单集（连载型）', summary: '通用的连载短剧结构，每集有冲突、有爆点、结尾留悬念', seconds: [60, 180, 90] },
    [
      ['钩尾承接', '承接上一集悬念，快速给出结果或继续升级（首集作为开场钩子）', 0.1],
      ['冲突推进', '本集核心事件推进，矛盾具体化', 0.4],
      ['情绪爆发', '本集最强戏剧点（反转、打脸、告白等）', 0.3],
      ['悬念钩尾', '为下一集设置新悬念', 0.2]
    ]
  ),
  defineTemplate(
    { id: 'short_drama_pilot', formatType: 'short_drama', label: '短剧单集（黄金开篇型）', summary: '用于故事的开篇，强钩子、人物困境、激励事件和首集悬念', seconds: [60, 180, 90] },
    [
      ['强钩子', '开场几秒内抛出最有冲击力的画面或台词，让人不划走', 0.1],
      ['人物与困境', '主角登场，交代身份、关系和当下的困境，让观众立刻站队', 0.25],
      ['激励事件', '打破现状的关键事件发生，主角被迫行动，故事正式开始', 0.3],
      ['目标与规则', '点明主角的目标、对手或这个世界的特殊规则，让观众明白后面看什么', 0.15],
      ['首集悬念', '在最紧张处收住，抛出让人必须点开下一集的悬念', 0.2]
    ]
  ),
  defineTemplate(
    { id: 'short_drama_revenge', formatType: 'short_drama', label: '短剧单集（逆袭爽文型）', summary: '受压、反击、揭晓、打脸，适合逆袭、复仇、身份反转类', seconds: [60, 180, 90] },
    [
      ['受压', '主角被轻视、被欺压，情绪压到最低，让观众憋着一口气', 0.15],
      ['暗中反击', '主角不动声色地布局或亮出一点实力，对手仍未察觉', 0.25],
      ['身份或实力揭晓', '关键底牌当众亮出，是本集最解气的爆点', 0.3],
      ['众人反应', '对手和旁观者的震惊、后悔和态度转变，放大爽感', 0.15],
      ['新钩子', '出现更强的对手或更大的秘密，为下一集铺路', 0.15]
    ]
  ),
  defineTemplate(
    { id: 'short_drama_romance', formatType: 'short_drama', label: '短剧单集（甜宠恋爱型）', summary: '心动、拉扯、阻碍、甜蜜的反转，适合甜宠、虐恋和先婚后爱', seconds: [60, 180, 90] },
    [
      ['偶遇心动', '两人以有张力的方式相遇或重逢，产生第一次心动', 0.2],
      ['暧昧推进', '用具体的互动和小细节推进关系，让观众磕到', 0.35],
      ['误会或阻碍', '外力、身份差异或误会让关系出现裂痕，情绪反转', 0.25],
      ['甜蜜反转钩', '一个出人意料的举动或真相让关系再次翻转，并留下期待', 0.2]
    ]
  ),
  defineTemplate(
    { id: 'short_drama_suspense', formatType: 'short_drama', label: '短剧单集（悬疑推理型）', summary: '疑点、线索、误导、真相悬念，适合悬疑、刑侦和探案', seconds: [60, 180, 90] },
    [
      ['疑点抛出', '出现一个事件或反常现象，立刻建立需要解开的谜题', 0.2],
      ['线索搜集', '主角调查，得到几条看似合理的线索，信息量集中', 0.3],
      ['误导与反转', '线索被推翻或出现新的嫌疑，观众的判断被打乱', 0.3],
      ['真相悬念', '揭示一小半真相，同时抛出更大的谜团或危险', 0.2]
    ]
  ),
  defineTemplate(
    { id: 'short_drama_double_reversal', formatType: 'short_drama', label: '短剧单集（连环反转型）', summary: '一集之内连续两次反转，节奏快，适合强情节短剧', seconds: [60, 180, 90] },
    [
      ['表象', '呈现一个看似清楚的局面，让观众形成第一印象', 0.2],
      ['第一次反转', '推翻表象，真相与观众的预期相反', 0.3],
      ['第二次反转', '在第一次反转的基础上再翻一层，信息再次颠覆', 0.3],
      ['悬念钩尾', '反转之后留下新的局面和问题，拉动追更', 0.2]
    ]
  ),
  defineTemplate(
    { id: 'short_drama_family', formatType: 'short_drama', label: '短剧单集（家庭情感型）', summary: '矛盾引爆、各方表态、情感冲击，适合家庭伦理和现实题材', seconds: [60, 180, 90] },
    [
      ['矛盾引爆', '一件具体的事把家庭中潜藏的矛盾推到台面上', 0.2],
      ['各方表态', '不同角色各自站队，立场和诉求相互冲突', 0.3],
      ['情感冲击', '真相或积压的情绪爆发，是本集最有力的情感戏', 0.3],
      ['余波钩子', '冲突之后留下新的裂痕或和解的契机，指向下一集', 0.2]
    ]
  ),
  defineTemplate(
    { id: 'short_drama_workplace', formatType: 'short_drama', label: '短剧单集（职场商战型）', summary: '危机、博弈、翻盘、新局，适合职场、创业和商战', seconds: [60, 180, 90] },
    [
      ['危机', '主角面临具体的压力：项目失败、被针对或限期考核', 0.2],
      ['博弈', '各方交锋，利益与立场对抗，主角寻找破局点', 0.35],
      ['翻盘', '主角用关键筹码或智慧扭转局面，是本集的爆点', 0.3],
      ['新局', '胜利带来新的对手、代价或机会，为下一集埋线', 0.15]
    ]
  ),
  defineTemplate(
    { id: 'short_drama_fantasy', formatType: 'short_drama', label: '短剧单集（古装玄幻穿越型）', summary: '世界冲击、机遇觉醒、对决、更大危机，适合古装、仙侠和穿越', seconds: [60, 180, 90] },
    [
      ['世界冲击', '用具体的画面展示这个世界与主角认知的差异，建立新奇感', 0.15],
      ['机遇觉醒', '主角获得能力、身份或关键机缘，开始改变处境', 0.3],
      ['对决', '与对手正面交锋，用招式、计谋或身份压制展示强弱变化', 0.35],
      ['更大危机', '更强的势力或更深的秘密出现，预示下一阶段', 0.2]
    ]
  ),
  defineTemplate(
    { id: 'short_drama_comedy', formatType: 'short_drama', label: '短剧单集（轻喜剧型）', summary: '日常设定、误会升级、爆笑高潮、收束彩蛋，适合轻松搞笑的连载', seconds: [60, 180, 90] },
    [
      ['日常设定', '交代人物关系和本集要解决的小麻烦', 0.2],
      ['误会升级', '一个小误会或谎言不断扩大，人物越陷越深', 0.35],
      ['爆笑高潮', '所有误会集中暴露，场面最失控、最好笑', 0.3],
      ['收束彩蛋', '用一个温暖的收尾或意外的小彩蛋收住，并引出下一集', 0.15]
    ]
  ),
  defineTemplate(
    { id: 'short_drama_unit', formatType: 'short_drama', label: '短剧单集（单元故事型）', summary: '每集是一个相对完整的小故事，同时推进主线', seconds: [60, 240, 120] },
    [
      ['开场', '引入本集的人物、情境和要解决的问题', 0.15],
      ['发展', '事件展开，矛盾层层加深，本集主线与长线伏笔同时推进', 0.4],
      ['高潮', '本集的核心矛盾集中解决，情绪和信息量最大', 0.3],
      ['结局与伏笔', '给出本集的结果，并留下一条指向后续剧情的线索', 0.15]
    ]
  )
];
/** 全部节拍模板：先按形态分组，组内第一个是该形态的默认模板。 */
export const BEAT_TEMPLATES: readonly BeatTemplate[] = [...SHORT_VIDEO_TEMPLATES, ...SHORT_DRAMA_TEMPLATES];

/** 由简写生成完整的节拍模板，节拍序号按顺序从 1 开始。 */
function defineTemplate(spec: TemplateSpec, beats: readonly BeatSpec[]): BeatTemplate {
  const [minSeconds, maxSeconds, defaultSeconds] = spec.seconds;
  return {
    id: spec.id,
    formatType: spec.formatType,
    label: spec.label,
    summary: spec.summary,
    minSeconds,
    maxSeconds,
    defaultSeconds,
    items: beats.map(([label, purpose, targetRatio], index) => ({ seq: index + 1, label, purpose, targetRatio }))
  };
}
