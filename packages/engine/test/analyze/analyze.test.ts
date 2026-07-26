import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnalysisResult } from '@onboard/contract';
import { analyze, analyzeWithTimings } from '../../src/analyze';
import { SqliteCacheStore } from '../../src/cache/sqlite-cache-store';

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

/**
 * Windows can hold a newly-closed WAL-mode SQLite file's `-shm` mapping open
 * for a short window after `Database.close()` returns (same quirk documented
 * in `test/cache/sqlite-cache-store.test.ts`, A22) — a bounded retry absorbs
 * it rather than weakening the schema's WAL mode.
 */
async function removeDirWithRetry(path: string): Promise<void> {
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

describe('analyze — token_index persistence (Section 6.1, search infra)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'onboard-analyze-cache-'));
  });

  afterEach(async () => {
    await removeDirWithRetry(dir);
  });

  test('a cold analyze() with a cache store does not throw on an unparsed file (package.json has no file_cache row from persistParsedFile, only from the token-index FK guard)', async () => {
    const cacheStore = new SqliteCacheStore(join(dir, 'cache.sqlite'));
    await expect(
      analyze({ repoRootAbs: join(FIXTURES_DIR, 'node-express'), grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-test', cacheStore }),
    ).resolves.toBeDefined();
    expect(cacheStore.queryTokensByToken('express').some((row) => row.path === 'package.json')).toBe(true);
    cacheStore.close();
  });

  test('token_index rows exist for a parsed file too, and survive a warm re-run unchanged', async () => {
    const cacheStore = new SqliteCacheStore(join(dir, 'cache.sqlite'));
    await analyze({ repoRootAbs: join(FIXTURES_DIR, 'node-express'), grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-test', cacheStore });
    cacheStore.close();
    const warmCacheStore = new SqliteCacheStore(join(dir, 'cache.sqlite'));
    await analyze({ repoRootAbs: join(FIXTURES_DIR, 'node-express'), grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-test', cacheStore: warmCacheStore });
    const rows = warmCacheStore.queryTokensByToken('router');
    expect(rows.length).toBeGreaterThan(0);
    warmCacheStore.close();
  });
});

describe('analyzeWithTimings', () => {
  test('returns the same AnalysisResult as analyze(), plus a non-negative timings breakdown', async () => {
    const { result, timings } = await analyzeWithTimings({
      repoRootAbs: join(FIXTURES_DIR, 'node-express'),
      grammarsDir: GRAMMARS_DIR,
      engineVersion: '0.0.0-test',
    });
    expect(() => AnalysisResult.parse(result)).not.toThrow();
    expect(timings.walkMs).toBeGreaterThanOrEqual(0);
    expect(timings.parseMs).toBeGreaterThanOrEqual(0);
    expect(timings.resolveMs).toBeGreaterThanOrEqual(0);
    expect(timings.graphMs).toBe(0);
    expect(timings.totalMs).toBeGreaterThanOrEqual(timings.walkMs + timings.parseMs + timings.resolveMs);
    expect(timings.cacheHitCount).toBe(0);
  });

  test('reports a non-zero cacheHitCount on a warm re-run with an unchanged cache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onboard-timings-cache-'));
    try {
      const cold = new SqliteCacheStore(join(dir, 'cache.sqlite'));
      await analyzeWithTimings({ repoRootAbs: join(FIXTURES_DIR, 'node-express'), grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-test', cacheStore: cold });
      cold.close();
      const warm = new SqliteCacheStore(join(dir, 'cache.sqlite'));
      const { timings } = await analyzeWithTimings({ repoRootAbs: join(FIXTURES_DIR, 'node-express'), grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-test', cacheStore: warm });
      warm.close();
      expect(timings.cacheHitCount).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('emits onProgress at each phase-transition boundary, in order, with matching processed/total pairs', async () => {
    const phases: string[] = [];
    await analyzeWithTimings({
      repoRootAbs: join(FIXTURES_DIR, 'node-express'),
      grammarsDir: GRAMMARS_DIR,
      engineVersion: '0.0.0-test',
      onProgress: (p) => phases.push(`${p.phase}:${String(p.processed)}/${String(p.total)}`),
    });
    const phaseNames = phases.map((p) => p.split(':')[0]);
    expect(phaseNames).toEqual(['walk', 'walk', 'parse', 'parse', 'resolve', 'resolve', 'persist', 'persist']);
    // Every phase's second (completion) notification reports processed === total.
    phases
      .filter((_, index) => index % 2 === 1)
      .forEach((entry) => {
        const [, counts] = entry.split(':');
        const [processed, total] = (counts ?? '').split('/');
        expect(processed).toBe(total);
      });
  });
});
