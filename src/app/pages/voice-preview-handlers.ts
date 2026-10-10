// ------------------------------------------------------------------------
// 名称：voice-preview-handlers.ts
// 说明：分镜动画台词试听与“按描述生成音色”的请求处理：读取可选的声音模型，合成一条对白的语音，读取本集已保存的配音，读取各说话人的临时音色状态，生成、采用试听音色。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：请求带 workId，由所属页面提供的 resolveWorkId 校验作品归属；服务商、访问密钥或模型开关变化时，页面推送 MODEL_EVENTS.changed（见 model-events.ts），预览层据此重新读取模型下拉。
// ------------------------------------------------------------------------

import { MessageRouter } from '../messaging/message-router';
import { VoiceDraftService } from '../services/voice-draft-service';
import { VoicePreviewService } from '../services/voice-preview-service';

/** 台词试听使用的请求名称，需与 resources/stage/stage-storyboard-preview-voice.js 一致。 */
export const VOICE_PREVIEW_REQUESTS = {
  options: 'voicePreview.options',
  synthesize: 'voicePreview.synthesize',
  restore: 'voicePreview.restore',
  speakers: 'voicePreview.speakers',
  draftInfo: 'voicePreview.draftInfo',
  draft: 'voicePreview.draft',
  adopt: 'voicePreview.adopt'
} as const;

/**
 * 在路由器上注册台词试听与音色生成的请求处理函数。
 * @param router 面板的请求路由器。
 * @param voices 台词试听服务。
 * @param drafts 按描述生成音色服务。
 * @param resolveWorkId 从请求载荷中读取作品标识并校验它属于所属页面；不合法时抛出错误。
 */
export function registerVoicePreviewHandlers(
  router: MessageRouter,
  voices: VoicePreviewService,
  drafts: VoiceDraftService,
  resolveWorkId: (payload: unknown) => number
): void {
  router.register(VOICE_PREVIEW_REQUESTS.options, () => voices.getOptions());
  router.register(VOICE_PREVIEW_REQUESTS.synthesize, (payload) => voices.synthesize(resolveWorkId(payload), payload));
  router.register(VOICE_PREVIEW_REQUESTS.restore, (payload) => voices.restore(resolveWorkId(payload), payload));
  router.register(VOICE_PREVIEW_REQUESTS.speakers, (payload) => drafts.getSpeakers(resolveWorkId(payload)));
  router.register(VOICE_PREVIEW_REQUESTS.draftInfo, (payload) => drafts.getDraftInfo(resolveWorkId(payload), payload));
  router.register(VOICE_PREVIEW_REQUESTS.draft, (payload) => drafts.createDraft(resolveWorkId(payload), payload));
  router.register(VOICE_PREVIEW_REQUESTS.adopt, (payload) => drafts.adopt(resolveWorkId(payload), payload));
}
