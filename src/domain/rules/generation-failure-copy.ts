// ------------------------------------------------------------------------
// 名称：generation-failure-copy.ts
// 说明：视频、图片与音频生成失败原因的界面说明：按失败分类给出名称与处理建议，应用自己产生的失败按错误码给出专门说明。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：说明与服务商无关，所有服务商的失败共用；不在文案里写具体服务商的控制台名称。
// ------------------------------------------------------------------------

import { JobFailure } from '../models/generation';
import { TAIL_FRAME_UNAVAILABLE_CODE } from './tail-frame-rules';

/** 前序镜头组的任务失败、被取消或已不存在，等待它的任务因此失败时的错误码。 */
export const PREVIOUS_GROUP_UNAVAILABLE_CODE = 'PreviousGroupUnavailable';

/** 失败分类的界面名称。 */
const FAILURE_LABELS: Readonly<Record<JobFailure['category'], string>> = {
  auth: '密钥或账号问题',
  rate_limited: '请求被限流',
  invalid_request: '参数不符合要求',
  content_rejected: '内容审核未通过',
  server: '服务端错误',
  network: '网络错误'
};

/** 失败分类对应的处理建议，告诉用户下一步怎么做。 */
const FAILURE_HINTS: Readonly<Record<JobFailure['category'], string>> = {
  auth: '请到“设置 > 模型”检查访问密钥是否正确、账号是否欠费，以及是否有权限使用该模型，处理后重新生成。',
  rate_limited: '平台限制了请求频率，请稍等片刻后重新生成。',
  invalid_request: '请求的参数不符合模型要求，请检查画幅、分辨率、时长和素材后重新生成。',
  content_rejected: '平台认为镜头描述、声音台词或参考素材包含不允许的内容。请点“编辑镜头”修改画面描述或台词，确认分镜脚本后重新生成。',
  server: '服务商暂时出错，通常稍后重新生成即可；多次失败时请查看原因说明。',
  network: '无法连接服务商，请检查网络后重新生成。'
};

/** 应用自己产生的失败（不来自服务商）的界面说明，按错误码查找。 */
const SPECIAL_FAILURES: ReadonlyMap<string, { readonly label: string; readonly hint: string }> = new Map([
  [
    PREVIOUS_GROUP_UNAVAILABLE_CODE,
    { label: '上一组没有可用的结果', hint: '这一组要用上一组的尾帧作首帧。请先重新生成上一组，成功后再生成这一组。' }
  ],
  [
    TAIL_FRAME_UNAVAILABLE_CODE,
    {
      label: '无法截取上一组的尾帧',
      hint: '工作台没能从上一组的视频里截取尾帧（视频格式可能不被应用支持）。可以点“编辑镜头”把首帧来源改为“无”，或重新生成上一组后再试。'
    }
  ]
]);

/** 失败原因的界面说明：分类名称与处理建议。 */
export function describeJobFailure(failure: JobFailure): { readonly label: string; readonly hint: string } {
  const special = failure.code === null ? undefined : SPECIAL_FAILURES.get(failure.code);
  return special ?? { label: FAILURE_LABELS[failure.category], hint: FAILURE_HINTS[failure.category] };
}
