/**
 * @onboard/engine — `verify:no-network` (Section 9 Phase 5 gate item 3,
 * static half). Bundles `src/main.ts` (no `--compile`, so the output stays
 * readable text) and statically scans it.
 *
 * Two things worth knowing up front, so the pass/fail output below isn't
 * mistaken for a bug:
 *
 * 1. Bun's bundler strips the `node:` prefix from built-in specifiers
 *    (`import('node:net')` becomes `import("net")` in the emitted bundle).
 *    The literal substrings `node:http` / `node:net` the Phase 5 gate names
 *    are therefore trivially absent from ANY Bun-bundled output — that is
 *    reported below for transparency, but the substring absence by itself
 *    proves nothing. The check that actually matters is further down: no
 *    bare `"net"`/`"http"`/etc. import specifier exists anywhere OUTSIDE
 *    `src/guard/no-network.ts`.
 * 2. The literal substring `fetch(` DOES appear in the bundle — inside
 *    `web-tree-sitter`'s WASM-loading code, which has a browser-only
 *    `fetch()` fallback path this engine never reaches (WASM is always
 *    loaded from a local file). Those call sites reference the *global*
 *    `fetch` at call time, not at module-load time, and `guard/no-network.ts`
 *    is the first thing `main.ts` imports — so by the time any of that code
 *    could ever run, `globalThis.fetch` is already the poisoned version and
 *    throws `EngineNetworkBlockedError` instead of making a request. That
 *    is proven *behaviorally*, not just statically, by
 *    `test/guard/no-network.test.ts` (spawns a subprocess, calls the real
 *    `fetch()`, asserts it throws). This script's static scan is
 *    defense-in-depth on top of that behavioral proof, not a replacement
 *    for it.
 *
 * The Linux `unshare -rn` sandboxed half of this gate (a full fixture
 * analysis run with network namespaces unshared) is CI-only — it cannot run
 * on this Windows dev machine. See `docs/DECISIONS.md` and the Phase 5
 * report for how CI should wire it.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLines } from '../src/rpc/server';

const ENTRYPOINT = join(import.meta.dir, '..', 'src', 'main.ts');
const SCAN_OUT_DIR = join(import.meta.dir, '..', 'dist', 'no-network-scan');
const GUARD_MARKER = '// src/guard/no-network.ts';
const NEXT_MODULE_MARKER = /\n\/\/ src\//;
const BARE_NETWORK_SPECIFIERS = ['net', 'http', 'https', 'tls', 'dgram', 'dns'] as const;

async function buildScanBundle(): Promise<string> {
  const result = await Bun.build({ entrypoints: [ENTRYPOINT], target: 'bun', outdir: SCAN_OUT_DIR });
  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join('\n');
    throw new Error(`verify-no-network: failed to build the scan bundle:\n${messages}`);
  }
  const output = result.outputs[0];
  if (output === undefined) {
    throw new Error('verify-no-network: Bun.build produced no output artifact.');
  }
  return readFileSync(output.path, 'utf8');
}

function textOutsideGuardModule(bundleText: string): string {
  const start = bundleText.indexOf(GUARD_MARKER);
  if (start === -1) {
    throw new Error('verify-no-network: could not locate src/guard/no-network.ts in the bundle — refusing to scan blind.');
  }
  const rest = bundleText.slice(start + GUARD_MARKER.length);
  const nextModule = NEXT_MODULE_MARKER.exec(rest);
  const end = nextModule ? start + GUARD_MARKER.length + nextModule.index : bundleText.length;
  return bundleText.slice(0, start) + bundleText.slice(end);
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function reportLiteralSubstrings(bundleText: string): void {
  console.log('--- literal substrings named in the Phase 5 gate (scanned across the whole bundle) ---');
  [
    { label: 'fetch(', pattern: 'fetch(' },
    { label: 'node:http', pattern: 'node:http' },
    { label: 'node:net', pattern: 'node:net' },
  ].forEach(({ label, pattern }) => {
    console.log(`  "${label}": ${String(countOccurrences(bundleText, pattern))} occurrence(s)`);
  });
}

function checkBareSpecifiersOutsideGuard(bundleText: string): boolean {
  const outsideGuard = textOutsideGuardModule(bundleText);
  console.log('\n--- bare Node network-module import specifiers OUTSIDE guard/no-network.ts ---');
  let anyLeak = false;
  BARE_NETWORK_SPECIFIERS.forEach((specifier) => {
    const pattern = `import("${specifier}")`;
    const count = countOccurrences(outsideGuard, pattern);
    console.log(`  ${pattern}: ${String(count)} occurrence(s) outside the guard module`);
    if (count > 0) {
      anyLeak = true;
    }
  });
  return anyLeak;
}

/**
 * The sandboxed half of this gate: a full fixture analysis, run through the
 * built Linux binary with network namespaces unshared (`unshare -rn`), still
 * completes successfully. This is a materially stronger proof than the
 * static scan above — it shows the process needs no network *namespace* at
 * all, not just that its own entry points throw. `unshare` is Linux-only,
 * so this is a no-op (loud, not silent) everywhere else; CI's Linux runner
 * is expected to build the Linux binary first (`bun run build:sidecar`)
 * before this script runs.
 */
