// ------------------------------------------------------------------------
// 名称：voice-draft-transaction.test.ts
// 说明：采用试听音色的事务测试：用真实的资产服务与 SQLite 工作单元验证，绑定任何一集失败时新建的音色资产随事务回滚，不留下没人用的资产，暂存保留以便重试；成功时资产保留。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：资产使用内存数据库；分镜、绑定、旁白与出图能力用桩，绑定桩可在指定集失败。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationError } from '../../domain/errors';
import { MemoryAssetFileStore } from '../../domain/ports/testing/memory-asset-file-store';
import { IN_MEMORY_DATABASE_PATH, openDatabase } from '../../infra/database/database-connection';
import { SqliteAssetRepository } from '../../infra/database/sqlite-asset-repository';
import { SqliteUnitOfWork } from '../../infra/database/sqlite-unit-of-work';
import { AssetService } from './asset-service';
import { VoiceDraftService, VoiceDraftServiceDependencies } from './voice-draft-service';
import { VoiceDraftStore } from './voice-draft-store';

const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ')]);
const SPEAKER_ID = 11;
const SPEAKER_KEY = `entity:${SPEAKER_ID}`;

/** 创建服务；bindFailsOnEpisode 指定在哪一集的绑定上失败。 */
function createFixture(bindFailsOnEpisode?: number) {
  const database = openDatabase(IN_MEMORY_DATABASE_PATH);
  const assets = new AssetService(new SqliteAssetRepository(database, new MemoryAssetFileStore()));
  const drafts = new VoiceDraftStore();
  drafts.save({
    workId: 1,
    speakerKey: SPEAKER_KEY,
    modelId: 5,
    mime: 'audio/wav',
    content: WAV,
    durationSeconds: 2.5,
    sampleText: '今晚会下雨',
    description: '低沉沙哑的老年男声',
    language: null,
    presetVoice: null
  });
  const bound: number[] = [];
  const dependencies = {
    storyboards: {
      getView: () => ({ work: { name: '灯塔' }, entities: [{ id: SPEAKER_ID, kind: 'character', name: '守夜人' }] })
    } as unknown as VoiceDraftServiceDependencies['storyboards'],
    bindings: {
      getEntityDetail: () => ({}) as never,
      listBindings: () => [],
      listSiblingEpisodeIds: () => [1, 2, 3],
      bind: (raw: { episodeId: number }) => {
        if (raw.episodeId === bindFailsOnEpisode) {
          throw new ValidationError({ '': '绑定失败。' });
        }
        bound.push(raw.episodeId);
        return {} as never;
      }
    } as unknown as VoiceDraftServiceDependencies['bindings'],
    assets,
    narrators: { find: () => undefined, set: () => undefined },
    drafts,
    transaction: new SqliteUnitOfWork(database),
    providers: {} as VoiceDraftServiceDependencies['providers'],
    voices: {} as VoiceDraftServiceDependencies['voices']
  } satisfies VoiceDraftServiceDependencies;
  return { database, service: new VoiceDraftService(dependencies), assets, drafts, bound };
}

test('采用时某一集绑定失败：新建的音色资产随事务回滚，暂存保留以便重试', () => {
  const { database, service, assets, drafts } = createFixture(2);
  try {
    assert.throws(() => service.adopt(1, { episodeId: 1, entityId: SPEAKER_ID, name: '音色甲', applyToOtherEpisodes: true }), ValidationError);
    assert.deepEqual(assets.listAssets('audio'), []);
    assert.ok(drafts.find(1, SPEAKER_KEY) !== undefined);
    assert.equal(assets.isNameAvailable('audio', '音色甲'), true, '重试时名称不会被占用');
  } finally {
    database.close();
  }
});

test('采用成功：资产保留并绑定到各集，暂存被清除', () => {
  const { database, service, assets, drafts, bound } = createFixture();
  try {
    const result = service.adopt(1, { episodeId: 1, entityId: SPEAKER_ID, name: '音色甲', applyToOtherEpisodes: true });
    assert.equal(result.otherEpisodesBound, 2);
    assert.deepEqual(bound, [1, 2, 3]);
    assert.equal(assets.listAssets('audio').length, 1);
    assert.equal(drafts.find(1, SPEAKER_KEY), undefined);
  } finally {
    database.close();
  }
});
