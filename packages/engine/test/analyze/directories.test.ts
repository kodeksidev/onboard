import { describe, expect, test } from 'bun:test';
import { buildDirectoryNodes } from '../../src/directories';

describe('buildDirectoryNodes', () => {
  test('never emits the repo root itself as a DirectoryNode', () => {
    const nodes = buildDirectoryNodes([{ path: 'index.ts', classification: 'entrypoint' }]);
    expect(nodes).toEqual([]);
  });

  test('a top-level directory has parentPath null', () => {
    const nodes = buildDirectoryNodes([{ path: 'src/index.ts', classification: 'entrypoint' }]);
    expect(nodes).toEqual([
      { path: 'src', parentPath: null, fileCount: 1, descendantFileCount: 1, dominantClassification: 'entrypoint' },
    ]);
  });

  test('descendantFileCount accumulates across nested directories', () => {
    const nodes = buildDirectoryNodes([
      { path: 'src/api/a.ts', classification: 'route' },
      { path: 'src/api/b.ts', classification: 'route' },
      { path: 'src/util.ts', classification: 'util' },
    ]);
    const src = nodes.find((n) => n.path === 'src')!;
    const api = nodes.find((n) => n.path === 'src/api')!;
    expect(src.descendantFileCount).toBe(3);
    expect(src.fileCount).toBe(1); // only util.ts is directly in src/
    expect(api.fileCount).toBe(2);
    expect(api.descendantFileCount).toBe(2);
    expect(api.parentPath).toBe('src');
  });

  test('dominantClassification is the most common, tie-broken by classification name asc', () => {
    const nodes = buildDirectoryNodes([
      { path: 'src/a.ts', classification: 'util' },
      { path: 'src/b.ts', classification: 'util' },
      { path: 'src/c.ts', classification: 'config' },
    ]);
    expect(nodes[0]?.dominantClassification).toBe('util');
  });

  test('is sorted by path ascending', () => {
    const nodes = buildDirectoryNodes([
      { path: 'z/a.ts', classification: 'unknown' },
      { path: 'a/a.ts', classification: 'unknown' },
    ]);
    expect(nodes.map((n) => n.path)).toEqual(['a', 'z']);
  });
});
