/**
 * @onboard/engine — `analyze()`: walk -> hash -> classify -> parse -> resolve
 * -> graph -> rank -> assemble a validated `AnalysisResult` (Section 9 Phase 4).
 *
 * This is the first place every earlier phase's pieces are wired together
 * end to end. It is the composition root — nothing here is meant to be
 * reused piecemeal; per-concern logic lives in the modules it imports. Split
 * across `analyze.ts` (orchestration) and `analyze-support.ts`/`analyze-assemble.ts`
 * (phase implementations) to stay under the 800-line / 50-line-per-function
 * limits a single monolithic file could not meet.
 */
import { realpathSync } from 'node:fs';
import { AnalysisResult, SCHEMA_VERSION, stableStringify } from '@onboard/contract';
import type { AnalysisResult as AnalysisResultValue, EngineProgress } from '@onboard/contract';
import type { ParsedFile } from './parse/language-parser';
import { walk, type WalkFs } from './walk/walk';
import { classifyFile } from './classify/classify-file';
import { discoverWorkspacePackages, type WorkspacePackage } from './resolve/workspaces';
import { discoverTsconfigs } from './resolve/tsconfig-paths';
import { discoverPackageImports, type NodeResolutionContext } from './resolve/node-resolution';
import { discoverPythonPackageRoots, type PythonResolutionContext } from './resolve/python-resolution';
import type { ResolverContext } from './resolve/resolve-import';
import { PYTHON_STDLIB_MODULES } from './resolve/python-stdlib';
import { detectManifests, type DependencyInfoValue, type ManifestInfoValue } from './stack/manifests';
import { detectEntryPoints, type EntryPointValue } from './stack/entry-points';
import { computeRepoId } from './util/hash';
import { byteCompare } from './util/sort';
import { domainError } from './rpc/domain-error';
import type { CacheStore } from './cache/cache-store';
import {
  processOneFile,
  readFileText,
  runParsePhase,
  persistTokenIndex,
  tryServeCachedResultFastPath,
  type DiagnosticValue,
  type ProcessedFile,
} from './analyze-support';
import { computeGraphAndRanking, type ComputedAnalysis } from './analyze-rank-phase';
import { assembleAnalysisResult } from './analyze-assemble';

export interface AnalyzeOptions {
  readonly repoRootAbs: string;
  readonly excludeGlobs?: readonly string[];
  readonly grammarsDir: string;
  readonly engineVersion: string;
  readonly cacheStore?: CacheStore;
  /**
   * Test/verification-only override for the walk's filesystem access (e.g.
   * `scripts/verify-determinism.ts`'s shuffled-`readdir` check, Section 8.8).
   * Never set by the sidecar in normal operation.
   */
  readonly walkFs?: Partial<WalkFs>;
  /**
   * Section 7.3's `engine.progress` notification sink. Emitted at
   * phase-transition boundaries only (walk/parse/resolve+graph+rank/persist),
   * not per-file: `computeGraphAndRanking` bundles resolve, graph, and rank
   * into one function by Phase 4 design, so there is no interior boundary to
   * report 'graph' and 'rank' as separate notifications without touching
   * already-verified Phase 4 internals. The `EngineProgress` schema does not
   * require every phase to be emitted, only that emitted payloads match its
   * shape — this is a documented granularity choice, not a contract gap.
   */
  readonly onProgress?: (progress: EngineProgress) => void;
  /**
   * Fine-grained, NON-contract diagnostic timing sink (Section 11's bench
   * investigation into where cold-analysis time goes at 10,000 files — see
   * `docs/DECISIONS.md`). `AnalysisEnvelope.timings` is frozen at five
   * fields (Section 7.1); this reports finer sub-phase breakdowns without
   * touching that contract, purely for profiling. Never set by the sidecar
   * in normal operation; `main.ts` wires it to stderr only when
   * `ONBOARD_DEBUG_TIMINGS` is set, so normal runs pay zero cost for it.
   */
  readonly onPhaseTiming?: PhaseTimingSink;
  /**
   * Section 11's warm-analysis fast path (see `docs/DECISIONS.md`): when a
   * cache store is given and every file's content hash is unchanged (none
   * added, removed, or modified), `analyze()` serves the cached
   * `analysis_result` row directly instead of recomputing resolve/graph/
   * rank/assemble — Section 8.8's determinism guarantee is exactly why
   * this is safe (a full rebuild is GUARANTEED byte-identical). Set this to
   * `true` to force the full pipeline regardless, bypassing the fast path
   * entirely. Only `scripts/verify-determinism.ts` sets this — its cold-
   * vs-warm comparison exists specifically to prove the full incremental
   * pipeline reconstructs the correct result, which the fast path would
   * make tautological if left enabled there. Never set by the sidecar in
   * normal operation.
   */
  readonly disableFastPath?: boolean;
}

