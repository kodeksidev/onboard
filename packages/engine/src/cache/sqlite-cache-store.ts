/**
 * @onboard/engine — `bun:sqlite` implementation of `CacheStore` (Section 6.1, A10).
 *
 * All row mapping (snake_case columns -> camelCase fields, `0`/`1` -> boolean)
 * happens here, at the boundary; everything above this module works with the
 * plain `CacheStore` row types.
 */
import { Database } from 'bun:sqlite';
import { existsSync, rmSync } from 'node:fs';
import type {
  AnalysisResultRow,
  CacheOpenOutcome,
  CacheSchemaMeta,
  CacheStore,
  FileCacheRow,
  ImportEdgeRow,
  SymbolRow,
  TokenIndexRow,
} from './cache-store';
import { decideCacheInvalidation } from './invalidation';
// `with { type: 'text' }` (not `readFileSync(new URL(...))`) is required so
// `bun build --compile` actually embeds this file in the standalone sidecar
// binary — the URL+readFileSync pattern resolves to a virtual `~BUN/root/`
// path at runtime inside a compiled executable and throws ENOENT (discovered
// while driving `scripts/test-rpc.ts` against the built binary; see
// `docs/DECISIONS.md`).
import SCHEMA_SQL from './schema.sql' with { type: 'text' };

/** Escapes `%`, `_`, and the escape character itself for a SQLite `LIKE ... ESCAPE '\'` pattern. */
function escapeLikePattern(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

interface RawFileCacheRow {
  readonly path: string;
  readonly content_hash: string;
  readonly size_bytes: number;
  readonly line_count: number;
  readonly language: string;
  readonly classification: string;
  readonly is_parsed: number;
  readonly skip_reason: string | null;
  readonly parsed_json: string;
}

function fromRawFileCache(row: RawFileCacheRow): FileCacheRow {
  return {
    path: row.path,
    contentHash: row.content_hash,
    sizeBytes: row.size_bytes,
    lineCount: row.line_count,
    language: row.language,
    classification: row.classification,
    isParsed: row.is_parsed !== 0,
    skipReason: row.skip_reason,
    parsedJson: row.parsed_json,
  };
}

interface RawSymbolRow {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly name_lower: string;
  readonly kind: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly is_exported: number;
  readonly container: string | null;
  readonly signature: string | null;
}

function fromRawSymbol(row: RawSymbolRow): SymbolRow {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    nameLower: row.name_lower,
    kind: row.kind,
    startLine: row.start_line,
    endLine: row.end_line,
    isExported: row.is_exported !== 0,
    container: row.container,
    signature: row.signature,
  };
}

interface RawImportEdgeRow {
  readonly from_path: string;
  readonly specifier: string;
  readonly line: number;
  readonly to_path: string | null;
  readonly to_external: string | null;
  readonly kind: string;
  readonly is_type_only: number;
}

function fromRawImportEdge(row: RawImportEdgeRow): ImportEdgeRow {
  return {
    fromPath: row.from_path,
    specifier: row.specifier,
    line: row.line,
    toPath: row.to_path,
    toExternal: row.to_external,
    kind: row.kind,
    isTypeOnly: row.is_type_only !== 0,
  };
}

interface RawTokenIndexRow {
  readonly token: string;
  readonly path: string;
  readonly count: number;
  readonly lines_json: string;
}

function fromRawTokenIndex(row: RawTokenIndexRow): TokenIndexRow {
  return { token: row.token, path: row.path, count: row.count, linesJson: row.lines_json };
}

interface ProbeResult {
  readonly integrityOk: boolean;
  readonly meta: CacheSchemaMeta | null;
}

function readStoredMeta(db: Database): CacheSchemaMeta | null {
  try {
    const rows = db.query<{ key: string; value: string }, []>('SELECT key, value FROM schema_meta').all();
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const cacheSchemaVersion = Number(values.get('cacheSchemaVersion'));
    const contractSchemaVersion = Number(values.get('contractSchemaVersion'));
    const engineVersion = values.get('engineVersion');
    const grammarFingerprint = values.get('grammarFingerprint');
    if (engineVersion === undefined || grammarFingerprint === undefined) {
      return null;
    }
    if (!Number.isFinite(cacheSchemaVersion) || !Number.isFinite(contractSchemaVersion)) {
      return null;
    }
    return { cacheSchemaVersion, engineVersion, grammarFingerprint, contractSchemaVersion };
  } catch {
    return null;
  }
}

