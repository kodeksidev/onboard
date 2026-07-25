/**
 * @onboard/engine — inverted token index rows (Section 6.1's `token_index`
 * table, Section 8.7's content search, A12).
 *
 * Tokenization is language-agnostic and runs over EVERY file's raw text
 * (not just the four parsed grammars), so "where is X?" can still find a
 * hit in a README or a config file — token extraction is a separate concern
 * from symbol/import extraction (Section 9 Phase 3 lists `index/token-index.ts`
 * as its own module, distinct from `parse/`).
 */
import { MAX_LINES_PER_TOKEN } from '../constants';
import type { TokenIndexRow } from '../cache/cache-store';

const MIN_TOKEN_LENGTH = 3;
const NON_WORD_SPLIT_PATTERN = /[^A-Za-z0-9_]+/;
const CAMEL_BOUNDARY_LOWER_UPPER = /([a-z0-9])([A-Z])/g;
const CAMEL_BOUNDARY_ACRONYM = /([A-Z]+)([A-Z][a-z])/g;

/** Splits `identifierLikeSnakeOrCamel` into its constituent words, plus the whole token. */
function splitIdentifierWords(raw: string): readonly string[] {
  const bySeparator = raw.split(/[_-]+/).filter((part) => part.length > 0);
  const words: string[] = [];
  for (const part of bySeparator) {
    const spaced = part.replace(CAMEL_BOUNDARY_LOWER_UPPER, '$1 $2').replace(CAMEL_BOUNDARY_ACRONYM, '$1 $2');
    words.push(...spaced.split(' ').filter((word) => word.length > 0));
  }
  if (bySeparator.length > 1 || words.length > 1) {
    words.push(raw);
  }
  return words;
}

/** Lowercased, length-filtered tokens for one line of text, in first-seen order. */
function tokensForLine(lineText: string): readonly string[] {
  const rawTokens = lineText.split(NON_WORD_SPLIT_PATTERN).filter((token) => token.length > 0);
  const words: string[] = [];
  for (const raw of rawTokens) {
    words.push(...splitIdentifierWords(raw));
  }
  return words.map((word) => word.toLowerCase()).filter((word) => word.length >= MIN_TOKEN_LENGTH);
}

interface TokenAccumulator {
  count: number;
  readonly lines: number[];
}

function byToken(a: TokenIndexRow, b: TokenIndexRow): number {
  return a.token < b.token ? -1 : a.token > b.token ? 1 : 0;
}

/** Builds the cache `token_index` rows for one file's raw text, sorted by token. */
export function buildTokenIndexRows(path: string, text: string): readonly TokenIndexRow[] {
  const accumulators = new Map<string, TokenAccumulator>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    for (const token of tokensForLine(lines[i] ?? '')) {
      let accumulator = accumulators.get(token);
      if (accumulator === undefined) {
        accumulator = { count: 0, lines: [] };
        accumulators.set(token, accumulator);
      }
      accumulator.count += 1;
      const lastLine = accumulator.lines.at(-1);
      if (lastLine !== lineNumber && accumulator.lines.length < MAX_LINES_PER_TOKEN) {
        accumulator.lines.push(lineNumber);
      }
    }
  }
  const tokens = [...accumulators.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rows = tokens.map((token): TokenIndexRow => {
    const accumulator = accumulators.get(token);
    const count = accumulator?.count ?? 0;
    const tokenLines = accumulator?.lines ?? [];
    return { token, path, count, linesJson: JSON.stringify(tokenLines) };
  });
  return rows.sort(byToken);
}
