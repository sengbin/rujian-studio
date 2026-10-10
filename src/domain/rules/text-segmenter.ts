// ------------------------------------------------------------------------
// 名称：text-segmenter.ts
// 说明：把原稿文字切成段落和片段（按行与引号），并提供带编号的呈现和带说话人标记的呈现；供原创文稿的集拆分与结构标注使用。
// 作者：sengbin
// 邮箱：chengbin@3578.cn
// 日期：2026-10-05
// 备注：纯函数；段落、片段按顺序拼接都严格等于输入文本，模型只引用序号，不复制原文，因此原稿不会被改动。
// ------------------------------------------------------------------------

import { TextSegment } from '../models/screenplay';

/** 引号的起止符号；直引号的起止相同。 */
const QUOTE_PAIRS: Readonly<Record<string, string>> = { '“': '”', '「': '」', '『': '』', '"': '"' };

/** 无法确定说话人时的标记文字。 */
const UNKNOWN_DIALOGUE_MARK = '〔说话人未知〕';
const UNKNOWN_THOUGHT_MARK = '〔心声，说话人未知〕';

/**
 * 把文本切成段落：一个非空行加上它后面的空行为一个段落；开头的空行并入第一个段落。
 * @param text 原文。
 * @returns 段落列表，按顺序拼接等于原文。
 */
export function splitParagraphs(text: string): string[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const paragraphs: string[] = [];
  let leading = '';
  for (const line of lines) {
    if (line.trim().length > 0) {
      paragraphs.push(leading + line);
      leading = '';
    } else if (paragraphs.length > 0) {
      paragraphs[paragraphs.length - 1] += line;
    } else {
      leading += line;
    }
  }
  if (leading.length > 0) {
    paragraphs.push(leading);
  }
  return paragraphs;
}

/** 把只有空白的片段并入相邻片段，保证每个片段都有可见文字（拼接结果不变）。 */
function mergeBlankPieces(pieces: readonly string[]): string[] {
  const merged: string[] = [];
  let leading = '';
  for (const piece of pieces) {
    if (piece.trim().length > 0) {
      merged.push(leading + piece);
      leading = '';
    } else if (merged.length > 0) {
      merged[merged.length - 1] += piece;
    } else {
      leading += piece;
    }
  }
  return leading.length > 0 ? [...merged, leading] : merged;
}

/** 把一个段落按引号切成片段：引号内的内容单独成片段，引号外的叙述成片段；段落末尾的换行并入最后一个片段。 */
function splitByQuotes(paragraph: string): string[] {
  const body = paragraph.trimEnd();
  const tail = paragraph.slice(body.length);
  const pieces: string[] = [];
  let current = '';
  let closing: string | null = null;
  for (const character of body) {
    if (closing === null) {
      const close = QUOTE_PAIRS[character];
      if (close === undefined) {
        current += character;
        continue;
      }
      if (current.length > 0) {
        pieces.push(current);
      }
      current = character;
      closing = close;
      continue;
    }
    current += character;
    if (character === closing) {
      pieces.push(current);
      current = '';
      closing = null;
    }
  }
  if (current.length > 0) {
    pieces.push(current);
  }
  if (pieces.length === 0) {
    return [paragraph];
  }
  pieces[pieces.length - 1] += tail;
  return pieces;
}

/**
 * 把文本切成片段：先按段落，再在引号处切开，引号内外各自成片段。
 * @param text 集正文。
 * @returns 片段列表，按顺序拼接等于原文，每个片段都含可见文字。
 */
export function splitSegments(text: string): string[] {
  return mergeBlankPieces(splitParagraphs(text).flatMap(splitByQuotes));
}

/**
 * 给文本片段加序号，每行一个“[序号] 文字”，序号从 1 开始；片段末尾的空白不显示。
 * @param pieces 段落或片段。
 */
export function renderNumbered(pieces: readonly string[]): string {
  return pieces.map((piece, index) => `[${index + 1}] ${piece.trimEnd()}`).join('\n');
}

/**
 * 呈现带说话人标记的集正文，供分镜等下游理解谁在说话：对白前加“〔角色名说〕”，心声前加“〔角色名心想〕”，旁白保持原样。
 * @param segments 已标注的片段。
 */
export function renderAnnotatedText(segments: readonly TextSegment[]): string {
  return segments
    .map((segment) => {
      if (segment.kind === 'narration') {
        return segment.text;
      }
      if (segment.speaker === null) {
        return `${segment.kind === 'dialogue' ? UNKNOWN_DIALOGUE_MARK : UNKNOWN_THOUGHT_MARK}${segment.text}`;
      }
      return `〔${segment.speaker}${segment.kind === 'dialogue' ? '说' : '心想'}〕${segment.text}`;
    })
    .join('');
}