/** Reports one named sub-phase's wall-clock duration. See `AnalyzeOptions.onPhaseTiming`. */
export type PhaseTimingSink = (label: string, ms: number) => void;

function reportPhaseTiming<T>(sink: PhaseTimingSink | undefined, label: string, fn: () => T): T {
  if (sink === undefined) {
    return fn();
  }
  const start = performance.now();
  const result = fn();
  sink(label, performance.now() - start);
  return result;
}

export type ClassificationValue = AnalysisResultValue['files'][number]['classification'];

export interface ClassifiedFile extends ProcessedFile {
  readonly classification: ClassificationValue;
}

export interface PreparedAnalysis {
  readonly canonicalRoot: string;
  readonly repoId: string;
  readonly walkResult: ReturnType<typeof walk>;
  readonly readDiagnostics: readonly DiagnosticValue[];
  readonly workspacePackages: readonly WorkspacePackage[];
  readonly entryPoints: readonly EntryPointValue[];
  readonly classified: readonly ClassifiedFile[];
  readonly processedFiles: readonly ProcessedFile[];
  readonly manifests: readonly ManifestInfoValue[];
  readonly dependencies: readonly DependencyInfoValue[];
  readonly resolverContext: ResolverContext;
  readonly tsconfigDiagnostics: readonly { readonly code: string; readonly path: string }[];
}

function processAllFiles(
  repoRootAbs: string,
  walkFiles: readonly { path: string; sizeBytes: number }[],
): { files: readonly ProcessedFile[]; diagnostics: readonly DiagnosticValue[] } {
  const files: ProcessedFile[] = [];
  const diagnostics: DiagnosticValue[] = [];
  walkFiles.forEach((f) => {
    const { file, diagnostic } = processOneFile(repoRootAbs, f.path, f.sizeBytes);
    files.push(file);
    if (diagnostic !== null) {
      diagnostics.push(diagnostic);
    }
  });
  return { files, diagnostics };
}

function buildResolverContext(
  existingPaths: ReadonlySet<string>,
  readFile: (p: string) => string | null,
  workspacePackages: readonly WorkspacePackage[],
  pyManifestNames: ReadonlySet<string>,
): { context: ResolverContext; tsconfigDiagnostics: PreparedAnalysis['tsconfigDiagnostics'] } {
  const tsconfigPaths = [...existingPaths].filter(
    (p) => p === 'tsconfig.json' || p === 'jsconfig.json' || p.endsWith('/tsconfig.json') || p.endsWith('/jsconfig.json'),
  );
  const tsconfigDiscovery = discoverTsconfigs({ tsconfigPaths, readFile });
  const packageImports = discoverPackageImports(existingPaths, readFile);
  const pythonPackageRoots = discoverPythonPackageRoots({ existingPaths, readFile });
  const directories = new Set<string>(['']);
  existingPaths.forEach((p) => {
    if (p.includes('/')) {
      directories.add(p.slice(0, p.lastIndexOf('/')));
    }
  });

  const node: NodeResolutionContext = {
    existingPathSet: existingPaths,
    tsconfigs: tsconfigDiscovery.configs,
    packageImports,
    workspacePackages,
  };
  const python: PythonResolutionContext = {
    existingPathSet: existingPaths,
    directories,
    packageRoots: pythonPackageRoots,
    stdlibModules: PYTHON_STDLIB_MODULES,
    manifestPackageNames: pyManifestNames,
  };
  return { context: { node, python }, tsconfigDiagnostics: tsconfigDiscovery.diagnostics };
}

/** Walk, hash/skip/classify, and stack/resolver-context discovery — everything before parsing. */
/**
 * A manifest that did not parse, reported the way `tsconfig-paths.ts` already
 * reports its own — `TSCONFIG_UNREADABLE` was the only member of this class the
 * user ever heard about, because three modules each had their own copy of the
 * parse helper and only the fourth surfaced anything.
 */
function manifestDiagnostics(paths: ReadonlySet<string>): readonly DiagnosticValue[] {
  return [...paths].sort(byteCompare).map((path) => ({
    severity: 'warning' as const,
    code: 'MANIFEST_UNREADABLE',
    path,
    message: 'Manifest could not be read or parsed; its dependencies, workspaces and entry points are missing from this analysis.',
  }));
}