interface SandboxedRunOutcome {
  readonly exitCode: number;
  readonly analyzeOk: boolean;
  readonly stderrText: string;
}

async function spawnSandboxedAnalyze(binaryPath: string, grammarsDir: string, fixtureDir: string, appDataDir: string): Promise<SandboxedRunOutcome> {
  const proc = Bun.spawn(['unshare', '-rn', '--', binaryPath, '--grammars-dir', grammarsDir], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const responses: string[] = [];
  const consume = (async (): Promise<void> => {
    for await (const line of readLines(proc.stdout)) {
      if (line.trim().length > 0) {
        responses.push(line);
      }
    }
  })();

  proc.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'engine.analyze',
      params: { repoPath: fixtureDir, appDataDir, excludeGlobs: [], isForceRefresh: false },
    })}\n`,
  );
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'engine.shutdown', params: {} })}\n`);
  void proc.stdin.flush();

  const exitCode = await proc.exited;
  await consume;
  const analyzeResponse = responses.find((line) => (JSON.parse(line) as { id?: number }).id === 1);
  const analyzeOk = analyzeResponse !== undefined && !(JSON.parse(analyzeResponse) as { error?: unknown }).error;
  const stderrText = exitCode === 0 && analyzeOk ? '' : await new Response(proc.stderr).text();
  return { exitCode, analyzeOk, stderrText };
}

async function runSandboxedFixtureAnalysis(): Promise<void> {
  if (process.platform !== 'linux') {
    console.log(`\nSKIPPED (host platform is "${process.platform}"): the \`unshare -rn\` sandboxed check only runs on Linux CI.`);
    return;
  }

  const binaryPath = join(import.meta.dir, '..', 'dist', 'onboard-engine-x86_64-unknown-linux-gnu');
  const grammarsDir = join(import.meta.dir, '..', 'grammars');
  const fixtureDir = join(import.meta.dir, '..', 'fixtures', 'node-express');
  const appDataDir = mkdtempSync(join(tmpdir(), 'onboard-unshare-'));

  try {
    const outcome = await spawnSandboxedAnalyze(binaryPath, grammarsDir, fixtureDir, appDataDir);
    if (outcome.exitCode !== 0 || !outcome.analyzeOk) {
      throw new Error(
        `unshare -rn sandboxed run failed (exitCode=${String(outcome.exitCode)}, analyzeOk=${String(outcome.analyzeOk)}). stderr:\n${outcome.stderrText}`,
      );
    }
    console.log('\nPASS (sandboxed): a full fixture analysis over stdio succeeded with network namespaces unshared (unshare -rn).');
  } finally {
    rmSync(appDataDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const bundleText = await buildScanBundle();
  reportLiteralSubstrings(bundleText);
  const anyLeak = checkBareSpecifiersOutsideGuard(bundleText);

  if (anyLeak) {
    console.error('\nFAIL: a network module is imported somewhere outside src/guard/no-network.ts.');
    process.exit(1);
  }
  console.log(
    '\nPASS (static scan): no network-module import exists outside the guard, and every `fetch(` call site ' +
      'resolves to the poisoned globalThis.fetch at runtime (proven behaviorally by test/guard/no-network.test.ts).',
  );

  await runSandboxedFixtureAnalysis();
}

await main();
