/**
 * Markdown 分段解析器（与 React 版同源算法）
 * 核心目标：把流式累积的 buffer 切分为"已闭合的可渲染段" + "未闭合的待定段"
 *
 * 分段边界优先级（从高到低）：
 *   1. 完整代码块（```...``` 配对）
 *   2. 完整表格（header + separator + >=1 数据行）
 *   3. 完整段落（\n\n）
 *   4. 连续列表项
 *
 * 设计要点：
 *   - 一次只 flush 一段已闭合内容，避免大段重渲染
 *   - 保留未闭合段作为 pendingText，由打字机光标展示
 *   - 不依赖完整 Markdown 解析器（性能开销大）
 */

export interface SplitResult {
  flushed: string[];
  pending: string;
}

const RE_LIST_START = /^\s*([-*+]|\d+\.)\s+/;
const RE_TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)*\s*\|?\s*$/;
const RE_CODE_FENCE = /^\s*```/;
const RE_HEADING = /^\s{0,3}#{1,6}\s+/;
const RE_BLOCKQUOTE = /^\s*>/;
const RE_TABLE_ROW = /\|/;

const isListStart = (line: string) => RE_LIST_START.test(line);
const isTableSeparator = (line: string) => RE_TABLE_SEPARATOR.test(line);
const isTableRow = (line: string) => RE_TABLE_ROW.test(line) && line.trim().endsWith('|');
const isCodeFence = (line: string) => RE_CODE_FENCE.test(line);
const isHeading = (line: string) => RE_HEADING.test(line);
const isBlockquote = (line: string) => RE_BLOCKQUOTE.test(line);

const MAX_FLUSH_ITERATIONS = 16;

export function splitMarkdown(buffer: string): SplitResult {
  if (!buffer) return { flushed: [], pending: '' };

  const flushed: string[] = [];
  let remaining = buffer;

  for (let i = 0; i < MAX_FLUSH_ITERATIONS; i++) {
    const result = tryFlushOnce(remaining);
    if (!result) break;
    flushed.push(result.flushed);
    remaining = result.remaining;
    if (!remaining) break;
  }

  return { flushed, pending: remaining };
}

function tryFlushOnce(input: string): { flushed: string; remaining: string } | null {
  if (!input) return null;
  return (
    matchCodeBlock(input) ??
    matchTable(input) ??
    matchParagraph(input) ??
    matchList(input)
  );
}

function matchCodeBlock(input: string): { flushed: string; remaining: string } | null {
  const lines = input.split('\n');
  let openIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isCodeFence(lines[i])) {
      openIdx = i;
      break;
    }
  }
  if (openIdx === -1) return null;

  for (let i = openIdx + 1; i < lines.length; i++) {
    if (isCodeFence(lines[i])) {
      return {
        flushed: lines.slice(0, i + 1).join('\n'),
        remaining: lines.slice(i + 1).join('\n'),
      };
    }
  }
  return null;
}

function matchTable(input: string): { flushed: string; remaining: string } | null {
  const lines = input.split('\n');
  if (lines.length < 3) return null;
  if (!isTableRow(lines[0])) return null;
  if (!isTableSeparator(lines[1])) return null;

  let end = 2;
  while (end < lines.length && isTableRow(lines[end])) end++;
  if (end < 3) return null;

  return {
    flushed: lines.slice(0, end).join('\n'),
    remaining: lines.slice(end).join('\n'),
  };
}

function matchParagraph(input: string): { flushed: string; remaining: string } | null {
  const idx = input.indexOf('\n\n');
  if (idx === -1) return null;

  const candidate = input.slice(0, idx);
  if (!candidate.trim()) return null;

  const lines = candidate.split('\n');
  if (lines.some(isCodeFence)) return null;
  if (isListStart(lines[0])) return null;

  if (lines.length >= 2 && isTableRow(lines[0]) && isTableSeparator(lines[1])) {
    return null;
  }

  return { flushed: candidate, remaining: input.slice(idx + 2) };
}

function matchList(input: string): { flushed: string; remaining: string } | null {
  const lines = input.split('\n');
  if (lines.length < 2) return null;
  if (!isListStart(lines[0])) return null;

  let end = 1;
  while (end < lines.length) {
    const cur = lines[end];
    if (isListStart(cur)) {
      end++;
      continue;
    }
    if (cur.trim() === '' && (end + 1 >= lines.length || !isListStart(lines[end + 1]))) {
      end++;
      break;
    }
    break;
  }
  if (end < 2) return null;

  return {
    flushed: lines.slice(0, end).join('\n').trimEnd(),
    remaining: lines.slice(end).join('\n'),
  };
}
