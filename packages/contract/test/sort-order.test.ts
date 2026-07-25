/**
 * Tests for the sort-order assertion helper itself.
 *
 * The fixture is correctly sorted, so running the helper over it only ever
 * exercises the "no violations" path. These tests feed it deliberately
 * corrupted results to prove it actually detects disorder — without them a
 * broken helper would silently green-light an out-of-order contract for
 * every downstream track.
 */
import { describe, expect, test } from 'bun:test';
import { AnalysisResult } from '../src/analysis-result';
import { byteCompare, findCycleOrderViolations, findSortOrderViolations } from './sort-order';

import sampleAnalysis from '../fixtures/sample-analysis.json';

const VALID = AnalysisResult.parse(sampleAnalysis.result);

/** Returns a copy of the fixture with one array's first two entries swapped. */
function withSwappedPair<T>(items: readonly T[]): T[] {
  const copy = [...items];
  const first = copy[0] as T;
  const second = copy[1] as T;
  copy[0] = second;
  copy[1] = first;
  return copy;
}

describe('byteCompare', () => {
  test('orders by byte value and reports equality as 0', () => {
    expect(byteCompare('a', 'b')).toBe(-1);
    expect(byteCompare('b', 'a')).toBe(1);
    expect(byteCompare('a', 'a')).toBe(0);
  });

  test('places uppercase before lowercase, unlike a locale-aware sort', () => {
    expect(byteCompare('Z', 'a')).toBe(-1);
  });
});

describe('findSortOrderViolations', () => {
  test('reports no violations for the correctly sorted fixture', () => {
    expect(findSortOrderViolations(VALID)).toEqual([]);
  });

  test.each([
    ['files', () => ({ ...VALID, files: withSwappedPair(VALID.files) })],
    ['directories', () => ({ ...VALID, directories: withSwappedPair(VALID.directories) })],
    ['symbols', () => ({ ...VALID, symbols: withSwappedPair(VALID.symbols) })],
    ['edges', () => ({ ...VALID, edges: withSwappedPair(VALID.edges) })],
    ['modules', () => ({ ...VALID, modules: withSwappedPair(VALID.modules) })],
    ['entryPoints', () => ({ ...VALID, entryPoints: withSwappedPair(VALID.entryPoints) })],
    ['diagnostics', () => ({ ...VALID, diagnostics: withSwappedPair(VALID.diagnostics) })],
    [
      'unresolvedImports',
      () => ({ ...VALID, unresolvedImports: withSwappedPair(VALID.unresolvedImports) }),
    ],
    [
      'externalDependencies',
      () => ({ ...VALID, externalDependencies: withSwappedPair(VALID.externalDependencies) }),
    ],
    [
      'stack.dependencies',
      () => ({
        ...VALID,
        stack: { ...VALID.stack, dependencies: withSwappedPair(VALID.stack.dependencies) },
      }),
    ],
    [
      'graph.orphanPaths',
      () => ({
        ...VALID,
        graph: { ...VALID.graph, orphanPaths: withSwappedPair(VALID.graph.orphanPaths) },
      }),
    ],
    [
      'roadmap.steps',
      () => ({ ...VALID, roadmap: { steps: withSwappedPair(VALID.roadmap.steps) } }),
    ],
  ])('detects an out-of-order %s array', (arrayName, corrupt) => {
    // Arrange / Act
    const violations = findSortOrderViolations(corrupt());

    // Assert
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((violation) => violation.arrayName === arrayName)).toBe(true);
  });

  test('detects an out-of-order importedByPaths nested inside a dependency', () => {
    const [first, ...rest] = VALID.externalDependencies;
    const target = first as (typeof VALID.externalDependencies)[number];
    const corrupted = {
      ...VALID,
      externalDependencies: [
        { ...target, importedByPaths: [...target.importedByPaths].reverse() },
        ...rest,
      ],
    };
    const violations = findSortOrderViolations(corrupted);
    expect(violations.some((violation) => violation.arrayName.includes('importedByPaths'))).toBe(
      true,
    );
  });

  test('reports the offending pair so a failure is diagnosable', () => {
    const corrupted = { ...VALID, files: withSwappedPair(VALID.files) };
    const violation = findSortOrderViolations(corrupted)[0];
    expect(violation?.arrayName).toBe('files');
    expect(violation?.index).toBe(1);
    expect(violation?.previous).toBe(VALID.files[1]?.path);
    expect(violation?.current).toBe(VALID.files[0]?.path);
  });

  test('treats a single-element and an empty array as sorted', () => {
    expect(findSortOrderViolations({ ...VALID, files: [] })).toEqual([]);
    expect(findSortOrderViolations({ ...VALID, files: [VALID.files[0]!] })).toEqual([]);
  });
});

describe('findCycleOrderViolations', () => {
  const cycleA = { id: 'cycle-1', paths: ['src/a.ts', 'src/b.ts'], edgeCount: 5 };
  const cycleB = { id: 'cycle-2', paths: ['src/c.ts', 'src/d.ts'], edgeCount: 2 };
  const cycleTiedEarly = { id: 'cycle-3', paths: ['src/a.ts', 'src/z.ts'], edgeCount: 2 };

  test('reports no violations for the fixture', () => {
    expect(findCycleOrderViolations(VALID)).toEqual([]);
  });

  test('accepts cycles ordered by edgeCount descending', () => {
    const result = { ...VALID, graph: { ...VALID.graph, cycles: [cycleA, cycleB] } };
    expect(findCycleOrderViolations(result)).toEqual([]);
  });

  test('detects cycles ordered by edgeCount ascending', () => {
    const result = { ...VALID, graph: { ...VALID.graph, cycles: [cycleB, cycleA] } };
    expect(findCycleOrderViolations(result)).toHaveLength(1);
  });

  test('accepts an edgeCount tie broken by ascending first path', () => {
    const result = { ...VALID, graph: { ...VALID.graph, cycles: [cycleTiedEarly, cycleB] } };
    expect(findCycleOrderViolations(result)).toEqual([]);
  });

  test('detects an edgeCount tie broken by descending first path', () => {
    const result = { ...VALID, graph: { ...VALID.graph, cycles: [cycleB, cycleTiedEarly] } };
    expect(findCycleOrderViolations(result)).toHaveLength(1);
  });

  test('treats a single cycle as ordered', () => {
    const result = { ...VALID, graph: { ...VALID.graph, cycles: [cycleA] } };
    expect(findCycleOrderViolations(result)).toEqual([]);
  });
});
