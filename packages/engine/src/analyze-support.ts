/**
 * @onboard/engine — `analyze()` support functions (file processing, parsing,
 * import resolution). Split out of `analyze.ts` to keep both files under
 * the 800-line / 50-line-per-function limits.
 */
import { readFileSync } from 'node:fs';
import type { AnalysisResult as AnalysisResultValue } from '@onboard/contract';
import { BINARY_CHECK_BYTES, CACHE_SCHEMA_VERSION, SHA256_HEX_LENGTH } from './constants';
import { determineSkipReason, type SkipReason } from './walk/skip-rules';
import {
  createLanguageParserFactory,
  parseFiles,
  buildParseDiagnostics,
  type ParsePoolEntry,
  type ParsePoolResult,
} from './parse/parser-pool';
import type { ParsedFile, RawImport, SupportedLanguageId } from './parse/language-parser';
import { resolveRawImport, type ResolverContext } from './resolve/resolve-import';
import { computeGrammarFingerprint } from './parse/grammar-loader';
import { sha256Hex, countLines } from './util/hash';
import { posixExtLower } from './util/posix-path';
import { byteCompare } from './util/sort';
import type { CacheStore } from './cache/cache-store';
import { buildSymbolRows } from './index/symbol-index';
import { buildTokenIndexRows } from './index/token-index';

export type LanguageValue = AnalysisResultValue['files'][number]['language'];
export type DiagnosticValue = AnalysisResultValue['diagnostics'][number];
export type EdgeValue = AnalysisResultValue['edges'][number];
export type ExternalDependencyEdgeValue = AnalysisResultValue['externalDependencies'][number];
export type UnresolvedImportValue = AnalysisResultValue['unresolvedImports'][number];

const EXT_TO_LANGUAGE: Readonly<Record<string, LanguageValue>> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  py: 'py',
  json: 'json',
  md: 'md',
};

const LANGUAGE_TO_SUPPORTED_ID: Readonly<Partial<Record<LanguageValue, SupportedLanguageId>>> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
};

export function languageForPath(path: string): LanguageValue {
  return EXT_TO_LANGUAGE[posixExtLower(path)] ?? 'other';
}

export function supportedLanguageIdFor(language: LanguageValue): SupportedLanguageId | null {
  return LANGUAGE_TO_SUPPORTED_ID[language] ?? null;
}

function nativePath(repoRootAbs: string, relPosix: string): string {
  return `${repoRootAbs}/${relPosix}`;
}

export function readFileText(repoRootAbs: string, relPosix: string): string | null {
  try {
    return readFileSync(nativePath(repoRootAbs, relPosix), 'utf8');
  } catch {
    return null;
  }
}

export type FileSkipReason = SkipReason | 'unsupported-language' | 'unreadable';

export interface ProcessedFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly language: LanguageValue;
  readonly languageId: SupportedLanguageId | null;
  readonly contentHash: string;
  readonly lineCount: number;
  readonly skipReason: FileSkipReason | null;
  readonly isParsed: boolean;
  readonly headerLines: readonly string[];
  readonly text: string;
}

function unreadableFile(path: string, sizeBytes: number): ProcessedFile {
  return {
    path,
    sizeBytes,
    language: languageForPath(path),
    languageId: null,
    contentHash: sha256Hex(''),
    lineCount: 0,
    skipReason: 'unreadable',
    isParsed: false,
    headerLines: [],
    text: '',
  };
}

