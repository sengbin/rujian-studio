// ------------------------------------------------------------------------
// 名称：storage-file-types.ts
// 说明：本地文件存储共用的常量：写入中的临时文件后缀，以及保存文件时 MIME 类型对应的扩展名。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：临时文件后缀统一为 .part，列出存储内容时据此跳过未写完的文件；新增可保存的文件类型只改这里。
// ------------------------------------------------------------------------

/** 写入中的临时文件后缀；写完改名为正式文件名，列出存储内容时跳过带此后缀的文件。 */
export const PARTIAL_SUFFIX = '.part';

/** 语音缓存支持保存的音频类型与扩展名。 */
export const AUDIO_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/mp4': '.m4a'
};

/** 资产文件存储支持保存的类型与扩展名：图片、音频，以及小说与原创文稿的文本。 */
export const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  ...AUDIO_EXTENSION_BY_MIME,
  'text/plain': '.txt',
  'text/markdown': '.md'
};
