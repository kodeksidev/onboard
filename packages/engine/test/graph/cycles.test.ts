import { describe, expect, test } from 'bun:test';
import { buildCycles } from '../../src/graph/cycles';
import { buildGraph } from '../../src/graph/build-graph';
import { computeStronglyConnectedComponents } from '../../src/graph/tarjan-scc';

describe('buildCycles', () => {
  test('a 3-file cycle becomes one Cycle with paths rotated to start at the smallest', () => {
    const graph = buildGraph({
      allFilePaths: ['c.ts', 'a.ts', 'b.ts'],
      edges: [
        { fromPath: 'a.ts', toPath: 'b.ts' },
        { fromPath: 'b.ts', toPath: 'c.ts' },
        { fromPath: 'c.ts', toPath: 'a.ts' },
      ],
    });
    const sccs = computeStronglyConnectedComponents(['a.ts', 'b.ts', 'c.ts'], [
      { from: 'a.ts', to: 'b.ts' },
      { from: 'b.ts', to: 'c.ts' },
      { from: 'c.ts', to: 'a.ts' },
    ]);
    const cycles = buildCycles(sccs, graph.outLinks);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.paths[0]).toBe('a.ts');
    expect([...cycles[0]!.paths].sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(cycles[0]?.edgeCount).toBe(3);
    expect(cycles[0]?.id).toBe('cycle-1');
  });

  test('singleton components (no cycle) are excluded', () => {
    const sccs = computeStronglyConnectedComponents(['a.ts', 'b.ts'], [{ from: 'a.ts', to: 'b.ts' }]);
    const graph = buildGraph({ allFilePaths: ['a.ts', 'b.ts'], edges: [{ fromPath: 'a.ts', toPath: 'b.ts' }] });
    expect(buildCycles(sccs, graph.outLinks)).toEqual([]);
  });

  test('ranks cycles by edgeCount desc, then paths[0] asc', () => {
    const nodes = ['a.ts', 'b.ts', 'x.ts', 'y.ts', 'z.ts'];
    const edges = [
      { from: 'a.ts', to: 'b.ts' },
      { from: 'b.ts', to: 'a.ts' }, // 2-cycle, edgeCount 2
      { from: 'x.ts', to: 'y.ts' },
      { from: 'y.ts', to: 'z.ts' },
      { from: 'z.ts', to: 'x.ts' }, // 3-cycle, edgeCount 3
    ];
    const sccs = computeStronglyConnectedComponents(nodes, edges);
    const graph = buildGraph({
      allFilePaths: nodes,
      edges: edges.map((e) => ({ fromPath: e.from, toPath: e.to })),
    });
    const cycles = buildCycles(sccs, graph.outLinks);
    expect(cycles.map((c) => c.id)).toEqual(['cycle-1', 'cycle-2']);
    expect(cycles[0]?.edgeCount).toBe(3); // the 3-file cycle ranks first (higher edgeCount)
    expect(cycles[1]?.edgeCount).toBe(2);
  });
});
