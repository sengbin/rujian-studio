// ------------------------------------------------------------------------
// 名称：storyboard-edit-rules.test.ts
// 说明：分镜镜头编辑规则的自动化测试：镜头字段、出场实体、声音的规范化，以及首帧来源（资产参考图、指定图片）的校验。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：纯函数测试，不依赖数据库。
// ------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationError } from '../errors';
import { StoryboardEntity } from '../models/storyboard';
import { normalizeShotEdit } from './storyboard-edit-rules';

const ENTITIES: StoryboardEntity[] = [
  { id: 1, kind: 'character', name: '守夜人', aliases: ['老陈'] },
  { id: 2, kind: 'scene', name: '灯塔', aliases: [] },
  { id: 3, kind: 'prop', name: '灯塔', aliases: [] }
];

test('编辑：规范化镜头字段、出场实体与声音；对白必须选择角色', () => {
  const edit = normalizeShotEdit(
    {
      prompt: ' 新画面 ',
      durationSeconds: '3.5',
      firstFrameMode: 'prev_tail',
      entityIds: [2],
      sounds: [
        { kind: 'dialogue', speakerEntityId: 1, text: '台词', isEnabled: false },
        { kind: 'music', text: '配乐', startOffsetSeconds: '', durationSeconds: 3 }
      ]
    },
    ENTITIES,
    false
  );
  assert.equal(edit.prompt, '新画面');
  assert.equal(edit.durationSeconds, 3.5);
  assert.deepEqual(edit.entityIds, [2, 1], '说话人自动加入出场实体');
  assert.deepEqual(edit.sounds.map((sound) => [sound.kind, sound.speakerEntityId, sound.isEnabled]), [['dialogue', 1, false], ['music', null, true]]);

  assert.throws(
    () => normalizeShotEdit({ prompt: '', durationSeconds: '', firstFrameMode: 'prev_tail', entityIds: [99], sounds: [{ kind: 'dialogue', text: '' }] }, ENTITIES, true),
    (error) =>
      error instanceof ValidationError &&
      error.fieldErrors.prompt !== undefined &&
      error.fieldErrors.durationSeconds !== undefined &&
      error.fieldErrors.firstFrameMode !== undefined &&
      error.fieldErrors.entityIds !== undefined &&
      error.fieldErrors.sounds !== undefined
  );
});

test('编辑：首帧来源为指定图片时必须从可选资产中选一个，其他来源不保存资产', () => {
  const base = { prompt: '新画面', durationSeconds: 3, entityIds: [], sounds: [] };
  const asset = normalizeShotEdit({ ...base, firstFrameMode: 'asset', firstFrameAssetId: 7 }, ENTITIES, true, [7, 8]);
  assert.deepEqual([asset.firstFrameMode, asset.firstFrameAssetId], ['asset', 7], '第 1 个镜头也可以指定图片');

  const stale = normalizeShotEdit({ ...base, firstFrameMode: 'none', firstFrameAssetId: 7 }, ENTITIES, false, [7]);
  assert.deepEqual([stale.firstFrameMode, stale.firstFrameAssetId], ['none', null]);

  for (const firstFrameAssetId of [undefined, null, 9, '7']) {
    assert.throws(
      () => normalizeShotEdit({ ...base, firstFrameMode: 'asset', firstFrameAssetId }, ENTITIES, false, [7, 8]),
      (error) => error instanceof ValidationError && error.fieldErrors.firstFrameAssetId !== undefined
    );
  }
  assert.throws(() => normalizeShotEdit({ ...base, firstFrameMode: 'asset', firstFrameAssetId: 7 }, ENTITIES, false), ValidationError, '没有可选资产时不能指定');
});

/** 构造只含文件头的 PNG：签名加 IHDR 块，宽高写在固定位置。 */
function pngHeader(width: number, height: number): Buffer {
  const content = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(content);
  content.writeUInt32BE(13, 8);
  content.write('IHDR', 12);
  content.writeUInt32BE(width, 16);
  content.writeUInt32BE(height, 20);
  return content;
}

/** 界面提交的首帧图片：文件名、类型、大小与 Base64 内容。 */
function firstFrameFile(content: Buffer, name = 'tail.png') {
  return { name, mimeType: 'image/png', size: content.length, data: content.toString('base64') };
}

test('编辑：首帧来源为指定图片时，新选择的图片按文件头校验并读取宽高，其他来源不带图片', () => {
  const base = { prompt: '新画面', durationSeconds: 3, entityIds: [], sounds: [] };
  const png = pngHeader(1280, 720);
  const picked = normalizeShotEdit({ ...base, firstFrameMode: 'image', firstFrameImage: firstFrameFile(png) }, ENTITIES, true);
  assert.equal(picked.firstFrameMode, 'image');
  assert.deepEqual(
    [picked.firstFrameImage?.fileName, picked.firstFrameImage?.mime, picked.firstFrameImage?.width, picked.firstFrameImage?.height],
    ['tail.png', 'image/png', 1280, 720]
  );
  assert.deepEqual(Buffer.from(picked.firstFrameImage?.content ?? []), png);

  const stale = normalizeShotEdit({ ...base, firstFrameMode: 'none', firstFrameImage: firstFrameFile(png) }, ENTITIES, true);
  assert.ok(!('firstFrameImage' in stale), '其他首帧来源不保存图片');
});

test('编辑：指定图片没带新图片时，已保存了图片才保留；明确传空表示移除，不合法的文件报出原因', () => {
  const base = { prompt: '新画面', durationSeconds: 3, entityIds: [], sounds: [], firstFrameMode: 'image' };
  const kept = normalizeShotEdit(base, ENTITIES, false, [], true);
  assert.ok(!('firstFrameImage' in kept), '保留已保存的图片，不再带图片内容');

  const rejected = (input: Record<string, unknown>, hasSaved: boolean) =>
    assert.throws(
      () => normalizeShotEdit({ ...base, ...input }, ENTITIES, false, [], hasSaved),
      (error) => error instanceof ValidationError && error.fieldErrors.firstFrameImage !== undefined
    );
  rejected({}, false);
  rejected({ firstFrameImage: null }, true);
  rejected({ firstFrameImage: firstFrameFile(Buffer.from('not an image')) }, true);
  rejected({ firstFrameImage: { name: 'a.png', data: '!!!' } }, true);
});