/**
 * Collects manifest parse failures as PATHS, deduplicated.
 *
 * `package.json` is read by `detectManifests`, `discoverWorkspacePackages` and
 * `detectEntryPoints`, so a single malformed file fails to parse three times.
 * Three copies of one warning would be worse than none, and a `Set` of paths
 * dedupes without any module needing to know the others exist.
 */
function manifestFailureSink(): {
  onUnparseable: (path: string) => void;
  unparseableManifests: ReadonlySet<string>;
} {
  const unparseableManifests = new Set<string>();
  return {
    unparseableManifests,
    onUnparseable: (path: string): void => {
      unparseableManifests.add(path);
    },
  };
}

function classifyAll(
  files: readonly ProcessedFile[],
  entryPointPaths: ReadonlySet<string>,
): ClassifiedFile[] {
  return files.map((file) => ({
    ...file,
    classification: classifyFile({
      path: file.path,
      isEntryPoint: entryPointPaths.has(file.path),
      headerLines: file.headerLines,
    }) as ClassificationValue,
  }));
}

function prepareAnalysis(options: AnalyzeOptions): PreparedAnalysis {
  const canonicalRoot = realpathSync(options.repoRootAbs);
  const repoId = computeRepoId(canonicalRoot);
  const walkResult = walk(options.repoRootAbs, {
    ...(options.excludeGlobs === undefined ? {} : { excludeGlobs: options.excludeGlobs }),
    ...(options.walkFs === undefined ? {} : { fs: options.walkFs }),
  });
  const existingPaths = new Set(walkResult.files.map((f) => f.path));
  const readFile = (relPosix: string): string | null => readFileText(options.repoRootAbs, relPosix);

  const { files: processedFiles, diagnostics: readDiagnostics } = processAllFiles(options.repoRootAbs, walkResult.files);

  const { onUnparseable, unparseableManifests } = manifestFailureSink();

  const workspacePackages = discoverWorkspacePackages({ existingPaths, readFile, onUnparseable });
  const entryPoints = detectEntryPoints({ existingPaths, readFile, workspacePackages, onUnparseable });
  const entryPointPaths = new Set(entryPoints.map((e) => e.path));

  const classified = classifyAll(processedFiles, entryPointPaths);

  const { manifests, dependencies } = detectManifests({ existingPaths, readFile, onUnparseable });
  const pyManifestNames = new Set(dependencies.filter((d) => d.ecosystem === 'pypi').map((d) => d.name));
  const { context: resolverContext, tsconfigDiagnostics } = buildResolverContext(
    existingPaths,
    readFile,
    workspacePackages,
    pyManifestNames,
  );

  return {
    canonicalRoot,
    repoId,
    walkResult,
    readDiagnostics: [...readDiagnostics, ...manifestDiagnostics(unparseableManifests)],
    workspacePackages,
    entryPoints,
    classified,
    processedFiles,
    manifests,
    dependencies,
    resolverContext,
    tsconfigDiagnostics,
  };
}

/**
 * Per-phase wall-clock timings for `AnalysisEnvelope.timings` (Section 7.3's
 * `engine.analyze` result). `resolveMs` also covers graph-building and
 * ranking: `analyze-rank-phase.ts`'s `computeGraphAndRanking` bundles
 * resolve/graph/rank into one function by Phase 4 design (see
 * `docs/DECISIONS.md`), so `graphMs` is reported as `0` rather than an
 * invented split. This affects only the diagnostic timings breakdown, never
 * `AnalysisResult` itself or determinism.
 */
export interface AnalyzeTimings {
  readonly walkMs: number;
  readonly parseMs: number;
  readonly resolveMs: number;
  readonly graphMs: number;
  readonly totalMs: number;
  readonly cacheHitCount: number;
}

export interface AnalyzeWithTimingsResult {
  readonly result: AnalysisResultValue;
  readonly timings: AnalyzeTimings;
}

function emitProgress(
  onProgress: AnalyzeOptions['onProgress'],
  phase: EngineProgress['phase'],
  processed: number,
  total: number,
): void {
  onProgress?.({ phase, processed, total, currentPath: null });
}

interface FastPathTimingInputs {
  readonly walkMs: number;
  readonly parseMs: number;
  readonly cacheHitCount: number;
}