function probeExistingDatabase(dbFilePath: string): ProbeResult {
  let db: Database | null = null;
  try {
    db = new Database(dbFilePath);
    const integrity = db.query<{ integrity_check: string }, []>('PRAGMA integrity_check').get();
    const integrityOk = integrity?.integrity_check === 'ok';
    const meta = integrityOk ? readStoredMeta(db) : null;
    return { integrityOk, meta };
  } catch {
    return { integrityOk: false, meta: null };
  } finally {
    db?.close();
  }
}

/** Synchronous sleep (`open()` is a synchronous API — see `CacheStore`). */
function sleepSyncMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const DELETE_RETRY_ATTEMPTS = 10;
const DELETE_RETRY_DELAY_MS = 25;

/**
 * Deletes the main db file plus its WAL/SHM siblings. On Windows, a just-closed
 * WAL-mode SQLite file can briefly hold an OS-level lock past `Database.close()`
 * returning; a short bounded retry absorbs that instead of failing the
 * "delete and recreate, never migrate" invalidation path (Section 6.1).
 */
function deleteDatabaseFiles(dbFilePath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    deleteOneFileWithRetry(`${dbFilePath}${suffix}`);
  }
}

function deleteOneFileWithRetry(filePath: string): void {
  for (let attempt = 1; attempt <= DELETE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      rmSync(filePath, { force: true });
      return;
    } catch (error) {
      if (attempt === DELETE_RETRY_ATTEMPTS) {
        throw error;
      }
      sleepSyncMs(DELETE_RETRY_DELAY_MS);
    }
  }
}

export class SqliteCacheStore implements CacheStore {
  private readonly dbFilePath: string;
  private db: Database | null = null;

  constructor(dbFilePath: string) {
    this.dbFilePath = dbFilePath;
  }

  open(expected: CacheSchemaMeta): CacheOpenOutcome {
    const existed = existsSync(this.dbFilePath);
    const probe = existed ? probeExistingDatabase(this.dbFilePath) : { integrityOk: true, meta: null };
    const decision = decideCacheInvalidation(probe.meta, expected, probe.integrityOk);

    if (decision.action === 'keep') {
      this.db = new Database(this.dbFilePath);
      return 'reused';
    }
    this.recreate(expected);
    return 'recreated';
  }

