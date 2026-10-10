// ------------------------------------------------------------------------
// 名称：storyboard.ts
// 说明：分镜脚本阶段的领域模型：生成参数、镜头与镜头声音的草稿与已保存记录、用户编辑提交的内容。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：对应 storyboard_scripts、shots、shot_entities、shot_sounds、shot_first_frames 表；镜头引用实体用实体标识，不用名称。
// ------------------------------------------------------------------------

import { EntityKind } from './screenplay';

/** 镜头声音的类型：角色对白、旁白、音效、背景音乐。 */
export type SoundKind = 'dialogue' | 'narration' | 'sfx' | 'music';

/** 声音类型的界面名称，顺序即界面与提示词中的顺序。 */
export const SOUND_KIND_LABELS: Readonly<Record<SoundKind, string>> = {
  dialogue: '角色对白',
  narration: '旁白',
  sfx: '音效',
  music: '背景音乐'
};

/** 画面横向位置（以观众看到的画面为准）：左、中、右，以及从画面外进入、走出画面的位置。 */
export type StageX = 'off_left' | 'left' | 'center' | 'right' | 'off_right';

/** 画面纵深位置：靠近镜头（前景）、中景、远离镜头（背景）。 */
export type StageDepth = 'front' | 'middle' | 'back';

/** 朝向（以观众看到的画面为准）：面向镜头、背对镜头、面朝画面左侧、面朝画面右侧。 */
export type StageFacing = 'camera' | 'away' | 'left' | 'right';

/** 横向位置的界面名称，顺序即界面与提示词中的顺序。 */
export const STAGE_X_LABELS: Readonly<Record<StageX, string>> = {
  off_left: '画面左外',
  left: '画面左侧',
  center: '画面中央',
  right: '画面右侧',
  off_right: '画面右外'
};

/** 纵深位置的界面名称。 */
export const STAGE_DEPTH_LABELS: Readonly<Record<StageDepth, string>> = {
  front: '前景',
  middle: '中景',
  back: '背景'
};

/** 朝向的界面名称。 */
export const STAGE_FACING_LABELS: Readonly<Record<StageFacing, string>> = {
  camera: '面向镜头',
  away: '背对镜头',
  left: '面朝画面左侧',
  right: '面朝画面右侧'
};

/**
 * 一个实体在镜头里的站位与调度：起点、终点（不填表示不移动）、朝向与动作。
 * 角色、道具、特效都可以有；场景是整个背景，不需要站位。起点或终点可以在画面外，表示从画面外进入或走出画面。
 */
export interface ShotStaging {
  /** 实体标识，必须在本镜头的出场实体里。 */
  readonly entityId: number;
  readonly startX: StageX | null;
  readonly startDepth: StageDepth | null;
  /** 终点；两项都为空表示整个镜头里停在起点。 */
  readonly endX: StageX | null;
  readonly endDepth: StageDepth | null;
  readonly facing: StageFacing | null;
  /** 姿态或动作，如“坐在桌边”“端起茶杯”；可为空。 */
  readonly action: string;
}

/** 镜头首帧来源：无、上一镜头尾帧、指定资产图、指定本地图片（后两种只能由用户在镜头编辑里指定，生成不会产出）。 */
export type FirstFrameMode = 'none' | 'prev_tail' | 'asset' | 'image';

/** 镜头连贯策略：组间硬切（不用尾帧，靠切换景别和机位衔接）；无；尾帧接首帧；由模型逐个镜头判断。 */
export type ContinuityStrategy = 'cut' | 'none' | 'prev_tail' | 'ai';

/** 声音模式：无声；模型原生生成。 */
export type AudioMode = 'none' | 'native';

/** 分镜脚本阶段的生成参数，已经过规范化。 */
export interface StoryboardParams {
  /** 本次生成自定义的画面风格；null 表示沿用项目视觉风格（项目也没有设置时不指定风格）。 */
  readonly visualStyle: string | null;
  /** 单镜头最短、最长时长（秒），null 表示不限制。 */
  readonly minShotSeconds: number | null;
  readonly maxShotSeconds: number | null;
  /** 单个镜头组的总时长上限（秒）：相邻镜头按顺序打包成一组，一组一次生成一个视频；应不超过目标视频模型的单次最长时长。 */
  readonly groupMaxSeconds: number;
  /** 镜头总数上限，null 表示使用系统上限。 */
  readonly maxShots: number | null;
  readonly continuity: ContinuityStrategy;
  readonly audioMode: AudioMode;
  /** 需要生成的声音类型；声音模式为无声时为空。 */
  readonly audioElements: readonly SoundKind[];
  readonly extra: string | null;
}

