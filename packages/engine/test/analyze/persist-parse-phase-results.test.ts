import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistParsePhaseResults, type ProcessedFile } from '../../src/analyze-support';
import { SqliteCacheStore } from '../../src/cache/sqlite-cache-store';
import type { ParsePoolResult } from '../../src/parse/parser-pool';

/**
 * Locks in the poisoned-cache fix (Section 6.1, `docs/DECISIONS.md`): a
 * SYSTEMIC parse failure (the parser pool call itself threw — e.g. the
 * tree-sitter.wasm regression) must never be written to `file_cache` as if
 * it were a legitimate empty result. A genuine per-file syntax error
 * (`status: 'ok'`, `hasSyntaxError: true`) is the opposite case and IS
 * still cached, exactly as before.
 */
function processedFile(overrides: Partial<ProcessedFile> & { path: string; contentHash: string }): ProcessedFile {
  return {
    sizeBytes: 10,
    language: 'ts',
    languageId: 'typescript',
    lineCount: 1,
    skipReason: null,
    isParsed: true,
    headerLines: [],
    text: 'export const x = 1;',
    ...overrides,
  };
}

describe('persistParsePhaseResults — the poisoned-cache fix', () => {
  let dir: string;
  let cacheStore: SqliteCacheStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'onboard-persist-parse-'));
    cacheStore = new SqliteCacheStore(join(dir, 'cache.sqlite'));
    cacheStore.open({ cacheSchemaVersion: 1, engineVersion: 'test', grammarFingerprint: 'fp', contractSchemaVersion: 1 });
  });

  afterEach(() => {
    cacheStore.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('a systemic failure (status: "failed") is never written to file_cache, but a successful parse still is', () => {
    const okFile = processedFile({ path: 'src/ok.ts', contentHash: 'hash-ok' });
    const failedFile = processedFile({ path: 'src/failed.ts', contentHash: 'hash-failed' });
    const results: readonly ParsePoolResult[] = [
      { status: 'ok', parsed: { imports: [], symbols: [], hasSyntaxError: false } },
      { status: 'failed', message: 'ENOENT: no such file or directory, open tree-sitter.wasm' },
    ];

    const freshByPath = persistParsePhaseResults([okFile, failedFile], results, cacheStore);

    expect(cacheStore.getFileCache('src/ok.ts')).not.toBeNull();
    expect(cacheStore.getFileCache('src/failed.ts')).toBeNull();

    // The in-memory result for THIS run's return value still has a
    // placeholder for the failed file (so analyze() can complete and
    // report a diagnostic), it just was never persisted.
    expect(freshByPath.get('src/ok.ts')).toEqual({ imports: [], symbols: [], hasSyntaxError: false });
    expect(freshByPath.get('src/failed.ts')).toEqual({ imports: [], symbols: [], hasSyntaxError: true });
  });

  test('a genuine per-file syntax error (status: "ok", hasSyntaxError: true) IS cached, unlike a systemic failure', () => {
    const brokenFile = processedFile({ path: 'src/broken.ts', contentHash: 'hash-broken' });
    const results: readonly ParsePoolResult[] = [{ status: 'ok', parsed: { imports: [], symbols: [], hasSyntaxError: true } }];

    persistParsePhaseResults([brokenFile], results, cacheStore);

    const row = cacheStore.getFileCache('src/broken.ts');
    expect(row).not.toBeNull();
    expect(row?.contentHash).toBe('hash-broken');
  });

  test('a later run with a fixed parser can still overwrite what a systemic failure never cached (self-healing)', () => {
    const file = processedFile({ path: 'src/recovers.ts', contentHash: 'hash-v1' });
    const failedResults: readonly ParsePoolResult[] = [{ status: 'failed', message: 'boom' }];
    persistParsePhaseResults([file], failedResults, cacheStore);
    expect(cacheStore.getFileCache('src/recovers.ts')).toBeNull();

    const okResults: readonly ParsePoolResult[] = [{ status: 'ok', parsed: { imports: [], symbols: [], hasSyntaxError: false } }];
    persistParsePhaseResults([file], okResults, cacheStore);
    expect(cacheStore.getFileCache('src/recovers.ts')).not.toBeNull();
  });
});
