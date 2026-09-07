import { describe, expect, test } from 'bun:test';
import { declaredOnly, discoverWorkspacePackages, type WorkspacePackage } from '../../src/resolve/workspaces';

describe('discoverWorkspacePackages', () => {
  test('expands a package.json#workspaces glob and reads each package name', () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
      'packages/core/package.json': JSON.stringify({ name: '@acme/core', main: 'src/index.ts' }),
      'packages/web/package.json': JSON.stringify({ name: '@acme/web' }),
    };
    const packages = discoverWorkspacePackages({
      existingPaths: new Set(Object.keys(files)),
      readFile: (path) => files[path] ?? null,
    });
    expect(packages).toEqual([
      { name: '@acme/core', dirPath: 'packages/core', entryField: 'src/index.ts', source: 'declared' },
      { name: '@acme/web', dirPath: 'packages/web', entryField: null, source: 'declared' },
    ]);
  });

  test('returns an empty array when there is no workspaces declaration', () => {
    const files: Record<string, string> = { 'package.json': JSON.stringify({ name: 'root' }) };
    const packages = discoverWorkspacePackages({
      existingPaths: new Set(Object.keys(files)),
      readFile: (path) => files[path] ?? null,
    });
    expect(packages).toEqual([]);
  });

  test('reads packages: from pnpm-workspace.yaml', () => {
    const files: Record<string, string> = {
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - 'apps/*'\n",
      'packages/a/package.json': JSON.stringify({ name: 'a' }),
      'apps/b/package.json': JSON.stringify({ name: 'b' }),
    };
    const packages = discoverWorkspacePackages({
      existingPaths: new Set(Object.keys(files)),
      readFile: (path) => files[path] ?? null,
    });
    expect(packages.map((p) => p.name).sort()).toEqual(['a', 'b']);
  });

  test('prefers exports over module over main for the entry field', () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/a/package.json': JSON.stringify({
        name: 'a',
        exports: { '.': 'dist/index.js' },
        module: 'esm/index.js',
        main: 'index.js',
      }),
    };
    const packages = discoverWorkspacePackages({
      existingPaths: new Set(Object.keys(files)),
      readFile: (path) => files[path] ?? null,
    });
    expect(packages[0]?.entryField).toBe('dist/index.js');
  });

  test('accepts a string-form "exports" field directly', () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/a/package.json': JSON.stringify({ name: 'a', exports: 'dist/index.js' }),
    };
    const packages = discoverWorkspacePackages({ existingPaths: new Set(Object.keys(files)), readFile: (path) => files[path] ?? null });
    expect(packages[0]?.entryField).toBe('dist/index.js');
  });

  test('falls back to "module" when there is no "exports" field', () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/a/package.json': JSON.stringify({ name: 'a', module: 'esm/index.js', main: 'index.js' }),
    };
    const packages = discoverWorkspacePackages({ existingPaths: new Set(Object.keys(files)), readFile: (path) => files[path] ?? null });
    expect(packages[0]?.entryField).toBe('esm/index.js');
  });

  test('reads packages from lerna.json', () => {
    const files: Record<string, string> = {
      'lerna.json': JSON.stringify({ packages: ['packages/*'] }),
      'packages/a/package.json': JSON.stringify({ name: 'a' }),
    };
    const packages = discoverWorkspacePackages({ existingPaths: new Set(Object.keys(files)), readFile: (path) => files[path] ?? null });
    expect(packages.map((p) => p.name)).toEqual(['a']);
  });

  test('reads a "packages" object form of package.json#workspaces (Yarn nohoist style)', () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ workspaces: { packages: ['packages/*'] } }),
      'packages/a/package.json': JSON.stringify({ name: 'a' }),
    };
    const packages = discoverWorkspacePackages({ existingPaths: new Set(Object.keys(files)), readFile: (path) => files[path] ?? null });
    expect(packages.map((p) => p.name)).toEqual(['a']);
  });

  test('ignores a package.json with malformed JSON rather than throwing', () => {
    const files: Record<string, string> = { 'package.json': '{ not valid json' };
    expect(
      discoverWorkspacePackages({ existingPaths: new Set(Object.keys(files)), readFile: (path) => files[path] ?? null }),
    ).toEqual([]);
  });

  test('skips a matched directory whose package.json is malformed', () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/a/package.json': '{ not valid json',
    };
    expect(
      discoverWorkspacePackages({ existingPaths: new Set(Object.keys(files)), readFile: (path) => files[path] ?? null }),
    ).toEqual([]);
  });
});

/**
 * The inference fallback (no root manifest at all -> guess from directory
 * shape) that Option B added for CacttusEdu's real shape: sibling packages,
 * no root manifest (docs/DECISIONS.md). Deliberately narrow, per that
 * entry's three conditions — each test below exercises one gate directly,
 * not just the happy path, since "the new path has no fixture coverage" was
 * the exact concern that motivated writing these.
 */