/** 一条镜头声音。 */
export interface SoundDraft {
  readonly kind: SoundKind;
  /** 说话人实体，仅角色对白使用。 */
  readonly speakerEntityId: number | null;
  readonly text: string;
  readonly delivery: string;
  readonly startOffsetSeconds: number | null;
  readonly durationSeconds: number | null;
  readonly isEnabled: boolean;
}

/** 一个镜头的内容（不含标识）。 */
export interface ShotDraft {
  readonly seq: number;
  readonly sceneLabel: string;
  readonly shotSize: string;
  readonly cameraAngle: string;
  readonly cameraMovement: string;
  readonly durationSeconds: number;
  readonly transition: string;
  readonly continuityNote: string;
  readonly firstFrameMode: FirstFrameMode;
  /** 首帧来源为指定资产图时的资产标识（取该资产的第一张参考图）；其他来源为 null，资产被删除后也为 null。 */
  readonly firstFrameAssetId: number | null;
  /** 出场实体标识，已去重；对白的说话人一定在其中。 */
  readonly entityIds: readonly number[];
  /** 出场实体的站位与调度，每个实体最多一条，没有填写站位的实体不出现。 */
  readonly staging: readonly ShotStaging[];
  readonly sounds: readonly SoundDraft[];
  /** 画面描述：镜头的中文视频提示词，必填；列表标题、分批衔接和发给视频模型的画面正文都用它。 */
  readonly prompt: string;
}

/** 已保存的声音条目。 */
export interface SoundRecord extends SoundDraft {
  readonly id: number;
}

/** 镜头指定的首帧图片（首帧来源为“指定图片”）：文件内容保存在本地，这里只有说明信息。 */
export interface ShotFirstFrameImage {
  readonly id: number;
  readonly fileName: string;
  readonly mime: string;
  /** 像素宽高；上传时页面没有读到为 null。 */
  readonly width: number | null;
  readonly height: number | null;
  readonly sizeBytes: number;
}

/** 用户新选择的首帧图片，已校验为受支持的图片格式。 */
export interface NewShotFirstFrameImage {
  readonly fileName: string;
  readonly mime: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly content: Uint8Array;
}

/** 已保存的镜头。 */
export interface ShotRecord extends Omit<ShotDraft, 'sounds'> {
  readonly id: number;
  readonly sounds: readonly SoundRecord[];
  /** 首帧来源为“指定图片”时保存的图片；其他情况为 null。 */
  readonly firstFrameImage: ShotFirstFrameImage | null;
}

/** 一条阶段记录对应的分镜脚本。 */
export interface StoryboardScript {
  readonly id: number;
  readonly runId: number;
  readonly episodeId: number;
}

/**
 * 用户编辑一个镜头后提交的内容：镜头序号不能修改，声音整体替换。
 * 首帧来源为“指定图片”时：带 firstFrameImage 表示换成这张新图片，不带表示保留已保存的图片；其他首帧来源会删除已保存的图片。
 */
export type ShotEdit = Omit<ShotDraft, 'seq'> & { readonly firstFrameImage?: NewShotFirstFrameImage };

/** 镜头组：序号相邻的若干镜头，作为一次视频生成的单位。 */
export interface ShotGroup {
  readonly id: number;
  readonly seq: number;
  /** 组内镜头标识，按镜头序号升序。 */
  readonly shotIds: readonly number[];
}

/** 分组布局中的一组：groupId 为 null 表示新建的组；布局中没有出现的已有组会被删除。 */
export interface GroupLayoutEntry {
  readonly groupId: number | null;
  readonly shotIds: readonly number[];
}

/** 生成分镜脚本时可供镜头引用的实体。 */
export interface StoryboardEntity {
  readonly id: number;
  readonly kind: EntityKind;
  readonly name: string;
  readonly aliases: readonly string[];
}
