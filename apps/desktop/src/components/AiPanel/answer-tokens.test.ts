import { describe, expect, test } from 'vitest';
import { parseAnswerBlocks, parseAnswerSegments } from './answer-tokens';

/**
 * Section 8.10 step 4: the backend rewrites every VERIFIED citation into a
 * `[[path:line]]` token. This parser's contract is therefore narrow and
 * security-relevant — a token is the only thing that may become a jump link,
 * and a path that merely looks like a path must stay inert text.
 */
describe('parseAnswerSegments', () => {
  test('splits a verified [[path:line]] token out of the surrounding prose', () => {
    const segments = parseAnswerSegments('Requests enter at [[src/index.ts:12]] and fan out.');

    expect(segments).toEqual([
      { kind: 'text', text: 'Requests enter at ' },
      { kind: 'citation', path: 'src/index.ts', line: 12 },
      { kind: 'text', text: ' and fan out.' },
    ]);
  });

  test('leaves a bare path in prose as plain text — only tokens are citations', () => {
    const segments = parseAnswerSegments('See src/index.ts for the entry point.');

    expect(segments).toEqual([{ kind: 'text', text: 'See src/index.ts for the entry point.' }]);
  });

  test('leaves a backticked path as inline code, never as a citation', () => {
    const segments = parseAnswerSegments('See `src/index.ts` for details.');

    expect(segments).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'code', text: 'src/index.ts' },
      { kind: 'text', text: ' for details.' },
    ]);
  });

  test('ignores a malformed token that carries no line number', () => {
    const segments = parseAnswerSegments('Look at [[src/index.ts]].');

    expect(segments).toEqual([{ kind: 'text', text: 'Look at [[src/index.ts]].' }]);
  });

  test('parses bold spans', () => {
    expect(parseAnswerSegments('This is **important** here.')).toEqual([
      { kind: 'text', text: 'This is ' },
      { kind: 'strong', text: 'important' },
      { kind: 'text', text: ' here.' },
    ]);
  });

  test('parses several citations in one line', () => {
    const segments = parseAnswerSegments('[[a/b.ts:1]] then [[c/d.py:340]]');

    expect(segments.filter((segment) => segment.kind === 'citation')).toEqual([
      { kind: 'citation', path: 'a/b.ts', line: 1 },
      { kind: 'citation', path: 'c/d.py', line: 340 },
    ]);
  });
});

describe('parseAnswerBlocks', () => {
  test('treats blank-line-separated runs as separate paragraphs', () => {
    const blocks = parseAnswerBlocks('First line.\nStill first.\n\nSecond paragraph.');

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('paragraph');
    expect(blocks[1]?.kind).toBe('paragraph');
  });

  test('parses an ATX heading of any level as one heading block', () => {
    const blocks = parseAnswerBlocks('## What this does\n\nText.');

    expect(blocks[0]).toEqual({
      kind: 'heading',
      segments: [{ kind: 'text', text: 'What this does' }],
    });
  });

  test('groups consecutive dash/star lines into one bullet list', () => {
    const blocks = parseAnswerBlocks('- one\n- two\n* three');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('bullets');
    expect(blocks[0]?.kind === 'bullets' ? blocks[0].items : []).toHaveLength(3);
  });

  test('groups consecutive numbered lines into one ordered list', () => {
    const blocks = parseAnswerBlocks('1. one\n2. two');

    expect(blocks[0]?.kind).toBe('ordered');
    expect(blocks[0]?.kind === 'ordered' ? blocks[0].items : []).toHaveLength(2);
  });

  test('keeps a fenced code block verbatim and does not tokenize inside it', () => {
    const blocks = parseAnswerBlocks('```ts\nconst a = `x`; // [[src/index.ts:1]]\n```');

    expect(blocks).toEqual([
      { kind: 'codeBlock', text: 'const a = `x`; // [[src/index.ts:1]]' },
    ]);
  });

  test('returns no blocks for whitespace-only markdown', () => {
    expect(parseAnswerBlocks('   \n\n  ')).toEqual([]);
  });
});
