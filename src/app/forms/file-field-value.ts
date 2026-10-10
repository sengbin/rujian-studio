// ------------------------------------------------------------------------
// 名称：file-field-value.ts
// 说明：把已保存的文件转换为文件字段的初始值，供编辑表单回填。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：格式与界面提交的文件字段一致：[{ name, mimeType, size, data }] 的 JSON 文本，data 为 Base64。
// ------------------------------------------------------------------------

/** 已保存的文件：作品素材图片与资产文件都满足它。 */
export interface StoredFileContent {
  readonly fileName: string;
  readonly mime: string;
  readonly content: Uint8Array;
}

/**
 * 已保存的文件转文件字段的初始值。
 * @param files 已保存的文件，按字段中显示的顺序。
 */
export function storedFilesToFieldValue(files: readonly StoredFileContent[]): string {
  return JSON.stringify(
    files.map((file) => {
      const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
      return { name: file.fileName, mimeType: file.mime, size: content.length, data: content.toString('base64') };
    })
  );
}