describe('discoverWorkspacePackages — inferring siblings with no root manifest', () => {
  /** Real files under a dir, `count` of them, so file-share gates have something to measure. */
  function filesUnder(dirPath: string, count: number, names: string[] = []): Record<string, string> {
    const files: Record<string, string> = {};
    for (let i = 0; i < count; i += 1) {
      const name = names[i] ?? `file${String(i)}.ts`;
      files[`${dirPath}/${name}`] = '';
    }
    return files;
  }

  test('detects comparably-sized sibling packages as inferred, with no root manifest', () => {
    const files: Record<string, string> = {
      'backend/package.json': JSON.stringify({ name: 'backend' }),
      ...filesUnder('backend', 5),
      'dashboard/package.json': JSON.stringify({ name: 'dashboard' }),
      ...filesUnder('dashboard', 5),
      'frontend/package.json': JSON.stringify({ name: 'frontend' }),
      ...filesUnder('frontend', 5),
    };
    const packages = discoverWorkspacePackages({ existingPaths: new Set(Object.keys(files)), readFile: (p) => files[p] ?? null });
    expect(packages).toEqual([
      { name: 'backend', dirPath: 'backend', entryField: null, source: 'inferred' },
      { name: 'dashboard', dirPath: 'dashboard', entryField: null, source: 'inferred' },
      { name: 'frontend', dirPath: 'frontend', entryField: null, source: 'inferred' },
    ]);
  });

  test('does not infer when a root package.json exists — an intentional single manifest is never reinterpreted', () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ name: 'root' }),
      'backend/package.json': JSON.stringify({ name: 'backend' }),
      ...filesUnder('backend', 5),
      'dashboard/package.json': JSON.stringify({ name: 'dashboard' }),
      ...filesUnder('dashboard', 5),
    };
    const packages = discoverWorkspacePackages({ existingPaths: new Set(Object.keys(files)), readFile: (p) => files[p] ?? null });
    expect(packages).toEqual([]);
  });

  test('does not infer from a single named sibling — one package proves nothing about repo shape', () => {
    const files: Record<string, string> = {
      'backend/package.json': JSON.stringify({ name: 'backend' }),
      ...filesUnder('backend', 5),
    };
    const packages = discoverWorkspacePackages({ existingPaths: new Set(Object.keys(files)), readFile: (p) => files[p] ?? null });
    expect(packages).toEqual([]);
  });

  test('does not infer a monorepo from one real package plus one incidental package.json (the tools/ case)', () => {
    // A substantial real package (app/, 20 files) sits beside an incidental
    // helper (tools/, 1 file) that happens to carry its own package.json —
    // exactly the shape docs/DECISIONS.md names as the failure this gate
    // exists to prevent. tools/ passes the "has a name" check alone, which
    // is why the size-ratio gate (not just the sibling count) is required.
    const files: Record<string, string> = {
      'app/package.json': JSON.stringify({ name: 'app' }),
      ...filesUnder('app', 20),
      'tools/package.json': JSON.stringify({ name: 'lint-config' }),
      ...filesUnder('tools', 1),
    };
    const packages = discoverWorkspacePackages({ existingPaths: new Set(Object.keys(files)), readFile: (p) => files[p] ?? null });
    expect(packages).toEqual([]);
  });

  test('does not infer when most of the repo lives outside every candidate package', () => {
    // Two comparably-sized, named siblings exist, but most of the repo's
    // files sit at the root, outside both — "packages exist in here
    // somewhere" is not the same claim as "this repo IS these packages."
    const files: Record<string, string> = {
      ...filesUnder('src', 20, Array.from({ length: 20 }, (_u, i) => `f${String(i)}.ts`)),
      'app/package.json': JSON.stringify({ name: 'app' }),
      ...filesUnder('app', 3),
      'tools/package.json': JSON.stringify({ name: 'tools' }),
      ...filesUnder('tools', 3),
    };
    const packages = discoverWorkspacePackages({ existingPaths: new Set(Object.keys(files)), readFile: (p) => files[p] ?? null });
    expect(packages).toEqual([]);
  });

  test('an unnamed sibling package.json does not count as a candidate', () => {
    const files: Record<string, string> = {
      'backend/package.json': '{}', // no "name" field
      ...filesUnder('backend', 5),
      'dashboard/package.json': JSON.stringify({ name: 'dashboard' }),
      ...filesUnder('dashboard', 5),
    };
    const packages = discoverWorkspacePackages({ existingPaths: new Set(Object.keys(files)), readFile: (p) => files[p] ?? null });
    expect(packages).toEqual([]); // only one NAMED candidate remains — below the minimum.
  });
});

/**
 * Condition 2 of Option B (docs/DECISIONS.md, "resolution isolation made
 * structural"): `declaredOnly` is the only supported way to produce a
 * `DeclaredWorkspacePackage[]` — `NodeResolutionContext.workspacePackages`
 * types itself to require that narrowed shape specifically so a caller
 * handing it the unfiltered (declared + inferred) list does not compile.
 * This is the one function that actually enforces the boundary; test it
 * directly rather than only at the type level.
 */
describe('declaredOnly', () => {
  test('keeps declared packages and drops inferred ones', () => {
    const packages: readonly WorkspacePackage[] = [
      { name: '@acme/core', dirPath: 'packages/core', entryField: null, source: 'declared' },
      { name: 'backend', dirPath: 'backend', entryField: null, source: 'inferred' },
      { name: '@acme/web', dirPath: 'packages/web', entryField: null, source: 'declared' },
    ];
    expect(declaredOnly(packages).map((p) => p.name)).toEqual(['@acme/core', '@acme/web']);
  });

  test('returns an empty array when every package is inferred', () => {
    const packages: readonly WorkspacePackage[] = [{ name: 'backend', dirPath: 'backend', entryField: null, source: 'inferred' }];
    expect(declaredOnly(packages)).toEqual([]);
  });

  test('returns an empty array for an empty input', () => {
    expect(declaredOnly([])).toEqual([]);
  });
});
