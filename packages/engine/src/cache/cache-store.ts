/**
 * @onboard/engine — `CacheStore` interface (Section 6.1, A10).
 *
 * Row shapes mirror `schema.sql` column-for-column (snake_case columns become
 * camelCase fields; `INTEGER` boolean columns become `boolean`). Keeping the
 * interface separate from `sqlite-cache-store.ts`'s `bun:sqlite` specifics is
 * what lets a future `node:sqlite` implementation (the v2 npm-CLI adapter,
 * A10) drop in unchanged.
 */

export interface FileCacheRow {
  readonly path: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly lineCount: number;
  readonly language: string;
  readonly classification: string;
  readonly isParsed: boolean;
  readonly skipReason: string | null;
  readonly parsedJson: string;
}

export interface SymbolRow {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly nameLower: string;
  readonly kind: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly isExported: boolean;
  readonly container: string | null;
  readonly signature: string | null;
}

export interface ImportEdgeRow {
  readonly fromPath: string;
  readonly specifier: string;
  readonly line: number;
  readonly toPath: string | null;
  readonly toExternal: string | null;
  readonly kind: string;
  readonly isTypeOnly: boolean;
}

export interface TokenIndexRow {
  readonly token: string;
  readonly path: string;
  readonly count: number;
  readonly linesJson: string;
}

export interface AnalysisResultRow {
  readonly schemaVersion: number;
  readonly fingerprint: string;
  readonly resultJson: string;
}

/** The four `schema_meta` values checked on open (Section 6.1's invalidation rule). */
export interface CacheSchemaMeta {
  readonly cacheSchemaVersion: number;
  readonly engineVersion: string;
  readonly grammarFingerprint: string;
  readonly contractSchemaVersion: number;
}

export type CacheOpenOutcome = 'reused' | 'recreated';

/**
 * A per-repo cache. `open()` is idempotent-on-success: it either reuses an
 * existing, valid database or deletes and recreates it (never migrates —
 * Section 6.1) and must be called before any other method.
 */
export interface CacheStore {
  open(expected: CacheSchemaMeta): CacheOpenOutcome;
  close(): void;

  /**
   * Runs `fn` inside a single transaction (commits once at the end, rolls
   * back whole if `fn` throws) instead of each write inside `fn`
   * auto-committing individually. Bulk per-file cache writes (`analyze()`'s
   * parse-persist and token-index-persist loops) MUST use this — one commit
   * per file rather than one per batch was the dominant cost behind the
   * warm-analysis regression measured in Section 11's bench (see
   * `docs/DECISIONS.md`). A `CacheStore` with no real transaction concept
   * (e.g. a trivial in-memory test double) may implement this as a plain
   * `fn()` call — it is a performance contract, not a correctness one.
   */
  withTransaction<T>(fn: () => T): T;

  getFileCache(path: string): FileCacheRow | null;
  /** All cached paths, sorted ascending. */
  listFileCachePaths(): readonly string[];
  upsertFileCache(row: FileCacheRow): void;
  deleteFileCache(path: string): void;

  replaceSymbolsForPath(path: string, rows: readonly SymbolRow[]): void;
  getSymbolsForPath(path: string): readonly SymbolRow[];
  /** Every symbol whose `name_lower` contains `term` (Section 8.7 step 3) — repo-wide, not path-scoped. */
  querySymbolsByTermSubstring(term: string): readonly SymbolRow[];

  replaceImportEdgesForPath(fromPath: string, rows: readonly ImportEdgeRow[]): void;
  getImportEdgesFromPath(fromPath: string): readonly ImportEdgeRow[];

  replaceTokensForPath(path: string, rows: readonly TokenIndexRow[]): void;
  /** Every `token_index` row for an exact `token` match (Section 8.7 step 3). */
  queryTokensByToken(token: string): readonly TokenIndexRow[];

  getAnalysisResult(): AnalysisResultRow | null;
  putAnalysisResult(row: AnalysisResultRow): void;
}
