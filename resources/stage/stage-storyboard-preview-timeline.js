// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-timeline.js
// 说明：分镜动画的时间线编译与采样（纯逻辑）：把分镜脚本阶段视图编译为带镜头时间、站位坐标、声音时间、景别、运镜与转场的时间线，按任意时刻采样出一帧的绘制数据，并给出调度俯视图和镜头对照所需的数据。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：不依赖 DOM，通过 window.aiStoryboardTimeline 暴露，规则见 docs/storyboard-animation-design.md 第 6 节；渲染在 stage-storyboard-preview-art.js 与 stage-storyboard-preview-renderer.js，对照视图在 stage-storyboard-preview-modes.js，检查在 stage-storyboard-preview-checks.js。
// ------------------------------------------------------------------------

'use strict';

(function () {
  /** 横向位置的顺序与占画面宽度的比例（以观众看到的画面为准）。 */
  const X_ORDER = ['off_left', 'left', 'center', 'right', 'off_right'];
  const X_FRACTION = { off_left: -0.12, left: 0.22, center: 0.5, right: 0.78, off_right: 1.12 };
  /** 纵深位置的顺序，角色脚下位置占画面高度的比例与缩放。 */
  const DEPTH_ORDER = ['back', 'middle', 'front'];
  const DEPTH_STAGE = { back: { y: 0.56, scale: 0.7 }, middle: { y: 0.72, scale: 1 }, front: { y: 0.88, scale: 1.35 } };
  const DEFAULT_X = 'center';
  const DEFAULT_DEPTH = 'middle';

  /** 界面文字：位置与朝向的名称，与 domain/models/storyboard.ts 的标签一致。 */
  const LABELS = {
    x: { off_left: '画面左外', left: '画面左侧', center: '画面中央', right: '画面右侧', off_right: '画面右外' },
    depth: { back: '背景', middle: '中景', front: '前景' },
    facing: { camera: '面向镜头', away: '背对镜头', left: '面朝画面左侧', right: '面朝画面右侧' }
  };

  /** 画幅解析：宽高比的合理范围与缺省值。 */
  const DEFAULT_ASPECT = { width: 16, height: 9 };
  const MIN_RATIO = 9 / 21;
  const MAX_RATIO = 21 / 9;
  const ASPECT_PATTERN = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;

  /** 颜色：角色、道具、特效与场景（墙面、地面）。角色第一个为红色。 */
  const CHARACTER_COLORS = ['#E5484D', '#F5A524', '#30A46C', '#3E63DD', '#8E4EC6', '#E93D82', '#12A594', '#D6B100'];
  const PROP_COLORS = ['#8B6B4A', '#7A8793', '#3F8F83', '#8A7A9B', '#8C8C4A', '#A86F5A'];
  const EFFECT_COLOR = '#F5D90A';
  const SCENE_COLORS = [
    { wall: '#2B3A55', floor: '#3A4A66' },
    { wall: '#3B2F3F', floor: '#4D3F52' },
    { wall: '#2F4A3E', floor: '#3F5E50' },
    { wall: '#4A3B2B', floor: '#5E4C3A' },
    { wall: '#2B4A4D', floor: '#3A5F63' },
    { wall: '#4A2F35', floor: '#5F3F47' }
  ];

  /** 移动曲线：开头与结尾各停留镜头时长的这一比例，中间平滑移动。 */
  const MOVE_HOLD_RATIO = 0.1;
  /** 移动中角色上下起伏的幅度（占画面高度）与频率（Hz）。 */
  const BOB_AMPLITUDE = 0.0068;
  const BOB_FREQUENCY = 3;

  /** 声音时间：人声按每秒汉字数估算时长，最短时长；音效的默认时长。 */
  const SPEECH_CHARS_PER_SECOND = 4;
  const SPEECH_MIN_SECONDS = 1;
  const SFX_DEFAULT_SECONDS = 1.5;
  /** 标签（音效、音乐）淡入淡出的时长。 */
  const TAG_FADE_SECONDS = 0.2;
  /** 同时显示的字幕条数上限。 */
  const MAX_CAPTIONS = 2;
  const EPSILON = 1e-6;

  /** 转场处理的最长时长与占较短镜头时长的比例。 */
  const TRANSITION_MAX_SECONDS = 0.5;
  const TRANSITION_RATIO = 0.25;

  /** 运镜关键词，按先后顺序匹配。 */
  const CAMERA_RULES = [
    { type: 'static', words: ['固定', '静止'] },
    { type: 'zoomIn', words: ['推近', '推进', '拉近', '推镜'] },
    { type: 'zoomOut', words: ['拉远', '拉开', '后退', '拉镜'] },
    { type: 'panLeft', words: ['左摇', '向左摇'] },
    { type: 'panRight', words: ['右摇', '向右摇'] },
    { type: 'tiltUp', words: ['上摇', '向上摇'] },
    { type: 'tiltDown', words: ['下摇', '向下摇'] },
    { type: 'orbit', words: ['环绕'] },
    { type: 'follow', words: ['跟拍', '跟随'] },
    { type: 'handheld', words: ['手持'] }
  ];
  const CAMERA_SLOW_WORDS = ['缓慢', '轻微', '微微'];
  const CAMERA_FAST_WORDS = ['快速', '急'];
  const CAMERA_SLOW_AMOUNT = 0.6;
  const CAMERA_FAST_AMOUNT = 1.4;

  /** 景别关键词（按先后顺序匹配，近的在前）与取景放大倍数；全景及更远不放大。 */
  const SHOT_SIZE_RULES = [
    { words: ['大特写', '极特写'], zoom: 3 },
    { words: ['特写'], zoom: 2.2 },
    { words: ['中近'], zoom: 1.5 },
    { words: ['近景'], zoom: 1.8 },
    { words: ['中全', '中远'], zoom: 1.15 },
    { words: ['中景'], zoom: 1.3 },
    { words: ['全景', '远景', '俯瞰', '鸟瞰'], zoom: 1 }
  ];
  /** 放大倍数不小于这个值时只取景在一个角色上，否则取景在所有角色的中心。 */
  const SINGLE_SUBJECT_ZOOM = 1.6;
  /** 取景中心相对角色脚下的高度（占画面高度，纵深缩放为 1 时）：特写对着头部，近景对着上半身，其余对着胸口。 */
  const FOCUS_HEAD_RISE = 0.22;
  const FOCUS_UPPER_RISE = 0.17;
  const FOCUS_CHEST_RISE = 0.11;
  const FOCUS_HEAD_ZOOM = 2.2;
  const FOCUS_UPPER_ZOOM = 1.6;

  /** 场景归类关键词：时间与地点（按先后顺序匹配，匹配场景名与场次文字）。 */
  const SCENE_TIME_RULES = [
    { time: 'dusk', words: ['黄昏', '傍晚', '日落', '夕阳', '落日'] },
    { time: 'dawn', words: ['清晨', '黎明', '日出', '早晨', '拂晓', '凌晨', '晨'] },
    { time: 'night', words: ['夜', '晚'] }
  ];
  const SCENE_SETTING_RULES = [
    { setting: 'kitchen', words: ['厨房', '后厨', '灶间', '餐厅', '食堂'] },
    { setting: 'bathroom', words: ['卫生间', '浴室', '洗手间', '厕所', '盥洗', '澡堂', '洗澡'] },
    { setting: 'bedroom', words: ['卧室', '寝室', '宿舍', '闺房', '卧房'] },
    { setting: 'hospital', words: ['医院', '病房', '诊所', '手术室', '急诊', '药房', '医务室'] },
    { setting: 'classroom', words: ['教室', '课堂', '学校', '课室', '讲堂', '教学楼'] },
    { setting: 'shop', words: ['商店', '超市', '商场', '店铺', '便利店', '杂货', '书店', '药店', '饭店', '餐馆', '咖啡厅', '咖啡馆', '酒吧', '酒馆'] },
    { setting: 'space', words: ['太空', '宇宙', '星球', '飞船', '星际', '月球', '空间站'] },
    { setting: 'underwater', words: ['海底', '水下', '深海', '水底', '龙宫'] },
    { setting: 'sky', words: ['天空', '云端', '云海', '天宫', '天界', '仙境', '空中'] },
    { setting: 'cave', words: ['洞', '矿', '地牢', '地下', '密室', '隧道'] },
    { setting: 'desert', words: ['沙漠', '戈壁', '荒漠'] },
    { setting: 'snow', words: ['雪山', '雪地', '雪原', '冰原', '冰川', '极地', '雪'] },
    { setting: 'mountain', words: ['山顶', '山崖', '悬崖', '山峰', '山脉', '峭壁', '山坡', '高山', '山上'] },
    { setting: 'ruins', words: ['废墟', '遗迹', '遗址', '古墓', '墓地', '坟'] },
    { setting: 'sea', words: ['海', '湖', '河', '码头', '船', '港', '岸', '溪', '瀑', '灯塔', '沙滩'] },
    { setting: 'forest', words: ['森林', '树林', '山林', '山谷', '山路', '竹', '林', '丛'] },
    { setting: 'village', words: ['村', '乡下', '农家', '集市', '田园'] },
    { setting: 'field', words: ['草原', '田', '野', '荒', '操场', '牧场'] },
    { setting: 'street', words: ['室外', '外景'] },
    { setting: 'indoor', words: ['室', '屋', '房', '厅', '店', '馆', '宫', '殿', '楼', '堂', '办公', '卧', '厨', '厂', '牢', '家', '栈', '内'] },
    { setting: 'street', words: ['街', '路', '城', '巷', '广场', '市', '桥', '站', '院', '园', '外'] }
  ];
  /** 道具与特效归类关键词（按先后顺序匹配名称），决定绘制的图形。 */
  const PROP_RULES = [
    // 家电、厨具与卫浴：具体的名称在前，避免被后面笼统的“锅”“柜”“炉”抢先
    { glyph: 'fridge', words: ['冰箱', '冰柜', '冷柜'] },
    { glyph: 'aircon', words: ['空调', '暖气'] },
    { glyph: 'washer', words: ['洗衣机', '洗碗机', '烘干机'] },
    { glyph: 'microwave', words: ['微波炉', '烤箱', '烤炉', '蒸箱'] },
    { glyph: 'fan', words: ['风扇', '电扇', '吊扇', '排气扇'] },
    { glyph: 'hood', words: ['油烟机', '抽油烟', '排油烟', '抽烟机'] },
    { glyph: 'stove', words: ['灶台', '燃气灶', '煤气灶', '电磁炉', '灶'] },
    { glyph: 'sink', words: ['水槽', '洗手池', '洗手台', '洗碗池', '洗脸盆', '脸盆', '洗手盆', '水池'] },
    { glyph: 'faucet', words: ['水龙头', '龙头', '水管'] },
    { glyph: 'toilet', words: ['马桶', '坐便', '便器'] },
    { glyph: 'bathtub', words: ['浴缸', '浴盆', '澡盆'] },
    { glyph: 'shower', words: ['淋浴', '花洒'] },
    { glyph: 'towel', words: ['毛巾', '浴巾'] },
    { glyph: 'bomb', words: ['炸弹', '炸药', '火药', '手雷', '地雷', '雷管', '手榴弹'] },
    { glyph: 'rocket', words: ['火箭', '导弹', '飞弹', '卫星'] },
    { glyph: 'cannon', words: ['大炮', '火炮', '炮'] },
    { glyph: 'pan', words: ['平底锅', '炒锅', '煎锅'] },
    { glyph: 'knife', words: ['菜刀', '水果刀', '厨刀', '餐刀'] },
    { glyph: 'board', words: ['砧板', '案板', '菜板'] },
    { glyph: 'cutlery', words: ['刀叉', '餐具', '筷', '勺', '汤匙', '茶匙', '叉子'] },
    { glyph: 'bowl', words: ['碗', '钵'] },
    { glyph: 'plate', words: ['盘', '碟'] },
    { glyph: 'kettle', words: ['水壶', '茶壶', '热水壶', '咖啡壶', '壶'] },
    { glyph: 'cabinet', words: ['衣柜', '书柜', '橱柜', '鞋柜', '酒柜', '药柜', '柜子', '壁橱', '抽屉'] },
    { glyph: 'sofa', words: ['沙发', '躺椅'] },
    { glyph: 'bench', words: ['长椅', '长凳', '条凳'] },
    { glyph: 'shelf', words: ['书架', '货架', '架子', '置物架', '衣架', '展架'] },
    { glyph: 'medicine', words: ['药', '针管', '注射器'] },
    { glyph: 'bottle', words: ['酒瓶', '奶瓶', '玻璃瓶', '饮料瓶'] },
    { glyph: 'cake', words: ['蛋糕'] },
    { glyph: 'food', words: ['面包', '苹果', '水果', '食物', '米饭', '饭菜', '蔬菜', '肉', '饼', '糖果', '包子', '饺子', '面条', '香蕉', '橙子', '西瓜', '汉堡', '披萨', '零食', '点心', '馒头'] },
    { glyph: 'bone', words: ['骨头', '骷髅', '骸骨'] },
    { glyph: 'suitcase', words: ['行李箱', '皮箱', '手提箱', '旅行箱', '拉杆箱', '公文包'] },
    { glyph: 'clothes', words: ['衣服', '外套', '衬衫', '裙', '裤', '鞋', '袜', '披风', '斗篷', '围巾', '手套'] },
    { glyph: 'glasses', words: ['眼镜', '墨镜'] },
    { glyph: 'telescope', words: ['望远镜', '显微镜', '放大镜'] },
    { glyph: 'trophy', words: ['奖杯', '奖牌', '奖章', '勋章'] },
    { glyph: 'speaker', words: ['音响', '音箱', '喇叭', '收音机', '麦克风', '话筒'] },
    { glyph: 'camera', words: ['相机', '摄像', '摄影机', '照相机'] },
    { glyph: 'socket', words: ['插座', '开关', '插头'] },
    { glyph: 'flashlight', words: ['手电', '电筒', '探照灯'] },
    { glyph: 'lantern', words: ['灯笼', '宫灯', '孔明灯'] },
    { glyph: 'chandelier', words: ['吊灯', '水晶灯', '吸顶灯', '顶灯', '花灯'] },
    { glyph: 'campfire', words: ['篝火', '营火', '火堆'] },
    { glyph: 'candle', words: ['蜡烛', '烛台', '火把', '火炬', '烛'] },
    { glyph: 'fireplace', words: ['壁炉', '火塘'] },
    { glyph: 'curtain', words: ['窗帘', '门帘', '帘', '幕布'] },
    { glyph: 'carpet', words: ['地毯', '毛毯', '地垫', '毯'] },
    { glyph: 'blackboard', words: ['黑板', '白板', '公告栏', '展板'] },
    { glyph: 'bridge', words: ['桥'] },
    { glyph: 'well', words: ['水井', '井'] },
    { glyph: 'pillar', words: ['柱'] },
    { glyph: 'bow', words: ['弓箭', '长弓', '弓'] },
    { glyph: 'arrow', words: ['箭', '飞镖', '标枪'] },
    { glyph: 'shield', words: ['盾'] },
    { glyph: 'tool', words: ['锤', '扳手', '锯', '锄', '铲', '镐', '钳', '螺丝刀', '工具'] },
    { glyph: 'rope', words: ['绳', '锁链', '铁链', '链条'] },
    { glyph: 'bed', words: ['床', '榻'] },
    { glyph: 'table', words: ['桌', '柜台', '吧台', '讲台', '工作台', '案'] },
    { glyph: 'chair', words: ['椅', '凳', '沙发', '座'] },
    { glyph: 'door', words: ['门'] },
    { glyph: 'window', words: ['窗'] },
    { glyph: 'tower', words: ['灯塔', '塔'] },
    { glyph: 'light', words: ['灯', '烛', '火把'] },
    { glyph: 'weapon', words: ['剑', '刀', '枪', '斧', '弓', '匕首', '棍'] },
    { glyph: 'book', words: ['书', '信', '纸', '卷', '报', '日记', '地图'] },
    { glyph: 'bag', words: ['背包', '书包', '行李', '包裹', '口袋'] },
    { glyph: 'box', words: ['箱', '盒', '柜', '包', '袋', '匣', '篮'] },
    { glyph: 'vehicle', words: ['车', '船', '舟', '飞机'] },
    { glyph: 'cup', words: ['杯', '碗', '壶', '瓶', '酒', '茶'] },
    { glyph: 'gem', words: ['宝石', '钻石', '水晶', '金币', '银币', '硬币', '钱', '珠', '宝'] },
    { glyph: 'stone', words: ['石', '岩', '雕像', '塑像'] },
    { glyph: 'flower', words: ['花'] },
    { glyph: 'grass', words: ['草', '藤', '竹'] },
    { glyph: 'mushroom', words: ['蘑菇', '菇', '菌'] },
    { glyph: 'cactus', words: ['仙人掌', '仙人球'] },
    { glyph: 'plant', words: ['盆栽', '植物'] },
    { glyph: 'screen', words: ['电视', '电脑', '屏幕', '显示器', '屏'] },
    { glyph: 'phone', words: ['手机', '电话'] },
    { glyph: 'clock', words: ['钟', '表', '沙漏'] },
    { glyph: 'mirror', words: ['镜'] },
    { glyph: 'key', words: ['钥匙', '钥'] },
    { glyph: 'umbrella', words: ['伞'] },
    { glyph: 'ball', words: ['球'] },
    { glyph: 'flag', words: ['旗'] },
    { glyph: 'tent', words: ['帐篷', '帐'] },
    { glyph: 'barrel', words: ['桶', '罐', '缸', '坛'] },
    { glyph: 'sign', words: ['牌', '碑'] },
    { glyph: 'instrument', words: ['琴', '吉他', '鼓', '笛', '号'] },
    { glyph: 'pot', words: ['锅', '炉', '鼎', '灶'] },
    { glyph: 'crown', words: ['皇冠', '王冠', '冠', '帽'] },
    { glyph: 'fence', words: ['栅栏', '围栏', '篱笆', '栏杆', '墙'] },
    { glyph: 'stairs', words: ['楼梯', '台阶', '梯'] },
    { glyph: 'castle', words: ['城堡', '宫殿', '城'] },
    { glyph: 'house', words: ['房子', '小屋', '木屋', '房屋', '屋'] },
    { glyph: 'tree', words: ['树', '木'] }
  ];
  /**
   * 会说话的物品或植物（花、草、树、石头、箱子等当角色）的关键词，决定画哪种带脸的图形；
   * 名称里只认多字词（单字词如“花”“石”常出现在人名里），单字词只在名称就是它本身，或设定里写“一朵花”“是一块石头”时才算。
   */
  const THING_RULES = [
    { glyph: 'fridge', words: ['冰箱'] },
    { glyph: 'aircon', words: ['空调'] },
    { glyph: 'washer', words: ['洗衣机', '洗碗机'] },
    { glyph: 'microwave', words: ['微波炉', '烤箱'] },
    { glyph: 'fan', words: ['风扇', '电扇'] },
    { glyph: 'hood', words: ['油烟机'] },
    { glyph: 'stove', words: ['灶台', '燃气灶', '电磁炉'] },
    { glyph: 'sink', words: ['水槽', '洗手池', '脸盆'] },
    { glyph: 'toilet', words: ['马桶'] },
    { glyph: 'bathtub', words: ['浴缸'] },
    { glyph: 'towel', words: ['毛巾', '浴巾'] },
    { glyph: 'bomb', words: ['炸弹'] },
    { glyph: 'rocket', words: ['火箭', '导弹'] },
    { glyph: 'cannon', words: ['大炮'] },
    { glyph: 'pan', words: ['平底锅', '炒锅'] },
    { glyph: 'knife', words: ['菜刀'] },
    { glyph: 'board', words: ['砧板'] },
    { glyph: 'bowl', words: ['饭碗', '瓷碗', '碗'] },
    { glyph: 'plate', words: ['盘子', '碟子'] },
    { glyph: 'cutlery', words: ['刀叉', '勺子', '叉子', '筷子'] },
    { glyph: 'kettle', words: ['水壶', '茶壶', '开水壶'] },
    { glyph: 'bottle', words: ['酒瓶', '奶瓶'] },
    { glyph: 'medicine', words: ['药瓶', '药丸'] },
    { glyph: 'cake', words: ['蛋糕'] },
    { glyph: 'food', words: ['面包', '苹果', '包子', '饺子', '汉堡', '饼干'] },
    { glyph: 'bone', words: ['骨头'] },
    { glyph: 'suitcase', words: ['行李箱', '皮箱', '手提箱'] },
    { glyph: 'clothes', words: ['衣服', '外套', '衬衫', '裙子', '鞋子', '袜子'] },
    { glyph: 'glasses', words: ['眼镜'] },
    { glyph: 'telescope', words: ['望远镜', '显微镜', '放大镜'] },
    { glyph: 'trophy', words: ['奖杯'] },
    { glyph: 'speaker', words: ['音响', '音箱', '喇叭', '收音机'] },
    { glyph: 'camera', words: ['相机', '摄像机'] },
    { glyph: 'flashlight', words: ['手电筒'] },
    { glyph: 'lantern', words: ['灯笼'] },
    { glyph: 'chandelier', words: ['吊灯', '水晶灯'] },
    { glyph: 'candle', words: ['蜡烛'] },
    { glyph: 'campfire', words: ['篝火'] },
    { glyph: 'fireplace', words: ['壁炉'] },
    { glyph: 'curtain', words: ['窗帘'] },
    { glyph: 'carpet', words: ['地毯'] },
    { glyph: 'blackboard', words: ['黑板'] },
    { glyph: 'well', words: ['水井'] },
    { glyph: 'pillar', words: ['柱子', '石柱'] },
    { glyph: 'bow', words: ['弓箭', '长弓'] },
    { glyph: 'shield', words: ['盾牌'] },
    { glyph: 'tool', words: ['锤子', '扳手'] },
    { glyph: 'rope', words: ['绳子'] },
    { glyph: 'sofa', words: ['沙发'] },
    { glyph: 'cabinet', words: ['衣柜', '书柜', '柜子', '橱柜'] },
    { glyph: 'shelf', words: ['书架', '架子'] },
    { glyph: 'bench', words: ['长椅', '长凳'] },
    { glyph: 'flower', words: ['向日葵', '玫瑰', '牡丹', '荷花', '菊花', '花朵', '花儿', '鲜花', '花'] },
    { glyph: 'grass', words: ['小草', '野草', '青草', '竹子', '藤蔓', '草', '藤'] },
    { glyph: 'tree', words: ['大树', '古树', '老树', '树木', '松树', '柳树', '枫树', '榕树', '树', '木'] },
    { glyph: 'mushroom', words: ['蘑菇', '毒蝇伞', '菇', '菌'] },
    { glyph: 'cactus', words: ['仙人掌', '仙人球'] },
    { glyph: 'stone', words: ['石头', '岩石', '鹅卵石', '石像', '石碑', '石块', '石', '岩'] },
    { glyph: 'box', words: ['箱子', '盒子', '宝箱', '木箱', '纸箱', '箱', '盒'] },
    { glyph: 'cup', words: ['杯子', '水杯', '茶杯', '茶壶', '酒杯', '瓶子', '花瓶', '杯', '壶', '瓶'] },
    { glyph: 'book', words: ['书本', '日记本', '笔记本', '纸条', '书'] },
    { glyph: 'light', words: ['台灯', '灯笼', '蜡烛', '路灯', '灯', '烛'] },
    { glyph: 'table', words: ['桌子', '茶几', '书桌', '柜子', '桌'] },
    { glyph: 'chair', words: ['椅子', '凳子', '沙发', '椅', '凳'] },
    { glyph: 'door', words: ['大门', '房门', '门'] },
    { glyph: 'window', words: ['窗户', '窗'] },
    { glyph: 'weapon', words: ['宝剑', '长剑', '匕首', '剑'] },
    { glyph: 'bed', words: ['床', '枕头'] },
    { glyph: 'vehicle', words: ['汽车', '马车', '小船', '飞机', '车'] },
    { glyph: 'phone', words: ['手机', '电话', '电脑'] },
    { glyph: 'plant', words: ['盆栽', '植物'] },
    { glyph: 'screen', words: ['电视机', '电脑', '显示器'] },
    { glyph: 'clock', words: ['闹钟', '时钟', '钟表', '怀表', '沙漏'] },
    { glyph: 'mirror', words: ['镜子', '魔镜'] },
    { glyph: 'key', words: ['钥匙'] },
    { glyph: 'umbrella', words: ['雨伞', '伞'] },
    { glyph: 'ball', words: ['水晶球', '皮球', '气球', '球'] },
    { glyph: 'flag', words: ['旗帜', '旗子', '旗'] },
    { glyph: 'tent', words: ['帐篷'] },
    { glyph: 'barrel', words: ['木桶', '水桶', '罐子', '酒桶', '桶'] },
    { glyph: 'sign', words: ['招牌', '路牌', '牌子', '牌'] },
    { glyph: 'gem', words: ['宝石', '钻石', '水晶', '金币'] },
    { glyph: 'instrument', words: ['吉他', '钢琴', '小提琴', '笛子', '鼓', '琴'] },
    { glyph: 'pot', words: ['铁锅', '火炉', '炉子', '锅'] },
    { glyph: 'bag', words: ['背包', '书包', '包裹', '行李'] },
    { glyph: 'crown', words: ['皇冠', '王冠'] },
    { glyph: 'fence', words: ['栅栏', '围栏', '篱笆'] },
    { glyph: 'stairs', words: ['楼梯', '台阶'] },
    { glyph: 'tower', words: ['灯塔', '高塔', '塔'] },
    { glyph: 'house', words: ['房子', '小屋', '木屋'] },
    { glyph: 'castle', words: ['城堡'] },
    { glyph: 'generic', words: ['玩具', '玩偶', '布偶', '物品', '物体', '东西'] }
  ];
  /** 人的年龄与性别关键词：名称里按包含判断，设定里只看开头的几个明确的词（见 classifyHuman）。 */
  const HUMAN_AGE_RULES = [
    { age: 'baby', words: ['婴儿', '婴孩', '宝宝', '襁褓', '奶娃', '新生儿'] },
    { age: 'elder', words: ['老人', '老爷爷', '老奶奶', '爷爷', '奶奶', '老头', '老太', '老婆婆', '老妇', '老翁', '外公', '外婆', '祖父', '祖母', '长者', '老先生', '老者', '婆婆', '白发'] },
    { age: 'child', words: ['小孩', '孩子', '儿童', '男孩', '女孩', '小朋友', '小学生', '幼儿', '娃娃'] },
    { age: 'teen', words: ['少年', '少女', '中学生', '学生', '青少年'] }
  ];
  const HUMAN_GENDER_RULES = [
    { gender: 'female', words: ['女', '小姐', '姐', '妹', '妈', '母亲', '奶奶', '婆', '姑', '姨', '嫂', '妻', '娘', '公主', '王后', '皇后', '夫人', '太太', '新娘'], hintWords: ['女性', '女人', '女孩', '女子', '少女', '女士', '母亲', '妈妈', '奶奶', '公主', '女，', '女；'] },
    { gender: 'male', words: ['男', '先生', '爷爷', '爸', '父', '哥', '叔', '伯', '弟', '儿子', '少爷', '王子', '国王', '皇帝', '公子', '大叔', '老头', '和尚', '兄', '丈夫'], hintWords: ['男性', '男人', '男孩', '男子', '先生', '父亲', '爸爸', '爷爷', '王子', '男，', '男；'] }
  ];
  /** 年龄数字（“70 岁”）的分界：不到 2 岁是婴儿，不到 12 岁是儿童，不到 18 岁是少年，60 岁及以上是老人。 */
  const AGE_BABY_BELOW = 2;
  const AGE_CHILD_BELOW = 12;
  const AGE_TEEN_BELOW = 18;
  const AGE_ELDER_FROM = 60;
  /**
   * 角色种类关键词（按先后顺序匹配）：奇幻生物在前，动物在后，都不匹配再看会说话的物品与植物，最后才是人。
   * 单字关键词（马、牛、熊等容易是人的姓氏）只在作为名称最后一个字或名称本身时才算；设定只看开头和“是/一只…”之后，避免“猎杀怪物的人”被当成怪物。
   */
  const SPECIES_RULES = [
    { species: 'zombie', words: ['僵尸', '丧尸', '行尸', '尸鬼'] },
    { species: 'demon', words: ['恶魔', '魔鬼', '魔王', '魔神', '妖魔', '魔族', '撒旦', '恶鬼', '恶灵'] },
    { species: 'ghost', words: ['邪灵', '幽灵', '亡灵', '幽魂', '怨灵', '冤魂', '鬼魂', '鬼怪', '幽影', '鬼'] },
    { species: 'robot', words: ['机器人', '机械', '傀儡', '人工智能'] },
    { species: 'monster', words: ['怪物', '怪兽', '妖怪', '妖兽', '巨兽', '魔物', '异形', '哥布林', '食人魔', '巨人', '兽人', '巨龙', '恶龙', '神龙', '飞龙', '火龙', '冰龙'] },
    { species: 'deity', words: ['神仙', '仙人', '仙子', '仙女', '仙翁', '神明', '神灵', '天神', '神祇', '天使', '菩萨', '佛祖', '女神', '男神', '山神', '海神', '雷神', '龙王', '土地公', '土地婆'] },
    { species: 'elf', words: ['精灵', '妖精', '花仙', '仙灵', '树精', '花妖', '小妖'] },
    { species: 'blob', words: ['史莱姆', '果冻', '不明生物', '未知生物', '神秘生物', '某种生物', '无法形容的', '说不清的', '软体生物', '一团'] },
    // 微生物
    { species: 'virus', words: ['病毒', '噬菌体', '冠状'] },
    { species: 'bacteria', words: ['细菌', '杆菌', '球菌', '弧菌', '乳酸菌', '益生菌', '菌落'] },
    { species: 'fungus', words: ['真菌', '霉菌', '酵母', '孢子'] },
    { species: 'amoeba', words: ['变形虫', '草履虫', '原生生物', '阿米巴', '单细胞', '细胞', '浮游生物'] },
    // 鸟类：具体的鸟在前，笼统的“鸟”在后
    { species: 'bat', words: ['蝙蝠'] },
    { species: 'owl', words: ['猫头鹰'] },
    { species: 'parrot', words: ['鹦鹉', '八哥'] },
    { species: 'penguin', words: ['企鹅'] },
    { species: 'peacock', words: ['孔雀'] },
    { species: 'ostrich', words: ['鸵鸟'] },
    { species: 'chicken', words: ['公鸡', '母鸡', '小鸡', '鸡'] },
    { species: 'goose', words: ['天鹅', '大鹅', '鹅'] },
    { species: 'duck', words: ['鸭'] },
    { species: 'eagle', words: ['老鹰', '雄鹰', '秃鹫', '雕', '隼', '鹫', '鹰'] },
    { species: 'bird', words: ['乌鸦', '麻雀', '喜鹊', '凤凰', '啄木鸟', '仙鹤', '鸟', '雀', '鸽', '鸦', '燕', '鹤', '鸥', '雁'] },
    // 水生与节肢、软体动物
    { species: 'shark', words: ['鲨鱼', '大白鲨', '鲨'] },
    { species: 'whale', words: ['海豚', '鲸鱼', '鲸'] },
    { species: 'octopus', words: ['章鱼', '乌贼', '鱿鱼', '墨鱼'] },
    { species: 'jellyfish', words: ['水母', '海蜇'] },
    { species: 'starfish', words: ['海星'] },
    { species: 'crab', words: ['螃蟹', '龙虾', '蟹', '虾'] },
    { species: 'crocodile', words: ['鳄鱼', '鳄'] },
    { species: 'fish', words: ['鱼'] },
    { species: 'snake', words: ['眼镜蛇', '蟒蛇', '蛇', '蟒'] },
    // 昆虫与小虫
    { species: 'butterfly', words: ['蝴蝶', '蛾'] },
    { species: 'bee', words: ['蜜蜂', '黄蜂', '蜂'] },
    { species: 'ladybug', words: ['瓢虫'] },
    { species: 'ant', words: ['蚂蚁', '白蚁', '蚁'] },
    { species: 'spider', words: ['蜘蛛'] },
    { species: 'dragonfly', words: ['蜻蜓'] },
    { species: 'snail', words: ['蜗牛'] },
    { species: 'worm', words: ['蚯蚓', '毛毛虫', '蠕虫', '蛆', '寄生虫'] },
    { species: 'beetle', words: ['甲虫', '金龟', '天牛', '蟑螂', '蟋蟀', '螳螂', '蝗虫', '蚱蜢'] },
    { species: 'insect', words: ['萤火虫', '苍蝇', '蚊子', '跳蚤', '蝉', '蚊', '蝇', '虫'] },
    // 兽类：具体的在前，认不出的归到最后的“野兽”
    { species: 'squirrel', words: ['松鼠'] },
    { species: 'hedgehog', words: ['刺猬'] },
    { species: 'kangaroo', words: ['袋鼠'] },
    { species: 'lizard', words: ['蜥蜴', '壁虎', '变色龙', '蝾螈'] },
    { species: 'rhino', words: ['犀牛', '犀'] },
    { species: 'mouse', words: ['仓鼠', '老鼠', '耗子', '鼠'] },
    { species: 'rabbit', words: ['兔子', '兔'] },
    { species: 'panda', words: ['熊猫'] },
    { species: 'tiger', words: ['老虎', '虎'] },
    { species: 'lion', words: ['狮子', '狮'] },
    { species: 'leopard', words: ['豹子', '猎豹', '豹'] },
    { species: 'cat', words: ['猫咪', '猞猁', '猫'] },
    { species: 'dog', words: ['小狗', '狗', '犬'] },
    { species: 'wolf', words: ['狼'] },
    { species: 'fox', words: ['狐狸', '狐'] },
    { species: 'bear', words: ['熊'] },
    { species: 'giraffe', words: ['长颈鹿'] },
    { species: 'deer', words: ['驯鹿', '麋鹿', '鹿'] },
    { species: 'hippo', words: ['河马'] },
    { species: 'zebra', words: ['斑马'] },
    { species: 'unicorn', words: ['独角兽'] },
    { species: 'camel', words: ['骆驼'] },
    { species: 'horse', words: ['骏马', '毛驴', '马', '驴', '骡'] },
    { species: 'cow', words: ['奶牛', '水牛', '牛'] },
    { species: 'sheep', words: ['绵羊', '山羊', '羊'] },
    { species: 'pig', words: ['野猪', '小猪', '猪'] },
    { species: 'frog', words: ['青蛙', '蟾蜍', '蛙'] },
    { species: 'elephant', words: ['大象', '象'] },
    { species: 'gorilla', words: ['大猩猩', '猩猩'] },
    { species: 'monkey', words: ['猕猴', '猴子', '猴', '猿'] },
    { species: 'turtle', words: ['乌龟', '海龟', '龟'] },
    { species: 'dinosaur', words: ['恐龙', '霸王龙', '暴龙'] },
    { species: 'beast', words: ['动物', '野兽', '獾', '貂', '鼬', '獭', '兽'] }
  ];
  /** 设定开头参与判断的字数，以及介绍身份的引导词（“是”“一只”等，或位于开头）。 */
  const SPECIES_HINT_CHARS = 24;
  const THING_HINT_LEAD = '(?:是|为|一个|一只|一朵|一根|一棵|一块|一株|一件|一把|一颗|一盏|一扇|一本|一张|一辆|一支|一座|化身|化作|变成|变为|穿越成)';
  const SPECIES_HINT_LEAD = '(?:^|；|是|为|一个|一位|一名|一只|一头|一条|一匹|一尾|一朵|一根|一棵|一块|一株|一件|一把|一颗|一盏|一扇|一本|一张|一辆|一支|一座|化身|化作|变成)';
  const EFFECT_RULES = [
    // 爆炸、烟花、发射、光束与影子等：具体的在前，避免被后面笼统的“火”“烟”“光”抢先
    { glyph: 'explosion', words: ['爆炸', '爆破', '爆发', '引爆', '核爆', '蘑菇云', '爆', '炸', '轰'] },
    { glyph: 'fireworks', words: ['烟花', '焰火', '礼花', '烟火'] },
    { glyph: 'muzzle', words: ['枪口', '炮口', '开枪', '开炮', '枪火', '炮火'] },
    { glyph: 'laser', words: ['激光', '射线', '光线'] },
    { glyph: 'beam', words: ['灯光', '聚光', '光束', '光柱', '探照', '手电', '舞台灯'] },
    { glyph: 'projectile', words: ['子弹', '炮弹', '导弹', '火箭弹', '飞镖', '暗器', '飞刀', '弹丸', '箭', '发射', '射击', '射', '投掷', '弹'] },
    { glyph: 'shadow', words: ['阴影', '影子', '投影', '倒影'] },
    { glyph: 'splash', words: ['水花', '浪花', '溅', '喷泉', '喷水'] },
    { glyph: 'slash', words: ['剑气', '刀光', '刀气', '斩击', '挥砍', '劈', '爪痕', '划痕'] },
    { glyph: 'lightning', words: ['闪电', '雷', '电'] },
    { glyph: 'magic', words: ['法阵', '魔法阵', '咒', '符文', '符咒', '法术', '魔法', '法'] },
    { glyph: 'heart', words: ['爱心', '心形', '爱', '心'] },
    { glyph: 'notes', words: ['音符', '歌声', '音乐', '旋律'] },
    { glyph: 'wind', words: ['龙卷', '风', '气流'] },
    { glyph: 'bubbles', words: ['泡泡', '气泡', '泡'] },
    { glyph: 'leaves', words: ['落叶', '树叶', '花瓣', '叶'] },
    { glyph: 'dark', words: ['黑雾', '暗影', '黑暗', '阴'] },
    { glyph: 'shockwave', words: ['冲击', '震', '波'] },
    { glyph: 'fire', words: ['火', '焰', '烧'] },
    { glyph: 'smoke', words: ['烟', '雾', '尘', '气'] },
    { glyph: 'rain', words: ['雨', '水', '浪'] },
    { glyph: 'snow', words: ['雪', '冰', '霜'] },
    { glyph: 'light', words: ['光', '闪', '星', '亮', '魔'] }
  ];

  /** 俯视图与对照：纵深折算成 0（背景）到 1（前景）的行位置；对照取镜头结尾前一点点的画面。 */
  const COMPARE_END_GAP = 0.02;
  /** 判断角色是否在取景范围之外：在镜头内这几个时刻取样，屏幕位置超出画面边缘这么多（占画面宽度的比例）才算。 */
  const FRAME_SAMPLE_RATIOS = [0, 0.25, 0.5, 0.75, 1];
  const FRAME_MARGIN = 0.03;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /** 线性插值；ratio 为 0 或 1 时精确等于端点。 */
  function lerp(from, to, ratio) {
    return from * (1 - ratio) + to * ratio;
  }

  function smoothstep(ratio) {
    return ratio * ratio * (3 - 2 * ratio);
  }

  /** 文字的简单哈希（非负整数），用来给没有场景实体的场次稳定取色。 */
  function hashText(text) {
    let hash = 5381;
    for (const char of text) hash = ((hash << 5) + hash + char.codePointAt(0)) >>> 0;
    return hash;
  }

  /**
   * 解析画幅文字（如 16:9）。
   * @param {string|null|undefined} text 画幅；为空或无法解析时按 16:9。
   * @returns {{ width: number, height: number, ratio: number, assumed: boolean }} 宽高、宽高比与是否为缺省值；宽高比限制在 9:21 到 21:9 之间。
   */
  function parseAspectRatio(text) {
    const matched = typeof text === 'string' ? ASPECT_PATTERN.exec(text.trim()) : null;
    const width = matched ? Number(matched[1]) : 0;
    const height = matched ? Number(matched[2]) : 0;
    if (!(width > 0 && height > 0)) {
      return { ...DEFAULT_ASPECT, ratio: DEFAULT_ASPECT.width / DEFAULT_ASPECT.height, assumed: true };
    }
    return { width, height, ratio: clamp(width / height, MIN_RATIO, MAX_RATIO), assumed: false };
  }

  /**
   * 解析运镜文字。
   * @param {string} text 镜头的运镜文字。
   * @returns {{ type: string, amount: number, label: string, supported: boolean }} 类型为 none 且 supported 为 false 表示无法识别。
   */
  function parseCamera(text) {
    const label = (text || '').trim();
    if (label === '') return { type: 'none', amount: 1, label, supported: true };
    const rule = CAMERA_RULES.find((item) => item.words.some((word) => label.includes(word)));
    if (!rule) return { type: 'none', amount: 1, label, supported: false };
    let amount = 1;
    if (CAMERA_SLOW_WORDS.some((word) => label.includes(word))) amount = CAMERA_SLOW_AMOUNT;
    else if (CAMERA_FAST_WORDS.some((word) => label.includes(word))) amount = CAMERA_FAST_AMOUNT;
    return { type: rule.type, amount, label, supported: true };
  }

  /** 解析转场文字为类型：cut、dissolve、fadeOut、fadeIn、flash。 */
  function parseTransition(text) {
    const label = text || '';
    if (label.includes('叠化')) return 'dissolve';
    if (label.includes('淡出')) return 'fadeOut';
    if (label.includes('淡入')) return 'fadeIn';
    if (label.includes('闪白')) return 'flash';
    return 'cut';
  }

  /** 解析景别文字：取景放大倍数；无法识别（或为空）时不放大，supported 为 false。 */
  function parseShotSize(text) {
    const label = (text || '').trim();
    const rule = SHOT_SIZE_RULES.find((item) => item.words.some((word) => label.includes(word)));
    return { zoom: rule ? rule.zoom : 1, label, supported: Boolean(rule) };
  }

  /** 取第一条关键词命中的规则的值。 */
  function matchRule(rules, key, text, fallback) {
    const rule = rules.find((item) => item.words.some((word) => text.includes(word)));
    return rule ? rule[key] : fallback;
  }

  /** 场景归类：地点（室内、街道、森林、洞穴、海边、旷野或通用）与时间（白天、黄昏、清晨、夜晚）。 */
  function classifyScene(text) {
    const source = text || '';
    return { setting: matchRule(SCENE_SETTING_RULES, 'setting', source, 'generic'), time: matchRule(SCENE_TIME_RULES, 'time', source, 'day') };
  }

  /** 道具归类为要绘制的图形名称。 */
  function classifyProp(name) {
    return matchRule(PROP_RULES, 'glyph', name || '', 'generic');
  }

  /** 特效归类为要绘制的图形名称。 */
  function classifyEffect(name) {
    return matchRule(EFFECT_RULES, 'glyph', name || '', 'spark');
  }

  /**
   * 关键词是否命中：名称里多字词包含即可，单字词要作为名称最后一个字；设定里要出现在开头或“是/一只…”这类介绍身份的词之后。
   * isThing（物品与植物）更严格：单字词只能是名称本身，设定里只认“是/一朵/化身…”之后、且后面紧跟标点或结尾的词（“守着灯塔的老人”不是灯）。
   */
  function matchesSpecies(word, text, isHint, isThing) {
    if (isHint) {
      const pattern = isThing ? `${THING_HINT_LEAD}[^，。；;,.\\s]{0,6}${word}(?=$|[，。；;,.、\\s])` : `${SPECIES_HINT_LEAD}[^，。；;,.\\s]{0,5}${word}(?![的之们])`;
      return new RegExp(pattern).test(text.slice(0, SPECIES_HINT_CHARS));
    }
    if (word.length > 1) return text.includes(word);
    return text === word || (!isThing && text.endsWith(word));
  }

  /**
   * 角色归类的详细结果：种类，以及种类为会说话的物品或植物（thing）时要画的图形。
   * @returns {{ species: string, glyph: string }} glyph 只在 species 为 thing 时有值。
   */
  function classifyCharacterDetail(name, hint) {
    for (const [text, isHint] of [[name || '', false], [hint || '', true]]) {
      const rule = SPECIES_RULES.find((item) => item.words.some((word) => matchesSpecies(word, text, isHint, false)));
      if (rule) return { species: rule.species, glyph: '' };
      const thing = THING_RULES.find((item) => item.words.some((word) => matchesSpecies(word, text, isHint, true)));
      if (thing) return { species: 'thing', glyph: thing.glyph };
    }
    return { species: 'human', glyph: '' };
  }

  /**
   * 角色归类：人、动物（松鼠、刺猬、蝙蝠、鸟、猫、狗等）、奇幻生物（僵尸、神仙、精灵、怪物、邪灵、恶魔、机器人、软泥怪）或会说话的物品与植物（thing），决定画哪种形象。
   * @param {string} name 角色名，优先按它判断。
   * @param {string} [hint] 身份与设定的开头，名称里认不出时再看它。
   * @returns {string} 种类名；认不出时为 human。
   */
  function classifyCharacter(name, hint) {
    return classifyCharacterDetail(name, hint).species;
  }

  /**
   * 人的性别与年龄：按名称里的称呼（妈妈、爷爷、小女孩、婴儿等）判断，名称里没有时再看设定开头的明确说法（女性、70 岁等）。
   * @returns {{ gender: 'male'|'female'|'unknown', age: 'baby'|'child'|'teen'|'adult'|'elder' }} 都认不出时性别 unknown、年龄 adult。
   */
  function classifyHuman(name, hint) {
    const nameText = name || '';
    const head = (hint || '').slice(0, SPECIES_HINT_CHARS);
    let gender = 'unknown';
    const byName = HUMAN_GENDER_RULES.find((rule) => rule.words.some((word) => nameText.includes(word)));
    const byHint = HUMAN_GENDER_RULES.find((rule) => rule.hintWords.some((word) => head.includes(word)));
    if (byName) gender = byName.gender;
    else if (byHint) gender = byHint.gender;

    let age = 'adult';
    const ageByName = HUMAN_AGE_RULES.find((rule) => rule.words.some((word) => nameText.includes(word)));
    const ageByHint = HUMAN_AGE_RULES.find((rule) => rule.words.some((word) => head.includes(word)));
    const years = /(\d{1,3})\s*岁/.exec(head);
    if (ageByName) age = ageByName.age;
    else if (years) {
      const value = Number(years[1]);
      age = value < AGE_BABY_BELOW ? 'baby' : value < AGE_CHILD_BELOW ? 'child' : value < AGE_TEEN_BELOW ? 'teen' : value >= AGE_ELDER_FROM ? 'elder' : 'adult';
    } else if (ageByHint) age = ageByHint.age;
    return { gender, age };
  }

  /** 纵深坐标（占画面高度的比例）折算成 0（背景）到 1（前景）的行位置。 */
  function toRow(y) {
    return Math.round(((y - DEPTH_STAGE.back.y) / (DEPTH_STAGE.front.y - DEPTH_STAGE.back.y)) * 1e6) / 1e6;
  }

  /** 位置名称换算成画面比例坐标与缩放。 */
  function toCoordinates(xName, depthName) {
    const depth = DEPTH_STAGE[depthName];
    return { x: X_FRACTION[xName], y: depth.y, scale: depth.scale };
  }

  /** 站位是否填写了任何位置（只填朝向或动作不算已摆放）。 */
  function hasPosition(staging) {
    return Boolean(staging) && [staging.startX, staging.startDepth, staging.endX, staging.endDepth].some((value) => value !== null && value !== undefined);
  }

  /** 按补全规则求出起点与终点的位置名称。 */
  function resolveEndpoints(staging) {
    const fromX = staging.startX || DEFAULT_X;
    const fromDepth = staging.startDepth || DEFAULT_DEPTH;
    const hasEnd = Boolean(staging.endX) || Boolean(staging.endDepth);
    return {
      fromX,
      fromDepth,
      toX: hasEnd ? staging.endX || fromX : fromX,
      toDepth: hasEnd ? staging.endDepth || fromDepth : fromDepth
    };
  }

  /** 朝向缺省时：移动时朝向移动方向，不移动时面向镜头。 */
  function resolveFacing(staging, fromX, toX) {
    if (staging && staging.facing) return staging.facing;
    const delta = X_FRACTION[toX] - X_FRACTION[fromX];
    if (delta > EPSILON) return 'right';
    if (delta < -EPSILON) return 'left';
    return 'camera';
  }

  /** 人声（对白、旁白）。 */
  function isVoice(kind) {
    return kind === 'dialogue' || kind === 'narration';
  }

  /** 文字里的非空白字符数。 */
  function countChars(text) {
    return (text || '').replace(/\s+/g, '').length;
  }

  /**
   * 计算一个镜头里已启用声音的起止时间（相对镜头开头）。
   * @param {object[]} sounds 镜头的声音条目。
   * @param {number} duration 镜头时长（秒）。
   * @param {(id: number|null) => string} nameOf 取说话人名称。
   */
  function compileSounds(sounds, duration, nameOf) {
    const result = [];
    let voiceCursor = 0;
    for (const sound of sounds || []) {
      if (!sound.isEnabled) continue;
      const voice = isVoice(sound.kind);
      const hasStart = sound.startOffsetSeconds !== null && sound.startOffsetSeconds !== undefined;
      const hasDuration = sound.durationSeconds !== null && sound.durationSeconds !== undefined;
      const start = hasStart ? sound.startOffsetSeconds : voice ? voiceCursor : 0;
      let length;
      if (hasDuration) length = sound.durationSeconds;
      else if (voice) length = Math.max(SPEECH_MIN_SECONDS, countChars(sound.text) / SPEECH_CHARS_PER_SECOND);
      else if (sound.kind === 'music') length = Math.max(0, duration - start);
      else length = SFX_DEFAULT_SECONDS;
      const rawEnd = start + length;
      if (voice) voiceCursor = rawEnd;
      result.push({
        id: sound.id === undefined ? null : sound.id,
        kind: sound.kind,
        speakerEntityId: sound.speakerEntityId === undefined ? null : sound.speakerEntityId,
        speakerName: sound.kind === 'dialogue' ? nameOf(sound.speakerEntityId) : '',
        text: sound.text,
        delivery: sound.delivery || '',
        charCount: countChars(sound.text),
        start: Math.min(start, duration),
        end: Math.min(rawEnd, duration),
        rawEnd,
        // 开始时间或持续时长缺失，按规则估算得到。
        estimated: !hasStart || (!hasDuration && sound.kind !== 'music'),
        clipped: rawEnd > duration + EPSILON
      });
    }
    return result;
  }

  /** 把一个镜头的出场实体与站位编译为角色、道具、特效的运动描述，以及不绘制的实体。 */
  function compileActors(shot, entities, colorIndex) {
    const stagingById = new Map((shot.staging || []).map((item) => [item.entityId, item]));
    const actors = [];
    const unplaced = [];
    for (const entityId of shot.entityIds || []) {
      const entity = entities.get(entityId);
      if (!entity || entity.kind === 'scene') continue;
      const staging = stagingById.get(entityId);
      const placed = hasPosition(staging);
      if (!placed && entity.kind !== 'character') {
        unplaced.push({ entityId, name: entity.name, kind: entity.kind });
        continue;
      }
      const index = colorIndex.get(entityId) || 0;
      let color = EFFECT_COLOR;
      if (entity.kind === 'character') color = CHARACTER_COLORS[index % CHARACTER_COLORS.length];
      else if (entity.kind === 'prop') color = PROP_COLORS[index % PROP_COLORS.length];
      const detail = entity.kind === 'character' ? classifyCharacterDetail(entity.name, entity.hint) : null;
      const human = detail && detail.species === 'human' ? classifyHuman(entity.name, entity.hint) : null;
      const actor = {
        entityId,
        name: entity.name,
        kind: entity.kind,
        color,
        isPlaced: placed,
        action: staging ? staging.action || '' : '',
        glyph: detail ? detail.glyph : entity.kind === 'prop' ? classifyProp(entity.name) : entity.kind === 'effect' ? classifyEffect(entity.name) : '',
        species: detail ? detail.species : '',
        gender: human ? human.gender : '',
        age: human ? human.age : '',
        slot: null,
        from: null,
        to: null,
        facing: 'camera',
        isMoving: false
      };
      if (placed) {
        const points = resolveEndpoints(staging);
        actor.slot = { fromX: points.fromX, fromDepth: points.fromDepth, toX: points.toX, toDepth: points.toDepth };
        actor.from = toCoordinates(points.fromX, points.fromDepth);
        actor.to = toCoordinates(points.toX, points.toDepth);
        actor.facing = resolveFacing(staging, points.fromX, points.toX);
        actor.isMoving = points.fromX !== points.toX || points.fromDepth !== points.toDepth;
      } else {
        actor.facing = staging && staging.facing ? staging.facing : 'camera';
      }
      actors.push(actor);
    }
    // 没有摆放的角色在画面中部等距排开。
    const waiting = actors.filter((actor) => !actor.isPlaced);
    waiting.forEach((actor, position) => {
      const x = waiting.length === 1 ? 0.5 : lerp(0.3, 0.7, position / (waiting.length - 1));
      const point = { x, y: DEPTH_STAGE[DEFAULT_DEPTH].y, scale: DEPTH_STAGE[DEFAULT_DEPTH].scale };
      actor.from = point;
      actor.to = point;
    });
    return { actors, unplaced };
  }

  /** 镜头的场景：取第一个场景实体，没有则按场次文字取色；同时按场景名与场次文字归类地点和时间。 */
  function compileScene(shot, entities, colorIndex) {
    const entityId = (shot.entityIds || []).find((id) => entities.get(id) && entities.get(id).kind === 'scene');
    const label = (shot.sceneLabel || '').trim();
    if (entityId !== undefined) {
      const colors = SCENE_COLORS[(colorIndex.get(entityId) || 0) % SCENE_COLORS.length];
      const name = entities.get(entityId).name;
      return { entityId, name, ...colors, ...classifyScene(`${name} ${label}`), seed: hashText(name) };
    }
    const colors = SCENE_COLORS[hashText(label) % SCENE_COLORS.length];
    return { entityId: null, name: label || '未命名场景', ...colors, ...classifyScene(label), seed: hashText(label) };
  }

  /**
   * 把分镜脚本阶段视图编译为时间线。
   * @param {object} view 分镜脚本阶段视图（shots、groups、entities、aspectRatio）。
   * @returns {object} 时间线：{ aspect, totalSeconds, shots, groups }，镜头带起止时间、场景、角色运动、声音、运镜与转场。
   */
  function compile(view) {
    const entities = new Map((view.entities || []).map((entity) => [entity.id, entity]));
    // 同一类型实体按列表顺序编号，用来稳定分配颜色。
    const colorIndex = new Map();
    const counters = {};
    for (const entity of view.entities || []) {
      counters[entity.kind] = counters[entity.kind] || 0;
      colorIndex.set(entity.id, counters[entity.kind]);
      counters[entity.kind] += 1;
    }
    const groupOf = new Map();
    for (const group of view.groups || []) for (const shotId of group.shotIds) groupOf.set(shotId, group.seq);
    const nameOf = (id) => (entities.has(id) ? entities.get(id).name : '');
    const noticesByShot = new Map();
    for (const notice of view.cutNotices || []) noticesByShot.set(notice.shotId, [...(noticesByShot.get(notice.shotId) || []), notice]);

    let cursor = 0;
    const shots = [...(view.shots || [])]
      .sort((a, b) => a.seq - b.seq)
      .map((shot, index) => {
        const start = cursor;
        cursor += shot.durationSeconds;
        const { actors, unplaced } = compileActors(shot, entities, colorIndex);
        return {
          id: shot.id,
          seq: shot.seq,
          index,
          start,
          end: cursor,
          duration: shot.durationSeconds,
          groupSeq: groupOf.has(shot.id) ? groupOf.get(shot.id) : null,
          sceneLabel: shot.sceneLabel || '',
          shotSize: shot.shotSize || '',
          cameraAngle: shot.cameraAngle || '',
          cameraMovement: shot.cameraMovement || '',
          transition: shot.transition || '',
          firstFrameMode: shot.firstFrameMode || 'none',
          cutNotices: noticesByShot.get(shot.id) || [],
          prompt: shot.prompt || '',
          scene: compileScene(shot, entities, colorIndex),
          actors,
          unplaced,
          sounds: compileSounds(shot.sounds, shot.durationSeconds, nameOf),
          camera: parseCamera(shot.cameraMovement),
          shotSizeInfo: parseShotSize(shot.shotSize),
          transitionOut: parseTransition(shot.transition)
        };
      });

    const groups = [];
    for (const shot of shots) {
      const last = groups[groups.length - 1];
      if (last && shot.groupSeq !== null && last.seq === shot.groupSeq) {
        last.lastIndex = shot.index;
        last.end = shot.end;
      } else {
        groups.push({ seq: shot.groupSeq, firstIndex: shot.index, lastIndex: shot.index, start: shot.start, end: shot.end });
      }
    }
    return { aspect: parseAspectRatio(view.aspectRatio), totalSeconds: Math.round(cursor * 1000) / 1000, shots, groups };
  }

  /**
   * 求某一时刻所在的镜头序位。
   * @returns {number} 镜头在时间线中的下标；没有镜头时为 -1；时间在末尾或之后落在最后一个镜头。
   */
  function locate(timeline, time) {
    const { shots } = timeline;
    if (shots.length === 0) return -1;
    if (time <= 0) return 0;
    const found = shots.findIndex((shot) => time >= shot.start - EPSILON && time < shot.end - EPSILON);
    return found === -1 ? shots.length - 1 : found;
  }

  /** 当前播放位置：所在镜头标识与镜头内偏移，用于时间线重建后恢复位置。 */
  function position(timeline, time) {
    const index = locate(timeline, time);
    if (index === -1) return null;
    const shot = timeline.shots[index];
    return { shotId: shot.id, offset: clamp(time - shot.start, 0, shot.duration) };
  }

  /**
   * 按镜头标识与镜头内偏移求时间；镜头已不存在时返回 null。
   * @returns {number|null} 时间（秒）。
   */
  function restore(timeline, saved) {
    if (!saved) return null;
    const shot = timeline.shots.find((item) => item.id === saved.shotId);
    return shot ? shot.start + clamp(saved.offset, 0, shot.duration) : null;
  }

  /** 运镜在镜头进度 progress 时的画面变换：缩放（不小于 1）与平移（占画面宽高的比例）。 */
  function sampleCamera(camera, progress, localTime, followX, reducedMotion) {
    const { amount } = camera;
    switch (camera.type) {
      case 'zoomIn':
        return { zoom: 1 + 0.15 * amount * progress, offsetX: 0, offsetY: 0 };
      case 'zoomOut':
        return { zoom: 1 + 0.15 * amount * (1 - progress), offsetX: 0, offsetY: 0 };
      case 'panLeft':
        return { zoom: 1.06, offsetX: 0.06 * amount * (progress - 0.5), offsetY: 0 };
      case 'panRight':
        return { zoom: 1.06, offsetX: -0.06 * amount * (progress - 0.5), offsetY: 0 };
      case 'tiltUp':
        return { zoom: 1.06, offsetX: 0, offsetY: 0.06 * amount * (progress - 0.5) };
      case 'tiltDown':
        return { zoom: 1.06, offsetX: 0, offsetY: -0.06 * amount * (progress - 0.5) };
      case 'orbit':
        return { zoom: 1 + 0.06 * amount * progress, offsetX: 0.05 * amount * Math.sin(Math.PI * progress), offsetY: 0 };
      case 'follow':
        return { zoom: 1.08, offsetX: followX === null ? 0 : clamp((0.5 - followX) * 0.3, -0.06, 0.06), offsetY: 0 };
      case 'handheld':
        if (reducedMotion) return { zoom: 1.02, offsetX: 0, offsetY: 0 };
        return {
          zoom: 1.02,
          offsetX: 0.004 * amount * (Math.sin(localTime * 7.3) + 0.5 * Math.sin(localTime * 11.1)),
          offsetY: 0.004 * amount * (Math.sin(localTime * 8.7) + 0.5 * Math.sin(localTime * 13.3))
        };
      default:
        return { zoom: 1, offsetX: 0, offsetY: 0 };
    }
  }

  /** 角色、道具、特效在镜头内某一时刻的位置、缩放、朝向与行走状态。 */
  function sampleActors(shot, localTime, activeSpeakers, reducedMotion) {
    const ratio = clamp((localTime - shot.duration * MOVE_HOLD_RATIO) / (shot.duration * (1 - 2 * MOVE_HOLD_RATIO)), 0, 1);
    const eased = smoothstep(ratio);
    return shot.actors.map((actor) => {
      const walking = actor.isMoving && ratio > 0 && ratio < 1;
      const bob = walking && !reducedMotion ? Math.sin(localTime * BOB_FREQUENCY * 2 * Math.PI) * BOB_AMPLITUDE : 0;
      return {
        entityId: actor.entityId,
        name: actor.name,
        kind: actor.kind,
        glyph: actor.glyph,
        species: actor.species,
        gender: actor.gender,
        age: actor.age,
        color: actor.color,
        x: lerp(actor.from.x, actor.to.x, eased),
        y: lerp(actor.from.y, actor.to.y, eased) - bob * lerp(actor.from.scale, actor.to.scale, eased),
        scale: lerp(actor.from.scale, actor.to.scale, eased),
        facing: actor.facing,
        actionText: actor.action,
        isPlaced: actor.isPlaced,
        isSpeaking: activeSpeakers.has(actor.entityId),
        isWalking: walking,
        // 角色在整个镜头里的走位（起点到终点），用来画轨迹；不移动时为 null。
        path: actor.isMoving ? { fromX: actor.from.x, fromY: actor.from.y, toX: actor.to.x, toY: actor.to.y, fromScale: actor.from.scale, toScale: actor.to.scale } : null
      };
    });
  }

  /** 一个镜头内某一时刻的字幕、标签与正在说话的角色。 */
  function sampleSounds(shot, localTime) {
    const captions = [];
    const tags = [];
    const speakers = new Set();
    for (const sound of shot.sounds) {
      if (localTime < sound.start - EPSILON || localTime >= sound.end - EPSILON) continue;
      if (isVoice(sound.kind)) {
        captions.push({ kind: sound.kind, speakerName: sound.speakerName, text: sound.text, start: sound.start });
        if (sound.kind === 'dialogue' && sound.speakerEntityId !== null) speakers.add(sound.speakerEntityId);
      } else {
        const opacity = Math.min(1, (localTime - sound.start) / TAG_FADE_SECONDS, (sound.end - localTime) / TAG_FADE_SECONDS);
        tags.push({ kind: sound.kind, text: sound.text, opacity: clamp(opacity, 0, 1) });
      }
    }
    captions.sort((a, b) => a.start - b.start);
    return { captions: captions.slice(0, MAX_CAPTIONS), tags, speakers };
  }

  /** 镜头开头、结尾处转场处理的时长。 */
  function transitionSeconds(shot, neighbor) {
    return Math.min(TRANSITION_MAX_SECONDS, TRANSITION_RATIO * Math.min(shot.duration, neighbor ? neighbor.duration : shot.duration));
  }

  /** 取景中心（占画面宽高的比例）：景别放大时对准主体，不放大或没有角色时在画面中央。 */
  function frameCenter(shot, actors, sizeZoom) {
    const characters = actors.filter((actor) => actor.kind === 'character');
    if (sizeZoom <= 1 || characters.length === 0) return { centerX: 0.5, centerY: 0.5 };
    let subjects = characters;
    if (sizeZoom >= SINGLE_SUBJECT_ZOOM) {
      // 主体：本镜头第一个说话的角色，没有则第一个角色；不随说话人切换，避免画面跳动。
      const speaker = shot.sounds.find((sound) => sound.kind === 'dialogue' && characters.some((actor) => actor.entityId === sound.speakerEntityId));
      subjects = [speaker ? characters.find((actor) => actor.entityId === speaker.speakerEntityId) : characters[0]];
    }
    const rise = sizeZoom >= FOCUS_HEAD_ZOOM ? FOCUS_HEAD_RISE : sizeZoom >= FOCUS_UPPER_ZOOM ? FOCUS_UPPER_RISE : FOCUS_CHEST_RISE;
    const x = subjects.reduce((sum, actor) => sum + actor.x, 0) / subjects.length;
    const y = subjects.reduce((sum, actor) => sum + actor.y - rise * actor.scale, 0) / subjects.length;
    const half = 0.5 / sizeZoom;
    return { centerX: clamp(x, half, 1 - half), centerY: clamp(y, half, 1 - half) };
  }

  /** 一个镜头在镜头内某一时刻的画面（不含转场叠加）。 */
  function buildFrame(timeline, shotIndex, localTime, options) {
    const shot = timeline.shots[shotIndex];
    const reducedMotion = Boolean(options && options.reducedMotion);
    const { captions, tags, speakers } = sampleSounds(shot, localTime);
    const actors = sampleActors(shot, localTime, speakers, reducedMotion);
    // 跟拍跟随第一个正在移动的角色。
    const moverSource = shot.actors.find((actor) => actor.kind === 'character' && actor.isMoving);
    const mover = moverSource ? actors.find((actor) => actor.entityId === moverSource.entityId) : undefined;
    const progress = shot.duration > 0 ? clamp(localTime / shot.duration, 0, 1) : 0;
    const movement = sampleCamera(shot.camera, progress, localTime, mover ? mover.x : null, reducedMotion);
    const sizeZoom = shot.shotSizeInfo.zoom;
    return {
      shotId: shot.id,
      shotIndex,
      shotLocalTime: localTime,
      shotProgress: progress,
      scene: shot.scene,
      // 景别决定取景放大与中心，运镜在它之上继续缩放和平移。
      camera: { ...movement, zoom: movement.zoom * sizeZoom, ...frameCenter(shot, actors, sizeZoom) },
      shot: {
        seq: shot.seq,
        count: timeline.shots.length,
        sceneLabel: shot.sceneLabel,
        shotSize: shot.shotSize,
        cameraAngle: shot.cameraAngle,
        cameraMovement: shot.cameraMovement,
        duration: shot.duration,
        prompt: shot.prompt
      },
      actors,
      hasSpeaker: speakers.size > 0,
      captions,
      tags,
      overlay: { fadeToBlack: 0, flashWhite: 0, dissolve: null }
    };
  }

  /** 转场叠加：叠化、淡入淡出、闪白（减少动态效果时闪白改为叠化）。 */
  function buildOverlay(timeline, shotIndex, localTime, options) {
    const shot = timeline.shots[shotIndex];
    const previous = timeline.shots[shotIndex - 1];
    const next = timeline.shots[shotIndex + 1];
    const reducedMotion = Boolean(options && options.reducedMotion);
    const overlay = { fadeToBlack: 0, flashWhite: 0, dissolve: null };

    if (previous) {
      const seconds = transitionSeconds(shot, previous);
      let type = previous.transitionOut;
      if (type === 'flash' && reducedMotion) type = 'dissolve';
      if (type === 'dissolve' && localTime < seconds) {
        overlay.dissolve = { fromFrame: buildFrame(timeline, previous.index, previous.duration, options), alpha: 1 - localTime / seconds };
      } else if (type === 'fadeIn' && localTime < seconds) {
        overlay.fadeToBlack = 1 - localTime / seconds;
      } else if (type === 'flash' && localTime < seconds / 2) {
        overlay.flashWhite = 1 - localTime / (seconds / 2);
      }
    }

    const outSeconds = transitionSeconds(shot, next);
    const remaining = shot.duration - localTime;
    if (shot.transitionOut === 'fadeOut' && remaining < outSeconds) {
      overlay.fadeToBlack = Math.max(overlay.fadeToBlack, 1 - remaining / outSeconds);
    } else if (shot.transitionOut === 'flash' && next && !reducedMotion && remaining < outSeconds / 2) {
      overlay.flashWhite = Math.max(overlay.flashWhite, 1 - remaining / (outSeconds / 2));
    }
    return overlay;
  }

  /**
   * 采样某一时刻的一帧。
   * @param {object} timeline compile 的结果。
   * @param {number} time 时间（秒），超出范围时取端点。
   * @param {{ reducedMotion?: boolean }} [options] reducedMotion 为 true 时关闭起伏、晃动与闪白。
   * @returns {object|null} 一帧绘制数据；没有镜头时为 null。
   */
  function sampleFrame(timeline, time, options) {
    const index = locate(timeline, time);
    if (index === -1) return null;
    const shot = timeline.shots[index];
    const localTime = clamp(time - shot.start, 0, shot.duration);
    const frame = buildFrame(timeline, index, localTime, options);
    frame.overlay = buildOverlay(timeline, index, localTime, options);
    return frame;
  }

  /**
   * 调度俯视图的数据：当前镜头每个实体的起点、终点、此刻位置与上一镜头的终点。
   * 位置用 { x: 横向比例（-0.12 到 1.12）, row: 纵深行位置（0 背景，0.5 中景，1 前景） }。
   * @returns {object|null} 没有这个镜头时为 null。
   */
  function buildTopView(timeline, shotIndex, time) {
    const shot = timeline.shots[shotIndex];
    if (!shot) return null;
    const previous = timeline.shots[shotIndex - 1];
    const localTime = clamp(time - shot.start, 0, shot.duration);
    const ratio = clamp((localTime - shot.duration * MOVE_HOLD_RATIO) / (shot.duration * (1 - 2 * MOVE_HOLD_RATIO)), 0, 1);
    const eased = smoothstep(ratio);
    const point = (coordinates) => ({ x: coordinates.x, row: toRow(coordinates.y) });
    const previousEnds = new Map();
    if (previous) for (const actor of previous.actors) if (actor.isPlaced) previousEnds.set(actor.entityId, point(actor.to));
    const actors = shot.actors.map((actor) => {
      const from = point(actor.from);
      const to = point(actor.to);
      const ghost = actor.isPlaced && previousEnds.has(actor.entityId) ? previousEnds.get(actor.entityId) : null;
      return {
        entityId: actor.entityId,
        name: actor.name,
        kind: actor.kind,
        glyph: actor.glyph,
        species: actor.species,
        color: actor.color,
        isPlaced: actor.isPlaced,
        isMoving: actor.isMoving,
        facing: actor.facing,
        from,
        to,
        current: { x: lerp(from.x, to.x, eased), row: lerp(from.row, to.row, eased) },
        // 与上一镜头终点不在同一格时才画出，用来发现位置跳变。
        ghost: ghost && (Math.abs(ghost.x - from.x) > EPSILON || Math.abs(ghost.row - from.row) > EPSILON) ? ghost : null
      };
    });
    return { shotId: shot.id, seq: shot.seq, sceneName: shot.scene.name, hasPrevious: Boolean(previous), actors };
  }

  /**
   * 镜头对照的三个画面时刻：上一镜结尾、本镜开头、本镜结尾；没有上一镜时第一项的时间为 null。
   * @returns {Array<{ key: string, label: string, time: number|null }>}
   */
  function comparePanels(timeline, shotIndex) {
    const shot = timeline.shots[shotIndex];
    if (!shot) return [];
    const previous = timeline.shots[shotIndex - 1];
    return [
      { key: 'previousEnd', label: '上一镜结尾', time: previous ? Math.max(previous.start, previous.end - COMPARE_END_GAP) : null },
      { key: 'start', label: '本镜开头', time: shot.start },
      { key: 'end', label: '本镜结尾', time: Math.max(shot.start, shot.end - COMPARE_END_GAP) }
    ];
  }

  /**
   * 整个镜头都在取景范围之外的角色：景别放大并对准别的角色时，站位在远处的角色会被拍到画面外。
   * 站位本身整个镜头都在画面外的不算（检查另行提示）。
   * @returns {Set<number>} 实体标识集合；景别不放大时为空。
   */
  function framedOut(timeline, shotIndex) {
    const shot = timeline.shots[shotIndex];
    const hidden = new Set();
    if (!shot || shot.shotSizeInfo.zoom <= 1) return hidden;
    const frames = FRAME_SAMPLE_RATIOS.map((ratio) => buildFrame(timeline, shotIndex, shot.duration * ratio, { reducedMotion: true }));
    for (const actor of shot.actors) {
      if (actor.kind !== 'character' || !actor.isPlaced) continue;
      const { fromX, toX } = actor.slot;
      if (fromX === toX && (fromX === 'off_left' || fromX === 'off_right')) continue;
      const outside = frames.every((frame) => {
        const sampled = frame.actors.find((item) => item.entityId === actor.entityId);
        if (!sampled) return false;
        const { zoom, offsetX, centerX } = frame.camera;
        const screenX = 0.5 + offsetX + (sampled.x - centerX) * zoom;
        return screenX < -FRAME_MARGIN || screenX > 1 + FRAME_MARGIN;
      });
      if (outside) hidden.add(actor.entityId);
    }
    return hidden;
  }

  /** 位置与朝向的一句话描述，用于无障碍摘要与信息栏。 */
  function describeActor(actor) {
    if (!actor.isPlaced) return `${actor.name}（没有站位）`;
    const { fromX, fromDepth, toX, toDepth } = actor.slot;
    const facing = LABELS.facing[actor.facing];
    const origin = `${LABELS.x[fromX]}${LABELS.depth[fromDepth]}`;
    if (!actor.isMoving) return `${actor.name}在${origin}，${facing}`;
    return `${actor.name}从${origin}走到${LABELS.x[toX]}${LABELS.depth[toDepth]}，${facing}`;
  }

  /** 一个镜头的摘要：序号、场景与角色调度，用作画布的无障碍文字。 */
  function summarizeShot(shot) {
    const parts = [`第 ${shot.seq} 镜`, shot.scene.name];
    for (const actor of shot.actors) if (actor.kind === 'character') parts.push(describeActor(actor));
    return parts.join('，');
  }

  window.aiStoryboardTimeline = {
    LABELS,
    X_ORDER,
    DEPTH_ORDER,
    X_FRACTION,
    DEPTH_STAGE,
    compile,
    sampleFrame,
    locate,
    position,
    restore,
    parseAspectRatio,
    parseCamera,
    parseTransition,
    parseShotSize,
    classifyScene,
    classifyProp,
    classifyEffect,
    classifyCharacter,
    classifyCharacterDetail,
    classifyHuman,
    buildTopView,
    comparePanels,
    framedOut,
    describeActor,
    summarizeShot,
    isVoice
  };
})();