/** See `AnalyzeOptions.disableFastPath`'s doc comment. Returns `null` when the fast path does not apply. */
function tryFastPath(
  options: AnalyzeOptions,
  prepared: PreparedAnalysis,
  previousContentHashByPath: ReadonlyMap<string, string>,
  timingInputs: FastPathTimingInputs,
  totalStart: number,
): AnalyzeWithTimingsResult | null {
  if (options.disableFastPath === true) {
    return null;
  }
  const fastPathResult = tryServeCachedResultFastPath(prepared.processedFiles, previousContentHashByPath, options.cacheStore);
  if (fastPathResult === null) {
    return null;
  }
  const totalMs = performance.now() - totalStart;
  return {
    result: fastPathResult,
    timings: { walkMs: timingInputs.walkMs, parseMs: timingInputs.parseMs, resolveMs: 0, graphMs: 0, totalMs, cacheHitCount: timingInputs.cacheHitCount },
  };
}

/**
 * Writes the just-computed `result` to the single-row `analysis_result`
 * table (Section 6.1) so a LATER `analyze()` call — from any caller, not
 * just the RPC sidecar — can take Section 11's warm fast path
 * (`tryServeCachedResultFastPath`). Skips the write (and the real cost of
 * `stableStringify` on a large result: ~300 ms at 10,000 files) whenever
 * the cached row already carries the same fingerprint, since Section 8.8's
 * determinism guarantee means the bytes would be identical anyway. This
 * used to live in `rpc/analyze-method.ts` (the RPC layer only), which is
 * exactly why `scripts/verify-determinism.ts` — which calls `analyze()`
 * directly, bypassing the RPC layer — could never actually exercise the
 * fast path: nothing ever populated `analysis_result` for it to read.
 * Moving this into the engine's own pipeline makes the fast path a real
 * property of `analyze()` itself, not an RPC-only optimization.
 */
function persistAnalysisResultIfChanged(cacheStore: CacheStore | undefined, result: AnalysisResultValue, onPhaseTiming: PhaseTimingSink | undefined): void {
  if (cacheStore === undefined || cacheStore.getAnalysisResultFingerprint() === result.fingerprint) {
    return;
  }
  reportPhaseTiming(onPhaseTiming, 'putAnalysisResult', () => {
    const resultJson = reportPhaseTiming(onPhaseTiming, 'stableStringify', () => stableStringify(result));
    cacheStore.putAnalysisResult({ schemaVersion: SCHEMA_VERSION, fingerprint: result.fingerprint, resultJson });
  });
}

interface FullRebuildInputs {
  readonly prepared: PreparedAnalysis;
  readonly parsedByPath: ReadonlyMap<string, ParsedFile>;
  readonly parseDiagnostics: readonly DiagnosticValue[];
  readonly previousContentHashByPath: ReadonlyMap<string, string>;
  readonly timings: FastPathTimingInputs;
  readonly totalStart: number;
}

/** The resolve -> graph -> rank -> assemble -> persist tail (Section 9 Phase 4), run whenever `tryFastPath` did not apply. */
function runFullRebuild(options: AnalyzeOptions, inputs: FullRebuildInputs): AnalyzeWithTimingsResult {
  const { prepared, parsedByPath, parseDiagnostics, previousContentHashByPath, timings, totalStart } = inputs;
  const onProgress = options.onProgress;
  const onPhaseTiming = options.onPhaseTiming;
  const fileCount = prepared.processedFiles.length;

  reportPhaseTiming(onPhaseTiming, 'persistTokenIndex', () =>
    persistTokenIndex(prepared.processedFiles, parsedByPath, previousContentHashByPath, options.cacheStore),
  );

  emitProgress(onProgress, 'resolve', 0, fileCount);
  const resolveStart = performance.now();
  const computed: ComputedAnalysis = computeGraphAndRanking(prepared, parsedByPath, onPhaseTiming);
  const resolveMs = performance.now() - resolveStart;
  emitProgress(onProgress, 'resolve', fileCount, fileCount);

  emitProgress(onProgress, 'persist', 0, fileCount);
  const result = reportPhaseTiming(onPhaseTiming, 'assembleAndValidate', () => {
    const finalResult = assembleAnalysisResult(prepared, computed, parsedByPath, parseDiagnostics);
    return AnalysisResult.parse(finalResult);
  });
  persistAnalysisResultIfChanged(options.cacheStore, result, onPhaseTiming);
  const totalMs = performance.now() - totalStart;
  emitProgress(onProgress, 'persist', fileCount, fileCount);

  return { result, timings: { walkMs: timings.walkMs, parseMs: timings.parseMs, resolveMs, graphMs: 0, totalMs, cacheHitCount: timings.cacheHitCount } };
}

