import { describe, expect, test } from 'bun:test';
import { resolveRawImport, type ResolverContext } from '../../src/resolve/resolve-import';
import type { NodeResolutionContext } from '../../src/resolve/node-resolution';
import type { PythonResolutionContext } from '../../src/resolve/python-resolution';
import type { RawImport } from '../../src/parse/language-parser';
import { PYTHON_STDLIB_MODULES } from '../../src/resolve/python-stdlib';

function nodeContext(overrides: Partial<NodeResolutionContext> = {}): NodeResolutionContext {
  return { existingPathSet: new Set(), tsconfigs: [], packageImports: [], workspacePackages: [], ...overrides };
}

function pythonContext(overrides: Partial<PythonResolutionContext> = {}): PythonResolutionContext {
  return {
    existingPathSet: new Set(),
    directories: new Set(),
    packageRoots: [''],
    stdlibModules: PYTHON_STDLIB_MODULES,
    manifestPackageNames: new Set(),
    ...overrides,
  };
}

function contextWith(node: Partial<NodeResolutionContext> = {}, python: Partial<PythonResolutionContext> = {}): ResolverContext {
  return { node: nodeContext(node), python: pythonContext(python) };
}

function rawImport(overrides: Partial<RawImport> = {}): RawImport {
  return { specifier: './x', line: 1, kind: 'static', isTypeOnly: false, isLiteral: true, ...overrides };
}

describe('resolveRawImport — JS/TS family', () => {
  test('produces an edge when the specifier resolves', () => {
    const context = contextWith({ existingPathSet: new Set(['src/x.ts']) });
    const outcome = resolveRawImport('src/index.ts', 'typescript', rawImport({ specifier: './x' }), context);
    expect(outcome).toEqual({
      kind: 'edge',
      edge: { fromPath: 'src/index.ts', toPath: 'src/x.ts', specifier: './x', line: 1, kind: 'static', isTypeOnly: false },
    });
  });

  test('produces an npm external when the specifier is a bare package name', () => {
    const context = contextWith();
    const outcome = resolveRawImport('src/index.ts', 'javascript', rawImport({ specifier: 'express' }), context);
    expect(outcome).toEqual({ kind: 'external', packageName: 'express', ecosystem: 'npm' });
  });

  test('produces unresolved when the relative specifier does not exist on disk', () => {
    const context = contextWith();
    const outcome = resolveRawImport('src/index.ts', 'javascript', rawImport({ specifier: './missing' }), context);
    expect(outcome).toEqual({
      kind: 'unresolved',
      unresolved: { fromPath: 'src/index.ts', specifier: './missing', line: 1, reason: 'no-match-on-disk' },
    });
  });

  test('a non-literal dynamic import is dynamic-expression without attempting resolution', () => {
    const context = contextWith({ existingPathSet: new Set(['pathVar']) }); // even if this "resolves" by accident, it must not be tried
    const outcome = resolveRawImport(
      'src/index.ts',
      'javascript',
      rawImport({ specifier: 'pathVar', kind: 'dynamic', isLiteral: false }),
      context,
    );
    expect(outcome).toEqual({
      kind: 'unresolved',
      unresolved: { fromPath: 'src/index.ts', specifier: 'pathVar', line: 1, reason: 'dynamic-expression' },
    });
  });

  test('a literal dynamic import IS resolved normally', () => {
    const context = contextWith({ existingPathSet: new Set(['src/lazy.ts']) });
    const outcome = resolveRawImport(
      'src/index.ts',
      'javascript',
      rawImport({ specifier: './lazy', kind: 'dynamic', isLiteral: true }),
      context,
    );
    expect(outcome.kind).toBe('edge');
  });
});

describe('resolveRawImport — Python', () => {
  test('produces an edge with kind "static" when the module resolves', () => {
    const context = contextWith({}, { existingPathSet: new Set(['models.py']) });
    const outcome = resolveRawImport('main.py', 'python', rawImport({ specifier: 'models' }), context);
    expect(outcome).toEqual({
      kind: 'edge',
      edge: { fromPath: 'main.py', toPath: 'models.py', specifier: 'models', line: 1, kind: 'static', isTypeOnly: false },
    });
  });

  test('produces a stdlib external for an unresolved top-level stdlib name', () => {
    const context = contextWith();
    const outcome = resolveRawImport('app/main.py', 'python', rawImport({ specifier: 'os.path' }), context);
    expect(outcome).toEqual({ kind: 'external', packageName: 'os', ecosystem: 'stdlib' });
  });

  test('produces unresolved for a relative import that does not exist', () => {
    const context = contextWith();
    const outcome = resolveRawImport('app/main.py', 'python', rawImport({ specifier: '.sibling' }), context);
    expect(outcome).toEqual({
      kind: 'unresolved',
      unresolved: { fromPath: 'app/main.py', specifier: '.sibling', line: 1, reason: 'no-match-on-disk' },
    });
  });

  test('a non-literal importlib.import_module(...) argument is dynamic-expression, never resolved (Section 8.2 rule 6)', () => {
    const context = contextWith({}, { existingPathSet: new Set(['name.py']) }); // even if this "resolves" by accident, it must not be tried
    const outcome = resolveRawImport(
      'app/main.py',
      'python',
      rawImport({ specifier: 'name', kind: 'dynamic', isLiteral: false }),
      context,
    );
    expect(outcome).toEqual({
      kind: 'unresolved',
      unresolved: { fromPath: 'app/main.py', specifier: 'name', line: 1, reason: 'dynamic-expression' },
    });
  });

  test('a literal importlib.import_module(...) argument IS resolved with the same rules as a normal import', () => {
    const context = contextWith({}, { existingPathSet: new Set(['models.py']) });
    const outcome = resolveRawImport(
      'app/main.py',
      'python',
      rawImport({ specifier: 'models', kind: 'dynamic', isLiteral: true }),
      context,
    );
    expect(outcome.kind).toBe('edge');
  });
});
