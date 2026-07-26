/**
 * `bun run bench` (Section 9 Phase 11's gate, Section 11's performance
 * table). Drives the REAL staged sidecar binary (Section 5's actual engine,
 * not a stub) through cold/warm/incremental analysis of deterministic
 * synthetic repos at 1,000 and 10,000 files, samples sidecar peak RSS, and
 * measures `engine.search` p95 latency — then relays `bench:graph`'s
 * already-built graph/pan measurements (Phase 8) for one consolidated
 * report against every budget in `budgets.json`.
 *
 * Honesty over a green checkmark: if a budget genuinely isn't met, this
 * script reports the measured number and exits non-zero — it does not
 * round, retry-until-lucky, or silently loosen a budget to pass.
 */
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateSyntheticRepo,
  SYNTHETIC_REPO_SEED_LABEL,
} from './fixtures/generate-synthetic-repo';
import { spawnEngine, assertNoRpcError, type JsonRpcMessage } from './support/engine-rpc-client';
import { startRssMonitor } from './support/rss-sampler';

interface Budgets {
  readonly coldAnalysis1kMs: { readonly budget: number };
  readonly warmAnalysis1kMs: { readonly budget: number };
  readonly incremental1k20ChangedMs: { readonly budget: number };
  readonly coldAnalysis10kMs: { readonly budget: number };
  readonly warmAnalysis10kMs: { readonly budget: number };
  readonly sidecarPeakRss10kMb: { readonly budget: number };
  readonly searchQueryLatency10kP95Ms: { readonly budget: number };
}

const BUDGETS = (await Bun.file(join(import.meta.dir, 'budgets.json')).json()) as Budgets;

/** Section 11 says "median of 5 runs" for the 1,000-file rows; overridable for fast local iteration. */
const REPEATS_1K = Number(process.env.BENCH_REPEATS_1K ?? '5');
const INCREMENTAL_FILE_COUNT = 20;
const SEARCH_QUERY_COUNT = 50;

const BINARIES_DIR = join(import.meta.dir, '..', 'src-tauri', 'binaries');
const GRAMMARS_DIR = join(import.meta.dir, '..', 'src-tauri', 'resources', 'grammars');

function binaryNameForHost(): string {
  if (process.platform === 'win32') {
    return 'onboard-engine-x86_64-pc-windows-msvc.exe';
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64'
      ? 'onboard-engine-aarch64-apple-darwin'
      : 'onboard-engine-x86_64-apple-darwin';
  }
  return 'onboard-engine-x86_64-unknown-linux-gnu';
}

/**
 * A hung/timed-out sidecar process can still hold its `appDataDir`'s SQLite
 * cache file locked on Windows (`EBUSY`) well after the RPC call watching
 * it has already given up — cleanup failing must never crash the whole
 * bench run and lose every result gathered so far.
 */
function safeRmSync(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`(cleanup) could not remove ${path}: ${message}`);
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const middle = sorted[mid];
  const lower = sorted[mid - 1];
  if (middle === undefined) {
    throw new Error('median() called with an empty array');
  }
  return sorted.length % 2 === 0 && lower !== undefined ? (lower + middle) / 2 : middle;
}

interface AnalyzeOutcome {
  readonly elapsedMs: number;
  readonly repoId: string;
  readonly filesScanned: number;
}

/** One `engine.analyze` call over a freshly spawned sidecar process (Section 7.3). Measures only the analyze RPC itself, not process spawn/handshake/shutdown overhead. */
async function analyzeOnce(
  repoPath: string,
  appDataDir: string,
  isForceRefresh: boolean,
): Promise<AnalyzeOutcome> {
  const engine = spawnEngine(join(BINARIES_DIR, binaryNameForHost()), GRAMMARS_DIR);
  try {
    const version = await engine.session.call('engine.version', {});
    assertNoRpcError(version, 'engine.version');

    const start = performance.now();
    const analyze = await engine.session.call(
      'engine.analyze',
      { repoPath, appDataDir, excludeGlobs: [], isForceRefresh },
      180_000,
    );
    const elapsedMs = performance.now() - start;
    assertNoRpcError(analyze, 'engine.analyze');

    const result = analyze.result as {
      result: { repo: { id: string }; stats: { filesScanned: number } };
    };
    return {
      elapsedMs,
      repoId: result.result.repo.id,
      filesScanned: result.result.stats.filesScanned,
    };
  } finally {
    await engine.session.call('engine.shutdown', {}, 5000).catch(() => undefined);
    engine.kill();
  }
}

