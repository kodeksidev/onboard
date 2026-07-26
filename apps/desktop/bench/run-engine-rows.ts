/**
 * Engine-only slice of `bun run bench`, for one size at a time.
 *
 * `bun run bench` runs 1,000 files, then 10,000 files, then relays
 * `bench:graph` in a single long-lived process. On this machine that process is
 * repeatedly reaped part-way into the 10,000-file phase (peak sidecar RSS
 * ~1.2 GB against ~3.6 GB free), losing every result gathered before it. This
 * runs exactly the same measurements against exactly the same staged binary,
 * one size per invocation, so a run finishes before anything can reap it.
 *
 * The measurement window is deliberately identical to `run-bench.ts`: the timer
 * starts after the `engine.version` handshake and stops when the `engine.analyze`
 * response has been received, so numbers are directly comparable to the
 * official harness.
 *
 * Usage:
 *   bun run bench/run-engine-rows.ts 1000
 *   bun run bench/run-engine-rows.ts 10000
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

const SEARCH_QUERY_COUNT = 50;

const BUDGETS = (await Bun.file(join(import.meta.dir, 'budgets.json')).json()) as Budgets;
const REPEATS_1K = Number(process.env.BENCH_REPEATS_1K ?? '5');
const INCREMENTAL_FILE_COUNT = 20;
const BINARIES_DIR = join(import.meta.dir, '..', 'src-tauri', 'binaries');
const GRAMMARS_DIR = join(import.meta.dir, '..', 'src-tauri', 'resources', 'grammars');

function binaryNameForHost(): string {
  if (process.platform === 'win32') return 'onboard-engine-x86_64-pc-windows-msvc.exe';
  if (process.platform === 'darwin')
    return process.arch === 'arm64'
      ? 'onboard-engine-aarch64-apple-darwin'
      : 'onboard-engine-x86_64-apple-darwin';
  return 'onboard-engine-x86_64-unknown-linux-gnu';
}

function safeRm(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    /* WAL files stay briefly locked on Windows */
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const middle = sorted[mid];
  const lower = sorted[mid - 1];
  if (middle === undefined) throw new Error('median of empty array');
  return sorted.length % 2 === 0 && lower !== undefined ? (lower + middle) / 2 : middle;
}

interface Measured {
  readonly elapsedMs: number;
  readonly symbols: number;
  readonly edges: number;
  readonly parseFailed: number;
  readonly cacheHits: number;
}

async function analyzeOnce(repoPath: string, appDataDir: string): Promise<Measured> {
  const engine = spawnEngine(join(BINARIES_DIR, binaryNameForHost()), GRAMMARS_DIR);
  try {
    assertNoRpcError(await engine.session.call('engine.version', {}), 'engine.version');
    const start = performance.now();
    const analyze = await engine.session.call(
      'engine.analyze',
      { repoPath, appDataDir, excludeGlobs: [], isForceRefresh: false },
      180_000,
    );
    const elapsedMs = performance.now() - start;
    assertNoRpcError(analyze, 'engine.analyze');
    const payload = analyze.result as {
      timings: { cacheHitCount: number };
      result: { symbols: unknown[]; edges: unknown[]; diagnostics: { code: string }[] };
    };
    const measured: Measured = {
      elapsedMs,
      symbols: payload.result.symbols.length,
      edges: payload.result.edges.length,
      parseFailed: payload.result.diagnostics.filter((d) => d.code === 'PARSE_FAILED').length,
      cacheHits: payload.timings.cacheHitCount,
    };
    // Same precondition as run-bench.ts: never report a timing from an engine
    // that did not actually parse.
    if (measured.symbols === 0 || measured.edges === 0) {
      throw new Error(
        `precondition failed: symbols=${String(measured.symbols)} edges=${String(measured.edges)} — timing meaningless`,
      );
    }
    return measured;
  } finally {
    await engine.session.call('engine.shutdown', {}, 5000).catch(() => undefined);
    engine.kill();
  }
}

/** `unit` is explicit because the RSS row is megabytes, not milliseconds. */
function report(label: string, measured: number, budget: number, unit = 'ms'): void {
  const verdict = measured <= budget ? 'PASS' : 'FAIL';
  console.log(
    `${verdict}  ${label}: ${measured.toFixed(1)}${unit} (budget ${String(budget)}${unit})`,
  );
}

function touchFiles(paths: readonly string[], count: number): void {
  const step = Math.max(1, Math.floor(paths.length / count));
  for (let i = 0; i < count; i += 1) {
    const p = paths[i * step];
    if (p !== undefined)
      appendFileSync(p, `\n// bench-touched ${new Date().toISOString()}\n`, 'utf8');
  }
}

const fileCount = Number(process.argv[2] ?? '1000');
const repoDir = mkdtempSync(join(tmpdir(), `rows-repo-${String(fileCount)}-`));
const appDataDir = mkdtempSync(join(tmpdir(), `rows-data-${String(fileCount)}-`));
console.log(`=== ${String(fileCount)} files (seed ${SYNTHETIC_REPO_SEED_LABEL}) ===`);
const paths = generateSyntheticRepo(repoDir, fileCount);

