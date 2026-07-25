import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CacheSchemaMeta } from '../../src/cache/cache-store';
import { SqliteCacheStore } from '../../src/cache/sqlite-cache-store';

const EXPECTED: CacheSchemaMeta = {
  cacheSchemaVersion: 1,
  engineVersion: '0.1.0',
  grammarFingerprint: 'fingerprint-a',
  contractSchemaVersion: 1,
};

let dir: string;
let dbFilePath: string;

/**
 * Windows can hold a newly-closed WAL-mode SQLite file's `-shm` mapping open
 * for a short window after `Database.close()` returns (observed with
 * `bun:sqlite` on this dev machine, A22). This is a test-cleanup timing
 * quirk, not a product bug, so it is handled here with a bounded retry
 * rather than by weakening the schema's `PRAGMA journal_mode = WAL` (Section
 * 6.1's DDL is verbatim) or the store's own `close()`.
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'onboard-cache-'));
  dbFilePath = join(dir, 'repo.sqlite');
});

afterEach(async () => {
  await removeDirWithRetry(dir);
});

describe('SqliteCacheStore.open — first run', () => {
  test('creates a fresh database and reports "recreated"', () => {
    const store = new SqliteCacheStore(dbFilePath);
    expect(store.open(EXPECTED)).toBe('recreated');
    store.close();
  });
});

describe('SqliteCacheStore.open — reopening', () => {
  test('reuses a valid database whose schema_meta matches ("reused")', () => {
    const first = new SqliteCacheStore(dbFilePath);
    first.open(EXPECTED);
    first.close();

    const second = new SqliteCacheStore(dbFilePath);
    expect(second.open(EXPECTED)).toBe('reused');
    second.close();
  });

  test('recreates (and drops prior content) when engineVersion no longer matches', () => {
    const first = new SqliteCacheStore(dbFilePath);
    first.open(EXPECTED);
    first.upsertFileCache({
      path: 'src/a.ts',
      contentHash: 'h'.repeat(64),
      sizeBytes: 10,
      lineCount: 1,
      language: 'ts',
      classification: 'util',
      isParsed: true,
      skipReason: null,
      parsedJson: '{}',
    });
    first.close();

    const second = new SqliteCacheStore(dbFilePath);
    const outcome = second.open({ ...EXPECTED, engineVersion: '0.2.0' });
    expect(outcome).toBe('recreated');
    expect(second.getFileCache('src/a.ts')).toBeNull();
    second.close();
  });
});

describe('SqliteCacheStore.open — corrupt / truncated database (Section 10)', () => {
  test('deletes and rebuilds a file that is not a valid SQLite database', () => {
    writeFileSync(dbFilePath, 'not a real sqlite file, just garbage bytes');
    const store = new SqliteCacheStore(dbFilePath);
    expect(store.open(EXPECTED)).toBe('recreated');
    expect(store.listFileCachePaths()).toEqual([]);
    store.close();
  });
});

describe('SqliteCacheStore — file_cache CRUD', () => {
  test('round-trips a row through upsert/get, preserving boolean and nullable fields', () => {
    const store = new SqliteCacheStore(dbFilePath);
    store.open(EXPECTED);
    store.upsertFileCache({
      path: 'src/b.ts',
      contentHash: 'b'.repeat(64),
      sizeBytes: 20,
      lineCount: 2,
      language: 'ts',
      classification: 'service',
      isParsed: false,
      skipReason: 'binary',
      parsedJson: '{}',
    });

    const row = store.getFileCache('src/b.ts');
    expect(row).toEqual({
      path: 'src/b.ts',
      contentHash: 'b'.repeat(64),
      sizeBytes: 20,
      lineCount: 2,
      language: 'ts',
      classification: 'service',
      isParsed: false,
      skipReason: 'binary',
      parsedJson: '{}',
    });
    store.close();
  });

  test('listFileCachePaths returns paths sorted ascending', () => {
    const store = new SqliteCacheStore(dbFilePath);
    store.open(EXPECTED);
    for (const path of ['z.ts', 'a.ts', 'm.ts']) {
      store.upsertFileCache({
        path,
        contentHash: 'c'.repeat(64),
        sizeBytes: 1,
        lineCount: 1,
        language: 'ts',
        classification: 'util',
        isParsed: true,
        skipReason: null,
        parsedJson: '{}',
      });
    }
    expect(store.listFileCachePaths()).toEqual(['a.ts', 'm.ts', 'z.ts']);
    store.close();
  });

  test('deleteFileCache removes a row', () => {
    const store = new SqliteCacheStore(dbFilePath);
    store.open(EXPECTED);
    store.upsertFileCache({
      path: 'src/c.ts',
      contentHash: 'd'.repeat(64),
      sizeBytes: 1,
      lineCount: 1,
      language: 'ts',
      classification: 'util',
      isParsed: true,
      skipReason: null,
      parsedJson: '{}',
    });
    store.deleteFileCache('src/c.ts');
    expect(store.getFileCache('src/c.ts')).toBeNull();
    store.close();
  });
});

describe('SqliteCacheStore — symbol / import_edge / token_index CRUD', () => {
  test('replaceSymbolsForPath replaces the full set for a path', () => {
    const store = new SqliteCacheStore(dbFilePath);
    store.open(EXPECTED);
    store.upsertFileCache({
      path: 'src/d.ts',
      contentHash: 'e'.repeat(64),
      sizeBytes: 1,
      lineCount: 5,
      language: 'ts',
      classification: 'util',
      isParsed: true,
      skipReason: null,
      parsedJson: '{}',
    });
    store.replaceSymbolsForPath('src/d.ts', [
      {
        id: 'sym-1',
        path: 'src/d.ts',
        name: 'doThing',
        nameLower: 'dothing',
        kind: 'function',
        startLine: 1,
        endLine: 3,
        isExported: true,
        container: null,
        signature: 'function doThing(): void',
      },
    ]);
    expect(store.getSymbolsForPath('src/d.ts')).toHaveLength(1);

    store.replaceSymbolsForPath('src/d.ts', []);
    expect(store.getSymbolsForPath('src/d.ts')).toEqual([]);
    store.close();
  });

  test('cascades symbol/import_edge/token_index deletes when the owning file_cache row is deleted', () => {
    const store = new SqliteCacheStore(dbFilePath);
    store.open(EXPECTED);
    store.upsertFileCache({
      path: 'src/e.ts',
      contentHash: 'f'.repeat(64),
      sizeBytes: 1,
      lineCount: 1,
      language: 'ts',
      classification: 'util',
      isParsed: true,
      skipReason: null,
      parsedJson: '{}',
    });
    store.replaceSymbolsForPath('src/e.ts', [
      {
        id: 'sym-2',
        path: 'src/e.ts',
        name: 'x',
        nameLower: 'x',
        kind: 'const',
        startLine: 1,
        endLine: 1,
        isExported: false,
        container: null,
        signature: null,
      },
    ]);
    store.replaceImportEdgesForPath('src/e.ts', [
      { fromPath: 'src/e.ts', specifier: './f', line: 1, toPath: 'src/f.ts', toExternal: null, kind: 'static', isTypeOnly: false },
    ]);

    store.deleteFileCache('src/e.ts');

    expect(store.getSymbolsForPath('src/e.ts')).toEqual([]);
    expect(store.getImportEdgesFromPath('src/e.ts')).toEqual([]);
    store.close();
  });
});

describe('SqliteCacheStore — analysis_result single-row table', () => {
  test('putAnalysisResult then getAnalysisResult round-trips, and upserts on repeat calls', () => {
    const store = new SqliteCacheStore(dbFilePath);
    store.open(EXPECTED);

    store.putAnalysisResult({ schemaVersion: 1, fingerprint: 'f'.repeat(64), resultJson: '{"a":1}' });
    expect(store.getAnalysisResult()).toEqual({
      schemaVersion: 1,
      fingerprint: 'f'.repeat(64),
      resultJson: '{"a":1}',
    });

    store.putAnalysisResult({ schemaVersion: 1, fingerprint: 'g'.repeat(64), resultJson: '{"a":2}' });
    expect(store.getAnalysisResult()).toEqual({
      schemaVersion: 1,
      fingerprint: 'g'.repeat(64),
      resultJson: '{"a":2}',
    });
    store.close();
  });

  test('returns null when no analysis has ever been stored', () => {
    const store = new SqliteCacheStore(dbFilePath);
    store.open(EXPECTED);
    expect(store.getAnalysisResult()).toBeNull();
    store.close();
  });
});