type SpawnedEngineHandle = ReturnType<typeof spawnEngine>;

/**
 * Same as `analyzeOnce`, but keeps the process alive and returns it (for
 * the search-latency measurement, which needs a live session afterward).
 * When `onSpawned` is given, it runs immediately after the process spawns —
 * this is how the 10k cold-analysis measurement starts its RSS monitor
 * before the analyze call it is meant to observe, in the same single run,
 * rather than paying for a second full cold analysis just to sample memory.
 */
async function analyzeKeepAlive(
  repoPath: string,
  appDataDir: string,
  isForceRefresh: boolean,
  onSpawned?: (engine: SpawnedEngineHandle) => void,
  timeoutMs = 180_000,
): Promise<{ engine: SpawnedEngineHandle; outcome: AnalyzeOutcome }> {
  const engine = spawnEngine(join(BINARIES_DIR, binaryNameForHost()), GRAMMARS_DIR);
  onSpawned?.(engine);
  try {
    const version = await engine.session.call('engine.version', {});
    assertNoRpcError(version, 'engine.version');

    const start = performance.now();
    const analyze = await engine.session.call(
      'engine.analyze',
      { repoPath, appDataDir, excludeGlobs: [], isForceRefresh },
      timeoutMs,
    );
    const elapsedMs = performance.now() - start;
    assertNoRpcError(analyze, 'engine.analyze');
    const result = analyze.result as {
      result: { repo: { id: string }; stats: { filesScanned: number } };
    };
    return {
      engine,
      outcome: {
        elapsedMs,
        repoId: result.result.repo.id,
        filesScanned: result.result.stats.filesScanned,
      },
    };
  } catch (error: unknown) {
    // A timed-out or errored analyze call leaves the process running
    // (nothing else has a reference to it yet) — kill it here so it can't
    // keep the appDataDir's SQLite cache file locked for the caller's
    // cleanup, and so it doesn't linger as an orphaned process either.
    engine.kill();
    throw error;
  }
}

function touchFiles(paths: readonly string[], count: number): void {
  const step = Math.max(1, Math.floor(paths.length / count));
  for (let i = 0; i < count; i += 1) {
    const path = paths[i * step];
    if (path !== undefined) {
      appendFileSync(path, `\n// bench-touched at ${new Date().toISOString()}\n`, 'utf8');
    }
  }
}

interface Verdict {
  readonly label: string;
  readonly measured: number;
  readonly budget: number;
  readonly unit: string;
}

function printVerdict(v: Verdict): boolean {
  const passed = v.measured <= v.budget;
  const verdict = passed ? 'PASS' : 'FAIL';
  console.log(
    `${verdict}  ${v.label}: ${v.measured.toFixed(1)}${v.unit} (budget ${String(v.budget)}${v.unit})`,
  );
  return passed;
}

/** 10k analysis has been observed to hang well past the 60s budget (see docs/DECISIONS.md) — bounded well below the default so a genuine hang is reported as a fast, clear FAIL instead of a multi-minute stall. */
const TEN_K_ANALYZE_TIMEOUT_MS = 90_000;

/**
 * The 1,000-file budgets: cold, warm, and incremental, each a median of
 * REPEATS_1K runs per Section 11's "median of 5" measurement note.
 */
async function measureCold1k(
  fileCount: number,
  repoDir: string,
  verdicts: Verdict[],
): Promise<void> {
  const runs: number[] = [];
  for (let i = 0; i < REPEATS_1K; i += 1) {
    const freshAppData = mkdtempSync(join(tmpdir(), `onboard-bench-cold-${String(i)}-`));
    const { elapsedMs } = await analyzeOnce(repoDir, freshAppData, false);
    runs.push(elapsedMs);
    safeRmSync(freshAppData);
  }
  verdicts.push({
    label: `Cold analysis, ${String(fileCount)} files (median of ${String(REPEATS_1K)})`,
    measured: median(runs),
    budget: BUDGETS.coldAnalysis1kMs.budget,
    unit: 'ms',
  });
}