  private recreate(expected: CacheSchemaMeta): void {
    deleteDatabaseFiles(this.dbFilePath);
    const db = new Database(this.dbFilePath);
    db.exec(SCHEMA_SQL);
    const metaSql = 'INSERT INTO schema_meta (key, value) VALUES (?, ?)';
    db.run(metaSql, ['cacheSchemaVersion', String(expected.cacheSchemaVersion)]);
    db.run(metaSql, ['engineVersion', expected.engineVersion]);
    db.run(metaSql, ['grammarFingerprint', expected.grammarFingerprint]);
    db.run(metaSql, ['contractSchemaVersion', String(expected.contractSchemaVersion)]);
    this.db = db;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private requireDb(): Database {
    if (this.db === null) {
      throw new Error('SqliteCacheStore: open() must be called before use.');
    }
    return this.db;
  }

  getFileCache(path: string): FileCacheRow | null {
    const row = this.requireDb()
      .query<RawFileCacheRow, [string]>('SELECT * FROM file_cache WHERE path = ?')
      .get(path);
    return row === null ? null : fromRawFileCache(row);
  }

  listFileCachePaths(): readonly string[] {
    const rows = this.requireDb()
      .query<{ path: string }, []>('SELECT path FROM file_cache ORDER BY path ASC')
      .all();
    return rows.map((row) => row.path);
  }

  upsertFileCache(row: FileCacheRow): void {
    this.requireDb().run(
      `INSERT INTO file_cache
         (path, content_hash, size_bytes, line_count, language, classification,
          is_parsed, skip_reason, parsed_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         content_hash = excluded.content_hash,
         size_bytes = excluded.size_bytes,
         line_count = excluded.line_count,
         language = excluded.language,
         classification = excluded.classification,
         is_parsed = excluded.is_parsed,
         skip_reason = excluded.skip_reason,
         parsed_json = excluded.parsed_json`,
      [
        row.path,
        row.contentHash,
        row.sizeBytes,
        row.lineCount,
        row.language,
        row.classification,
        row.isParsed ? 1 : 0,
        row.skipReason,
        row.parsedJson,
      ],
    );
  }

  deleteFileCache(path: string): void {
    this.requireDb().run('DELETE FROM file_cache WHERE path = ?', [path]);
  }

  replaceSymbolsForPath(path: string, rows: readonly SymbolRow[]): void {
    const db = this.requireDb();
    db.run('DELETE FROM symbol WHERE path = ?', [path]);
    const insert = db.prepare(
      `INSERT INTO symbol
         (id, path, name, name_lower, kind, start_line, end_line, is_exported, container, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    try {
      for (const row of rows) {
        insert.run(
          row.id,
          row.path,
          row.name,
          row.nameLower,
          row.kind,
          row.startLine,
          row.endLine,
          row.isExported ? 1 : 0,
          row.container,
          row.signature,
        );
      }
    } finally {
      insert.finalize();
    }
  }

  getSymbolsForPath(path: string): readonly SymbolRow[] {
    return this.requireDb()
      .query<RawSymbolRow, [string]>('SELECT * FROM symbol WHERE path = ? ORDER BY start_line ASC')
      .all(path)
      .map(fromRawSymbol);
  }

  querySymbolsByTermSubstring(term: string): readonly SymbolRow[] {
    return this.requireDb()
      .query<RawSymbolRow, [string]>(
        "SELECT * FROM symbol WHERE name_lower LIKE ? ESCAPE '\\' ORDER BY path ASC, start_line ASC",
      )
      .all(`%${escapeLikePattern(term)}%`)
      .map(fromRawSymbol);
  }

  replaceImportEdgesForPath(fromPath: string, rows: readonly ImportEdgeRow[]): void {
    const db = this.requireDb();
    db.run('DELETE FROM import_edge WHERE from_path = ?', [fromPath]);
    const insert = db.prepare(
      `INSERT INTO import_edge (from_path, specifier, line, to_path, to_external, kind, is_type_only)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    try {
      for (const row of rows) {
        insert.run(row.fromPath, row.specifier, row.line, row.toPath, row.toExternal, row.kind, row.isTypeOnly ? 1 : 0);
      }
    } finally {
      insert.finalize();
    }
  }

  getImportEdgesFromPath(fromPath: string): readonly ImportEdgeRow[] {
    return this.requireDb()
      .query<RawImportEdgeRow, [string]>('SELECT * FROM import_edge WHERE from_path = ? ORDER BY line ASC')
      .all(fromPath)
      .map(fromRawImportEdge);
  }

  replaceTokensForPath(path: string, rows: readonly TokenIndexRow[]): void {
    const db = this.requireDb();
    db.run('DELETE FROM token_index WHERE path = ?', [path]);
    const insert = db.prepare('INSERT INTO token_index (token, path, count, lines_json) VALUES (?, ?, ?, ?)');
    try {
      for (const row of rows) {
        insert.run(row.token, row.path, row.count, row.linesJson);
      }
    } finally {
      insert.finalize();
    }
  }

  queryTokensByToken(token: string): readonly TokenIndexRow[] {
    return this.requireDb()
      .query<RawTokenIndexRow, [string]>('SELECT * FROM token_index WHERE token = ? ORDER BY path ASC')
      .all(token)
      .map(fromRawTokenIndex);
  }

  getAnalysisResult(): AnalysisResultRow | null {
    const row = this.requireDb()
      .query<{ schema_version: number; fingerprint: string; result_json: string }, []>(
        'SELECT schema_version, fingerprint, result_json FROM analysis_result WHERE id = 1',
      )
      .get();
    return row === null
      ? null
      : { schemaVersion: row.schema_version, fingerprint: row.fingerprint, resultJson: row.result_json };
  }

  putAnalysisResult(row: AnalysisResultRow): void {
    this.requireDb().run(
      `INSERT INTO analysis_result (id, schema_version, fingerprint, result_json)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         schema_version = excluded.schema_version,
         fingerprint = excluded.fingerprint,
         result_json = excluded.result_json`,
      [row.schemaVersion, row.fingerprint, row.resultJson],
    );
  }
}
