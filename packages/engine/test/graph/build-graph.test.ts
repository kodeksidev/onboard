import { describe, expect, test } from 'bun:test';
import { buildGraph } from '../../src/graph/build-graph';

describe('buildGraph — degrees', () => {
  test('counts distinct importing/imported files, not raw edge rows', () => {
    const graph = buildGraph({
      allFilePaths: ['a.ts', 'b.ts'],
      edges: [
        { fromPath: 'a.ts', toPath: 'b.ts' },
        { fromPath: 'a.ts', toPath: 'b.ts' }, // a second import statement, same pair
      ],
    });
    expect(graph.degrees.get('a.ts')).toEqual({ path: 'a.ts', inDegree: 0, outDegree: 1 });
    expect(graph.degrees.get('b.ts')).toEqual({ path: 'b.ts', inDegree: 1, outDegree: 0 });
  });

  test('includes every file, even ones with zero edges (e.g. a skipped or unsupported-language file)', () => {
    const graph = buildGraph({ allFilePaths: ['isolated.json'], edges: [] });
    expect(graph.degrees.get('isolated.json')).toEqual({ path: 'isolated.json', inDegree: 0, outDegree: 0 });
  });

  test('drops a self-edge from degree counting', () => {
    const graph = buildGraph({ allFilePaths: ['a.ts'], edges: [{ fromPath: 'a.ts', toPath: 'a.ts' }] });
    expect(graph.degrees.get('a.ts')).toEqual({ path: 'a.ts', inDegree: 0, outDegree: 0 });
  });
});

describe('buildGraph — outLinks', () => {
  test('are unique and sorted ascending', () => {
    const graph = buildGraph({
      allFilePaths: ['a.ts', 'b.ts', 'c.ts'],
      edges: [
        { fromPath: 'a.ts', toPath: 'c.ts' },
        { fromPath: 'a.ts', toPath: 'b.ts' },
        { fromPath: 'a.ts', toPath: 'b.ts' },
      ],
    });
    expect(graph.outLinks.get('a.ts')).toEqual(['b.ts', 'c.ts']);
  });
});

describe('buildGraph — pageRank is wired through', () => {
  test('every file gets a pageRank entry', () => {
    const graph = buildGraph({ allFilePaths: ['a.ts', 'b.ts'], edges: [{ fromPath: 'a.ts', toPath: 'b.ts' }] });
    expect(graph.pageRank.get('a.ts')).toBeDefined();
    expect(graph.pageRank.get('b.ts')).toBeDefined();
  });
});