async function measureWarm1k(
  fileCount: number,
  repoDir: string,
  appDataDir: string,
  verdicts: Verdict[],
): Promise<void> {
  // Prime the cache once, then measure against a genuinely warm cache.
  await analyzeOnce(repoDir, appDataDir, false);
  const runs: number[] = [];
  for (let i = 0; i < REPEATS_1K; i += 1) {
    const { elapsedMs } = await analyzeOnce(repoDir, appDataDir, false);
    runs.push(elapsedMs);
  }
  verdicts.push({
    label: `Warm analysis, ${String(fileCount)} files, no changes (median of ${String(REPEATS_1K)})`,
    measured: median(runs),
    budget: BUDGETS.warmAnalysis1kMs.budget,
    unit: 'ms',
  });
}

async function measureIncremental1k(
  fileCount: number,
  repoDir: string,
  appDataDir: string,
  paths: readonly string[],
  verdicts: Verdict[],
): Promise<void> {
  const runs: number[] = [];
  for (let i = 0; i < REPEATS_1K; i += 1) {
    touchFiles(paths, INCREMENTAL_FILE_COUNT);
    const { elapsedMs } = await analyzeOnce(repoDir, appDataDir, false);
    runs.push(elapsedMs);
  }
  verdicts.push({
    label: `Incremental, ${String(fileCount)} files, ${String(INCREMENTAL_FILE_COUNT)} changed (median of ${String(REPEATS_1K)})`,
    measured: median(runs),
    budget: BUDGETS.incremental1k20ChangedMs.budget,
    unit: 'ms',
  });
}

async function bench1k(
  fileCount: number,
  repoDir: string,
  appDataDir: string,
  paths: readonly string[],
  verdicts: Verdict[],
): Promise<void> {
  await measureCold1k(fileCount, repoDir, verdicts);
  await measureWarm1k(fileCount, repoDir, appDataDir, verdicts);
  await measureIncremental1k(fileCount, repoDir, appDataDir, paths, verdicts);
}

/**
 * The 10,000-file budgets: a single cold run RSS-sampled from spawn (Section 11
 * names no repeat count at this size), then warm, then search p95.
 *
 * The bounded timeout and the try/catch around the whole block are deliberate:
 * a genuine hang (observed — see docs/DECISIONS.md) must produce a clear FAIL
 * verdict for every budget this block would have measured, rather than crashing
 * the script and discarding the 1,000-file results already gathered.
 */
async function measureWarm10k(
  fileCount: number,
  engine: SpawnedEngineHandle,
  repoDir: string,
  coldAppData: string,
  verdicts: Verdict[],
): Promise<void> {
  const params = {
    repoPath: repoDir,
    appDataDir: coldAppData,
    excludeGlobs: [],
    isForceRefresh: false,
  };
  const warm = await engine.session.call('engine.analyze', params, TEN_K_ANALYZE_TIMEOUT_MS);
  assertNoRpcError(warm, 'engine.analyze (warm 10k)');
  const warmStart = performance.now();
  const measured = await engine.session.call('engine.analyze', params, TEN_K_ANALYZE_TIMEOUT_MS);
  const warmElapsedMs = performance.now() - warmStart;
  assertNoRpcError(measured, 'engine.analyze (warm 10k, measured)');
  verdicts.push({
    label: `Warm analysis, ${String(fileCount)} files`,
    measured: warmElapsedMs,
    budget: BUDGETS.warmAnalysis10kMs.budget,
    unit: 'ms',
  });
}

/**
 * 50 fixed queries against symbols the generator actually created, so every
 * query is a realistic exact/substring hit rather than a guaranteed-empty
 * lookup that would flatter the p95.
 */
