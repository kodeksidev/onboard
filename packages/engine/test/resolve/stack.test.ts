import { describe, expect, test } from 'bun:test';
import { detectManifests } from '../../src/stack/manifests';
import { detectEntryPoints } from '../../src/stack/entry-points';
import { computeLanguageStats, detectRepoType, detectSourceRoots } from '../../src/stack/detect-stack';
import { inferDependencyRole } from '../../src/stack/dependency-roles';

describe('detectManifests', () => {
  test('detects package.json, its dependencies, and its package manager from a lockfile', () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ name: 'acme', version: '1.0.0', dependencies: { express: '^4.19.2' } }),
      'package-lock.json': '{}',
    };
    const result = detectManifests({ existingPaths: new Set(Object.keys(files)), readFile: (p) => files[p] ?? null });
    expect(result.manifests).toEqual([
      { path: 'package.json', kind: 'package.json', projectName: 'acme', version: '1.0.0', packageManager: 'npm' },
    ]);
    expect(result.dependencies).toEqual([
      { name: 'express', versionSpec: '^4.19.2', ecosystem: 'npm', scope: 'runtime', inferredRole: 'web framework', importedByCount: 0 },
    ]);
  });

  test('detects requirements.txt dependencies, stripping version specifiers', () => {
    const files: Record<string, string> = { 'requirements.txt': 'flask==3.0.0\n# a comment\n\nrequests>=2\n' };
    const result = detectManifests({ existingPaths: new Set(Object.keys(files)), readFile: (p) => files[p] ?? null });
    expect(result.dependencies.map((d) => d.name)).toEqual(['flask', 'requests']);
    expect(result.dependencies[0]?.ecosystem).toBe('pypi');
  });

  test('detects pyproject.toml poetry dependencies, excluding the python constraint', () => {
    const files: Record<string, string> = {
      'pyproject.toml':
        '[tool.poetry]\nname = "app"\nversion = "0.1.0"\n\n[tool.poetry.dependencies]\npython = "^3.11"\nflask = "^3.0.0"\n',
    };
    const result = detectManifests({ existingPaths: new Set(Object.keys(files)), readFile: (p) => files[p] ?? null });
    expect(result.manifests[0]).toEqual({
      path: 'pyproject.toml',
      kind: 'pyproject.toml',
      projectName: 'app',
      version: '0.1.0',
      packageManager: 'poetry',
    });
    expect(result.dependencies.map((d) => d.name)).toEqual(['flask']);
  });

  test('returns no manifests when none are present', () => {
    const result = detectManifests({ existingPaths: new Set(), readFile: () => null });
    expect(result.manifests).toEqual([]);
    expect(result.dependencies).toEqual([]);
  });
});

describe('detectEntryPoints', () => {
  test('detects package.json#main and assigns it rank 1', () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ main: 'src/index.js' }),
      'src/index.js': 'module.exports = {};',
    };
    const entryPoints = detectEntryPoints({
      existingPaths: new Set(Object.keys(files)),
      readFile: (p) => files[p] ?? null,
      workspacePackages: [],
    });
    expect(entryPoints[0]).toEqual({ path: 'src/index.js', rank: 1, evidence: 'package.json#main', kind: 'main' });
  });

  test('detects a Python __main__.py entry point', () => {
    const files: Record<string, string> = { '__main__.py': 'print(1)' };
    const entryPoints = detectEntryPoints({
      existingPaths: new Set(Object.keys(files)),
      readFile: (p) => files[p] ?? null,
      workspacePackages: [],
    });
    expect(entryPoints).toEqual([{ path: '__main__.py', rank: 1, evidence: 'python:__main__.py', kind: 'main' }]);
  });

  test('detects a convention index.ts when there is no package.json#main', () => {
    const files: Record<string, string> = { 'src/index.ts': 'export {}' };
    const entryPoints = detectEntryPoints({
      existingPaths: new Set(Object.keys(files)),
      readFile: (p) => files[p] ?? null,
      workspacePackages: [],
    });
    expect(entryPoints).toEqual([{ path: 'src/index.ts', rank: 1, evidence: 'convention:src/index.ts', kind: 'convention' }]);
  });

  test('every rank is unique and 1-based', () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ main: 'index.js', bin: { cli: 'bin/cli.js' } }),
      'index.js': '',
      'bin/cli.js': '',
    };
    const entryPoints = detectEntryPoints({
      existingPaths: new Set(Object.keys(files)),
      readFile: (p) => files[p] ?? null,
      workspacePackages: [],
    });
    expect(entryPoints.map((e) => e.rank)).toEqual([1, 2]);
  });
});

describe('detectRepoType / detectSourceRoots / computeLanguageStats', () => {
  test('detects a monorepo when there is more than one workspace package', () => {
    const type = detectRepoType({ manifests: [], dependencies: [], workspacePackageCount: 3 });
    expect(type).toBe('Monorepo (3 workspaces)');
  });

  test('detects a React application from its dependencies', () => {
    const type = detectRepoType({
      manifests: [{ path: 'package.json', kind: 'package.json', projectName: null, version: null, packageManager: null }],
      dependencies: [{ name: 'react', versionSpec: '^19', ecosystem: 'npm', scope: 'runtime', inferredRole: 'UI framework', importedByCount: 0 }],
      workspacePackageCount: 0,
    });
    expect(type).toBe('React application');
  });

  test('sourceRoots defaults to the repo root when there are no workspace packages', () => {
    expect(detectSourceRoots([])).toEqual(['']);
  });

  test('sourceRoots is every workspace package dir, sorted', () => {
    expect(detectSourceRoots(['packages/web', 'packages/core'])).toEqual(['packages/core', 'packages/web']);
  });

  test('computeLanguageStats shares are percentages of total file count', () => {
    const stats = computeLanguageStats([
      { language: 'ts', lineCount: 10 },
      { language: 'ts', lineCount: 20 },
      { language: 'py', lineCount: 5 },
      { language: 'py', lineCount: 5 },
    ]);
    const ts = stats.find((s) => s.language === 'ts')!;
    expect(ts.fileCount).toBe(2);
    expect(ts.sharePercent).toBe(50);
  });
});

describe('inferDependencyRole', () => {
  test('returns a role for a known package', () => {
    expect(inferDependencyRole('express')).toBe('web framework');
  });

  test('returns null for an unknown package', () => {
    expect(inferDependencyRole('some-obscure-package')).toBeNull();
  });
});
