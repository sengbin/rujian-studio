// ------------------------------------------------------------------------
// 名称：adaptation-checklist-repository.ts
// 说明：结构性改编清单数据访问的端口接口：剧本阶段保存模型给出的取舍项，用户勾选后保存选择并确认。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：同步调用；清单挂在剧本阶段记录下，随阶段记录一并删除。
// ------------------------------------------------------------------------

import { AdaptationChecklist } from '../models/adaptation-checklist';

/** 改编清单的数据访问接口。 */
export interface AdaptationChecklistRepository {
  /** 读取阶段记录的改编清单；没有时返回 undefined。 */
  find(runId: number): AdaptationChecklist | undefined;
  /** 保存清单（含取舍项）；已存在时整体覆盖，确认状态随传入内容。 */
  save(checklist: AdaptationChecklist): void;
  /** 按被勾选的取舍项标识更新勾选状态；清单不存在时返回 false。 */
  updateSelection(runId: number, selectedIds: ReadonlySet<string>, timestamp: string): boolean;
  /** 记录用户确认采用；清单不存在时返回 false。 */
  confirm(runId: number, timestamp: string): boolean;
}