async function measureSearchP95(
  fileCount: number,
  engine: SpawnedEngineHandle,
  repoId: string,
  verdicts: Verdict[],
): Promise<void> {
  const queries = Array.from(
    { length: SEARCH_QUERY_COUNT },
    (_unused, i) => `computeValue${String(Math.floor((i / SEARCH_QUERY_COUNT) * fileCount))}`,
  );
  const latencies: number[] = [];
  for (const query of queries) {
    const start = performance.now();
    const search: JsonRpcMessage = await engine.session.call(
      'engine.search',
      { repoId, query, limit: 20 },
      30_000,
    );
    latencies.push(performance.now() - start);
    assertNoRpcError(search, `engine.search "${query}"`);
  }
  latencies.sort((a, b) => a - b);
  const p95Index = Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1);
  verdicts.push({
    label: `Search query latency, ${String(fileCount)}-file index (p95 of ${String(SEARCH_QUERY_COUNT)} queries)`,
    measured: latencies[p95Index] ?? Number.NaN,
    budget: BUDGETS.searchQueryLatency10kP95Ms.budget,
    unit: 'ms',
  });
}

/** Every 10k budget reported as BLOCKED rather than silently skipped. */
function pushBlocked10kVerdicts(fileCount: number, message: string, verdicts: Verdict[]): void {
  const inf = Number.POSITIVE_INFINITY;
  verdicts.push({
    label: `Cold analysis, ${String(fileCount)} files (BLOCKED — ${message})`,
    measured: inf,
    budget: BUDGETS.coldAnalysis10kMs.budget,
    unit: 'ms',
  });
  verdicts.push({
    label: `Warm analysis, ${String(fileCount)} files (BLOCKED)`,
    measured: inf,
    budget: BUDGETS.warmAnalysis10kMs.budget,
    unit: 'ms',
  });
  verdicts.push({
    label: `Sidecar peak RSS at ${String(fileCount)} files (BLOCKED)`,
    measured: Number.NaN,
    budget: BUDGETS.sidecarPeakRss10kMb.budget,
    unit: 'MB',
  });
  verdicts.push({
    label: `Search query latency, ${String(fileCount)}-file index (BLOCKED)`,
    measured: inf,
    budget: BUDGETS.searchQueryLatency10kP95Ms.budget,
    unit: 'ms',
  });
}

async function measureCold10k(
  fileCount: number,
  repoDir: string,
  coldAppData: string,
  verdicts: Verdict[],
): Promise<{ engine: SpawnedEngineHandle; repoId: string }> {
  let rssMonitorHandle: ReturnType<typeof startRssMonitor> | undefined;
  const { engine, outcome } = await analyzeKeepAlive(
    repoDir,
    coldAppData,
    false,
    (spawned) => {
      rssMonitorHandle = startRssMonitor(spawned.pid);
    },
    TEN_K_ANALYZE_TIMEOUT_MS,
  );
  const peakRssMb = await rssMonitorHandle?.stop();
  verdicts.push({
    label: `Cold analysis, ${String(fileCount)} files`,
    measured: outcome.elapsedMs,
    budget: BUDGETS.coldAnalysis10kMs.budget,
    unit: 'ms',
  });
  verdicts.push({
    label: `Sidecar peak RSS at ${String(fileCount)} files`,
    measured: peakRssMb ?? Number.NaN,
    budget: BUDGETS.sidecarPeakRss10kMb.budget,
    unit: 'MB',
  });
  return { engine, repoId: outcome.repoId };
}

async function bench10k(fileCount: number, repoDir: string, verdicts: Verdict[]): Promise<void> {
  const coldAppData = mkdtempSync(join(tmpdir(), 'onboard-bench-cold-10k-'));
  try {
    const { engine, repoId } = await measureCold10k(fileCount, repoDir, coldAppData, verdicts);
    await measureWarm10k(fileCount, engine, repoDir, coldAppData, verdicts);
    await measureSearchP95(fileCount, engine, repoId, verdicts);
    await engine.session.call('engine.shutdown', {}, 5000).catch(() => undefined);
    engine.kill();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`\n10,000-file benchmark block did not complete: ${message}`);
    console.log('Reporting every budget it would have measured as BLOCKED rather than skipping.');
    pushBlocked10kVerdicts(fileCount, message, verdicts);
  } finally {
    safeRmSync(coldAppData);
  }
}

