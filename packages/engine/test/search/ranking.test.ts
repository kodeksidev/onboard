import { describe, expect, test } from 'bun:test';
import { scoreFile, type FileScoringInput, type TermWeight } from '../../src/search/ranking';

function fileInput(overrides: Partial<FileScoringInput> = {}): FileScoringInput {
  return {
    classification: 'unknown',
    importance: 0,
    basenameWithoutExtLower: 'user',
    pathSegmentsLower: ['src'],
    symbols: [],
    tokenOccurrencesByTerm: new Map(),
    ...overrides,
  };
}

function directTerm(term: string): readonly TermWeight[] {
  return [{ term, weightFactor: 1.0 }];
}

describe('scoreFile — symbol tiers (first match wins: exact > prefix > substring)', () => {
  test('an exact symbol name match scores W_SYMBOL_EXACT (100)', () => {
    const detail = scoreFile(directTerm('auth'), fileInput({ symbols: [{ nameLower: 'auth', isExported: false }] }));
    expect(detail.score).toBe(100);
    expect(detail.matchKinds).toEqual(['symbol-exact']);
  });

  test('a prefix-only match scores W_SYMBOL_PREFIX (60), not exact', () => {
    const detail = scoreFile(directTerm('auth'), fileInput({ symbols: [{ nameLower: 'authenticate', isExported: false }] }));
    expect(detail.score).toBe(60);
    expect(detail.matchKinds).toEqual(['symbol-prefix']);
  });

  test('a substring-only match scores W_SYMBOL_SUBSTRING (30)', () => {
    const detail = scoreFile(directTerm('auth'), fileInput({ symbols: [{ nameLower: 'isauthorized', isExported: false }] }));
    expect(detail.score).toBe(30);
    expect(detail.matchKinds).toEqual(['symbol-substring']);
  });

  test('an exported best-symbol match adds W_EXPORTED_BONUS (8)', () => {
    const detail = scoreFile(directTerm('auth'), fileInput({ symbols: [{ nameLower: 'auth', isExported: true }] }));
    expect(detail.score).toBe(108);
  });
});

describe('scoreFile — filename tiers', () => {
  test('an exact basename match scores W_FILENAME_EXACT (45)', () => {
    const detail = scoreFile(directTerm('user'), fileInput({ basenameWithoutExtLower: 'user' }));
    expect(detail.score).toBe(45);
    expect(detail.matchKinds).toEqual(['filename-exact']);
  });

  test('a substring basename match scores W_FILENAME_SUBSTR (20)', () => {
    const detail = scoreFile(directTerm('user'), fileInput({ basenameWithoutExtLower: 'user-controller' }));
    expect(detail.score).toBe(20);
    expect(detail.matchKinds).toEqual(['filename-substring']);
  });
});

describe('scoreFile — path segment and content', () => {
  test('a matching path segment scores W_PATH_SEGMENT (15)', () => {
    const detail = scoreFile(directTerm('auth'), fileInput({ pathSegmentsLower: ['src', 'auth'] }));
    expect(detail.score).toBe(15);
    expect(detail.matchKinds).toEqual(['path-segment']);
  });

  test('content occurrences score min(4*log2(1+occurrences), 24)', () => {
    const detail = scoreFile(directTerm('auth'), fileInput({ tokenOccurrencesByTerm: new Map([['auth', 1]]) }));
    expect(detail.score).toBeCloseTo(4 * Math.log2(2), 3);
  });

  test('content score is capped at W_CONTENT_CAP (24) for a large occurrence count', () => {
    const detail = scoreFile(directTerm('auth'), fileInput({ tokenOccurrencesByTerm: new Map([['auth', 100000]]) }));
    expect(detail.score).toBe(24);
  });
});

describe('scoreFile — per-file bonuses/penalties (applied once, not per term)', () => {
  test('adds W_IMPORTANCE * importance', () => {
    const detail = scoreFile(directTerm('zzz'), fileInput({ importance: 0.4 }));
    expect(detail.score).toBeCloseTo(25 * 0.4, 3);
  });

  test('applies P_TEST (-20) for a test-classified file', () => {
    const detail = scoreFile(directTerm('auth'), fileInput({ classification: 'test', symbols: [{ nameLower: 'auth', isExported: false }] }));
    expect(detail.score).toBe(80); // 100 - 20
  });

  test('applies P_GENERATED (-30) for a generated-classified file', () => {
    const detail = scoreFile(directTerm('auth'), fileInput({ classification: 'generated', symbols: [{ nameLower: 'auth', isExported: false }] }));
    expect(detail.score).toBe(70);
  });

  test('applies P_FIXTURE (-15) for a fixture-classified file', () => {
    const detail = scoreFile(directTerm('auth'), fileInput({ classification: 'fixture', symbols: [{ nameLower: 'auth', isExported: false }] }));
    expect(detail.score).toBe(85);
  });

  test('never goes negative — score is clamped at 0', () => {
    const detail = scoreFile(directTerm('zzz'), fileInput({ classification: 'generated', importance: 0 }));
    expect(detail.score).toBe(0);
  });
});

describe('scoreFile — expansion decay', () => {
  test('an expanded term (weightFactor 0.6) contributes 60% of a direct term\'s score', () => {
    const direct = scoreFile([{ term: 'auth', weightFactor: 1.0 }], fileInput({ basenameWithoutExtLower: 'auth' }));
    const expanded = scoreFile([{ term: 'auth', weightFactor: 0.6 }], fileInput({ basenameWithoutExtLower: 'auth' }));
    expect(expanded.score).toBeCloseTo(direct.score * 0.6, 3);
  });
});

describe('scoreFile — multiple terms sum, and matchKinds is deduped/ordered', () => {
  test('sums points across terms and reports every distinct match kind once, in a fixed order', () => {
    const terms: TermWeight[] = [
      { term: 'auth', weightFactor: 1.0 },
      { term: 'user', weightFactor: 1.0 },
    ];
    const detail = scoreFile(
      terms,
      fileInput({
        basenameWithoutExtLower: 'user',
        symbols: [{ nameLower: 'auth', isExported: false }],
      }),
    );
    expect(detail.matchKinds).toEqual(['symbol-exact', 'filename-exact']);
    expect(detail.score).toBe(100 + 45);
  });
});
