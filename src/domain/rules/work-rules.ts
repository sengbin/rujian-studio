// ------------------------------------------------------------------------
// 名称：work-rules.ts
// 说明：作品创建的校验与规范化：作品名称与形态，灵感图片、小说原文文件和原创文稿（文件或粘贴文字）的类型、数量、大小与内容检查。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-09-30
// 备注：文件由表单以 JSON 文本传输（[{ name, mimeType, size, data }]，data 为 Base64），界面的限制只是体验层，这里按内容再次校验：图片按文件头判断真实格式，小说和原创文稿文件必须是合法的 UTF-8；原创文稿保存前统一换行符为 \n。
// ------------------------------------------------------------------------

import { ProductionFormatType } from '../models/production-profile';
import { NewWorkSource, WorkInput, WorkSourceType, WorkUpdate } from '../models/work';
import { FieldErrors, assertNoFieldErrors, readRecord, readText } from './field-readers';
import { IMAGE_FILE_MAX_BYTES, detectImageMime } from './image-size';
import { PRODUCTION_PROFILES, UNSUPPORTED_FORMAT_SUFFIX } from './production-profile-rules';
import { UploadedFile, getExtension, readUploadedFiles } from './upload-readers';

/** 作品名称的长度上限。 */
export const WORK_NAME_MAX_LENGTH = 60;

/** 作品形态在界面中的名称，由制作方案注册表派生；尚未实现的形态带“即将推出”后缀，表单里显示但不能选中。 */
export const WORK_KIND_LABELS: Readonly<Record<ProductionFormatType, string>> = Object.fromEntries(
  PRODUCTION_PROFILES.map((profile) => [profile.formatType, profile.supported ? profile.label : `${profile.label}${UNSUPPORTED_FORMAT_SUFFIX}`])
) as Record<ProductionFormatType, string>;

/** 素材来源在界面中的名称。 */
export const SOURCE_TYPE_LABELS: Readonly<Record<WorkSourceType, string>> = {
  text: '文字灵感',
  image: '灵感图片',
  novel: '小说原文',
  original: '原创文稿'
};

/** 表单字段键：灵感图片、小说原文件、原创文稿文件、原创文稿粘贴的文字。 */
export const IMAGE_FIELD_KEY = 'images';
/** 小说文件字段的表单键。 */
export const NOVEL_FIELD_KEY = 'novelFile';
/** 原创文稿文件字段的表单键。 */
export const MANUSCRIPT_FILE_FIELD_KEY = 'manuscriptFile';
/** 原创文稿文字字段的表单键。 */
export const MANUSCRIPT_TEXT_FIELD_KEY = 'manuscriptText';

/** 灵感图片允许的文件扩展名。 */
export const IMAGE_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp'];
/** 灵感图片最多上传的张数。 */
export const IMAGE_MAX_FILES = 10;
/** 小说文件允许的扩展名。 */
export const NOVEL_EXTENSIONS: readonly string[] = ['.txt', '.md'];
/** 小说文件的大小上限，单位为字节。 */
export const NOVEL_MAX_BYTES = 5 * 1024 * 1024;
/** 原创文稿粘贴文字的字数上限，按最多 3 字节一个字计算也不超过 NOVEL_MAX_BYTES。 */
export const MANUSCRIPT_TEXT_MAX_LENGTH = 1000000;

/** UTF-8 文件开头的字节序标记，读取文本时去掉。 */
const UTF8_BOM = [0xef, 0xbb, 0xbf];

/** 粘贴的原稿保存为素材文件时使用的文件名。 */
const MANUSCRIPT_PASTED_FILE_NAME = '原稿.txt';

/** 作品创建时校验通过的内容。 */
export interface NormalizedWorkCreation {
  readonly input: WorkInput;
  readonly sources: readonly NewWorkSource[];
}

/**
 * 校验并规范化创建作品时的名称、形态和素材文件。
 * @param rawInput 表单提交的原始内容。
 * @param sourceType 素材来源，由入口决定。
 * @throws ValidationError 存在不合法的字段。
 */
