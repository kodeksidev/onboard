import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { AnalysisResult } from '@onboard/contract';
import { analyze } from '../../src/analyze';

const GRAMMARS_DIR = join(import.meta.dir, '..', '..', 'grammars');
const FIXTURES_DIR = join(import.meta.dir, '..', '..', 'fixtures');

describe('analyze — node-express fixture', () => {
  test('produces a schema-valid AnalysisResult', async () => {
    const result = await analyze({
      repoRootAbs: join(FIXTURES_DIR, 'node-express'),
      grammarsDir: GRAMMARS_DIR,
      engineVersion: '0.0.0-test',
    });
    expect(() => AnalysisResult.parse(result)).not.toThrow();
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.stats.filesParsed).toBeGreaterThan(0);
  });

  test('detects the router.get(...) route symbol and a resolved edge to the controller', async () => {
    const result = await analyze({
      repoRootAbs: join(FIXTURES_DIR, 'node-express'),
      grammarsDir: GRAMMARS_DIR,
      engineVersion: '0.0.0-test',
    });
    expect(result.symbols.some((s) => s.kind === 'route')).toBe(true);
    expect(
      result.edges.some((e) => e.fromPath === 'src/routes/user-routes.js' && e.toPath === 'src/controllers/user-controller.js'),
    ).toBe(true);
  });

  test('is deterministic: two cold runs produce the same fingerprint', async () => {
    const first = await analyze({ repoRootAbs: join(FIXTURES_DIR, 'node-express'), grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-test' });
    const second = await analyze({ repoRootAbs: join(FIXTURES_DIR, 'node-express'), grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-test' });
    expect(second.fingerprint).toBe(first.fingerprint);
  });
});

describe('analyze — react-app fixture (tsconfig paths alias, barrel re-export)', () => {
  test('resolves the @/ alias and a barrel re-export', async () => {
    const result = await analyze({ repoRootAbs: join(FIXTURES_DIR, 'react-app'), grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-test' });
    expect(result.edges.some((e) => e.fromPath === 'src/index.tsx' && e.toPath === 'src/components/App.tsx')).toBe(true);
    expect(result.edges.some((e) => e.fromPath === 'src/components/App.tsx' && e.toPath === 'src/hooks/useToggle.ts')).toBe(true);
  });

  test('detects a component symbol and a hook symbol', async () => {
    const result = await analyze({ repoRootAbs: join(FIXTURES_DIR, 'react-app'), grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-test' });
    expect(result.symbols.some((s) => s.kind === 'component')).toBe(true);
    expect(result.symbols.some((s) => s.kind === 'hook')).toBe(true);
  });
});

describe('analyze — python-flask fixture (relative imports, __main__.py)', () => {
  test('resolves a relative Python import and detects the __main__.py entry point', async () => {
    const result = await analyze({ repoRootAbs: join(FIXTURES_DIR, 'python-flask'), grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-test' });
    expect(result.edges.some((e) => e.fromPath === 'app/routes/user_routes.py' && e.toPath === 'app/models/user_model.py')).toBe(true);
    expect(result.entryPoints.some((e) => e.path === 'app/__main__.py' && e.evidence === 'python:__main__.py')).toBe(true);
  });
});

describe('analyze — mixed-monorepo fixture (workspace resolution)', () => {
  test('resolves a workspace package import to its in-repo entry file, never node_modules', async () => {
    const result = await analyze({ repoRootAbs: join(FIXTURES_DIR, 'mixed-monorepo'), grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-test' });
    expect(
      result.edges.some((e) => e.fromPath === 'packages/web/src/index.ts' && e.toPath === 'packages/core/src/index.ts'),
    ).toBe(true);
    expect(result.repo.detectedType).toBe('Monorepo (2 workspaces)');
  });
});

describe('analyze — kitchen-sink fixture (cycles, skip-rules, broken file)', () => {
  test('runs to completion, skips the 2MB/minified files, and surfaces a PARSE_FAILED diagnostic', async () => {
    const result = await analyze({ repoRootAbs: join(FIXTURES_DIR, 'kitchen-sink'), grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-test' });
    const large = result.files.find((f) => f.path === 'src/large-file.ts');
    const minified = result.files.find((f) => f.path === 'src/minified.js');
    expect(large?.skipReason).toBe('too-large');
    expect(minified?.skipReason).toBe('minified');
    expect(result.diagnostics.some((d) => d.code === 'PARSE_FAILED' && d.path === 'src/broken.ts')).toBe(true);
  });

  test('the nested .gitignore negation is honored: important.log is indexed, other.log is not', async () => {
    const result = await analyze({ repoRootAbs: join(FIXTURES_DIR, 'kitchen-sink'), grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-test' });
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain('src/sub/nested/important.log');
    expect(paths).not.toContain('src/sub/nested/other.log');
  });
});
