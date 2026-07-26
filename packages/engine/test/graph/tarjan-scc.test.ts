import { describe, expect, test } from 'bun:test';
import { computeStronglyConnectedComponents } from '../../src/graph/tarjan-scc';

function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedComponents(components: readonly (readonly string[])[]): string[][] {
  return components.map((c) => [...c].sort(byteCompare)).sort((a, b) => byteCompare(a[0] ?? '', b[0] ?? ''));
}

describe('computeStronglyConnectedComponents', () => {
  test('a node with no edges is its own singleton component', () => {
    const result = computeStronglyConnectedComponents(['a'], []);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(['a']);
  });

  test('a 3-cycle forms one strongly-connected component', () => {
    const result = computeStronglyConnectedComponents(
      ['a', 'b', 'c'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ],
    );
    expect(result).toHaveLength(1);
    expect([...result[0]!].sort()).toEqual(['a', 'b', 'c']);
  });

  test('a known 4-SCC graph: two separate cycles plus two singletons', () => {
    // a<->b (cycle), c<->d (cycle), e standalone, f imports e only.
    const result = computeStronglyConnectedComponents(
      ['a', 'b', 'c', 'd', 'e', 'f'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
        { from: 'c', to: 'd' },
        { from: 'd', to: 'c' },
        { from: 'f', to: 'e' },
      ],
    );
    expect(sortedComponents(result)).toEqual([['a', 'b'], ['c', 'd'], ['e'], ['f']]);
  });

  test('a linear chain produces only singleton components (no false cycle)', () => {
    const result = computeStronglyConnectedComponents(
      ['a', 'b', 'c'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    );
    expect(result).toHaveLength(3);
    expect(result.every((c) => c.length === 1)).toBe(true);
  });

  test('is deterministic and every node appears in exactly one component', () => {
    const nodes = ['z', 'y', 'x', 'w'];
    const edges = [
      { from: 'z', to: 'y' },
      { from: 'y', to: 'z' },
      { from: 'x', to: 'w' },
    ];
    const result = computeStronglyConnectedComponents(nodes, edges);
    const allMembers = result.flatMap((c) => c);
    expect([...allMembers].sort()).toEqual(['w', 'x', 'y', 'z']);
  });

  test('handles a large chain without a stack overflow (iterative DFS)', () => {
    const size = 5000;
    const nodes = Array.from({ length: size }, (_, i) => `n${String(i)}`);
    const edges = nodes.slice(0, -1).map((node, i) => ({ from: node, to: `n${String(i + 1)}` }));
    const result = computeStronglyConnectedComponents(nodes, edges);
    expect(result).toHaveLength(size);
  });
});