/** Reads, hashes, and applies the skip-rules for one file (Sections 8.1, 8.6). */
export function processOneFile(repoRootAbs: string, path: string, sizeBytes: number): { file: ProcessedFile; diagnostic: DiagnosticValue | null } {
  let bytes: Buffer;
  try {
    bytes = readFileSync(nativePath(repoRootAbs, path));
  } catch {
    return { file: unreadableFile(path, sizeBytes), diagnostic: { severity: 'error', code: 'FILE_UNREADABLE', path, message: 'The file could not be read.' } };
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const contentHash = sha256Hex(bytes);
  const language = languageForPath(path);
  const languageId = supportedLanguageIdFor(language);
  const skipReason = determineSkipReason({
    sizeBytes,
    readFirstBytes: () => bytes.subarray(0, BINARY_CHECK_BYTES),
    readFullText: () => text,
  });
  const finalSkipReason: FileSkipReason | null = skipReason ?? (languageId === null ? 'unsupported-language' : null);
  const diagnostic: DiagnosticValue | null =
    finalSkipReason === null && text.includes('�')
      ? { severity: 'info', code: 'ENCODING_LOSSY', path, message: 'File decoded as UTF-8 with lossy replacement.' }
      : null;
  const file: ProcessedFile = {
    path,
    sizeBytes,
    language,
    languageId,
    contentHash,
    lineCount: countLines(text),
    skipReason: finalSkipReason,
    isParsed: finalSkipReason === null,
    headerLines: text.split('\n').slice(0, 3),
    text,
  };
  return { file, diagnostic };
}

export interface ParsePhaseResult {
  readonly parsedByPath: ReadonlyMap<string, ParsedFile>;
  readonly diagnostics: readonly DiagnosticValue[];
  /** Count of parseable files served from the cache (content hash matched) this run. */
  readonly cacheHitCount: number;
  /**
   * Every file's `file_cache.content_hash` as it stood BEFORE this run wrote
   * anything — captured once, up front, so `persistTokenIndex` can tell a
   * genuinely unchanged file (skip re-tokenizing) apart from a file this
   * same run just parsed and upserted (whose `file_cache` row now already
   * matches its current hash, which would otherwise look identical to
   * "unchanged" if read again afterward).
   */
  readonly previousContentHashByPath: ReadonlyMap<string, string>;
}

interface CachedRow {
  readonly contentHash: string;
  readonly parsedJson: string;
}

function openCacheIfProvided(
  cacheStore: CacheStore | undefined,
  grammarsDir: string,
  engineVersion: string,
  contractSchemaVersion: number,
): void {
  if (cacheStore === undefined) {
    return;
  }
  cacheStore.open({
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
    engineVersion,
    grammarFingerprint: computeGrammarFingerprint(grammarsDir),
    contractSchemaVersion,
  });
}

/** Reads every file's currently-cached content hash BEFORE this run writes anything (see `ParsePhaseResult`'s doc comment). */
function snapshotContentHashes(files: readonly ProcessedFile[], cacheStore: CacheStore | undefined): ReadonlyMap<string, string> {
  const snapshot = new Map<string, string>();
  if (cacheStore === undefined) {
    return snapshot;
  }
  files.forEach((f) => {
    const cached = cacheStore.getFileCache(f.path);
    if (cached !== null) {
      snapshot.set(f.path, cached.contentHash);
    }
  });
  return snapshot;
}

function partitionByCacheHit(
  files: readonly ProcessedFile[],
  cacheStore: CacheStore | undefined,
): { readonly cacheHit: ReadonlyMap<string, ParsedFile>; readonly toParse: readonly ProcessedFile[] } {
  const cacheHit = new Map<string, ParsedFile>();
  const toParse: ProcessedFile[] = [];
  files
    .filter((f) => f.isParsed && f.languageId !== null)
    .forEach((f) => {
      const cached: CachedRow | null = cacheStore?.getFileCache(f.path) ?? null;
      if (cached !== null && cached.contentHash === f.contentHash) {
        cacheHit.set(f.path, JSON.parse(cached.parsedJson) as ParsedFile);
      } else {
        toParse.push(f);
      }
    });
  return { cacheHit, toParse };
}

function persistParsedFile(cacheStore: CacheStore, f: ProcessedFile, parsed: ParsedFile): void {
  cacheStore.upsertFileCache({
    path: f.path,
    contentHash: f.contentHash,
    sizeBytes: f.sizeBytes,
    lineCount: f.lineCount,
    language: f.language,
    classification: 'unknown', // not yet known at parse time; analyze.ts owns the authoritative FileNode
    isParsed: f.isParsed,
    skipReason: f.skipReason,
    parsedJson: JSON.stringify(parsed),
  });
  cacheStore.replaceSymbolsForPath(f.path, buildSymbolRows(f.path, parsed.symbols));
}

/**
 * Persists (or, per the doc comment below, deliberately withholds) each
 * freshly-parsed file's result, wrapped in one transaction for the whole
 * batch rather than one auto-committed write per file — N individual
 * commits was the dominant cost behind the warm/incremental-analysis
 * regression measured in Section 11's bench (see `docs/DECISIONS.md`).
 * Returns the fresh `path -> ParsedFile` map for the `toParse` subset only.
 */
export function persistParsePhaseResults(
  toParse: readonly ProcessedFile[],
  results: readonly ParsePoolResult[],
  cacheStore: CacheStore | undefined,
): Map<string, ParsedFile> {
  const freshByPath = new Map<string, ParsedFile>();
  const persistOne = (f: ProcessedFile, index: number): void => {
    const result = results[index];
    if (result?.status === 'ok') {
      freshByPath.set(f.path, result.parsed);
      if (cacheStore !== undefined) {
        persistParsedFile(cacheStore, f, result.parsed);
      }
      return;
    }
    // A SYSTEMIC parse failure (the pool call itself threw — e.g. a
    // tree-sitter init/WASM-loading failure) is not the same thing as a
    // genuine per-file syntax error and must never be cached as if it
    // were: doing so poisons every later run with a false "successfully
    // parsed as empty" result that survives even after the underlying bug
    // is fixed, since `file_cache.content_hash` still matches and the
    // parse-cache never suspects anything is wrong (see
    // `docs/DECISIONS.md`'s poisoned-cache entry). Genuine per-file syntax
    // errors (e.g. `broken.ts`) never reach this branch — tree-sitter is
    // error-tolerant and always returns `status: 'ok'` with
    // `hasSyntaxError: true`, which IS legitimate to cache. Diagnostics
    // still surface the real failure (`buildParseDiagnostics` uses
    // `result.message`); only the cache write is withheld.
    freshByPath.set(f.path, { imports: [], symbols: [], hasSyntaxError: true });
  };
  if (cacheStore !== undefined) {
    cacheStore.withTransaction(() => toParse.forEach(persistOne));
  } else {
    toParse.forEach(persistOne);
  }
  return freshByPath;
}

/** Runs the parser pool over every parseable file, reusing cached results when the content hash matches. */
export async function runParsePhase(
  files: readonly ProcessedFile[],
  grammarsDir: string,
  engineVersion: string,
  contractSchemaVersion: number,
  cacheStore: CacheStore | undefined,
): Promise<ParsePhaseResult> {
  openCacheIfProvided(cacheStore, grammarsDir, engineVersion, contractSchemaVersion);
  const previousContentHashByPath = snapshotContentHashes(files, cacheStore);
  const { cacheHit, toParse } = partitionByCacheHit(files, cacheStore);

  const entries: ParsePoolEntry[] = toParse.map((f) => ({ path: f.path, languageId: f.languageId!, sourceText: f.text }));
  const getParser = createLanguageParserFactory(grammarsDir);
  const results: readonly ParsePoolResult[] = await parseFiles(entries, getParser);

  const freshByPath = persistParsePhaseResults(toParse, results, cacheStore);
  const parsedByPath = new Map<string, ParsedFile>([...cacheHit, ...freshByPath]);

  // Diagnostics must cover EVERY parsed file (cache hits included), not just
  // this run's freshly-parsed subset — otherwise a cached file's syntax-error
  // diagnostic silently disappears on a warm run (Section 8.8: cold vs warm
  // must produce an identical fingerprint).
  const allParsedFiles = files.filter((f) => f.isParsed && f.languageId !== null);
  const allEntries: ParsePoolEntry[] = allParsedFiles.map((f) => ({ path: f.path, languageId: f.languageId!, sourceText: f.text }));
  const allResults: ParsePoolResult[] = allParsedFiles.map((f) => {
    const parsed = parsedByPath.get(f.path);
    return parsed === undefined ? { status: 'failed', message: 'no parse result' } : { status: 'ok', parsed };
  });
  const parseDiagnostics = buildParseDiagnostics(allEntries, allResults);

  return { parsedByPath, diagnostics: parseDiagnostics, cacheHitCount: cacheHit.size, previousContentHashByPath };
}

export interface ResolutionOutput {
  readonly edges: EdgeValue[];
  readonly externalDependencies: ExternalDependencyEdgeValue[];
  readonly unresolvedImports: UnresolvedImportValue[];
  readonly externalImportedByPaths: ReadonlyMap<string, ReadonlySet<string>>;
}

function dedupeEdges(edges: readonly EdgeValue[]): EdgeValue[] {
  const seen = new Set<string>();
  const result: EdgeValue[] = [];
  edges.forEach((edge) => {
    const key = `${edge.fromPath}${edge.specifier}${String(edge.line)}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(edge);
    }
  });
  return result;
}

/** Resolves every file's raw imports into internal edges, external deps, and unresolved imports. */
export function resolveAllImports(
  files: readonly { readonly path: string; readonly languageId: SupportedLanguageId | null }[],
  parsedByPath: ReadonlyMap<string, ParsedFile>,
  context: ResolverContext,
): ResolutionOutput {
  const edges: EdgeValue[] = [];
  const unresolvedImports: UnresolvedImportValue[] = [];
  const externalImportsByKey = new Map<string, Set<string>>();

  files.forEach((f) => {
    if (f.languageId === null) {
      return;
    }
    const parsed = parsedByPath.get(f.path);
    if (parsed === undefined) {
      return;
    }
    parsed.imports.forEach((rawImport: RawImport) => {
      const outcome = resolveRawImport(f.path, f.languageId!, rawImport, context);
      if (outcome.kind === 'edge') {
        edges.push(outcome.edge);
      } else if (outcome.kind === 'external') {
        const key = `${outcome.ecosystem}:${outcome.packageName}`;
        if (!externalImportsByKey.has(key)) {
          externalImportsByKey.set(key, new Set());
        }
        externalImportsByKey.get(key)?.add(f.path);
      } else {
        unresolvedImports.push(outcome.unresolved);
      }
    });
  });

  const externalDependencies: ExternalDependencyEdgeValue[] = [];
  externalImportsByKey.forEach((paths, key) => {
    const [ecosystem, ...rest] = key.split(':');
    externalDependencies.push({
      packageName: rest.join(':'),
      ecosystem: ecosystem as ExternalDependencyEdgeValue['ecosystem'],
      importedByPaths: [...paths].sort(byteCompare),
    });
  });

  return {
    edges: dedupeEdges(edges),
    externalDependencies,
    unresolvedImports,
    externalImportedByPaths: externalImportsByKey,
  };
}

const NON_TOKENIZABLE_SKIP_REASONS: ReadonlySet<FileSkipReason> = new Set(['binary', 'too-large', 'minified', 'unreadable']);

const EMPTY_PARSED_JSON = JSON.stringify({ imports: [], symbols: [], hasSyntaxError: false });

/**
 * `token_index.path` (and `symbol.path`, `import_edge.from_path`) all carry a
 * `REFERENCES file_cache(path)` foreign key (Section 6.1's schema). `symbol`/
 * `import_edge` rows are always preceded by an `upsertFileCache` call in
 * `persistParsedFile`, but a file that is never parsed (README.md, JSON,
 * a skipped/too-large file) never goes through that path — so a bare
 * `replaceTokensForPath` call for it would violate the FK on a cold cache.
 * This guarantees a `file_cache` row exists for every file before token rows
 * are written for it, without disturbing the row a freshly-parsed file
 * already got from `persistParsedFile` (the upsert is idempotent).
 */
function ensureFileCacheRow(cacheStore: CacheStore, f: ProcessedFile, parsedByPath: ReadonlyMap<string, ParsedFile>): void {
  const parsed = parsedByPath.get(f.path);
  cacheStore.upsertFileCache({
    path: f.path,
    contentHash: f.contentHash,
    sizeBytes: f.sizeBytes,
    lineCount: f.lineCount,
    language: f.language,
    classification: 'unknown', // not yet known at this stage; analyze.ts owns the authoritative FileNode
    isParsed: f.isParsed,
    skipReason: f.skipReason,
    parsedJson: parsed === undefined ? EMPTY_PARSED_JSON : JSON.stringify(parsed),
  });
}

/**
 * Persists the Section 6.1 `token_index` rows every "where is X?" content
 * match (Section 8.7 step 3) is drawn from. Tokenization is language-agnostic
 * (Section: `index/token-index.ts`'s doc comment) — it runs over every
 * readable, reasonably-sized file, not just the four parsed grammars, so a
 * hit can land in a README or a config file.
 *
 * Incremental-cache-gated by content hash (`previousContentHashByPath`, a
 * snapshot taken before this run wrote anything — see `ParsePhaseResult`'s
 * doc comment): a file whose hash is unchanged already has correct token
 * rows from whichever earlier run last wrote that exact content, so
 * `buildTokenIndexRows` (a pure function of `(path, text)`) does not need
 * to re-run for it. This — plus wrapping the whole batch in one
 * transaction instead of one auto-committed write per file — is what fixes
 * the warm/incremental-analysis regression measured in Section 11's bench
 * (previously every file was unconditionally re-tokenized and rewritten on
 * every single run, warm included; see `docs/DECISIONS.md`).
 */
export function persistTokenIndex(
  files: readonly ProcessedFile[],
  parsedByPath: ReadonlyMap<string, ParsedFile>,
  previousContentHashByPath: ReadonlyMap<string, string>,
  cacheStore: CacheStore | undefined,
): void {
  if (cacheStore === undefined) {
    return;
  }
  cacheStore.withTransaction(() => {
    files.forEach((f) => {
      if (f.skipReason !== null && NON_TOKENIZABLE_SKIP_REASONS.has(f.skipReason)) {
        return;
      }
      if (previousContentHashByPath.get(f.path) === f.contentHash) {
        return; // unchanged since a prior run already tokenized this exact content
      }
      ensureFileCacheRow(cacheStore, f, parsedByPath);
      cacheStore.replaceTokensForPath(f.path, buildTokenIndexRows(f.path, f.text));
    });
  });
}

export function assertHexLength(value: string): string {
  return value.length === SHA256_HEX_LENGTH ? value : value.padEnd(SHA256_HEX_LENGTH, '0').slice(0, SHA256_HEX_LENGTH);
}
