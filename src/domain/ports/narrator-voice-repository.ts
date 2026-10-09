// ------------------------------------------------------------------------
// 名称：narrator-voice-repository.ts
// 说明：作品旁白音色数据访问的端口接口：读取、设置、清除。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：同步调用；旁白不属于任何角色实体，所以音色参考按作品保存，作品里所有集共用；资产被删除时记录随之级联删除。
// ------------------------------------------------------------------------

/** 作品当前的旁白音色。 */
export interface NarratorVoiceRecord {
  readonly workId: number;
  readonly assetId: number;
  readonly assetName: string;
}

/** 作品旁白音色的数据访问接口。 */
export interface NarratorVoiceRepository {
  /** 读取作品的旁白音色；没有设置返回 undefined。 */
  find(workId: number): NarratorVoiceRecord | undefined;
  /** 设置作品的旁白音色，已有的被替换。 */
  set(workId: number, assetId: number, timestamp: string): void;
  /** 清除作品的旁白音色；没有设置时什么也不做。 */
  clear(workId: number): void;
}
