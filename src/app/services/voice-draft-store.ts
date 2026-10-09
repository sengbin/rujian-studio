// ------------------------------------------------------------------------
// 名称：voice-draft-store.ts
// 说明：试听音色的内存暂存：说话人还没有绑定音色时，按描述生成的试听音色先暂存在这里，供动画预览当作临时音色使用，用户采用后才保存为音频资产并绑定。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：只在内存中，重启后清空；按作品和说话人各存一个，重新生成会替换；总条数有上限，超过时淘汰最久没有使用的。
// ------------------------------------------------------------------------

/** 暂存条数上限。 */
const MAX_DRAFTS = 24;

/** 一个暂存的试听音色。 */
export interface VoiceDraft {
  readonly workId: number;
  /** 说话人键：角色为 entity:标识，旁白为 narrator。 */
  readonly speakerKey: string;
  /** 生成它的音频模型。 */
  readonly modelId: number;
  /** 试听样本的 MIME 类型与内容。 */
  readonly mime: string;
  readonly content: Buffer;
  /** 样本时长（秒），平台没有返回时为 null。 */
  readonly durationSeconds: number | null;
  /** 样本念的台词。 */
  readonly sampleText: string;
  /** 生成时使用的音色描述。 */
  readonly description: string;
  /** 语言代码（zh、en），不确定时为 null。 */
  readonly language: string | null;
  /** 模型只有预置音色时所用的音色名，否则为 null。 */
  readonly presetVoice: string | null;
}

/** 试听音色的内存暂存。 */
export class VoiceDraftStore {
  private readonly drafts = new Map<string, VoiceDraft>();

  /** 读取暂存的试听音色；没有返回 undefined。 */
  find(workId: number, speakerKey: string): VoiceDraft | undefined {
    return this.drafts.get(keyOf(workId, speakerKey));
  }

  /** 暂存试听音色，同一说话人已有的被替换；超过条数上限时淘汰最久没有使用的。 */
  save(draft: VoiceDraft): void {
    const key = keyOf(draft.workId, draft.speakerKey);
    this.drafts.delete(key);
    this.drafts.set(key, draft);
    for (const oldKey of this.drafts.keys()) {
      if (this.drafts.size <= MAX_DRAFTS) {
        break;
      }
      this.drafts.delete(oldKey);
    }
  }

  /** 丢弃暂存的试听音色。 */
  delete(workId: number, speakerKey: string): void {
    this.drafts.delete(keyOf(workId, speakerKey));
  }

  /** 列出作品里全部暂存的试听音色。 */
  listByWork(workId: number): VoiceDraft[] {
    return [...this.drafts.values()].filter((draft) => draft.workId === workId);
  }
}

function keyOf(workId: number, speakerKey: string): string {
  return `${workId}:${speakerKey}`;
}