/**
 * Re-entrancy guard. Two `analyze()` calls overlapping in ONE process do not
 * produce independent results — measured, not feared: identical content
 * analysed from two paths concurrently disagreed on `edges`, `symbolCount`,
 * `pageRank`, `inDegree`/`outDegree`, `diagnostics` and `graph.componentCount`
 * (107 differing leaves; sequentially, 3). See `docs/DECISIONS.md`.
 *
 * The CAUSE IS NOW FIXED: `parse/grammar-loader.ts` memoized `Parser.init()`
 * per loader, but `Parser` is a process-global WASM runtime, so two concurrent
 * cold loaders re-initialized it under each other and one run's grammars came
 * back as `Incompatible language version 0` — failing every parse in that run.
 * With the init promise hoisted to module scope, two concurrent `analyze()`
 * calls differ in 3 leaves (the path-derived identity fields) instead of 107,
 * which is exactly what SEQUENTIAL runs differ by.
 *
 * This guard is kept anyway, deliberately. What has been demonstrated is that
 * one known global was wrong and is now right — not that the engine is
 * re-entrant. Other process-scoped state exists (the SQLite cache store, the
 * no-network guard), and nothing has exercised it under overlap. Refusing costs
 * nothing today, because the Rust shell serializes analyses regardless; it
 * would cost a silently wrong `AnalysisResult` to be wrong about.
 *
 * It also replaces a safety property that used to depend on
 * `apps/desktop/src-tauri`'s supervisor being accidentally STRICTER than the
 * build spec — Phase 6 says "one analysis at a time PER REPO", which would
 * permit exactly the overlap that corrupted results. A property that holds
 * because another domain has not yet implemented its own spec is not a
 * property; this is.
 *
 * `verify:determinism`, the snapshot suite and the sidecar all call
 * sequentially, so nothing legitimate trips this.
 */
let analysisInFlight = false;

async function analyzeInternal(options: AnalyzeOptions): Promise<AnalyzeWithTimingsResult> {
  if (analysisInFlight) {
    throw domainError(
      'E_ANALYSIS_IN_PROGRESS',
      'An analysis is already running in this engine process.',
      'The engine is single-threaded per process: a concurrent analysis would produce a result that is not reproducible. Wait for the current analysis to finish.',
      null,
    );
  }
  analysisInFlight = true;
  try {
    return await analyzeGuarded(options);
  } finally {
    analysisInFlight = false;
  }
}

async function analyzeGuarded(options: AnalyzeOptions): Promise<AnalyzeWithTimingsResult> {
  const totalStart = performance.now();
  const onProgress = options.onProgress;

  emitProgress(onProgress, 'walk', 0, 0);
  const walkStart = performance.now();
  const prepared = prepareAnalysis(options);
  const walkMs = performance.now() - walkStart;
  const fileCount = prepared.processedFiles.length;
  emitProgress(onProgress, 'walk', fileCount, fileCount);

  emitProgress(onProgress, 'parse', 0, fileCount);
  const parseStart = performance.now();
  const {
    parsedByPath,
    diagnostics: parseDiagnostics,
    cacheHitCount,
    previousContentHashByPath,
  } = await runParsePhase(prepared.processedFiles, options.grammarsDir, options.engineVersion, SCHEMA_VERSION, options.cacheStore);
  const parseMs = performance.now() - parseStart;
  emitProgress(onProgress, 'parse', fileCount, fileCount);

  const timings: FastPathTimingInputs = { walkMs, parseMs, cacheHitCount };
  const fastPath = tryFastPath(options, prepared, previousContentHashByPath, timings, totalStart);
  if (fastPath !== null) {
    emitProgress(onProgress, 'resolve', fileCount, fileCount);
    emitProgress(onProgress, 'persist', fileCount, fileCount);
    return fastPath;
  }

  return runFullRebuild(options, { prepared, parsedByPath, parseDiagnostics, previousContentHashByPath, timings, totalStart });
}

/** Runs the full walk -> parse -> resolve -> graph -> rank pipeline, returning a validated `AnalysisResult`. */
export async function analyze(options: AnalyzeOptions): Promise<AnalysisResultValue> {
  return (await analyzeInternal(options)).result;
}

/** Same pipeline as `analyze()`, additionally returning the per-phase timings the RPC envelope needs. */
export async function analyzeWithTimings(options: AnalyzeOptions): Promise<AnalyzeWithTimingsResult> {
  return analyzeInternal(options);
}