export function normalizeWorkCreation(rawInput: unknown, sourceType: WorkSourceType): NormalizedWorkCreation {
  const source = readRecord(rawInput);
  const errors: FieldErrors = {};

  const name = readText(source, { key: 'workName', label: '作品名称', required: true, maxLength: WORK_NAME_MAX_LENGTH }, errors);
  const kind = readWorkKind(source.kind, errors);
  const sources =
    sourceType === 'image'
      ? readImageSources(source[IMAGE_FIELD_KEY], errors)
      : sourceType === 'novel'
        ? readNovelSource(source[NOVEL_FIELD_KEY], errors)
        : sourceType === 'original'
          ? readManuscriptSource(source[MANUSCRIPT_FILE_FIELD_KEY], source[MANUSCRIPT_TEXT_FIELD_KEY], errors)
          : [];

  assertNoFieldErrors(errors);
  return { input: { name, kind, sourceType }, sources };
}

/**
 * 校验并规范化修改作品时的名称与形态。
 * @param rawInput 表单提交的原始内容。
 * @param currentKind 作品现有的形态；不允许修改形态时原样保留。
 * @param canChangeKind 是否允许修改形态；为 false 时忽略提交内容中的形态。
 * @param sourceType 作品的素材来源；灵感图片作品还要校验并返回提交的完整图片列表。
 * @throws ValidationError 存在不合法的字段。
 */
export function normalizeWorkUpdate(
  rawInput: unknown,
  currentKind: ProductionFormatType,
  canChangeKind: boolean,
  sourceType: WorkSourceType = 'text'
): WorkUpdate {
  const source = readRecord(rawInput);
  const errors: FieldErrors = {};
  const name = readText(source, { key: 'workName', label: '作品名称', required: true, maxLength: WORK_NAME_MAX_LENGTH }, errors);
  const kind = canChangeKind ? readWorkKind(source.kind, errors) : currentKind;
  const images = sourceType === 'image' ? readImageSources(source[IMAGE_FIELD_KEY], errors) : undefined;
  assertNoFieldErrors(errors);
  return images === undefined ? { name, kind } : { name, kind, images };
}

/** 读取作品形态：接受界面名称或内部键，只能选已实现的形态。 */
function readWorkKind(value: unknown, errors: FieldErrors): ProductionFormatType {
  const supported = PRODUCTION_PROFILES.filter((profile) => profile.supported);
  const found = supported.find((profile) => value === profile.formatType || value === profile.label);
  if (found === undefined) {
    const pending = PRODUCTION_PROFILES.some((profile) => !profile.supported && (value === profile.formatType || value === WORK_KIND_LABELS[profile.formatType]));
    errors.kind = pending ? '该作品形态即将推出，暂不能选择。' : '请选择作品形态。';
    return supported[0].formatType;
  }
  return found.formatType;
}

/** 读取灵感图片：至少 1 张、最多 10 张，按文件头识别 PNG、JPEG、WebP。 */
function readImageSources(value: unknown, errors: FieldErrors): NewWorkSource[] {
  const files = readUploadedFiles(value, IMAGE_FIELD_KEY, '灵感图片', IMAGE_FILE_MAX_BYTES, errors);
  if (files === undefined) {
    return [];
  }
  if (files.length === 0) {
    errors[IMAGE_FIELD_KEY] = '请至少选择 1 张灵感图片。';
    return [];
  }
  if (files.length > IMAGE_MAX_FILES) {
    errors[IMAGE_FIELD_KEY] = `灵感图片最多 ${IMAGE_MAX_FILES} 张（当前 ${files.length} 张）。`;
    return [];
  }

  const sources: NewWorkSource[] = [];
  for (const file of files) {
    const mime = detectImageMime(file.content);
    if (mime === null) {
      errors[IMAGE_FIELD_KEY] = `“${file.name}”不是有效的 PNG、JPEG 或 WebP 图片。`;
      return [];
    }
    sources.push({ kind: 'image', fileName: file.name, mime, content: file.content });
  }
  return sources;
}

