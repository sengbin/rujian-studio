// ------------------------------------------------------------------------
// 名称：voice-preview-handlers.test.ts
// 说明：台词试听请求处理的自动化测试：读取声音模型、合成请求按作品校验归属后转交服务、服务商变化事件名称与界面脚本一致。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：服务用桩代替；请求经真实的消息路由器处理，因此错误会转换为界面看到的错误载荷。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ValidationError } from '../../domain/errors';
import { MessageRouter } from '../messaging/message-router';
import { VoiceDraftService } from '../services/voice-draft-service';
import { VoicePreviewService } from '../services/voice-preview-service';
import { VOICE_PREVIEW_REQUESTS, registerVoicePreviewHandlers } from './voice-preview-handlers';

/** 登记了台词试听请求的路由器与桩服务；作品只认 workId 为 1。 */
function createHandlers() {
  const synthesized: Array<{ workId: number; payload: unknown }> = [];
  const voices = {
    getOptions: async () => ({ models: [{ id: 5, label: '假服务商 · 模型', supportsReference: true }], unavailableHint: null }),
    synthesize: async (workId: number, payload: unknown) => {
      synthesized.push({ workId, payload });
      return { mime: 'audio/wav', data: 'UklG', cached: false, note: null };
    }
  } as unknown as VoicePreviewService;
  const drafted: Array<{ name: string; workId: number; payload: unknown }> = [];
  const record = (name: string, result: unknown) => async (workId: unknown, payload?: unknown) => {
    drafted.push({ name, workId: workId as number, payload });
    return result;
  };
  const drafts = {
    getSpeakers: (workId: number) => ({ narrator: 'none', narratorAssetName: null, draftEntityIds: [workId] }),
    getDraftInfo: record('draftInfo', { speakerName: '守夜人' }),
    createDraft: record('draft', { mime: 'audio/wav', data: 'UklG' }),
    adopt: record('adopt', { assetId: 3 })
  } as unknown as VoiceDraftService;
  const router = new MessageRouter();
  registerVoicePreviewHandlers(router, voices, drafts, (payload) => {
    const workId = (payload as { workId?: unknown }).workId;
    if (workId !== 1) throw new ValidationError({ '': '作品标识无效。' });
    return 1;
  });
  const send = (name: string, payload?: unknown) => router.handle({ type: 'request', requestId: 1, name, payload });
  return { send, synthesized, drafted };
}

test('读取声音模型：转交服务，不需要作品', async () => {
  const { send } = createHandlers();
  const response = await send(VOICE_PREVIEW_REQUESTS.options);
  assert.ok(response?.ok);
  assert.equal((response.data as { models: unknown[] }).models.length, 1);
});

test('合成：先校验作品归属再转交服务；归属不对时不调用服务并返回校验错误', async () => {
  const { send, synthesized } = createHandlers();
  const payload = { workId: 1, episodeId: 7, soundId: 3, modelId: 5 };
  const ok = await send(VOICE_PREVIEW_REQUESTS.synthesize, payload);
  assert.ok(ok?.ok);
  assert.deepEqual(synthesized, [{ workId: 1, payload }]);

  const denied = await send(VOICE_PREVIEW_REQUESTS.synthesize, { ...payload, workId: 2 });
  assert.ok(denied && !denied.ok);
  assert.equal(denied.error.kind, 'validation');
  assert.equal(synthesized.length, 1);
});

test('音色生成的请求：先校验作品归属再转交服务，归属不对时不调用服务', async () => {
  const { send, drafted } = createHandlers();
  const payload = { workId: 1, episodeId: 7, entityId: 11 };

  const speakers = await send(VOICE_PREVIEW_REQUESTS.speakers, { workId: 1 });
  assert.deepEqual(speakers?.ok && speakers.data, { narrator: 'none', narratorAssetName: null, draftEntityIds: [1] });
  for (const [request, name] of [
    [VOICE_PREVIEW_REQUESTS.draftInfo, 'draftInfo'],
    [VOICE_PREVIEW_REQUESTS.draft, 'draft'],
    [VOICE_PREVIEW_REQUESTS.adopt, 'adopt']
  ] as const) {
    assert.ok((await send(request, payload))?.ok, name);
    const denied = await send(request, { ...payload, workId: 2 });
    assert.ok(denied && !denied.ok && denied.error.kind === 'validation', name);
  }
  assert.deepEqual(drafted.map((item) => [item.name, item.workId]), [['draftInfo', 1], ['draft', 1], ['adopt', 1]]);
});

test('请求名称与界面脚本一致', () => {
  const script = readFileSync(path.join(__dirname, '..', '..', '..', 'resources', 'stage', 'storyboard-preview', 'stage-storyboard-preview-voice.js'), 'utf8');
  for (const name of Object.values(VOICE_PREVIEW_REQUESTS)) {
    assert.ok(script.includes(`'${name}'`), `界面脚本里缺少 ${name}`);
  }
});
