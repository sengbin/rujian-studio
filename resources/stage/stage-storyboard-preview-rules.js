// ------------------------------------------------------------------------
// 名称：stage-storyboard-preview-rules.js
// 说明：分镜动画的关键词归类规则（纯逻辑）：运镜、景别、转场，场景的地点与时间，道具与特效的图形，角色的种类、性别与年龄；规则表是“先到先得”，具体的词排在笼统的词之前。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：不依赖 DOM，通过 window.aiStoryboardRules 暴露，timeline 再原样导出这些归类函数；单字词只认名称末字（人名样式的名称除外），设定里要有“是/一只…”这类引导词，规则见 private-docs/rujian-studio/开发文档-vscode/storyboard-animation-design.md 第 6 节；对应的图形在 stage-storyboard-preview-art/props/creatures/bestiary.js 里登记。
// ------------------------------------------------------------------------

'use strict';

(function () {
  /** 运镜关键词，按先后顺序匹配：明确的镜头运动在前，跟拍在“后退”之前，“固定”放在最后（“固定机位缓慢推近”按推近算）。 */
  const CAMERA_RULES = [
    { type: 'zoomIn', words: ['推近', '推进', '拉近', '推镜'] },
    { type: 'follow', words: ['跟拍', '跟随'] },
    { type: 'zoomOut', words: ['拉远', '拉开', '后退', '拉镜'] },
    { type: 'panLeft', words: ['左摇'] },
    { type: 'panRight', words: ['右摇'] },
    { type: 'tiltUp', words: ['上摇'] },
    { type: 'tiltDown', words: ['下摇'] },
    { type: 'orbit', words: ['环绕'] },
    { type: 'handheld', words: ['手持'] },
    { type: 'static', words: ['固定', '静止'] }
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
    { setting: 'classroom', words: ['教室', '课堂', '学校', '课室', '讲堂', '教学楼', '学院'] },
    { setting: 'shop', words: ['商店', '超市', '商场', '店铺', '便利店', '杂货', '书店', '药店', '饭店', '餐馆', '咖啡厅', '咖啡馆', '酒吧', '酒馆'] },
    { setting: 'space', words: ['太空', '宇宙', '星球', '飞船', '星际', '月球', '空间站'] },
    { setting: 'underwater', words: ['海底', '水下', '深海', '水底', '龙宫'] },
    { setting: 'sky', words: ['天空', '云端', '云海', '天宫', '天界', '仙境', '空中'] },
    // “洞房”是屋里，要排在笼统的“洞”之前
    { setting: 'indoor', words: ['洞房'] },
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

  /**
   * 道具与会说话的物品（花、草、树、石头、箱子等当角色）归类为要绘制的图形，按先后顺序匹配，具体的名称在前，避免被后面笼统的字（锅、柜、光、茶、座、书）抢先。
   * words 是道具和角色都认的词；propWords 只有道具认：角色名里单字词（花、石等）常出现在人名里，所以角色只认 words 里的多字词，单字词只在名称就是它本身，或设定里写“一朵花”“是一块石头”时才算。
   */
  const OBJECT_RULES = [
    { glyph: 'fridge', words: ['冰箱'], propWords: ['冰柜', '冷柜'] },
    { glyph: 'aircon', words: ['空调'], propWords: ['暖气'] },
    { glyph: 'washer', words: ['洗衣机', '洗碗机'], propWords: ['烘干机'] },
    { glyph: 'microwave', words: ['微波炉', '烤箱'], propWords: ['烤炉', '蒸箱'] },
    { glyph: 'fan', words: ['风扇', '电扇'], propWords: ['吊扇', '排气扇'] },
    { glyph: 'hood', words: ['油烟机'], propWords: ['抽油烟', '排油烟', '抽烟机'] },
    { glyph: 'stove', words: ['灶台', '燃气灶', '电磁炉'], propWords: ['煤气灶', '灶'] },
    { glyph: 'sink', words: ['水槽', '洗手池', '脸盆'], propWords: ['洗手台', '洗碗池', '洗脸盆', '洗手盆', '水池'] },
    { glyph: 'faucet', words: [], propWords: ['水龙头', '龙头', '水管'] },
    { glyph: 'toilet', words: ['马桶'], propWords: ['坐便', '便器'] },
    { glyph: 'bathtub', words: ['浴缸'], propWords: ['浴盆', '澡盆'] },
    { glyph: 'shower', words: [], propWords: ['淋浴', '花洒'] },
    { glyph: 'towel', words: ['毛巾', '浴巾'] },
    { glyph: 'bomb', words: ['炸弹'], propWords: ['炸药', '火药', '手雷', '地雷', '雷管', '手榴弹'] },
    { glyph: 'rocket', words: ['火箭', '导弹'], propWords: ['飞弹', '卫星'] },
    { glyph: 'cannon', words: ['大炮'], propWords: ['火炮', '炮'] },
    { glyph: 'pan', words: ['平底锅', '炒锅'], propWords: ['煎锅'] },
    { glyph: 'knife', words: ['菜刀'], propWords: ['水果刀', '厨刀', '餐刀'] },
    { glyph: 'board', words: ['砧板'], propWords: ['案板', '菜板'] },
    { glyph: 'cutlery', words: ['刀叉', '叉子', '勺子', '筷子'], propWords: ['餐具', '筷', '勺', '汤匙', '茶匙'] },
    { glyph: 'bowl', words: ['碗', '饭碗', '瓷碗'], propWords: ['钵'] },
    // “键盘”不是盘子，要排在笼统的“盘”之前
    { glyph: 'generic', words: [], propWords: ['键盘'] },
    { glyph: 'plate', words: ['盘子', '碟子'], propWords: ['盘', '碟'] },
    { glyph: 'kettle', words: ['壶', '水壶', '茶壶', '开水壶'], propWords: ['热水壶', '咖啡壶'] },
    { glyph: 'cabinet', words: ['衣柜', '书柜', '橱柜', '柜子'], propWords: ['鞋柜', '酒柜', '药柜', '壁橱', '抽屉'] },
    { glyph: 'sofa', words: ['沙发'], propWords: ['躺椅'] },
    { glyph: 'bench', words: ['长椅', '长凳'], propWords: ['条凳'] },
    { glyph: 'shelf', words: ['书架', '架子'], propWords: ['货架', '置物架', '衣架', '展架'] },
    { glyph: 'medicine', words: ['药瓶', '药丸'], propWords: ['药', '针管', '注射器'] },
    { glyph: 'bottle', words: ['酒瓶', '奶瓶'], propWords: ['玻璃瓶', '饮料瓶'] },
    { glyph: 'cake', words: ['蛋糕'] },
    { glyph: 'food', words: ['面包', '苹果', '包子', '饺子', '汉堡', '饼干'], propWords: ['水果', '食物', '米饭', '饭菜', '蔬菜', '肉', '饼', '糖果', '面条', '香蕉', '橙子', '西瓜', '披萨', '零食', '点心', '馒头'] },
    { glyph: 'bone', words: ['骨头'], propWords: ['骷髅', '骸骨'] },
    { glyph: 'suitcase', words: ['行李箱', '皮箱', '手提箱'], propWords: ['旅行箱', '拉杆箱', '公文包'] },
    { glyph: 'clothes', words: ['衣服', '外套', '衬衫', '裙子', '鞋子', '袜子'], propWords: ['裙', '裤', '鞋', '袜', '披风', '斗篷', '围巾', '手套'] },
    { glyph: 'glasses', words: ['眼镜'], propWords: ['墨镜'] },
    { glyph: 'telescope', words: ['望远镜', '显微镜', '放大镜'] },
    { glyph: 'trophy', words: ['奖杯'], propWords: ['奖牌', '奖章', '勋章'] },
    { glyph: 'speaker', words: ['音响', '音箱', '喇叭', '收音机'], propWords: ['麦克风', '话筒'] },
    { glyph: 'camera', words: ['相机', '摄像机'], propWords: ['摄像', '摄影机', '照相机'] },
    { glyph: 'socket', words: [], propWords: ['插座', '开关', '插头'] },
    { glyph: 'flashlight', words: ['手电筒'], propWords: ['手电', '电筒', '探照灯'] },
    { glyph: 'lantern', words: ['灯笼'], propWords: ['宫灯', '孔明灯'] },
    { glyph: 'chandelier', words: ['吊灯', '水晶灯'], propWords: ['吸顶灯', '顶灯', '花灯'] },
    { glyph: 'campfire', words: ['篝火'], propWords: ['营火', '火堆'] },
    { glyph: 'candle', words: ['烛', '蜡烛'], propWords: ['烛台', '火把', '火炬'] },
    { glyph: 'fireplace', words: ['壁炉'], propWords: ['火塘'] },
    { glyph: 'curtain', words: ['窗帘'], propWords: ['门帘', '帘', '幕布'] },
    { glyph: 'carpet', words: ['地毯'], propWords: ['毛毯', '地垫', '毯'] },
    { glyph: 'blackboard', words: ['黑板'], propWords: ['白板', '公告栏', '展板'] },
    { glyph: 'bridge', words: [], propWords: ['桥'] },
    { glyph: 'well', words: ['水井'], propWords: ['井'] },
    { glyph: 'pillar', words: ['柱子', '石柱'], propWords: ['柱'] },
    { glyph: 'bow', words: ['弓箭', '长弓'], propWords: ['弓'] },
    { glyph: 'arrow', words: [], propWords: ['箭', '飞镖', '标枪'] },
    { glyph: 'shield', words: ['盾牌'], propWords: ['盾'] },
    { glyph: 'tool', words: ['扳手', '锤子'], propWords: ['锤', '锯', '锄', '铲', '镐', '钳', '螺丝刀', '工具'] },
    { glyph: 'rope', words: ['绳子'], propWords: ['绳', '锁链', '铁链', '链条'] },
    { glyph: 'bed', words: ['床', '枕头'], propWords: ['榻'] },
    { glyph: 'table', words: ['桌', '桌子', '茶几', '书桌'], propWords: ['柜台', '吧台', '讲台', '工作台', '案'] },
    // “座钟”不是座椅，钟表要排在笼统的“座”之前
    { glyph: 'clock', words: ['沙漏', '闹钟', '时钟', '钟表', '怀表', '座钟'], propWords: ['钟', '表'] },
    { glyph: 'chair', words: ['椅', '凳', '椅子', '凳子'], propWords: ['座'] },
    { glyph: 'door', words: ['门', '大门', '房门'] },
    { glyph: 'window', words: ['窗', '窗户'] },
    { glyph: 'tower', words: ['灯塔', '塔', '高塔'] },
    { glyph: 'light', words: ['灯', '台灯', '路灯'] },
    { glyph: 'weapon', words: ['剑', '匕首', '宝剑', '长剑'], propWords: ['刀', '枪', '斧', '棍'] },
    // “书包”不是书，要排在笼统的“书”之前；“纸箱”要排在“纸”之前
    { glyph: 'bag', words: ['背包', '书包', '行李', '包裹'], propWords: ['口袋'] },
    { glyph: 'box', words: ['箱', '盒', '箱子', '盒子', '宝箱', '木箱', '纸箱'], propWords: ['柜', '包', '袋', '匣', '篮'] },
    { glyph: 'book', words: ['书', '书本', '日记本', '笔记本', '纸条'], propWords: ['信', '纸', '卷', '报', '日记', '地图'] },
    { glyph: 'vehicle', words: ['车', '飞机', '汽车', '马车', '小船'], propWords: ['船', '舟'] },
    // “酒桶”要排在笼统的“酒”之前
    { glyph: 'barrel', words: ['桶', '木桶', '水桶', '罐子', '酒桶'], propWords: ['罐', '缸', '坛'] },
    { glyph: 'cup', words: ['杯', '瓶', '杯子', '水杯', '茶杯', '酒杯', '瓶子', '花瓶'], propWords: ['酒', '茶'] },
    // “仙人球”要排在“球”之前，“水晶球”要排在“水晶”（宝石）之前
    { glyph: 'cactus', words: ['仙人掌', '仙人球'] },
    { glyph: 'ball', words: ['球', '水晶球', '皮球', '气球'] },
    { glyph: 'gem', words: ['宝石', '钻石', '水晶', '金币'], propWords: ['银币', '硬币', '钱', '珠', '宝'] },
    { glyph: 'stone', words: ['石', '岩', '石头', '岩石', '鹅卵石', '石像', '石碑', '石块'], propWords: ['雕像', '塑像'] },
    { glyph: 'flower', words: ['花', '向日葵', '玫瑰', '牡丹', '荷花', '菊花', '花朵', '花儿', '鲜花'] },
    { glyph: 'grass', words: ['草', '藤', '小草', '野草', '青草', '竹子', '藤蔓'], propWords: ['竹'] },
    { glyph: 'mushroom', words: ['蘑菇', '菇', '菌', '毒蝇伞'] },
    { glyph: 'plant', words: ['盆栽', '植物'] },
    { glyph: 'screen', words: ['电脑', '显示器', '电视机'], propWords: ['电视', '屏幕', '屏'] },
    { glyph: 'phone', words: ['手机', '电话'] },
    { glyph: 'mirror', words: ['镜子', '魔镜'], propWords: ['镜'] },
    { glyph: 'key', words: ['钥匙'], propWords: ['钥'] },
    { glyph: 'umbrella', words: ['伞', '雨伞'] },
    { glyph: 'flag', words: ['旗', '旗帜', '旗子'] },
    { glyph: 'tent', words: ['帐篷'], propWords: ['帐'] },
    { glyph: 'sign', words: ['牌', '招牌', '路牌', '牌子'], propWords: ['碑'] },
    { glyph: 'instrument', words: ['琴', '吉他', '鼓', '钢琴', '小提琴', '笛子'], propWords: ['笛', '号'] },
    { glyph: 'pot', words: ['锅', '铁锅', '火炉', '炉子'], propWords: ['炉', '鼎'] },
    { glyph: 'crown', words: ['皇冠', '王冠'], propWords: ['冠', '帽'] },
    { glyph: 'fence', words: ['栅栏', '围栏', '篱笆'], propWords: ['栏杆', '墙'] },
    { glyph: 'stairs', words: ['楼梯', '台阶'], propWords: ['梯'] },
    { glyph: 'castle', words: ['城堡'], propWords: ['宫殿', '城'] },
    { glyph: 'house', words: ['房子', '小屋', '木屋'], propWords: ['房屋', '屋'] },
    { glyph: 'tree', words: ['树', '木', '大树', '古树', '老树', '树木', '松树', '柳树', '枫树', '榕树'] },
    { glyph: 'generic', words: ['玩具', '玩偶', '布偶', '物品', '物体', '东西'] }
  ];

  /** 特效归类关键词（按先后顺序匹配名称）：爆炸、烟花、发射、光束与影子等具体的在前，避免被后面笼统的“火”“烟”“光”抢先。 */
  const EFFECT_RULES = [
    { glyph: 'explosion', words: ['爆', '炸', '蘑菇云', '轰'] },
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

  /** 人的年龄与性别关键词：名称里按包含判断，设定里只看开头的几个明确的词（见 classifyHuman）。 */
  const HUMAN_AGE_RULES = [
    { age: 'baby', words: ['婴儿', '婴孩', '宝宝', '襁褓', '奶娃', '新生儿'] },
    { age: 'elder', words: ['老人', '老爷爷', '老奶奶', '爷爷', '奶奶', '老头', '老太', '老婆婆', '老妇', '老翁', '外公', '外婆', '祖父', '祖母', '长者', '老先生', '老者', '婆婆', '白发'] },
    { age: 'child', words: ['小孩', '孩子', '儿童', '男孩', '女孩', '小朋友', '小学生', '幼儿', '娃娃'] },
    { age: 'teen', words: ['少年', '少女', '中学生', '学生', '青少年'] }
  ];
  const HUMAN_GENDER_RULES = [
    // “姐夫”“姑父”是男性，要排在含“姐”“姑”的女性词之前
    { gender: 'male', words: ['姐夫', '妹夫', '姑父', '姑夫', '姨夫', '姨父'], hintWords: [] },
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
   * 单字关键词（马、牛、熊等容易是人的姓氏）只在作为名称最后一个字或名称本身时才算，姓氏开头的短名称（李燕、王虎）按人名处理；设定只看开头和“是/一只…”之后，避免“猎杀怪物的人”被当成怪物。
   * 带 glyph 的条目是会说话的物品（species 为 thing），要排在容易抢先的词（“仙人”）之前。
   */
  const SPECIES_RULES = [
    { species: 'zombie', words: ['僵尸', '丧尸', '行尸', '尸鬼'] },
    { species: 'demon', words: ['恶魔', '魔鬼', '魔王', '魔神', '妖魔', '魔族', '撒旦', '恶鬼', '恶灵'] },
    { species: 'ghost', words: ['邪灵', '幽灵', '亡灵', '幽魂', '怨灵', '冤魂', '鬼魂', '鬼怪', '幽影', '鬼'] },
    { species: 'robot', words: ['机器人', '机械', '傀儡', '人工智能'] },
    { species: 'monster', words: ['怪物', '怪兽', '妖怪', '妖兽', '巨兽', '魔物', '异形', '哥布林', '食人魔', '巨人', '兽人', '巨龙', '恶龙', '神龙', '飞龙', '火龙', '冰龙'] },
    { species: 'thing', glyph: 'cactus', words: ['仙人掌', '仙人球'] },
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
  /** 人名样式：姓氏开头的 2 到 3 个字（不含白、黄、金、黑、红等常作动物毛色的字），这样的名称末字不当作动物（李燕、王虎、陈熊）。 */
  const SURNAME_CHARS = '王李张刘陈杨赵周吴徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾萧田董潘袁蔡蒋余于杜叶程魏苏吕丁任卢姜崔钟谭陆汪范廖贾夏韦付方邹熊孟秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
  const PERSON_NAME_MIN_CHARS = 2;
  const PERSON_NAME_MAX_CHARS = 3;

  /** 取第一条关键词命中的规则的值。 */
  function matchRule(rules, key, text, fallback) {
    const rule = rules.find((item) => item.words.some((word) => text.includes(word)));
    return rule ? rule[key] : fallback;
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

  /**
   * 解析转场文字。
   * @param {string} text 镜头的转场文字。
   * @returns {string} 类型：cut、dissolve、fadeOut、fadeIn、flash。
   */
  function parseTransition(text) {
    const label = text || '';
    if (label.includes('叠化')) return 'dissolve';
    if (label.includes('淡出')) return 'fadeOut';
    if (label.includes('淡入')) return 'fadeIn';
    if (label.includes('闪白')) return 'flash';
    return 'cut';
  }

  /**
   * 解析景别文字。
   * @param {string} text 镜头的景别文字。
   * @returns {{ zoom: number, label: string, supported: boolean }} 取景放大倍数；无法识别（或为空）时不放大，supported 为 false。
   */
  function parseShotSize(text) {
    const label = (text || '').trim();
    const rule = SHOT_SIZE_RULES.find((item) => item.words.some((word) => label.includes(word)));
    return { zoom: rule ? rule.zoom : 1, label, supported: Boolean(rule) };
  }

  /**
   * 场景归类：地点（室内、街道、森林、洞穴、海边、旷野或通用）与时间（白天、黄昏、清晨、夜晚）。
   * @param {string} text 场景名与场次文字。
   * @returns {{ setting: string, time: string }} 地点与时间。
   */
  function classifyScene(text) {
    const source = text || '';
    return { setting: matchRule(SCENE_SETTING_RULES, 'setting', source, 'generic'), time: matchRule(SCENE_TIME_RULES, 'time', source, 'day') };
  }

  /**
   * 道具归类为要绘制的图形名称。
   * @param {string} name 道具名称。
   * @returns {string} 图形名称；认不出时为 generic。
   */
  function classifyProp(name) {
    const text = name || '';
    const rule = OBJECT_RULES.find((item) => item.words.some((word) => text.includes(word)) || (item.propWords || []).some((word) => text.includes(word)));
    return rule ? rule.glyph : 'generic';
  }

  /**
   * 特效归类为要绘制的图形名称。
   * @param {string} name 特效名称。
   * @returns {string} 图形名称；认不出时为 spark。
   */
  function classifyEffect(name) {
    return matchRule(EFFECT_RULES, 'glyph', name || '', 'spark');
  }

  /** 名称是否像人名：姓氏开头的 2 到 3 个字。 */
  function looksLikePersonName(name) {
    return name.length >= PERSON_NAME_MIN_CHARS && name.length <= PERSON_NAME_MAX_CHARS && SURNAME_CHARS.includes(name[0]);
  }

  /**
   * 关键词是否命中：名称里多字词包含即可，单字词要作为名称最后一个字（人名样式的名称里只认名称本身）；设定里要出现在开头或“是/一只…”这类介绍身份的词之后。
   * isThing（物品与植物）更严格：单字词只能是名称本身，设定里只认“是/一朵/化身…”之后、且后面紧跟标点或结尾的词（“守着灯塔的老人”不是灯）。
   */
  function matchesSpecies(word, text, isHint, isThing) {
    if (isHint) {
      const pattern = isThing ? `${THING_HINT_LEAD}[^，。；;,.\\s]{0,6}${word}(?=$|[，。；;,.、\\s])` : `${SPECIES_HINT_LEAD}[^，。；;,.\\s]{0,5}${word}(?![的之们])`;
      return new RegExp(pattern).test(text.slice(0, SPECIES_HINT_CHARS));
    }
    if (word.length > 1) return text.includes(word);
    return text === word || (!isThing && !looksLikePersonName(text) && text.endsWith(word));
  }

  /**
   * 角色归类：人、动物（松鼠、刺猬、蝙蝠、鸟、猫、狗等）、奇幻生物（僵尸、神仙、精灵、怪物、邪灵、恶魔、机器人、软泥怪）或会说话的物品与植物（thing），决定画哪种形象。
   * @param {string} name 角色名，优先按它判断。
   * @param {string} [hint] 身份与设定的开头，名称里认不出时再看它。
   * @returns {{ species: string, glyph: string }} 种类名（认不出时为 human），glyph 只在 species 为 thing 时有值（要画的物品图形）。
   */
  function classifyCharacterDetail(name, hint) {
    for (const [text, isHint] of [[name || '', false], [hint || '', true]]) {
      const rule = SPECIES_RULES.find((item) => item.words.some((word) => matchesSpecies(word, text, isHint, false)));
      if (rule) return { species: rule.species, glyph: rule.glyph || '' };
      const thing = OBJECT_RULES.find((item) => item.words.some((word) => matchesSpecies(word, text, isHint, true)));
      if (thing) return { species: 'thing', glyph: thing.glyph };
    }
    return { species: 'human', glyph: '' };
  }

  /**
   * 人的性别与年龄：按名称里的称呼（妈妈、爷爷、小女孩、婴儿等）判断，名称里没有时再看设定开头的明确说法（女性、70 岁等）。
   * @param {string} name 角色名。
   * @param {string} [hint] 身份与设定的开头。
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

  window.aiStoryboardRules = {
    TABLES: {
      camera: CAMERA_RULES,
      shotSize: SHOT_SIZE_RULES,
      sceneTime: SCENE_TIME_RULES,
      sceneSetting: SCENE_SETTING_RULES,
      object: OBJECT_RULES,
      effect: EFFECT_RULES,
      species: SPECIES_RULES,
      humanGender: HUMAN_GENDER_RULES,
      humanAge: HUMAN_AGE_RULES
    },
    parseCamera,
    parseTransition,
    parseShotSize,
    classifyScene,
    classifyProp,
    classifyEffect,
    classifyCharacterDetail,
    classifyHuman
  };
})();
