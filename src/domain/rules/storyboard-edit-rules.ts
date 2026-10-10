// ------------------------------------------------------------------------
// 名称：storyboard-edit-rules.ts
// 说明：用户编辑保存分镜镜头的校验与规范化：镜头字段、出场实体、站位、声音，以及首帧来源（含指定的首帧图片）。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：界面提交的编辑内容校验失败抛出 ValidationError；镜头与声音字段的共用读取在 storyboard-shot-fields。
// ------------------------------------------------------------------------

import { FirstFrameMode, NewShotFirstFrameImage, SOUND_KIND_LABELS, ShotEdit, ShotStaging, SoundDraft, SoundKind, StoryboardEntity } from '../models/storyboard';
import { FieldErrors, assertNoFieldErrors, isRecord, readOptionalChoice, readOptionalDecimal, readRecord, readText } from './field-readers';
import { IMAGE_FILE_MAX_BYTES, detectImageMime, readImageSize } from './image-size';
import { MAX_STAGING_PER_SHOT } from './staging-rules';
import {
  MAX_SOUNDS_PER_SHOT,
  SHOT_LABEL_MAX_LENGTH,
  SHOT_NOTE_MAX_LENGTH,
  SHOT_PROMPT_MAX_LENGTH,
  SHOT_SECONDS_MAX,
  SHOT_SECONDS_MIN,
  SOUND_KINDS,
  collectStaging,
  readSoundContent
} from './storyboard-shot-fields';
import { readUploadedFiles } from './upload-readers';

/** 首帧图片字段在错误提示里的键。 */
const FIRST_FRAME_IMAGE_KEY = 'firstFrameImage';

/** 读取用户编辑的站位条目：实体必须是已有的非场景实体，有站位的实体自动加入出场实体；同一实体重复时后面的覆盖前面的。 */
function readStagingEdits(value: unknown, entities: readonly StoryboardEntity[], errors: FieldErrors, entityIds: Set<number>): ShotStaging[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_STAGING_PER_SHOT) {
    errors.staging = `站位必须是数组，最多 ${MAX_STAGING_PER_SHOT} 条。`;
    return [];
  }
  const issues: string[] = [];
  const staging = collectStaging(
    value,
    (item, index) => {
      const record = isRecord(item) ? item : {};
      const entity = entities.find((candidate) => candidate.id === record.entityId);
      if (entity === undefined) {
        issues.push(`第 ${index + 1} 条站位必须选择剧本中已有的实体。`);
      }
      return entity;
    },
    (entity) => `${entity.name}的站位`,
    entityIds,
    issues
  );
  if (issues.length > 0) {
    errors.staging = issues.join('；');
    return [];
  }
  return staging;
}

/** 读取用户编辑的声音条目。 */
function readSoundEdits(value: unknown, entities: readonly StoryboardEntity[], errors: FieldErrors, entityIds: Set<number>): SoundDraft[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_SOUNDS_PER_SHOT) {
    errors.sounds = `声音必须是数组，最多 ${MAX_SOUNDS_PER_SHOT} 条。`;
    return [];
  }
  const sounds: SoundDraft[] = [];
  value.forEach((item, index) => {
    const label = `第 ${index + 1} 条声音`;
    const issues: string[] = [];
    const record = isRecord(item) ? item : {};
    const kind = record.kind;
    if (typeof kind !== 'string' || !SOUND_KINDS.includes(kind as SoundKind)) {
      issues.push(`${label}的类型必须是以下之一：${SOUND_KINDS.map((key) => SOUND_KIND_LABELS[key]).join('、')}。`);
    }
    let speakerEntityId: number | null = null;
    if (kind === 'dialogue') {
      const speaker = record.speakerEntityId;
      const entity = entities.find((candidate) => candidate.id === speaker && candidate.kind === 'character');
      if (entity === undefined) {
        issues.push(`${label}必须选择说话的角色。`);
      } else {
        speakerEntityId = entity.id;
        entityIds.add(entity.id);
      }
    }
    const content = readSoundContent(
      record,
      label,
      { text: '台词或声音描述', delivery: '说话方式或声音质感', startOffset: '开始时间', duration: '持续时长' },
      issues
    );
    if (issues.length > 0) {
      errors.sounds = issues.join('；');
      return;
    }
    sounds.push({ kind: kind as SoundKind, speakerEntityId, ...content, isEnabled: record.isEnabled !== false });
  });
  return sounds;
}

/**
 * 校验并规范化用户编辑保存的一个镜头（F11“镜头编辑”）；声音整体替换，出场实体必须取自可引用的实体。
 * @param rawInput 界面提交的原始内容；首帧来源为 image 时，“firstFrameImage”是新选择的图片 { name, mimeType, size, data（Base64） }，不带表示保留已保存的图片。
 * @param entities 可引用的实体。
 * @param isFirstShot 是否为集内第 1 个镜头：没有上一镜头，首帧不能接上一镜头尾帧。
 * @param firstFrameAssetIds 可作为首帧图片的资产标识（图片类资产且至少有一张参考图）；首帧来源为“资产参考图”时必须从中选择。
 * @param hasSavedFirstFrameImage 这个镜头是否已保存了首帧图片；首帧来源为“指定图片”且没有选择新图片时，必须已有保存的图片。
 * @throws ValidationError 存在不合法的字段。
 */