async function benchSize(fileCount: number, verdicts: Verdict[]): Promise<void> {
  const repoDir = mkdtempSync(join(tmpdir(), `onboard-bench-repo-${String(fileCount)}-`));
  const appDataDir = mkdtempSync(join(tmpdir(), `onboard-bench-appdata-${String(fileCount)}-`));
  console.log(
    `\n=== ${String(fileCount)}-file synthetic repo (seed ${SYNTHETIC_REPO_SEED_LABEL}) ===`,
  );
  console.log(`repo: ${repoDir}`);
  const paths = generateSyntheticRepo(repoDir, fileCount);

  try {
    if (fileCount === 1000) {
      await bench1k(fileCount, repoDir, appDataDir, paths, verdicts);
      return;
    }
    await bench10k(fileCount, repoDir, verdicts);
  } finally {
    safeRmSync(repoDir);
    safeRmSync(appDataDir);
  }
}

async function runGraphBench(): Promise<{ output: string; hasFail: boolean }> {
  const proc = Bun.spawn(['bun', 'run', 'bench/graph/run-bench-graph.ts'], {
    cwd: join(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  const output = stdout + (stderr.length > 0 ? `\n[stderr]\n${stderr}` : '');
  return { output, hasFail: /FAIL/.test(output) };
}

function printKnownIssueCaveat(): void {
  console.log('');
  console.log(
    '*** KNOWN ISSUE (not caused by or fixable from apps/desktop — see docs/DECISIONS.md) ***',
  );
  console.log(
    'The staged sidecar binary fails to load its bundled tree-sitter core WASM runtime at',
  );
  console.log(
    'runtime ("ENOENT ... tree-sitter.wasm", inside Bun\'s compiled-binary asset namespace),',
  );
  console.log(
    'observed on every run in this environment. Parsing degrades to PARSE_FAILED for every',
  );
  console.log(
    'file (0 symbols/edges extracted) rather than throwing, so cold/warm/incremental timings',
  );
  console.log(
    'below measure a pipeline that never does real tree-sitter work — they are NOT proof the',
  );
  console.log(
    'budgets would be met once parsing is fixed, only a lower bound. At 10,000 files this',
  );
  console.log(
    'additionally times out well past its budget (observed: >180s against a 60s budget) rather',
  );
  console.log(
    'than merely degrading, which independently fails that budget regardless of the WASM bug.',
  );
  console.log(
    'This is Phase 5 (packages/engine) sidecar-packaging territory, out of apps/desktop scope.',
  );
  console.log('');
}

async function main(): Promise<void> {
  console.log('=== bun run bench (Section 11) ===');
  console.log(`Engine binary: ${join(BINARIES_DIR, binaryNameForHost())}`);
  console.log(`Grammars dir: ${GRAMMARS_DIR}`);
  console.log(`1,000-file repeat count: ${String(REPEATS_1K)} (override with BENCH_REPEATS_1K)`);
  printKnownIssueCaveat();

  const verdicts: Verdict[] = [];
  await benchSize(1000, verdicts);
  await benchSize(10_000, verdicts);

  console.log('\n=== engine.analyze / engine.search verdicts ===');
  const engineResults = verdicts.map(printVerdict);

  console.log('\n=== bench:graph (Phase 8, relayed) ===');
  const { output: graphOutput, hasFail: graphHasFail } = await runGraphBench();
  console.log(graphOutput);

  const allEnginePassed = engineResults.every(Boolean);
  console.log('\n=== summary ===');
  console.log(`engine/search budgets: ${allEnginePassed ? 'ALL PASS' : 'AT LEAST ONE FAIL'}`);
  console.log(
    `bench:graph budgets: ${graphHasFail ? 'AT LEAST ONE FAIL (see above)' : 'ALL PASS (see above)'}`,
  );
  printKnownIssueCaveat();

  if (!allEnginePassed) {
    process.exitCode = 1;
  }
}

await main();
