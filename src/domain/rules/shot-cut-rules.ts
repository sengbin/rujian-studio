// ------------------------------------------------------------------------
// 名称：shot-cut-rules.ts
// 说明：镜头组之间“硬切”的规则：判断两个相邻镜头之间是否构成有效的剪辑切换（场次变化，或景别、机位发生变化），并检查每组第一个镜头与上一组最后一个镜头的衔接。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-07
// 备注：纯函数；景别与机位是模型或用户填写的自由文字，识别不了时按文字是否相同判断，任一方为空视为无法判断、不当作问题。
// ------------------------------------------------------------------------

import { FirstFrameMode } from '../models/storyboard';

/** 判断剪辑切换所需的镜头外观信息；景别与机位缺省视为未填写。 */
export interface CutLook {
  readonly sceneLabel: string;
  readonly shotSize?: string;
  readonly cameraAngle?: string;
}

/** 景别的识别规则：先命中的优先，较具体的词必须排在泛称之前（大远景先于远景，中近景先于近景）。 */
const SHOT_SIZE_RULES: ReadonlyArray<{ readonly words: readonly string[]; readonly level: number }> = [
  { words: ['大远景', '极远景'], level: 1 },
  { words: ['中全景', '中远景'], level: 3.5 },
  { words: ['远景'], level: 2 },
  { words: ['全景'], level: 3 },
  { words: ['中近景'], level: 5 },
  { words: ['中景'], level: 4 },
  { words: ['大特写', '极特写'], level: 8 },
  { words: ['特写'], level: 7 },
  { words: ['近景'], level: 6 }
];

/** 机位的识别规则：先命中的优先（侧面平视归为侧面）。 */
const CAMERA_ANGLE_RULES: ReadonlyArray<{ readonly words: readonly string[]; readonly kind: string }> = [
  { words: ['俯拍', '俯视', '高角度', '鸟瞰'], kind: 'high' },
  { words: ['仰拍', '仰视', '低角度'], kind: 'low' },
  { words: ['过肩'], kind: 'over_shoulder' },
  { words: ['背面', '背对', '背后'], kind: 'back' },
  { words: ['侧面', '侧拍', '侧'], kind: 'side' },
  { words: ['正面', '正对'], kind: 'front' },
  { words: ['平视', '平拍', '水平'], kind: 'level' }
];

/** 去掉空白与标点后的文字，用于识别不了时比较两段文字是否相同。 */
function normalize(text: string | undefined): string {
  return (text ?? '').replace(/[\s,，、。；;：:]/g, '');
}

/** 景别的取景等级；识别不了为 null。 */
export function shotSizeLevel(text: string | undefined): number | null {
  const label = normalize(text);
  return SHOT_SIZE_RULES.find((rule) => rule.words.some((word) => label.includes(word)))?.level ?? null;
}

/** 机位的类别；识别不了为 null。 */
function cameraAngleKind(text: string | undefined): string | null {
  const label = normalize(text);
  return CAMERA_ANGLE_RULES.find((rule) => rule.words.some((word) => label.includes(word)))?.kind ?? null;
}

/** 某一项（景别或机位）的变化：任一方没填写时无法判断。 */
function compare(before: string | undefined, after: string | undefined, classify: (text: string | undefined) => number | string | null): 'changed' | 'same' | 'unknown' {
  if (normalize(before) === '' || normalize(after) === '') return 'unknown';
  const left = classify(before);
  const right = classify(after);
  const different = left !== null && right !== null ? left !== right : normalize(before) !== normalize(after);
  return different ? 'changed' : 'same';
}

/** 相邻两个镜头之间的切换情况：有效切换（场次变化，或景别、机位至少有一项变化）、没有变化（景别和机位都没变）、无法判断。 */
export type CutChange = 'cut' | 'unchanged' | 'unknown';

export function classifyCut(before: CutLook, after: CutLook): CutChange {
  if (before.sceneLabel !== after.sceneLabel) return 'cut';
  const parts = [compare(before.shotSize, after.shotSize, shotSizeLevel), compare(before.cameraAngle, after.cameraAngle, cameraAngleKind)];
  if (parts.includes('changed')) return 'cut';
  return parts.every((part) => part === 'same') ? 'unchanged' : 'unknown';
}

/** 是否确定是有效的剪辑切换；无法判断时不算。 */
export function isEffectiveCut(before: CutLook, after: CutLook): boolean {
  return classifyCut(before, after) === 'cut';
}

/** 检查所需的镜头信息。 */
export interface CutCheckShot extends CutLook {
  readonly id: number;
  readonly firstFrameMode: FirstFrameMode;
  readonly entityIds: readonly number[];
}

/** 组间衔接的提醒类别：硬切但画面没有变化；接尾帧会丢掉本组的参考图和音色。 */
export type CutNoticeCode = 'cut_unchanged' | 'tail_drops_references';

/** 一条组间衔接提醒，挂在组的第一个镜头上。 */
export interface CutNotice {
  readonly shotId: number;
  readonly code: CutNoticeCode;
  readonly text: string;
}

/**
 * 检查每组第一个镜头与上一组最后一个镜头的衔接（第一组没有上一组，不检查）。
 * @param shots 本集全部镜头。
 * @param groups 按组序号排列的各组镜头标识。
 * @param referencedEntityIds 已绑定形象或音色参考的实体标识。
 */
export function checkGroupCuts(shots: readonly CutCheckShot[], groups: ReadonlyArray<readonly number[]>, referencedEntityIds: ReadonlySet<number>): CutNotice[] {
  const byId = new Map(shots.map((shot) => [shot.id, shot]));
  const notices: CutNotice[] = [];
  for (let index = 1; index < groups.length; index += 1) {
    const first = byId.get(groups[index][0]);
    const previousLast = byId.get(groups[index - 1][groups[index - 1].length - 1]);
    if (first === undefined || previousLast === undefined) continue;
    if (first.firstFrameMode === 'prev_tail') {
      const hasReferences = groups[index].some((id) => (byId.get(id)?.entityIds ?? []).some((entityId) => referencedEntityIds.has(entityId)));
      if (hasReferences) {
        notices.push({
          shotId: first.id,
          code: 'tail_drops_references',
          text: `第 ${index + 1} 组以上一镜头尾帧作首帧，本组角色和场景的参考图、音色不会传给模型；需要保持形象和声音时，把首帧来源改为“不指定”。`
        });
      }
    } else if (first.firstFrameMode === 'none' && classifyCut(previousLast, first) === 'unchanged') {
      notices.push({
        shotId: first.id,
        code: 'cut_unchanged',
        text: `第 ${index + 1} 组开头与上一组最后一个镜头相比，景别和机位都没有变化；组与组之间是硬切，画面可能像跳切，建议改变景别或机位。`
      });
    }
  }
  return notices;
}
