import { describe, expect, test } from 'bun:test';
import { discoverPackageImports, resolveNodeImport, type NodeResolutionContext } from '../../src/resolve/node-resolution';
import { discoverTsconfigs } from '../../src/resolve/tsconfig-paths';

function contextWith(overrides: Partial<NodeResolutionContext> = {}): NodeResolutionContext {
  return {
    existingPathSet: new Set<string>(),
    tsconfigs: [],
    packageImports: [],
    workspacePackages: [],
    ...overrides,
  };
}

describe('resolveNodeImport — relative specifiers', () => {
  test('resolves a bare relative specifier to its exact file', () => {
    const context = contextWith({ existingPathSet: new Set(['src/api/user.ts']) });
    const result = resolveNodeImport('src/api/index.ts', './user', context);
    expect(result).toEqual({ kind: 'resolved', toPath: 'src/api/user.ts' });
  });

  test('tries suffixes in the exact Section 8.2 rule 6 order, taking the first hit', () => {
    const context = contextWith({ existingPathSet: new Set(['src/api/user.js', 'src/api/user.ts']) });
    const result = resolveNodeImport('src/api/index.ts', './user', context);
    expect(result).toEqual({ kind: 'resolved', toPath: 'src/api/user.ts' });
  });

  test('falls back to an index file when the bare path does not exist', () => {
    const context = contextWith({ existingPathSet: new Set(['src/api/user/index.ts']) });
    const result = resolveNodeImport('src/api/main.ts', './user', context);
    expect(result).toEqual({ kind: 'resolved', toPath: 'src/api/user/index.ts' });
  });

  test('walks ../ correctly', () => {
    const context = contextWith({ existingPathSet: new Set(['src/models/user.ts']) });
    const result = resolveNodeImport('src/api/routes/index.ts', '../../models/user', context);
    expect(result).toEqual({ kind: 'resolved', toPath: 'src/models/user.ts' });
  });

  test('is unresolved with reason no-match-on-disk when nothing matches', () => {
    const context = contextWith({ existingPathSet: new Set([]) });
    const result = resolveNodeImport('src/api/index.ts', './missing', context);
    expect(result).toEqual({ kind: 'unresolved', reason: 'no-match-on-disk' });
  });
});

describe('resolveNodeImport — bare specifiers are external, never node_modules', () => {
  test('records the first segment as the package name', () => {
    const context = contextWith();
    expect(resolveNodeImport('src/index.ts', 'express', context)).toEqual({
      kind: 'external',
      packageName: 'express',
    });
  });

  test('a subpath import records only the package name', () => {
    const context = contextWith();
    expect(resolveNodeImport('src/index.ts', 'lodash/debounce', context)).toEqual({
      kind: 'external',
      packageName: 'lodash',
    });
  });

  test('a scoped package records the first two segments', () => {
    const context = contextWith();
    expect(resolveNodeImport('src/index.ts', '@scope/pkg/sub', context)).toEqual({
      kind: 'external',
      packageName: '@scope/pkg',
    });
  });
});

