// ------------------------------------------------------------------------
// 名称：sidebar-status.ts
// 说明：侧栏底部状态条的内容模型：根据数据库可用性和已启用模型数生成状态条目，文案与状态等级只在此处定义。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：页面脚本按条目 id 刷新文案，字段需与 resources/sidebar/sidebar.js 一致。
// ------------------------------------------------------------------------

import { ProviderRepository } from '../domain/ports/provider-repository';
import { SidebarIconName } from './sidebar-icons';

/** 状态等级：正常、需要留意、不可用；页面除颜色外还以文字表达状态。 */
export type SidebarStatusLevel = 'normal' | 'warning' | 'error';

/** 状态条的一个条目。 */
export interface SidebarStatusEntry {
  /** 条目标识，页面刷新时据此定位。 */
  readonly id: 'database' | 'models';
  readonly icon: SidebarIconName;
  readonly label: string;
  readonly value: string;
  readonly level: SidebarStatusLevel;
}

/** 读取当前状态条目；每次调用都返回最新状态。 */
export type SidebarStatusReader = () => readonly SidebarStatusEntry[];

/** 生成状态条目所需的数据。 */
export interface SidebarStatusInput {
  /** 数据库是否可用；为 false 时扩展处于降级模式。 */
  readonly databaseReady: boolean;
  /** 已启用的模型数；数据库不可用时无法读取，传入 undefined。 */
  readonly enabledModelCount?: number;
}

/**
 * 生成侧栏状态条目。
 * @param input 数据库可用性与已启用模型数。
 * @returns 按显示顺序排列的状态条目；数据库不可用时不含模型条目。
 */
export function buildSidebarStatus(input: SidebarStatusInput): readonly SidebarStatusEntry[] {
  const database: SidebarStatusEntry = {
    id: 'database',
    icon: 'database',
    label: '数据库',
    value: input.databaseReady ? '正常' : '不可用',
    level: input.databaseReady ? 'normal' : 'error'
  };
  if (!input.databaseReady || input.enabledModelCount === undefined) {
    return [database];
  }

  const hasModels = input.enabledModelCount > 0;
  return [
    database,
    {
      id: 'models',
      icon: 'brain',
      label: '模型',
      value: hasModels ? `已启用 ${input.enabledModelCount} 个` : '尚未启用',
      level: hasModels ? 'normal' : 'warning'
    }
  ];
}

/**
 * 统计已启用的模型数：服务商和模型都处于启用状态才计入。
 * @param repository 服务商与模型的存储。
 */
export function countEnabledModels(repository: Pick<ProviderRepository, 'listProviders' | 'listModels'>): number {
  return repository
    .listProviders()
    .filter((provider) => provider.isEnabled)
    .reduce((total, provider) => total + repository.listModels({ providerId: provider.id }).filter((model) => model.isEnabled).length, 0);
}
