import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngineMethods } from '../../src/rpc/methods';
import { DomainError } from '../../src/rpc/domain-error';

const GRAMMARS_DIR = join(import.meta.dir, '..', '..', 'grammars');
const FIXTURES_DIR = join(import.meta.dir, '..', '..', 'fixtures');
const FAKE_REPO_ID = '0123456789abcdef';

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

function makeMethods(appDataDirOverride?: string) {
  const progressEvents: unknown[] = [];
  const methods = createEngineMethods({
    engineVersion: '0.0.0-test',
    grammarsDir: GRAMMARS_DIR,
    grammarFingerprint: 'fingerprint-test',
    onProgress: (p) => progressEvents.push(p),
  });
  return { methods, progressEvents, appDataDirOverride };
}

describe('engine.version', () => {
  test('returns the configured engine/contract/grammar identity', async () => {
    const { methods } = makeMethods();
    const result = await methods.version({});
    expect(result).toEqual({ engineVersion: '0.0.0-test', contractSchemaVersion: 1, grammarFingerprint: 'fingerprint-test' });
  });
});

describe('engine.analyze -> engine.search -> engine.readFile -> engine.shutdown (happy path)', () => {
  let appDataDir: string;

  beforeEach(() => {
    appDataDir = mkdtempSync(join(tmpdir(), 'onboard-rpc-appdata-'));
  });

  afterEach(async () => {
    await removeDirWithRetry(appDataDir);
  });

  test('runs the full method chain over the node-express fixture', async () => {
    const { methods, progressEvents } = makeMethods();

    const analyzeResult = await methods.analyze({
      repoPath: join(FIXTURES_DIR, 'node-express'),
      appDataDir,
      excludeGlobs: [],
      isForceRefresh: false,
    });
    expect(analyzeResult.result.files.length).toBeGreaterThan(0);
    expect(analyzeResult.engineVersion).toBe('0.0.0-test');
    expect(analyzeResult.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(progressEvents.length).toBeGreaterThan(0);

    const repoId = analyzeResult.result.repo.id;
    const searchResult = await methods.search({ repoId, query: 'router', limit: 10 });
    expect(searchResult.hits.length).toBeGreaterThan(0);

    const somePath = analyzeResult.result.files[0]?.path ?? '';
    expect(somePath.length).toBeGreaterThan(0);
    const readResult = await methods.readFile({ repoId, path: somePath, maxBytes: 1_000_000 });
    expect(readResult.path).toBe(somePath);
    expect(readResult.isTruncated).toBe(false);

    const shutdownResult = await methods.shutdown({});
    expect(shutdownResult).toEqual({});
  });

  test('a small maxBytes truncates readFile content and sets isTruncated', async () => {
    const { methods } = makeMethods();
    const analyzeResult = await methods.analyze({
      repoPath: join(FIXTURES_DIR, 'node-express'),
      appDataDir,
      excludeGlobs: [],
      isForceRefresh: false,
    });
    const repoId = analyzeResult.result.repo.id;
    const somePath = analyzeResult.result.files.find((f) => f.sizeBytes > 10)?.path;
    expect(somePath).toBeDefined();
    const readResult = await methods.readFile({ repoId, path: somePath!, maxBytes: 5 });
    expect(readResult.isTruncated).toBe(true);
    expect(readResult.content.length).toBeLessThanOrEqual(5);
    await methods.shutdown({});
  });

  test('a path with a ".." segment is rejected with E_PATH_ESCAPES_REPO', async () => {
    const { methods } = makeMethods();
    const analyzeResult = await methods.analyze({
      repoPath: join(FIXTURES_DIR, 'node-express'),
      appDataDir,
      excludeGlobs: [],
      isForceRefresh: false,
    });
    const repoId = analyzeResult.result.repo.id;
    try {
      await methods.readFile({ repoId, path: '../../etc/passwd', maxBytes: 1000 });
      throw new Error('expected readFile to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).appError.code).toBe('E_PATH_ESCAPES_REPO');
    }
    await methods.shutdown({});
  });
});

describe('engine.analyze — domain errors', () => {
  let appDataDir: string;

  beforeEach(() => {
    appDataDir = mkdtempSync(join(tmpdir(), 'onboard-rpc-appdata-'));
  });

  afterEach(async () => {
    await removeDirWithRetry(appDataDir);
  });

  test('a nonexistent repoPath is rejected with E_PATH_NOT_FOUND', async () => {
    const { methods } = makeMethods();
    try {
      await methods.analyze({ repoPath: join(appDataDir, 'does-not-exist'), appDataDir, excludeGlobs: [], isForceRefresh: false });
      throw new Error('expected analyze to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).appError.code).toBe('E_PATH_NOT_FOUND');
      expect((error as DomainError).appError.message).toBe('That folder no longer exists');
    }
  });

  test('a repoPath pointing at a file (not a directory) is rejected with E_NOT_A_DIRECTORY', async () => {
    const { methods } = makeMethods();
    const filePath = join(appDataDir, 'a-file.txt');
    writeFileSync(filePath, 'not a directory');
    try {
      await methods.analyze({ repoPath: filePath, appDataDir, excludeGlobs: [], isForceRefresh: false });
      throw new Error('expected analyze to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).appError.code).toBe('E_NOT_A_DIRECTORY');
    }
  });

  test('a directory with no supported source files is rejected with E_NO_SUPPORTED_FILES', async () => {
    const { methods } = makeMethods();
    const emptyRepo = join(appDataDir, 'empty-repo');
    mkdirSync(emptyRepo, { recursive: true });
    try {
      await methods.analyze({ repoPath: emptyRepo, appDataDir, excludeGlobs: [], isForceRefresh: false });
      throw new Error('expected analyze to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).appError.code).toBe('E_NO_SUPPORTED_FILES');
    }
  });
});

describe('engine.search / engine.readFile — E_NO_ANALYSIS', () => {
  test('search before analyze rejects with E_NO_ANALYSIS', async () => {
    const { methods } = makeMethods();
    try {
      await methods.search({ repoId: FAKE_REPO_ID, query: 'auth', limit: 10 });
      throw new Error('expected search to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).appError.code).toBe('E_NO_ANALYSIS');
    }
  });

  test('readFile before analyze rejects with E_NO_ANALYSIS', async () => {
    const { methods } = makeMethods();
    try {
      await methods.readFile({ repoId: FAKE_REPO_ID, path: 'src/index.ts', maxBytes: 1000 });
      throw new Error('expected readFile to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).appError.code).toBe('E_NO_ANALYSIS');
    }
  });

  test('snippets before analyze rejects with E_NO_ANALYSIS', async () => {
    const { methods } = makeMethods();
    try {
      await methods.snippets({ repoId: FAKE_REPO_ID, paths: ['src/index.ts'], maxLinesPerFile: 10, maxBytesPerFile: 1000 });
      throw new Error('expected snippets to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).appError.code).toBe('E_NO_ANALYSIS');
    }
  });
});

describe('engine.snippets', () => {
  let appDataDir: string;

  beforeEach(() => {
    appDataDir = mkdtempSync(join(tmpdir(), 'onboard-rpc-appdata-'));
  });

  afterEach(async () => {
    await removeDirWithRetry(appDataDir);
  });

  test('returns a truncated snippet per valid path and silently omits an escaping path', async () => {
    const { methods } = makeMethods();
    const analyzeResult = await methods.analyze({
      repoPath: join(FIXTURES_DIR, 'node-express'),
      appDataDir,
      excludeGlobs: [],
      isForceRefresh: false,
    });
    const repoId = analyzeResult.result.repo.id;
    const somePath = analyzeResult.result.files[0]?.path ?? '';

    const result = await methods.snippets({
      repoId,
      paths: [somePath, '../../etc/passwd'],
      maxLinesPerFile: 2,
      maxBytesPerFile: 1_000_000,
    });

    expect(result.snippets).toHaveLength(1);
    expect(result.snippets[0]?.path).toBe(somePath);
    expect(result.snippets[0]?.startLine).toBe(1);
    expect(result.snippets[0]?.endLine).toBeLessThanOrEqual(2);
    await methods.shutdown({});
  });
});