/** 读取小说原文：恰好 1 个文件，必须是能按 UTF-8 解码的文本；去掉开头的 BOM。 */
function readNovelSource(value: unknown, errors: FieldErrors): NewWorkSource[] {
  const files = readUploadedFiles(value, NOVEL_FIELD_KEY, '原作文件', NOVEL_MAX_BYTES, errors);
  return files === undefined ? [] : decodeTextFile(files, NOVEL_FIELD_KEY, '原作文件', errors);
}

/** 读取原创文稿：上传 1 个文本文件，或直接粘贴文字，二选一；粘贴的文字统一换行符。 */
function readManuscriptSource(fileValue: unknown, textValue: unknown, errors: FieldErrors): NewWorkSource[] {
  if (textValue !== undefined && textValue !== null && typeof textValue !== 'string') {
    errors[MANUSCRIPT_TEXT_FIELD_KEY] = '原稿文字必须是文本。';
    return [];
  }
  const files = readUploadedFiles(fileValue, MANUSCRIPT_FILE_FIELD_KEY, '原稿文件', NOVEL_MAX_BYTES, errors);
  if (files === undefined) {
    return [];
  }
  const pasted = (textValue ?? '').replace(/\r\n?/g, '\n');
  const hasPasted = pasted.trim().length > 0;
  if (pasted.length > MANUSCRIPT_TEXT_MAX_LENGTH) {
    errors[MANUSCRIPT_TEXT_FIELD_KEY] = `原稿文字不能超过 ${MANUSCRIPT_TEXT_MAX_LENGTH} 字（当前 ${pasted.length} 字）。`;
    return [];
  }
  if (files.length > 0 && hasPasted) {
    errors[MANUSCRIPT_TEXT_FIELD_KEY] = '上传文件和粘贴文字只能选一种，请清空其中一个。';
    return [];
  }
  if (files.length > 0) {
    return decodeTextFile(files, MANUSCRIPT_FILE_FIELD_KEY, '原稿文件', errors);
  }
  if (!hasPasted) {
    errors[MANUSCRIPT_FILE_FIELD_KEY] = '请上传原稿文件，或在下方粘贴原稿文字。';
    return [];
  }
  const content = Buffer.from(pasted, 'utf8');
  return [{ kind: 'novel_text', fileName: MANUSCRIPT_PASTED_FILE_NAME, mime: 'text/plain', content }];
}

/** 校验恰好 1 个文本文件：扩展名受支持，内容是能按 UTF-8 解码的非空文字；去掉开头的 BOM。 */
function decodeTextFile(files: readonly UploadedFile[], key: string, label: string, errors: FieldErrors): NewWorkSource[] {
  if (files.length !== 1) {
    errors[key] = `请选择 1 个${label}。`;
    return [];
  }

  const [file] = files;
  const extension = getExtension(file.name);
  if (!NOVEL_EXTENSIONS.includes(extension)) {
    errors[key] = `${label}只支持 ${NOVEL_EXTENSIONS.join('、')}。`;
    return [];
  }
  const hasBom = UTF8_BOM.every((byte, index) => file.content[index] === byte);
  const content = hasBom ? file.content.subarray(UTF8_BOM.length) : file.content;
  const text = decodeUtf8(content);
  if (text === undefined || text.includes('\u0000')) {
    errors[key] = `“${file.name}”不是 UTF-8 编码的文本文件，请另存为 UTF-8 后重试。`;
    return [];
  }
  if (text.trim().length === 0) {
    errors[key] = `“${file.name}”没有可用的文字内容。`;
    return [];
  }
  return [{ kind: 'novel_text', fileName: file.name, mime: extension === '.md' ? 'text/markdown' : 'text/plain', content }];
}

/** 严格按 UTF-8 解码；含非法字节时返回 undefined。 */
function decodeUtf8(content: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    return undefined;
  }
}