describe('resolveNodeImport — tsconfig paths alias', () => {
  test('resolves an @/ alias to its baseUrl-relative target', () => {
    const discovery = discoverTsconfigs({
      tsconfigPaths: ['tsconfig.json'],
      readFile: (path) =>
        path === 'tsconfig.json'
          ? JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } })
          : null,
    });
    const context = contextWith({
      tsconfigs: discovery.configs,
      existingPathSet: new Set(['src/lib/db.ts']),
    });
    const result = resolveNodeImport('src/index.ts', '@/lib/db', context);
    expect(result).toEqual({ kind: 'resolved', toPath: 'src/lib/db.ts' });
  });

  test('reports alias-unmapped when a pattern matches but no candidate exists on disk', () => {
    const discovery = discoverTsconfigs({
      tsconfigPaths: ['tsconfig.json'],
      readFile: (path) =>
        path === 'tsconfig.json' ? JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/*'] } } }) : null,
    });
    const context = contextWith({ tsconfigs: discovery.configs, existingPathSet: new Set([]) });
    const result = resolveNodeImport('src/index.ts', '@/lib/missing', context);
    expect(result).toEqual({ kind: 'unresolved', reason: 'alias-unmapped' });
  });

  test('picks the nearest tsconfig by ancestor directory', () => {
    const discovery = discoverTsconfigs({
      tsconfigPaths: ['tsconfig.json', 'packages/a/tsconfig.json'],
      readFile: (path) => {
        if (path === 'tsconfig.json') {
          return JSON.stringify({ compilerOptions: { paths: { '@/*': ['root-src/*'] } } });
        }
        if (path === 'packages/a/tsconfig.json') {
          return JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/*'] } } });
        }
        return null;
      },
    });
    const context = contextWith({
      tsconfigs: discovery.configs,
      existingPathSet: new Set(['packages/a/src/thing.ts']),
    });
    const result = resolveNodeImport('packages/a/index.ts', '@/thing', context);
    expect(result).toEqual({ kind: 'resolved', toPath: 'packages/a/src/thing.ts' });
  });
});

describe('resolveNodeImport — workspace packages', () => {
  test('resolves a bare specifier matching a workspace package name to its entry file', () => {
    const context = contextWith({
      workspacePackages: [{ name: '@acme/core', dirPath: 'packages/core', entryField: 'src/index.ts', source: 'declared' }],
      existingPathSet: new Set(['packages/core/src/index.ts']),
    });
    const result = resolveNodeImport('packages/web/src/index.ts', '@acme/core', context);
    expect(result).toEqual({ kind: 'resolved', toPath: 'packages/core/src/index.ts' });
  });

  test('resolves a workspace package deep import', () => {
    const context = contextWith({
      workspacePackages: [{ name: '@acme/core', dirPath: 'packages/core', entryField: null, source: 'declared' }],
      existingPathSet: new Set(['packages/core/utils.ts']),
    });
    const result = resolveNodeImport('packages/web/src/index.ts', '@acme/core/utils', context);
    expect(result).toEqual({ kind: 'resolved', toPath: 'packages/core/utils.ts' });
  });

  test('never resolves into node_modules even if a same-named external package exists', () => {
    const context = contextWith({
      workspacePackages: [],
      existingPathSet: new Set(['node_modules/express/index.js']),
    });
    const result = resolveNodeImport('src/index.ts', 'express', context);
    expect(result).toEqual({ kind: 'external', packageName: 'express' });
  });
});

describe('resolveNodeImport — package.json #imports alias', () => {
  test('resolves a #alias specifier relative to the declaring package root', () => {
    const context = contextWith({
      packageImports: [{ dirPath: '', patterns: [{ pattern: '#lib/*', targets: ['src/lib/*.js'] }] }],
      existingPathSet: new Set(['src/lib/db.js']),
    });
    const result = resolveNodeImport('src/index.ts', '#lib/db', context);
    expect(result).toEqual({ kind: 'resolved', toPath: 'src/lib/db.js' });
  });

  test('is unresolved when no package.json#imports entry applies at all', () => {
    const context = contextWith({ packageImports: [] });
    const result = resolveNodeImport('src/index.ts', '#lib/db', context);
    expect(result).toEqual({ kind: 'unresolved', reason: 'no-match-on-disk' });
  });

  test('is unresolved when the nearest entry has no matching pattern', () => {
    const context = contextWith({
      packageImports: [{ dirPath: '', patterns: [{ pattern: '#other/*', targets: ['src/other/*.js'] }] }],
    });
    const result = resolveNodeImport('src/index.ts', '#lib/db', context);
    expect(result).toEqual({ kind: 'unresolved', reason: 'no-match-on-disk' });
  });
});

describe('resolveNodeImport — a tsconfig with paths that do not match falls through to bare resolution', () => {
  test('an unmatched specifier with a tsconfig present is still treated as external', () => {
    const discovery = discoverTsconfigs({
      tsconfigPaths: ['tsconfig.json'],
      readFile: (path) => (path === 'tsconfig.json' ? JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/*'] } } }) : null),
    });
    const context = contextWith({ tsconfigs: discovery.configs });
    const result = resolveNodeImport('src/index.ts', 'lodash', context);
    expect(result).toEqual({ kind: 'external', packageName: 'lodash' });
  });
});

describe('discoverPackageImports', () => {
  test('builds patterns from a string-valued, array-valued, and conditional-object-valued import', () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({
        imports: {
          '#a': './a.js',
          '#b': ['./b1.js', './b2.js'],
          '#c': { node: './c-node.js', default: './c-default.js' },
          '#d': { node: './d-node.js' },
        },
      }),
    };
    const entries = discoverPackageImports(new Set(Object.keys(files)), (p) => files[p] ?? null);
    expect(entries).toHaveLength(1);
    const patterns = new Map(entries[0]!.patterns.map((p) => [p.pattern, p.targets]));
    expect(patterns.get('#a')).toEqual(['./a.js']);
    expect(patterns.get('#b')).toEqual(['./b1.js', './b2.js']);
    expect(patterns.get('#c')).toEqual(['./c-default.js']);
    expect(patterns.get('#d')).toEqual([]);
  });

  test('computes dirPath for a nested package.json and "" for the repo root', () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ imports: { '#a': './a.js' } }),
      'packages/core/package.json': JSON.stringify({ imports: { '#b': './b.js' } }),
    };
    const entries = discoverPackageImports(new Set(Object.keys(files)), (p) => files[p] ?? null);
    const byDir = new Map(entries.map((e) => [e.dirPath, e]));
    expect(byDir.has('')).toBe(true);
    expect(byDir.has('packages/core')).toBe(true);
  });

  test('ignores a package.json with no "imports" field', () => {
    const files: Record<string, string> = { 'package.json': JSON.stringify({ name: 'x' }) };
    expect(discoverPackageImports(new Set(Object.keys(files)), (p) => files[p] ?? null)).toEqual([]);
  });

  test('ignores unreadable and malformed package.json files', () => {
    const files: Record<string, string> = { 'package.json': '{ not valid json' };
    expect(discoverPackageImports(new Set(['package.json', 'other.txt']), (p) => files[p] ?? null)).toEqual([]);
  });
});
