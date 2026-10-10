// ------------------------------------------------------------------------
// 名称：video-task-content.ts
// 说明：MiniMax 与火山方舟视频任务接口共用的请求内容与状态：素材按角色标注的 content 数组，以及任务状态与统一状态的对应。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：两家的 content 结构相同（文本、image_url、audio_url，素材带 role）；千问的 input.media 结构不同，不使用这里；首尾帧与参考素材的互斥由校验保证，这里不再判断。
// ------------------------------------------------------------------------

import { MediaInput, RemoteJobStatus, VideoGenerationRequest } from '../../../domain/ports/provider-adapters';
import { toDataUri } from './provider-payload';

/** 素材在请求中的角色（content[].role）。 */
const ROLE_FIRST_FRAME = 'first_frame';
const ROLE_LAST_FRAME = 'last_frame';
const ROLE_REFERENCE_IMAGE = 'reference_image';
const ROLE_REFERENCE_AUDIO = 'reference_audio';

/** 两家共有的任务状态与统一状态的对应；火山方舟另有 expired。 */
export const VIDEO_TASK_STATUSES: Readonly<Record<string, RemoteJobStatus>> = {
  queued: 'pending',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'canceled'
};

/**
 * 按素材组合构造 content：提示词不为空时文本在前，素材按角色标注，Base64 内联。
 * @param request 已通过校验的视频生成请求。
 */
export function buildVideoContent(request: VideoGenerationRequest): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  if (request.prompt.trim() !== '') content.push({ type: 'text', text: request.prompt });
  const image = (media: MediaInput, role: string): Record<string, unknown> => ({ type: 'image_url', image_url: { url: toDataUri(media) }, role });
  if (request.firstFrame !== null) content.push(image(request.firstFrame, ROLE_FIRST_FRAME));
  if (request.lastFrame !== null) content.push(image(request.lastFrame, ROLE_LAST_FRAME));
  for (const reference of request.referenceImages) content.push(image(reference, ROLE_REFERENCE_IMAGE));
  for (const audio of request.referenceAudios) content.push({ type: 'audio_url', audio_url: { url: toDataUri(audio) }, role: ROLE_REFERENCE_AUDIO });
  return content;
}
