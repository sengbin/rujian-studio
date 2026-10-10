// ------------------------------------------------------------------------
// 名称：asset-generation-queue.ts
// 说明：资产生成队列：按并发上限把排队的版本提交给图像、音频模型，轮询生成中的版本，成功时下载结果文件，失败时记录平台返回的具体原因，支持取消与重启恢复。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-02
// 备注：提交、轮询、重试、取消等公共流程在 BaseRemoteJobQueue；本文件只保留资产特有的部分：按资产类型选择图像或音频适配器，结果文件的下载校验与版本文件保存。千问音频接口是同步的，提交后第一次轮询即成功。超时先判定再查询。
// ------------------------------------------------------------------------

import { ProviderError } from '../../domain/errors';
import { AssetRecord } from '../../domain/models/asset';
import { AssetVersionRecord, NewAssetVersionFile } from '../../domain/models/asset-version';
import { JobFailure } from '../../domain/models/generation';
import { AssetRepository } from '../../domain/ports/asset-repository';
import { AssetVersionRepository } from '../../domain/ports/asset-version-repository';
import { MediaDownloader } from '../../domain/ports/media-downloader';
import {
  AudioGenerationRequest,
  AudioJobResult,
  ImageGenerationRequest,
  ImageJobResult,
  MediaInput,
  RemoteJobState,
  ResolvedAudioCall,
  ResolvedImageCall
} from '../../domain/ports/provider-adapters';
import { readAudioKind } from '../../domain/rules/asset-prompt-rules';
import { ASSET_AUDIO_MAX_BYTES, detectAudioMime } from '../../domain/rules/asset-rules';
import { detectImageMime } from '../../domain/rules/image-size';
import { BaseRemoteJobQueue, PreparedSubmission, RemoteCancelResult, RemoteCanceller, RemoteJobQueueOptions, RemoteJobQueueProfile, createRemoteCanceller } from './base-remote-job-queue';

/** 生成中的版本最长等待时间。 */
const DEFAULT_MAX_RUNNING_MS = 30 * 60 * 1000;
/** 单张结果图片的大小上限。 */
const IMAGE_RESULT_MAX_BYTES = 30 * 1024 * 1024;

/** 资产队列的特征：默认超时与文案。 */
const ASSET_QUEUE_PROFILE: RemoteJobQueueProfile = {
  defaultMaxRunningMs: DEFAULT_MAX_RUNNING_MS,
  queueName: '资产生成队列',
  subjectName: '资产版本',
  notFoundMessage: '版本不存在或已经结束。',
  missingResultMessage: '平台报告任务已完成，但没有返回结果文件，请重新生成。',
  expiredMessage: '平台已不再保留这个任务，请重新生成。'
};

/** 版本变化通知。 */
export interface AssetVersionChange {
  readonly assetId: number;
  readonly versionId: number;
}

/** 取消版本的结果。 */
export type AssetVersionCancelResult = RemoteCancelResult;

/** 解析图像、音频模型的调用凭据。 */
export interface AssetCallResolver {
  /** @throws ProviderError 模型不可用或没有配置密钥。 */
  resolveImageCall(modelId: number): Promise<ResolvedImageCall>;
  resolveAudioCall(modelId: number): Promise<ResolvedAudioCall>;
}

/** 资产生成队列的依赖与可调参数。 */
export interface AssetGenerationQueueDependencies extends RemoteJobQueueOptions {
  readonly versions: AssetVersionRepository;
  readonly assets: AssetRepository;
  readonly calls: AssetCallResolver;
  readonly downloader: MediaDownloader;
  readonly notify: (change: AssetVersionChange) => void;
}

/** 资产生成队列。 */
export class AssetGenerationQueue extends BaseRemoteJobQueue<AssetVersionRecord, ImageJobResult | AudioJobResult> {
  constructor(private readonly dependencies: AssetGenerationQueueDependencies) {
    super(dependencies, ASSET_QUEUE_PROFILE);
  }

  protected listRunning(): readonly AssetVersionRecord[] {
    return this.dependencies.versions.listByStatus(['running']);
  }

  protected listQueued(): readonly AssetVersionRecord[] {
    return this.dependencies.versions.listByStatus(['queued']);
  }

  protected findCancelable(id: number): AssetVersionRecord | undefined {
    const version = this.dependencies.versions.findVersion(id);
    return version !== undefined && (version.status === 'queued' || version.status === 'running') ? version : undefined;
  }

  protected isRunning(version: AssetVersionRecord): boolean {
    return version.status === 'running';
  }

  /** 先判断超时再查询：超过等待时间的版本直接失败。 */
  protected override failTimeoutBeforeQuery(): boolean {
    return true;
  }

  protected async resolveCanceller(version: AssetVersionRecord): Promise<RemoteCanceller | undefined> {
    const asset = this.dependencies.assets.findById(version.assetId);
    const { calls } = this.dependencies;
    return createRemoteCanceller(asset?.kind === 'audio' ? await calls.resolveAudioCall(version.modelId) : await calls.resolveImageCall(version.modelId));
  }

  /** 解析模型、构造并校验请求，返回真正发起提交与取消的函数；校验失败抛出参数错误。 */
  protected async prepareSubmission(version: AssetVersionRecord): Promise<PreparedSubmission> {
    const { assets, calls } = this.dependencies;
    const asset = assets.findById(version.assetId);
    if (asset === undefined) {
      throw new ProviderError('invalid_request', '资产已被删除。');
    }
    if (asset.kind === 'audio') {
      const call = await calls.resolveAudioCall(version.modelId);
      const request = buildAudioRequest(version, asset, call.modelCode);
      assertValid(call.adapter.validate(request));
      return { submit: () => call.adapter.submit(request, call.context), cancel: createRemoteCanceller(call) };
    }
    const call = await calls.resolveImageCall(version.modelId);
    const request = buildImageRequest(version, assets.listReferenceFiles(asset.id), call.modelCode);
    assertValid(call.adapter.validate(request));
    return { submit: () => call.adapter.submit(request, call.context), cancel: createRemoteCanceller(call) };
  }

