/**
 * The answer parser for `AiActionResult.markdown` (Section 7.4's `ai_*`
 * response shape).
 *
 * Its contract is narrow on purpose, and the narrowness is the security
 * property. Section 8.10 makes the *backend* the only thing allowed to decide
 * that a path is real: it extracts every candidate path from the model's
 * answer, rejects the whole answer if any of them is absent from the index,
 * and rewrites the survivors into `[[path:line]]` tokens (step 4). So a token
 * is the ONLY construct this parser will ever turn into a citation. A path
 * that merely looks like a path — in prose, in backticks, in a fenced block —
 * stays inert text, because those are exactly the unverified paths the
 * backend's rejection step exists to keep out. Linkifying one here would
 * quietly re-introduce what the verifier just refused.
 *
 * Deliberately NOT a general markdown renderer (no `react-markdown`, no
 * `dangerouslySetInnerHTML`): the input is model output, and the smallest
 * possible grammar — headings, lists, fenced code, inline code, bold,
 * citation tokens — is both all the answers need and the least surface for
 * anything to escape through. Every leaf is rendered by React as a text node.
 */

export type AnswerSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'citation'; readonly path: string; readonly line: number };

export type AnswerBlock =
  | { readonly kind: 'paragraph'; readonly segments: readonly AnswerSegment[] }
  | { readonly kind: 'heading'; readonly segments: readonly AnswerSegment[] }
  | { readonly kind: 'bullets'; readonly items: readonly (readonly AnswerSegment[])[] }
  | { readonly kind: 'ordered'; readonly items: readonly (readonly AnswerSegment[])[] }
  | { readonly kind: 'codeBlock'; readonly text: string };

/**
 * `[[path:line]]` — the backend's verified-citation token. The path may not
 * contain whitespace, `:` or a bracket, and the line must be digits, so a
 * half-written token (`[[src/index.ts]]`) matches nothing and survives as
 * literal text rather than being guessed at.
 */
const INLINE_PATTERN = /\[\[([^\s[\]:]+):(\d+)\]\]|`([^`]+)`|\*\*([^*]+)\*\*/g;

const FENCE_LINE = /^\s{0,3}```/;
const HEADING_LINE = /^\s{0,3}#{1,6}\s+(.*)$/;
const BULLET_LINE = /^\s*[-*]\s+(.*)$/;
const ORDERED_LINE = /^\s*\d+[.)]\s+(.*)$/;
const DECIMAL_RADIX = 10;

function toInlineSegment(match: RegExpMatchArray): AnswerSegment {
  const [, citedPath, citedLine, code, strong] = match;
  if (citedPath !== undefined && citedLine !== undefined) {
    return { kind: 'citation', path: citedPath, line: Number.parseInt(citedLine, DECIMAL_RADIX) };
  }
  if (code !== undefined) {
    return { kind: 'code', text: code };
  }
  return { kind: 'strong', text: strong ?? '' };
}

function withText(segments: readonly AnswerSegment[], text: string): readonly AnswerSegment[] {
  return text === '' ? segments : [...segments, { kind: 'text', text }];
}

/** Splits one line of answer prose into inline segments. Tokens become citations; nothing else can. */
export function parseAnswerSegments(text: string): readonly AnswerSegment[] {
  let segments: readonly AnswerSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    segments = [...withText(segments, text.slice(cursor, start)), toInlineSegment(match)];
    cursor = start + match[0].length;
  }
  return withText(segments, text.slice(cursor));
}

interface ConsumedBlock {
  readonly block: AnswerBlock;
  readonly nextIndex: number;
}

/**
 * A fenced block is copied out verbatim and never tokenized: a `[[…]]` that
 * appears inside example code is example code, not a citation.
 */
function consumeFence(lines: readonly string[], start: number): ConsumedBlock {
  let index = start + 1;
  const body: string[] = [];
  while (index < lines.length && !FENCE_LINE.test(lines[index] ?? '')) {
    body.push(lines[index] ?? '');
    index += 1;
  }
  return { block: { kind: 'codeBlock', text: body.join('\n') }, nextIndex: index + 1 };
}

function consumeList(
  lines: readonly string[],
  start: number,
  pattern: RegExp,
  kind: 'bullets' | 'ordered',
): ConsumedBlock {
  let index = start;
  const items: (readonly AnswerSegment[])[] = [];
  let match = pattern.exec(lines[index] ?? '');
  while (index < lines.length && match !== null) {
    items.push(parseAnswerSegments(match[1] ?? ''));
    index += 1;
    match = index < lines.length ? pattern.exec(lines[index] ?? '') : null;
  }
  return { block: { kind, items }, nextIndex: index };
}

function isBlockStart(line: string): boolean {
  return (
    line.trim() === '' ||
    FENCE_LINE.test(line) ||
    HEADING_LINE.test(line) ||
    BULLET_LINE.test(line) ||
    ORDERED_LINE.test(line)
  );
}

/** Consecutive non-blank lines are one paragraph; a soft line break reads as a space. */
function consumeParagraph(lines: readonly string[], start: number): ConsumedBlock {
  let index = start;
  const collected: string[] = [];
  while (index < lines.length && !isBlockStart(lines[index] ?? '')) {
    collected.push((lines[index] ?? '').trim());
    index += 1;
  }
  return {
    block: { kind: 'paragraph', segments: parseAnswerSegments(collected.join(' ')) },
    nextIndex: index,
  };
}

function consumeBlock(lines: readonly string[], index: number): ConsumedBlock | null {
  const line = lines[index] ?? '';
  if (FENCE_LINE.test(line)) {
    return consumeFence(lines, index);
  }
  const heading = HEADING_LINE.exec(line);
  if (heading !== null) {
    return {
      block: { kind: 'heading', segments: parseAnswerSegments(heading[1] ?? '') },
      nextIndex: index + 1,
    };
  }
  if (BULLET_LINE.test(line)) {
    return consumeList(lines, index, BULLET_LINE, 'bullets');
  }
  if (ORDERED_LINE.test(line)) {
    return consumeList(lines, index, ORDERED_LINE, 'ordered');
  }
  return line.trim() === '' ? null : consumeParagraph(lines, index);
}

/** Splits an answer into renderable blocks. Whitespace-only input yields no blocks — the caller shows its own empty state. */
export function parseAnswerBlocks(markdown: string): readonly AnswerBlock[] {
  const lines = markdown.split('\n');
  const blocks: AnswerBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const consumed = consumeBlock(lines, index);
    if (consumed === null) {
      index += 1;
      continue;
    }
    blocks.push(consumed.block);
    index = consumed.nextIndex;
  }
  return blocks;
}
