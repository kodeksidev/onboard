import { describe, expect, test } from 'bun:test';
import { discoverWorkspacePackages } from '../../src/resolve/workspaces';

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
      { name: '@acme/core', dirPath: 'packages/core', entryField: 'src/index.ts' },
      { name: '@acme/web', dirPath: 'packages/web', entryField: null },
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