  protected async queryRemote(version: AssetVersionRecord, remoteJobId: string): Promise<RemoteJobState<ImageJobResult | AudioJobResult>> {
    const { assets, calls } = this.dependencies;
    if (assets.findById(version.assetId)?.kind === 'audio') {
      const call = await calls.resolveAudioCall(version.modelId);
      return call.adapter.query({ modelCode: call.modelCode, remoteJobId }, call.context);
    }
    const call = await calls.resolveImageCall(version.modelId);
    return call.adapter.query({ modelCode: call.modelCode, remoteJobId }, call.context);
  }

  protected markSubmitted(version: AssetVersionRecord, remoteJobId: string, at: string): boolean {
    return this.dependencies.versions.markSubmitted(version.id, remoteJobId, at);
  }

  protected markCanceled(version: AssetVersionRecord, at: string): boolean {
    return this.dependencies.versions.markCanceled(version.id, at);
  }

  protected markFailed(version: AssetVersionRecord, failure: JobFailure, at: string): boolean {
    return this.dependencies.versions.markFailed(version.id, failure, at);
  }

  protected notifyChange(version: AssetVersionRecord): void {
    this.dependencies.notify({ assetId: version.assetId, versionId: version.id });
  }

  /** 下载结果并保存为版本文件；下载失败按暂时性失败处理，文件格式不对直接失败。 */
  protected async saveResult(version: AssetVersionRecord, result: ImageJobResult | AudioJobResult): Promise<void> {
    const { downloader, versions } = this.dependencies;
    try {
      const files: NewAssetVersionFile[] = [];
      if ('imageUrls' in result) {
        for (const [index, url] of result.imageUrls.entries()) {
          const content = await downloader.download(url, IMAGE_RESULT_MAX_BYTES);
          const mime = detectImageMime(content);
          if (mime === null) {
            this.fail(version, { category: 'server', code: null, message: '平台返回的文件不是有效的 PNG、JPEG 或 WebP 图片。' });
            return;
          }
          files.push({ role: 'result', fileName: `v${version.version}-${index + 1}${extensionOf(mime)}`, mime, width: null, height: null, durationSeconds: null, content, sortOrder: index });
        }
      } else {
        const content = await downloader.download(result.audioUrl, ASSET_AUDIO_MAX_BYTES);
        const mime = detectAudioMime(content);
        if (mime === null) {
          this.fail(version, { category: 'server', code: null, message: '平台返回的文件不是有效的 MP3、WAV 或 M4A 音频。' });
          return;
        }
        files.push({ role: 'result', fileName: `v${version.version}${extensionOf(mime)}`, mime, width: null, height: null, durationSeconds: result.durationSeconds, content, sortOrder: 0 });
      }
      if (files.length === 0) {
        this.fail(version, { category: 'server', code: null, message: '平台没有返回任何结果文件。' });
        return;
      }
      if (versions.markSucceeded(version.id, files, this.timestamp())) {
        this.forget(version.id);
        this.notifyChange(version);
      }
    } catch (error) {
      this.handleSaveFailure(version, error, '保存结果文件失败：');
    }
  }
}

/** 构造图像生成请求：提示词取快照里的提示词，参考图取资产现有的前几张。 */
function buildImageRequest(
  version: AssetVersionRecord,
  referenceFiles: ReadonlyArray<{ readonly mime: string; readonly content: Buffer }>,
  modelCode: string
): ImageGenerationRequest {
  const { snapshot } = version;
  const references: MediaInput[] = snapshot.params.useReferenceImages
    ? referenceFiles.slice(0, snapshot.referenceCount).map((file) => ({ mimeType: file.mime, data: file.content }))
    : [];
  return {
    modelCode,
    prompt: snapshot.prompt,
    negativePrompt: null,
    referenceImages: references,
    aspectRatio: snapshot.params.aspectRatio,
    resolution: snapshot.params.resolution,
    count: snapshot.params.count,
    seed: snapshot.params.seed,
    extraParams: snapshot.params.extraParams
  };
}

/** 构造音频生成请求：音频类型取资产的音频类型，时长由内容决定。 */
function buildAudioRequest(version: AssetVersionRecord, asset: AssetRecord, modelCode: string): AudioGenerationRequest {
  const { snapshot } = version;
  return {
    modelCode,
    audioKind: readAudioKind(asset.attributes),
    prompt: snapshot.prompt,
    durationSeconds: null,
    language: snapshot.params.language,
    voice: snapshot.params.voice,
    referenceAudio: null,
    extraParams: snapshot.params.extraParams
  };
}

/** 适配器校验有问题时抛出参数错误。 */
function assertValid(issues: readonly string[]): void {
  if (issues.length > 0) {
    throw new ProviderError('invalid_request', issues.join('；'));
  }
}

/** 识别出的图片与音频 MIME 类型对应的文件扩展名。 */
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/mp4': '.m4a'
};

/** 按 MIME 类型给出文件扩展名；未登记的类型视为程序错误。 */
function extensionOf(mime: string): string {
  const extension = EXTENSION_BY_MIME[mime];
  if (extension === undefined) {
    throw new Error(`未登记扩展名的 MIME 类型：${mime}`);
  }
  return extension;
}
