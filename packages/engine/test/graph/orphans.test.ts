import { describe, expect, test } from 'bun:test';
import { findOrphanPaths } from '../../src/graph/orphans';
import { buildGraph } from '../../src/graph/build-graph';

describe('findOrphanPaths', () => {
  test('a file with zero in-degree and zero out-degree is an orphan', () => {
    const graph = buildGraph({ allFilePaths: ['a.ts', 'isolated.ts'], edges: [] });
    expect(findOrphanPaths(graph.degrees)).toEqual(['isolated.ts', 'a.ts'].sort());
  });

  test('a file with edges either way is not an orphan', () => {
    const graph = buildGraph({
      allFilePaths: ['a.ts', 'b.ts', 'isolated.ts'],
      edges: [{ fromPath: 'a.ts', toPath: 'b.ts' }],
    });
    expect(findOrphanPaths(graph.degrees)).toEqual(['isolated.ts']);
  });

  test('returns an empty array when there are no orphans', () => {
    const graph = buildGraph({
      allFilePaths: ['a.ts', 'b.ts'],
      edges: [{ fromPath: 'a.ts', toPath: 'b.ts' }],
    });
    expect(findOrphanPaths(graph.degrees)).toEqual([]);
  });

  test('is sorted ascending', () => {
    const graph = buildGraph({ allFilePaths: ['z.ts', 'a.ts', 'm.ts'], edges: [] });
    expect(findOrphanPaths(graph.degrees)).toEqual(['a.ts', 'm.ts', 'z.ts']);
  });
});
