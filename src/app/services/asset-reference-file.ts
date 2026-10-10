// ------------------------------------------------------------------------
// 名称：asset-reference-file.ts
// 说明：读取资产第一个参考文件（图片或音频）的类型与 Base64 内容：资产列表的原图查看与试听、实体绑定页的原图查看与音色试听共用。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：参考文件指资产当前使用来源的文件；资产是否存在、类型是否匹配由调用方先检查。
// ------------------------------------------------------------------------

import { NotFoundError } from '../../domain/errors';
import { AssetRepository } from '../../domain/ports/asset-repository';

/** 参考文件的类型与内容。 */
export interface ReferenceFileData {
  readonly mime: string;
  /** Base64 内容（不带前缀）。 */
  readonly data: string;
}

/**
 * 读取资产的第一个参考文件。
 * @param emptyMessage 资产没有参考文件时的提示。
 * @throws NotFoundError 资产没有参考文件。
 */
export function readFirstReferenceFile(assets: Pick<AssetRepository, 'listReferenceFiles'>, assetId: number, emptyMessage: string): ReferenceFileData {
  const [file] = assets.listReferenceFiles(assetId);
  if (file === undefined) {
    throw new NotFoundError(emptyMessage);
  }
  return { mime: file.mime, data: file.content.toString('base64') };
}
