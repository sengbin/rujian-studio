// ------------------------------------------------------------------------
// 名称：tab-state.ts
// 说明：标签状态：有序的标签列表与当前激活的标签，提供打开、激活、关闭和循环切换。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯逻辑，不依赖 DOM，便于测试；同一键只保留一个标签。
// ------------------------------------------------------------------------

import { TabDescriptor } from '../app/shell/shell-channels';

/** 标签状态。 */
export class TabState {
  private readonly tabs: TabDescriptor[] = [];
  private activeKey: string | undefined;

  /** 按显示顺序排列的标签。 */
  list(): readonly TabDescriptor[] {
    return this.tabs;
  }

  /** 当前激活的标签键；没有标签时为 undefined。 */
  get active(): string | undefined {
    return this.activeKey;
  }

  has(key: string): boolean {
    return this.tabs.some((tab) => tab.key === key);
  }

  /**
   * 打开标签并激活；同一键已存在时只激活，不重复添加。
   * @returns 是否新增了标签。
   */
  open(tab: TabDescriptor): boolean {
    const isNew = !this.has(tab.key);
    if (isNew) {
      this.tabs.push(tab);
    }
    this.activeKey = tab.key;
    return isNew;
  }

  /** 激活已有标签。 @returns 该键的标签是否存在。 */
  activate(key: string): boolean {
    if (!this.has(key)) {
      return false;
    }
    this.activeKey = key;
    return true;
  }

  /** 关闭标签；关闭的是当前标签时，激活右侧相邻标签，没有则激活左侧。 @returns 该键的标签是否存在。 */
  close(key: string): boolean {
    const index = this.tabs.findIndex((tab) => tab.key === key);
    if (index < 0) {
      return false;
    }
    this.tabs.splice(index, 1);
    if (this.activeKey === key) {
      this.activeKey = (this.tabs[index] ?? this.tabs[index - 1])?.key;
    }
    return true;
  }

  /** 按顺序循环切换到下一个（1）或上一个（-1）标签；少于两个标签时不变。 */
  cycle(step: 1 | -1): void {
    if (this.tabs.length < 2 || this.activeKey === undefined) {
      return;
    }
    const index = this.tabs.findIndex((tab) => tab.key === this.activeKey);
    this.activeKey = this.tabs[(index + step + this.tabs.length) % this.tabs.length].key;
  }
}