export function normalizeShotEdit(
  rawInput: unknown,
  entities: readonly StoryboardEntity[],
  isFirstShot: boolean,
  firstFrameAssetIds: readonly number[] = [],
  hasSavedFirstFrameImage = false
): ShotEdit {
  const source = readRecord(rawInput);
  const errors: FieldErrors = {};
  const text = (key: string, label: string, max: number, required: boolean): string =>
    readText(source, { key, label, required, maxLength: max }, errors);

  const sceneLabel = text('sceneLabel', '场次', SHOT_LABEL_MAX_LENGTH, false);
  const shotSize = text('shotSize', '景别', SHOT_LABEL_MAX_LENGTH, false);
  const cameraAngle = text('cameraAngle', '机位与视角', SHOT_LABEL_MAX_LENGTH, false);
  const cameraMovement = text('cameraMovement', '摄影机运动', SHOT_LABEL_MAX_LENGTH, false);
  const transition = text('transition', '转场', SHOT_LABEL_MAX_LENGTH, false);
  const continuityNote = text('continuityNote', '连续性要求', SHOT_NOTE_MAX_LENGTH, false);
  const prompt = text('prompt', '画面描述', SHOT_PROMPT_MAX_LENGTH, true);
  const durationSeconds = readOptionalDecimal(
    source,
    { key: 'durationSeconds', label: '时长', min: SHOT_SECONDS_MIN, max: SHOT_SECONDS_MAX, maxDecimals: 1 },
    errors
  );
  if (durationSeconds === null && errors.durationSeconds === undefined) {
    errors.durationSeconds = '时长不能为空。';
  }

  const firstFrameMode = readOptionalChoice(source, 'firstFrameMode', '首帧来源', ['none', 'prev_tail', 'asset', 'image'], errors) ?? 'none';
  if (firstFrameMode === 'prev_tail' && isFirstShot) {
    errors.firstFrameMode = '第 1 个镜头没有上一镜头，不能接上一镜头尾帧。';
  }
  // 资产参考图作首帧：必须选一个带参考图的图片资产；其他首帧来源不保存资产。
  let firstFrameAssetId: number | null = null;
  if (firstFrameMode === 'asset') {
    const rawAssetId = source.firstFrameAssetId;
    if (typeof rawAssetId !== 'number' || !firstFrameAssetIds.includes(rawAssetId)) {
      errors.firstFrameAssetId = '请选择一个带参考图的资产作为首帧图片。';
    } else {
      firstFrameAssetId = rawAssetId;
    }
  }
  // 指定图片作首帧：选了新图片就换掉旧的，没带该字段表示保留已保存的图片（须已有），明确传空表示用户移除了图片；其他首帧来源不保留图片。
  let firstFrameImage: NewShotFirstFrameImage | undefined;
  if (firstFrameMode === 'image') {
    firstFrameImage = readFirstFrameImage(source.firstFrameImage, errors);
    const keepsSaved = source.firstFrameImage === undefined && hasSavedFirstFrameImage;
    if (firstFrameImage === undefined && !keepsSaved && errors[FIRST_FRAME_IMAGE_KEY] === undefined) {
      errors[FIRST_FRAME_IMAGE_KEY] = '请选择一张图片作为首帧。';
    }
  }

  const entityIds = new Set<number>();
  const rawIds = source.entityIds;
  if (rawIds !== undefined && rawIds !== null) {
    if (!Array.isArray(rawIds) || rawIds.some((id) => typeof id !== 'number')) {
      errors.entityIds = '出场实体格式不正确。';
    } else {
      for (const id of rawIds as number[]) {
        if (!entities.some((entity) => entity.id === id)) {
          errors.entityIds = '出场实体必须是剧本中已有的实体。';
        } else {
          entityIds.add(id);
        }
      }
    }
  }
  const staging = readStagingEdits(source.staging, entities, errors, entityIds);
  const sounds = readSoundEdits(source.sounds, entities, errors, entityIds);
  assertNoFieldErrors(errors);
  return {
    sceneLabel,
    shotSize,
    cameraAngle,
    cameraMovement,
    durationSeconds: durationSeconds ?? SHOT_SECONDS_MIN,
    transition,
    continuityNote,
    firstFrameMode: firstFrameMode as FirstFrameMode,
    firstFrameAssetId,
    entityIds: [...entityIds],
    staging,
    sounds,
    prompt,
    ...(firstFrameImage === undefined ? {} : { firstFrameImage })
  };
}

/**
 * 读取用户新选择的首帧图片：解码内容、检查大小，按文件头确认是 PNG、JPEG 或 WebP 并读取像素宽高。
 * @returns 图片；没有提交新图片或内容不合法时返回 undefined（不合法时已记录错误）。
 */
function readFirstFrameImage(value: unknown, errors: FieldErrors): NewShotFirstFrameImage | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const uploaded = readUploadedFiles([value], FIRST_FRAME_IMAGE_KEY, '首帧图片', IMAGE_FILE_MAX_BYTES, errors);
  const file = uploaded?.[0];
  if (file === undefined) {
    return undefined;
  }
  const mime = detectImageMime(file.content);
  if (mime === null) {
    errors[FIRST_FRAME_IMAGE_KEY] = `“${file.name}”不是有效的 PNG、JPEG 或 WebP 图片。`;
    return undefined;
  }
  const size = readImageSize(file.content, mime);
  return { fileName: file.name, mime, width: size?.width ?? null, height: size?.height ?? null, content: file.content };
}
