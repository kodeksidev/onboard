import { describe, expect, test } from 'bun:test';
import { computeImportance, type ImportanceInput } from '../../src/rank/importance';

function file(overrides: Partial<ImportanceInput> & { path: string }): ImportanceInput {
  return {
    isParsed: true,
    classification: 'unknown',
    pageRank: 0,
    inDegree: 0,
    lineCount: 10,
    ...overrides,
  };
}

describe('computeImportance', () => {
  test('an entrypoint outranks a plain util file with the same pageRank/inDegree', () => {
    const output = computeImportance([
      file({ path: 'src/index.ts', classification: 'entrypoint', pageRank: 0.5, inDegree: 2 }),
      file({ path: 'src/util.ts', classification: 'util', pageRank: 0.5, inDegree: 2 }),
    ]);
    const entry = output.results.find((r) => r.path === 'src/index.ts')!;
    const util = output.results.find((r) => r.path === 'src/util.ts')!;
    expect(entry.importance).toBeGreaterThan(util.importance);
  });

  test('importanceRank is 1-based and dense with no ties (path is unique)', () => {
    const output = computeImportance([
      file({ path: 'a.ts', pageRank: 0.9 }),
      file({ path: 'b.ts', pageRank: 0.1 }),
      file({ path: 'c.ts', pageRank: 0.5 }),
    ]);
    const ranks = output.results.map((r) => r.importanceRank).sort((x, y) => x - y);
    expect(ranks).toEqual([1, 2, 3]);
  });

  test('unparsed files get importance 0 and rank after every parsed file', () => {
    const output = computeImportance([
      file({ path: 'unparsed.png', isParsed: false, pageRank: 0, inDegree: 0 }),
      file({ path: 'low.ts', pageRank: 0.01, inDegree: 0 }),
    ]);
    const unparsed = output.results.find((r) => r.path === 'unparsed.png')!;
    const low = output.results.find((r) => r.path === 'low.ts')!;
    expect(unparsed.importance).toBe(0);
    expect(unparsed.importanceRank).toBeGreaterThan(low.importanceRank);
  });

  test('ranking order is importance desc -> inDegree desc -> lineCount desc -> path asc', () => {
    const output = computeImportance([
      file({ path: 'z.ts', pageRank: 0, inDegree: 0, lineCount: 5 }),
      file({ path: 'a.ts', pageRank: 0, inDegree: 0, lineCount: 5 }),
    ]);
    // Tied on everything except path -> 'a.ts' must rank first.
    const a = output.results.find((r) => r.path === 'a.ts')!;
    const z = output.results.find((r) => r.path === 'z.ts')!;
    expect(a.importanceRank).toBeLessThan(z.importanceRank);
  });

  test('importantFilePaths is the first 20 entries in importance-desc order', () => {
    const files = Array.from({ length: 25 }, (_, i) =>
      file({ path: `f${String(i).padStart(2, '0')}.ts`, pageRank: i / 25, inDegree: i }),
    );
    const output = computeImportance(files);
    expect(output.importantFilePaths).toHaveLength(20);
    expect(output.importantFilePaths[0]).toBe('f24.ts'); // highest pageRank/inDegree
  });

  test('importance is clamped to [0, 1] and rounded to 6 decimals', () => {
    const output = computeImportance([
      file({ path: 'a.ts', classification: 'entrypoint', pageRank: 1, inDegree: 100 }),
      file({ path: 'b.ts', pageRank: 0, inDegree: 0 }),
    ]);
    for (const result of output.results) {
      expect(result.importance).toBeGreaterThanOrEqual(0);
      expect(result.importance).toBeLessThanOrEqual(1);
      expect(result.importance).toBe(Number(result.importance.toFixed(6)));
    }
  });

  test('norm() is 0 for every file when pageRank/inDegree have no spread (max === min)', () => {
    const output = computeImportance([
      file({ path: 'a.ts', pageRank: 0.3, inDegree: 2 }),
      file({ path: 'b.ts', pageRank: 0.3, inDegree: 2 }),
    ]);
    expect(output.results[0]?.importance).toBe(output.results[1]?.importance);
  });
});
