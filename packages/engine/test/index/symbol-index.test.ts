import { describe, expect, test } from 'bun:test';
import { buildSymbolRows, computeSymbolId } from '../../src/index/symbol-index';
import type { RawSymbol } from '../../src/parse/language-parser';

describe('computeSymbolId', () => {
  test('is a 16-character lowercase hex string', () => {
    const id = computeSymbolId('src/a.ts', 'foo', 1);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  test('is deterministic for the same inputs', () => {
    expect(computeSymbolId('src/a.ts', 'foo', 1)).toBe(computeSymbolId('src/a.ts', 'foo', 1));
  });

  test('differs when the path, name, or start line differ', () => {
    const base = computeSymbolId('src/a.ts', 'foo', 1);
    expect(computeSymbolId('src/b.ts', 'foo', 1)).not.toBe(base);
    expect(computeSymbolId('src/a.ts', 'bar', 1)).not.toBe(base);
    expect(computeSymbolId('src/a.ts', 'foo', 2)).not.toBe(base);
  });
});

describe('buildSymbolRows', () => {
  test('maps a RawSymbol to a cache SymbolRow with a lowercased name and computed id', () => {
    const rawSymbols: readonly RawSymbol[] = [
      {
        name: 'MyClass',
        kind: 'class',
        startLine: 3,
        endLine: 10,
        isExported: true,
        containerName: null,
        signature: 'export class MyClass {',
      },
    ];
    const rows = buildSymbolRows('src/a.ts', rawSymbols);
    expect(rows).toEqual([
      {
        id: computeSymbolId('src/a.ts', 'MyClass', 3),
        path: 'src/a.ts',
        name: 'MyClass',
        nameLower: 'myclass',
        kind: 'class',
        startLine: 3,
        endLine: 10,
        isExported: true,
        container: null,
        signature: 'export class MyClass {',
      },
    ]);
  });

  test('returns an empty array for a file with no symbols', () => {
    expect(buildSymbolRows('src/empty.ts', [])).toEqual([]);
  });
});
