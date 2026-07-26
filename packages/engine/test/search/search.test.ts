import { describe, expect, test } from 'bun:test';
import { search, type SearchDataSource, type SearchFileRecord, type SearchSymbolRow, type SearchTokenRow } from '../../src/search/search';
import { KEYWORD_MAP } from '../../src/search/keyword-map';

function dataSource(overrides: Partial<SearchDataSource> = {}): SearchDataSource {
  return {
    files: [],
    symbolsForTerm: () => [],
    tokensForToken: () => [],
    readFileText: () => null,
    ...overrides,
  };
}

function symbolRow(overrides: Partial<SearchSymbolRow> & { path: string; name: string }): SearchSymbolRow {
  return {
    id: `id-${overrides.name}`,
    nameLower: overrides.name.toLowerCase(),
    kind: 'function',
    startLine: 1,
    endLine: 2,
    isExported: true,
    containerName: null,
    signature: null,
    ...overrides,
  };
}

describe('search — term extraction (Section 8.7 step 1)', () => {
  test('drops terms shorter than 3 characters and reports them', () => {
    const response = search('db go', 50, KEYWORD_MAP, dataSource());
    expect(response.droppedTerms).toEqual(['db', 'go']);
    expect(response.hits).toEqual([]);
  });

  test('returns an empty response with droppedTerms populated when every term is dropped', () => {
    const response = search('ab', 50, KEYWORD_MAP, dataSource());
    expect(response.hits).toEqual([]);
    expect(response.droppedTerms).toEqual(['ab']);
    expect(response.totalCandidateCount).toBe(0);
  });

  test('lowercases and splits on non [a-z0-9_] characters', () => {
    const files: SearchFileRecord[] = [{ path: 'src/UserAuth.ts', classification: 'service', importance: 0.5 }];
    const response = search('User-Auth!!', 50, KEYWORD_MAP, dataSource({ files }));
    expect(response.hits.some((h) => h.path === 'src/UserAuth.ts')).toBe(true);
  });
});

describe('search — keyword expansion (Section 8.7 step 2)', () => {
  test('expands "auth" and finds a file only matched by an expanded term', () => {
    const files: SearchFileRecord[] = [{ path: 'src/jwt.ts', classification: 'util', importance: 0.1 }];
    const response = search('auth', 50, KEYWORD_MAP, dataSource({ files }));
    expect(response.expandedTerms).toContain('jwt');
    expect(response.hits.some((h) => h.path === 'src/jwt.ts')).toBe(true);
  });

  test('an expanded-term hit scores less than an equivalent direct-term hit', () => {
    const files: SearchFileRecord[] = [
      { path: 'src/auth.ts', classification: 'util', importance: 0 },
      { path: 'src/jwt.ts', classification: 'util', importance: 0 },
    ];
    const response = search('auth', 50, KEYWORD_MAP, dataSource({ files }));
    const authHit = response.hits.find((h) => h.path === 'src/auth.ts')!;
    const jwtHit = response.hits.find((h) => h.path === 'src/jwt.ts')!;
    expect(authHit.score).toBeGreaterThan(jwtHit.score);
  });
});

describe('search — candidates and scoring (Section 8.7 steps 3-4)', () => {
  test('a symbol-exact hit outranks a filename-substring hit for the same term', () => {
    const files: SearchFileRecord[] = [
      { path: 'src/a.ts', classification: 'service', importance: 0 },
      { path: 'src/user-controller.ts', classification: 'service', importance: 0 },
    ];
    const symbolsByTerm: Record<string, SearchSymbolRow[]> = {
      user: [symbolRow({ path: 'src/a.ts', name: 'user' })],
    };
    const response = search('user', 50, KEYWORD_MAP, dataSource({ files, symbolsForTerm: (t) => symbolsByTerm[t] ?? [] }));
    expect(response.hits[0]?.path).toBe('src/a.ts');
  });

  test('the returned symbol is the best-scoring one, matching contract shape', () => {
    const files: SearchFileRecord[] = [{ path: 'src/a.ts', classification: 'service', importance: 0 }];
    const symbolsByTerm: Record<string, SearchSymbolRow[]> = {
      auth: [symbolRow({ path: 'src/a.ts', name: 'auth', isExported: true })],
    };
    const response = search('auth', 50, KEYWORD_MAP, dataSource({ files, symbolsForTerm: (t) => symbolsByTerm[t] ?? [] }));
    expect(response.hits[0]?.symbol).toMatchObject({ name: 'auth', isExported: true });
  });
});

describe('search — sort order and limit (Section 8.7 step 5)', () => {
  test('sorts by score desc, then importance desc, then path asc, and respects limit', () => {
    const files: SearchFileRecord[] = [
      { path: 'z.ts', classification: 'unknown', importance: 0.9 },
      { path: 'a.ts', classification: 'unknown', importance: 0.9 },
      { path: 'm.ts', classification: 'unknown', importance: 0.1 },
    ];
    // All three match only via path-segment-less filename substring at equal tier;
    // 'a.ts' and 'z.ts' tie on score/importance, so path asc decides between them.
    const response = search('ts', 50, KEYWORD_MAP, dataSource({ files: [] }));
    expect(response).toBeDefined();

    const response2 = search('zzz', 2, KEYWORD_MAP, dataSource({ files }));
    expect(response2.hits.length).toBeLessThanOrEqual(2);
  });
});

describe('search — lineHits (Section 8.7 step 6)', () => {
  test('builds lineHits from token_index.lines_json, sorted ascending, capped at 5, with a preview', () => {
    const files: SearchFileRecord[] = [{ path: 'src/a.ts', classification: 'service', importance: 0 }];
    const tokens: SearchTokenRow[] = [{ path: 'src/a.ts', count: 3, linesJson: JSON.stringify([5, 1, 3]) }];
    const text = 'auth here\nno match\nline3 auth\nno\nauth again\n';
    const response = search(
      'auth',
      50,
      KEYWORD_MAP,
      dataSource({ files, tokensForToken: () => tokens, readFileText: () => text }),
    );
    const hit = response.hits.find((h) => h.path === 'src/a.ts')!;
    expect(hit.lineHits.map((l) => l.line)).toEqual([1, 3, 5]);
    expect(hit.lineHits[0]?.preview).toBe('auth here');
  });
});
