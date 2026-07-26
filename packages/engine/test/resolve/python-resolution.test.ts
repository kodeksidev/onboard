import { describe, expect, test } from 'bun:test';
import {
  discoverPythonPackageRoots,
  resolvePythonImport,
  type PythonResolutionContext,
} from '../../src/resolve/python-resolution';
import { PYTHON_STDLIB_MODULES } from '../../src/resolve/python-stdlib';

function contextWith(overrides: Partial<PythonResolutionContext> = {}): PythonResolutionContext {
  return {
    existingPathSet: new Set<string>(),
    directories: new Set<string>(),
    packageRoots: [''],
    stdlibModules: PYTHON_STDLIB_MODULES,
    manifestPackageNames: new Set<string>(),
    ...overrides,
  };
}

describe('resolvePythonImport — absolute imports', () => {
  test('resolves a dotted module to its .py file', () => {
    const context = contextWith({ existingPathSet: new Set(['app/models/user.py']), packageRoots: [''] });
    expect(resolvePythonImport('app/routes/user_routes.py', 'app.models.user', context)).toEqual({
      kind: 'resolved',
      toPath: 'app/models/user.py',
    });
  });

  test('resolves a package (__init__.py) when the module itself is a package', () => {
    const context = contextWith({ existingPathSet: new Set(['app/models/__init__.py']) });
    expect(resolvePythonImport('app/routes/user_routes.py', 'app.models', context)).toEqual({
      kind: 'resolved',
      toPath: 'app/models/__init__.py',
    });
  });

  test('falls back to the parent module when the last segment is a symbol, not a module', () => {
    const context = contextWith({ existingPathSet: new Set(['app/models.py']) });
    expect(resolvePythonImport('app/routes/user_routes.py', 'app.models.find_by_id', context)).toEqual({
      kind: 'resolved',
      toPath: 'app/models.py',
    });
  });

  test('classifies an unresolved top-level name in the stdlib list as external/stdlib', () => {
    const context = contextWith();
    expect(resolvePythonImport('app/main.py', 'os.path', context)).toEqual({
      kind: 'external',
      ecosystem: 'stdlib',
      packageName: 'os',
    });
  });

  test('classifies an unresolved top-level name present in a manifest as external/pypi', () => {
    const context = contextWith({ manifestPackageNames: new Set(['flask']) });
    expect(resolvePythonImport('app/main.py', 'flask', context)).toEqual({
      kind: 'external',
      ecosystem: 'pypi',
      packageName: 'flask',
    });
  });

  test('classifies an unresolved top-level name in neither list as external/unknown', () => {
    const context = contextWith();
    expect(resolvePythonImport('app/main.py', 'some_random_package', context)).toEqual({
      kind: 'external',
      ecosystem: 'unknown',
      packageName: 'some_random_package',
    });
  });
});

describe('resolvePythonImport — relative imports', () => {
  test('a single dot stays in the current package directory', () => {
    const context = contextWith({ existingPathSet: new Set(['app/routes/sibling.py']) });
    expect(resolvePythonImport('app/routes/user_routes.py', '.sibling', context)).toEqual({
      kind: 'resolved',
      toPath: 'app/routes/sibling.py',
    });
  });

  test('two dots walks one directory up, falling back to the package __init__.py for an imported symbol', () => {
    const context = contextWith({ existingPathSet: new Set(['app/models/__init__.py']) });
    expect(resolvePythonImport('app/routes/user_routes.py', '..models.User', context)).toEqual({
      kind: 'resolved',
      toPath: 'app/models/__init__.py',
    });
  });

  test('is never classified external, even when unresolved', () => {
    const context = contextWith({ existingPathSet: new Set([]) });
    const result = resolvePythonImport('app/routes/user_routes.py', '..nonexistent.Thing', context);
    expect(result.kind).toBe('unresolved');
  });

  test('a relative import into a PEP 420 namespace package reports namespace-package, not no-match-on-disk', () => {
    const context = contextWith({
      existingPathSet: new Set(['app/plugins/thing.txt']),
      directories: new Set(['app', 'app/plugins']),
    });
    expect(resolvePythonImport('app/main.py', '.plugins', context)).toEqual({
      kind: 'unresolved',
      reason: 'namespace-package',
    });
  });
});

describe('resolvePythonImport — PEP 420 namespace packages', () => {
  test('reports namespace-package when a directory exists without __init__.py', () => {
    const context = contextWith({
      existingPathSet: new Set(['app/plugins/thing.txt']),
      directories: new Set(['app', 'app/plugins']),
    });
    expect(resolvePythonImport('app/main.py', 'app.plugins', context)).toEqual({
      kind: 'unresolved',
      reason: 'namespace-package',
    });
  });

  test('a concrete .py file match takes priority over the namespace-package directory', () => {
    const context = contextWith({
      existingPathSet: new Set(['app/plugins.py']),
      directories: new Set(['app', 'app/plugins']),
    });
    expect(resolvePythonImport('app/main.py', 'app.plugins', context)).toEqual({
      kind: 'resolved',
      toPath: 'app/plugins.py',
    });
  });
});

describe('discoverPythonPackageRoots', () => {
  test('includes the repo root, package tops, and pyproject.toml packages, ordered length desc then path asc', () => {
    const roots = discoverPythonPackageRoots({
      existingPaths: new Set(['app/__init__.py', 'app/models/__init__.py', 'pyproject.toml']),
      readFile: (path) => (path === 'pyproject.toml' ? 'packages = [{ include = "app" }]\n' : null),
    });
    // 'app/models' has an __init__.py PARENT ('app'), so it is not its own package top.
    expect(roots).toEqual(['app', '']);
  });

  test('includes src/ when present', () => {
    const roots = discoverPythonPackageRoots({
      existingPaths: new Set(['src/pkg/__init__.py']),
      readFile: () => null,
    });
    expect(roots).toContain('src');
    expect(roots).toContain('src/pkg');
  });

  test('treats a top-level __init__.py as a package root at the repo root itself', () => {
    const roots = discoverPythonPackageRoots({ existingPaths: new Set(['__init__.py']), readFile: () => null });
    expect(roots).toContain('');
  });

  test('reads a bare quoted-string packages list (no include= form) from pyproject.toml', () => {
    const roots = discoverPythonPackageRoots({
      existingPaths: new Set(['pyproject.toml']),
      readFile: (path) => (path === 'pyproject.toml' ? 'packages = ["app", "lib"]\n' : null),
    });
    expect(roots).toContain('app');
    expect(roots).toContain('lib');
  });

  test('is unaffected by a pyproject.toml with no "packages" key at all', () => {
    const roots = discoverPythonPackageRoots({
      existingPaths: new Set(['pyproject.toml']),
      readFile: (path) => (path === 'pyproject.toml' ? '[tool.poetry]\nname = "app"\n' : null),
    });
    expect(roots).toEqual(['']);
  });
});
