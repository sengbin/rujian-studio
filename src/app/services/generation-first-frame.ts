// ------------------------------------------------------------------------
// 名称：generation-first-frame.ts
// 说明：解析镜头组首帧的来源：资产的第一张参考图、镜头本地上传的图片、上一组的尾帧（依赖上一组的任务或已采用的结果）。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-10
// 备注：来源不可用时返回说明原因的文字，由提交管线拒绝该组；尾帧的截取、保存与失败上报见 generation-tail-frame.ts。
// ------------------------------------------------------------------------

import { ACTIVE_JOB_STATUSES } from '../../domain/models/generation';
import { ShotFirstFrameImage, ShotGroup } from '../../domain/models/storyboard';
import { AssetRepository } from '../../domain/ports/asset-repository';
import { GenerationRepository, JobMediaReader } from '../../domain/ports/generation-repository';

/** 首帧不可用时给用户的后续操作建议。 */
const FIRST_FRAME_ADVICE = '请点“编辑镜头”重新选择首帧图片，或把首帧来源改为“无”。';

/** 指定图片首帧解析出的图片引用及其像素尺寸（未知为 null）：资产参考图用 fileId，镜头本地指定的图片用 imageId，二者只有一个有值。 */
export interface ResolvedFirstFrameImage {
  readonly fileId: number | null;
  readonly imageId: number | null;
  readonly width: number | null;
  readonly height: number | null;
}

/** 这一组首帧所依赖的前序任务，以及已就绪的首帧（尾帧图片）；尾帧还没截取时为 null。 */
export interface FirstFrameLink {
  readonly prevJobId: number;
  readonly firstFrameId: number | null;
}

/** 首帧解析的依赖。 */
export interface FirstFrameResolverDependencies {
  readonly assets: Pick<AssetRepository, 'findById' | 'listReferenceFiles'>;
  readonly media: Pick<JobMediaReader, 'readShotFirstFrame'>;
  readonly jobs: Pick<GenerationRepository, 'listJobsByGroups' | 'listResultsByGroups' | 'findResultFrameId'>;
}

/** 镜头组首帧来源的解析。 */
export class FirstFrameResolver {
  constructor(private readonly dependencies: FirstFrameResolverDependencies) {}

  /**
   * 解析指定图片首帧：取资产的第一张参考图。
   * @returns 资产图片文件标识；资产或图片不可用时返回说明原因的文字。
   */
  resolveAssetImage(assetId: number | null): ResolvedFirstFrameImage | string {
    const { assets } = this.dependencies;
    if (assetId === null) {
      return `这一组指定了图片作首帧，但指定的资产已被删除。${FIRST_FRAME_ADVICE}`;
    }
    const asset = assets.findById(assetId);
    const file = assets.listReferenceFiles(assetId)[0];
    if (asset === undefined || file === undefined) {
      return `这一组指定了“${asset?.name ?? '图片'}”作首帧，但它已没有可用的参考图。${FIRST_FRAME_ADVICE}`;
    }
    return { fileId: file.id, imageId: null, width: file.width, height: file.height };
  }

  /**
   * 解析镜头本地指定的首帧图片：确认图片记录存在且磁盘文件可读。
   * @returns 图片引用；图片不可用时返回说明原因的文字。
   */
  resolveLocalImage(image: ShotFirstFrameImage | null): ResolvedFirstFrameImage | string {
    if (image === null) {
      return `这一组指定了图片作首帧，但镜头里没有保存的首帧图片。${FIRST_FRAME_ADVICE}`;
    }
    if (this.dependencies.media.readShotFirstFrame(image.id) === undefined) {
      return `这一组指定了“${image.fileName}”作首帧，但它的文件已丢失。${FIRST_FRAME_ADVICE}`;
    }
    return { fileId: null, imageId: image.id, width: image.width, height: image.height };
  }

  /**
   * 找到这一组首帧依赖的上一组任务：本次提交里刚建的任务，其次是上一组正在进行的任务，最后是上一组已采用的结果。
   * @param createdJobIds 本次提交里已建任务的镜头组标识与任务标识。
   * @returns 依赖；上一组什么都没有时返回说明原因的文字。
   */
  linkPreviousGroup(previous: ShotGroup, createdJobIds: ReadonlyMap<number, number>): FirstFrameLink | string {
    const { jobs } = this.dependencies;
    const created = createdJobIds.get(previous.id);
    if (created !== undefined) {
      return { prevJobId: created, firstFrameId: null };
    }
    const active = jobs.listJobsByGroups([previous.id]).find((job) => ACTIVE_JOB_STATUSES.includes(job.status));
    if (active !== undefined) {
      return { prevJobId: active.id, firstFrameId: null };
    }
    const selected = jobs.listResultsByGroups([previous.id]).find((result) => result.isSelected);
    if (selected !== undefined) {
      return { prevJobId: selected.jobId, firstFrameId: jobs.findResultFrameId(selected.id) ?? null };
    }
    return `上一组（第 ${previous.seq} 组）还没有生成结果，无法用它的尾帧作首帧。请先生成上一组，或点“编辑镜头”把首帧来源改为“无”。`;
  }
}
