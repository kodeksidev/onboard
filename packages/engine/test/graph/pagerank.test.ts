import { describe, expect, test } from 'bun:test';
import { computePageRank } from '../../src/graph/pagerank';

describe('computePageRank — edge cases', () => {
  test('returns an empty map for zero nodes', () => {
    expect(computePageRank([], [])).toEqual(new Map());
  });

  test('a single node with no edges gets rank 1', () => {
    const result = computePageRank(['a'], []);
    expect(result.get('a')).toBe(1);
  });

  test('an all-dangling graph (no edges at all) distributes rank equally', () => {
    const result = computePageRank(['a', 'b', 'c'], []);
    expect(result.get('a')).toBeCloseTo(1 / 3, 6);
    expect(result.get('b')).toBeCloseTo(1 / 3, 6);
    expect(result.get('c')).toBeCloseTo(1 / 3, 6);
  });
});

describe('computePageRank — correctness', () => {
  test('a hub imported by two files has higher rank than a leaf importing nothing', () => {
    const result = computePageRank(
      ['a', 'b', 'hub'],
      [
        { from: 'a', to: 'hub' },
        { from: 'b', to: 'hub' },
      ],
    );
    const hubRank = result.get('hub') ?? 0;
    const aRank = result.get('a') ?? 0;
    expect(hubRank).toBeGreaterThan(aRank);
  });

  test('drops self-edges before ranking', () => {
    const withSelfEdge = computePageRank(['a'], [{ from: 'a', to: 'a' }]);
    const without = computePageRank(['a'], []);
    expect(withSelfEdge.get('a')).toBe(without.get('a'));
  });

  test('collapses duplicate edges to one', () => {
    const duplicated = computePageRank(
      ['a', 'b'],
      [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'b' },
        { from: 'a', to: 'b' },
      ],
    );
    const single = computePageRank(['a', 'b'], [{ from: 'a', to: 'b' }]);
    expect(duplicated.get('b')).toBe(single.get('b'));
  });

  test('every rank is rounded to exactly 6 decimal places', () => {
    const result = computePageRank(
      ['a', 'b', 'c'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ],
    );
    for (const value of result.values()) {
      expect(value).toBe(Number(value.toFixed(6)));
    }
  });

  test('is deterministic across repeated runs on the same input', () => {
    const nodes = ['a', 'b', 'c', 'd'];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
      { from: 'd', to: 'a' },
      { from: 'a', to: 'c' },
    ];
    const first = computePageRank(nodes, edges);
    const second = computePageRank([...nodes].reverse(), [...edges].reverse());
    expect([...first.entries()].sort()).toEqual([...second.entries()].sort());
  });
});
