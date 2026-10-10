// ------------------------------------------------------------------------
// 名称：sidebar-menu-config.ts
// 说明：侧栏菜单的结构与文案配置，页面按该配置渲染分区和菜单行；含数据库无法打开时的降级菜单。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：仅描述展示内容（含图标名称），不包含任何交互行为；图标定义见 sidebar-icons.ts。
// ------------------------------------------------------------------------

import { SidebarIconName } from './sidebar-icons';

/** 尾部“创建”“添加”操作使用的图标。 */
const ADD_ACTION_ICON: SidebarIconName = 'plus';

/** 侧栏菜单行：一个主入口，可带一个尾部次要操作。 */
export interface SidebarMenuItem {
  readonly id: string;
  /** 主入口文案。 */
  readonly title: string;
  /** 主入口标题前的图标。 */
  readonly icon: SidebarIconName;
  /** 尾部次要操作文案；缺省表示该行没有尾部操作。 */
  readonly actionLabel?: string;
  /** 尾部次要操作文案前的图标；缺省表示不显示图标。 */
  readonly actionIcon?: SidebarIconName;
  /** 标题后的小标签，如“预览”；缺省表示不显示。 */
  readonly badge?: string;
}

/** 分区的表面样式：stage 带阴影（亮主题），flat 无阴影。 */
export type SidebarSectionSurface = 'stage' | 'flat';

/** 侧栏分区：一个标题和一组菜单行。 */
export interface SidebarMenuSection {
  readonly id: string;
  readonly title: string;
  /** 分区标题前的图标。 */
  readonly icon: SidebarIconName;
  readonly surface: SidebarSectionSurface;
  readonly items: readonly SidebarMenuItem[];
}

/** 侧栏菜单分区，按制作顺序从上到下排列：项目、创作、脚本、资产、视频、设置。 */
export const SIDEBAR_SECTIONS: readonly SidebarMenuSection[] = [
  {
    id: 'project',
    title: '项目',
    icon: 'folder',
    surface: 'flat',
    items: [{ id: 'project-list', title: '所有项目', icon: 'folders', actionLabel: '创建', actionIcon: ADD_ACTION_ICON }]
  },
  {
    id: 'creation',
    title: '创作',
    icon: 'wand',
    surface: 'stage',
    items: [
      { id: 'text-inspiration', title: '文字灵感', icon: 'bulb', actionLabel: '添加', actionIcon: ADD_ACTION_ICON },
      { id: 'image-inspiration', title: '图片灵感', icon: 'photo', actionLabel: '添加', actionIcon: ADD_ACTION_ICON },
      { id: 'novel-adaptation', title: '小说改编', icon: 'book', actionLabel: '添加', actionIcon: ADD_ACTION_ICON },
      { id: 'original-manuscript', title: '原创文稿', icon: 'pencil', actionLabel: '添加', actionIcon: ADD_ACTION_ICON }
    ]
  },
  {
    id: 'script',
    title: '脚本',
    icon: 'file-text',
    surface: 'stage',
    items: [
      { id: 'screenplay', title: '剧本', icon: 'script', actionLabel: '添加', actionIcon: ADD_ACTION_ICON },
      { id: 'storyboard-script', title: '分镜', icon: 'layout-board', actionLabel: '添加', actionIcon: ADD_ACTION_ICON }
    ]
  },
  {
    id: 'asset',
    title: '资产',
    icon: 'packages',
    surface: 'stage',
    items: [
      { id: 'character', title: '角色', icon: 'user', actionLabel: '添加', actionIcon: ADD_ACTION_ICON },
      { id: 'scene', title: '场景', icon: 'mountain', actionLabel: '添加', actionIcon: ADD_ACTION_ICON },
      { id: 'prop', title: '道具', icon: 'box', actionLabel: '添加', actionIcon: ADD_ACTION_ICON },
      { id: 'effect', title: '特效', icon: 'sparkles', actionLabel: '添加', actionIcon: ADD_ACTION_ICON },
      { id: 'audio', title: '音频', icon: 'music', actionLabel: '添加', actionIcon: ADD_ACTION_ICON }
    ]
  },
  {
    id: 'video',
    title: '视频',
    icon: 'movie',
    surface: 'stage',
    items: [{ id: 'video-workbench', title: '生成工作台', icon: 'video' }]
  },
  {
    id: 'settings',
    title: '设置',
    icon: 'settings',
    surface: 'flat',
    items: [
      { id: 'model-settings', title: '模型', icon: 'brain' },
      { id: 'data-backup', title: '数据备份', icon: 'database-export' }
    ]
  }
];

/** 数据库无法打开时的降级侧栏：只保留数据备份入口（用于恢复），条目标识与完整菜单中的“数据备份”相同，点击后打开同一个数据备份页。 */
export const DEGRADED_SIDEBAR_SECTIONS: readonly SidebarMenuSection[] = [
  {
    id: 'settings',
    title: '设置',
    icon: 'settings',
    surface: 'flat',
    items: [{ id: 'data-backup', title: '数据备份（恢复）', icon: 'database-export' }]
  }
];

/** 数据库无法打开时，侧栏顶部提示的前缀，后接具体原因。 */
export const DATABASE_UNAVAILABLE_NOTICE_PREFIX = '数据库无法打开：';