try {
  if (fileCount === 1000) {
    const cold: number[] = [];
    for (let i = 0; i < REPEATS_1K; i += 1) {
      const fresh = mkdtempSync(join(tmpdir(), `rows-cold-${String(i)}-`));
      cold.push((await analyzeOnce(repoDir, fresh)).elapsedMs);
      safeRm(fresh);
    }
    report(
      `Cold analysis, 1000 files (median of ${String(REPEATS_1K)})`,
      median(cold),
      BUDGETS.coldAnalysis1kMs.budget,
    );

    await analyzeOnce(repoDir, appDataDir); // prime
    const warm: number[] = [];
    for (let i = 0; i < REPEATS_1K; i += 1)
      warm.push((await analyzeOnce(repoDir, appDataDir)).elapsedMs);
    report(
      `Warm analysis, 1000 files, no changes (median of ${String(REPEATS_1K)})`,
      median(warm),
      BUDGETS.warmAnalysis1kMs.budget,
    );

    const incr: number[] = [];
    for (let i = 0; i < REPEATS_1K; i += 1) {
      touchFiles(paths, INCREMENTAL_FILE_COUNT);
      incr.push((await analyzeOnce(repoDir, appDataDir)).elapsedMs);
    }
    report(
      `Incremental, 1000 files, 20 changed (median of ${String(REPEATS_1K)})`,
      median(incr),
      BUDGETS.incremental1k20ChangedMs.budget,
    );
  } else {
    // Cold run with the RSS monitor started at spawn, so peak memory is
    // sampled across the analysis it is meant to observe rather than paying
    // for a second cold run.
    const engine = spawnEngine(join(BINARIES_DIR, binaryNameForHost()), GRAMMARS_DIR);
    const rss = startRssMonitor(engine.pid);
    try {
      assertNoRpcError(await engine.session.call('engine.version', {}), 'engine.version');
      const coldStart = performance.now();
      const coldMsg = await engine.session.call(
        'engine.analyze',
        { repoPath: repoDir, appDataDir, excludeGlobs: [], isForceRefresh: false },
        180_000,
      );
      const coldMs = performance.now() - coldStart;
      assertNoRpcError(coldMsg, 'engine.analyze (cold)');
      const cold = coldMsg.result as {
        result: { symbols: unknown[]; edges: unknown[]; diagnostics: { code: string }[] };
      };
      const symbols = cold.result.symbols.length;
      const edges = cold.result.edges.length;
      if (symbols === 0 || edges === 0) {
        throw new Error('precondition failed: engine parsed nothing — timing meaningless');
      }
      const peakRssMb = await rss.stop();
      console.log(
        `   (cold: symbols=${String(symbols)} edges=${String(edges)} PARSE_FAILED=${String(cold.result.diagnostics.filter((d) => d.code === 'PARSE_FAILED').length)})`,
      );
      report(`Cold analysis, ${String(fileCount)} files`, coldMs, BUDGETS.coldAnalysis10kMs.budget);
      report(
        `Sidecar peak RSS at ${String(fileCount)} files`,
        peakRssMb ?? Number.NaN,
        BUDGETS.sidecarPeakRss10kMb.budget,
        'MB',
      );

      // Search p95 over the same live session, against symbols the generator
      // really created so every query is a realistic hit.
      const repoId = (coldMsg.result as { result: { repo: { id: string } } }).result.repo.id;
      const latencies: number[] = [];
      for (let i = 0; i < SEARCH_QUERY_COUNT; i += 1) {
        const query = `computeValue${String(Math.floor((i / SEARCH_QUERY_COUNT) * fileCount))}`;
        const t0 = performance.now();
        const hit: JsonRpcMessage = await engine.session.call(
          'engine.search',
          { repoId, query, limit: 20 },
          30_000,
        );
        latencies.push(performance.now() - t0);
        assertNoRpcError(hit, `engine.search "${query}"`);
      }
      latencies.sort((a, b) => a - b);
      const p95Index = Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1);
      report(
        `Search query latency, ${String(fileCount)}-file index (p95 of ${String(SEARCH_QUERY_COUNT)} queries)`,
        latencies[p95Index] ?? Number.NaN,
        BUDGETS.searchQueryLatency10kP95Ms.budget,
      );
    } finally {
      await engine.session.call('engine.shutdown', {}, 5000).catch(() => undefined);
      engine.kill();
    }

    const warm = await analyzeOnce(repoDir, appDataDir);
    console.log(
      `   (warm: symbols=${String(warm.symbols)} edges=${String(warm.edges)} PARSE_FAILED=${String(warm.parseFailed)} cacheHits=${String(warm.cacheHits)})`,
    );
    report(
      `Warm analysis, ${String(fileCount)} files`,
      warm.elapsedMs,
      BUDGETS.warmAnalysis10kMs.budget,
    );
  }
} finally {
  safeRm(repoDir);
  safeRm(appDataDir);
}
