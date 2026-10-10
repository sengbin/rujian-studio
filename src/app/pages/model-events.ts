// ------------------------------------------------------------------------
// 名称：model-events.ts
// 说明：可选模型变化的页面事件：在“模型设置”里启用或关闭模型、改访问密钥、换默认文本模型后，通知已打开的页面刷新表单与对话框里的模型下拉。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：事件名称需与 resources/form/form-runtime.js、resources/asset-list/asset-generate.js 一致。
// ------------------------------------------------------------------------

import { ProviderService } from '../services/provider-service';
import { TextSettingsService } from '../services/text-settings-service';

/** 宿主推送给页面的事件名称：可选的模型有变化（载荷为空）。 */
export const MODEL_EVENTS = {
  changed: 'models.changed'
} as const;

/**
 * 订阅服务商与文本模型设置的变化，变化时让页面刷新模型下拉。
 * @param postEvent 向页面推送事件的函数。
 * @returns 取消订阅的函数。
 */
export function watchModelChanges(
  providers: Pick<ProviderService, 'onDidChangeProviders'>,
  textModels: Pick<TextSettingsService, 'onDidChangeSettings'>,
  postEvent: (name: string) => void
): () => void {
  const notify = (): void => postEvent(MODEL_EVENTS.changed);
  const unsubscribes = [providers.onDidChangeProviders(notify), textModels.onDidChangeSettings(notify)];
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}
