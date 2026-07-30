/**
 * @onboard/engine — compiles `src/main.ts` into the four `onboard-engine-*`
 * sidecar binaries Tauri's `resolve_sidecar_path` expects (Section 9 Phase
 * 5/6). Cross-compiles all four target triples from this one runner via
 * `Bun.build({ compile: { target } })` (`bun build --compile --target=`
 * under the hood) — no target-specific toolchain is required.
 *
 * Emits to `packages/engine/dist/` ONLY. This deliberately does NOT write
 * into `apps/desktop/**` — the coordinator copies these into
 * `apps/desktop/src-tauri/binaries/` themselves (Phase 5 instructions).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLines } from '../src/rpc/server';
import { binaryNameForHost } from './lib/sidecar-binary-name';
import { HEADER_BYTES_NEEDED, readExecutableHeader } from './lib/executable-header';

const ENTRYPOINT = join(import.meta.dir, '..', 'src', 'main.ts');
const OUT_DIR = join(import.meta.dir, '..', 'dist');
const GRAMMARS_DIR = join(import.meta.dir, '..', 'grammars');
const SMOKE_FIXTURE_DIR = join(import.meta.dir, '..', 'fixtures', 'node-express');
const BUILD_HASH_LENGTH = 12;

/**
 * Fixes the poisoned-cache bug (Section 6.1: `schema_meta.engineVersion` is
 * one of four cache-invalidation keys, and a bare `package.json` version
 * string never moves when the engine's CODE changes without a version
 * bump — a defective binary's empty cache survived being replaced by a
 * fixed one, with no manual cache clear, because none of the four keys had
 * changed). Bundles `main.ts` once WITHOUT the hash (a chicken-and-egg
 * problem otherwise: the hash can't include itself), hashes that bundle's
 * text, then re-bundles (compiling, this time) with the hash injected via
 * `bun build --define` — a compile-time constant substitution, not a real
 * environment-variable read, so it cannot be spoofed by setting an env var
 * against the compiled binary. `src/engine-version.ts` is what consumes it.
 */
async function computeBuildHash(): Promise<string> {
  const result = await Bun.build({ entrypoints: [ENTRYPOINT], target: 'bun', outdir: join(OUT_DIR, '.build-hash-scratch') });
  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join('\n');
    throw new Error(`build-sidecar: failed to build the hash-scan bundle:\n${messages}`);
  }
  const output = result.outputs[0];
  if (output === undefined) {
    throw new Error('build-sidecar: Bun.build produced no output artifact to hash.');
  }
  const text = await output.text();
  rmSync(join(OUT_DIR, '.build-hash-scratch'), { recursive: true, force: true });
  return createHash('sha256').update(text).digest('hex').slice(0, BUILD_HASH_LENGTH);
}

interface SidecarTarget {
  readonly bunTarget: 'bun-windows-x64' | 'bun-darwin-arm64' | 'bun-darwin-x64' | 'bun-linux-x64';
  /** Tauri's `<name>-<target-triple>[.exe]` convention (Section 7/9). */
  readonly outfileName: string;
  /** Executable container this artefact must be, checked from its header bytes. */
  readonly format: 'pe' | 'macho' | 'elf';
  /** Architecture the header must declare, so a target cannot silently emit the wrong one. */
  readonly arch: 'x86_64' | 'arm64';
}

const SIDECAR_TARGETS: readonly SidecarTarget[] = [
  { bunTarget: 'bun-windows-x64', outfileName: 'onboard-engine-x86_64-pc-windows-msvc.exe', format: 'pe', arch: 'x86_64' },
  { bunTarget: 'bun-darwin-arm64', outfileName: 'onboard-engine-aarch64-apple-darwin', format: 'macho', arch: 'arm64' },
  { bunTarget: 'bun-darwin-x64', outfileName: 'onboard-engine-x86_64-apple-darwin', format: 'macho', arch: 'x86_64' },
  { bunTarget: 'bun-linux-x64', outfileName: 'onboard-engine-x86_64-unknown-linux-gnu', format: 'elf', arch: 'x86_64' },
];

/**
 * A compiled Bun sidecar is 60-100 MB. This floor is far below that on purpose:
 * it exists to catch a truncated or empty artefact, not to police size.
 */
const MIN_ARTIFACT_BYTES = 10 * 1024 * 1024;

/**
 * WHAT THIS GATE DOES AND DOES NOT PROVE.
 *
 * Phase 5's "Done when" says `build:sidecar` emits four artefacts. It did — and
 * for three of them it proved only that a file existed at the expected path. A
 * gate that emits four names and verifies one is the vacuity pattern this
 * project has been removing all week, so the limits are now written down and
 * the checkable part is actually checked.
 *
 * Checked, per artefact: the container format and declared architecture, read
 * out of the header bytes, plus a size floor. That catches a truncated build, a
 * cross-compile that silently produced the host's format, and a target table
 * that has drifted from its filenames.
 *
 * NOT checked, and no wording here should suggest otherwise: **the three
 * non-host binaries are never executed.** Only the host binary is launched, by
 * `smokeTestHostBinary()` below, which runs a real `engine.analyze`. Nothing in
 * this repository has ever run a darwin sidecar on macOS. Criterion 23 stays
 * unproven until `docs/MACOS_SMOKE.md` is signed off on real hardware — see
 * `docs/CRITERIA_MAP.md`.
 */
function verifyArtifact(target: SidecarTarget): void {
  const outfile = join(OUT_DIR, target.outfileName);
  const size = statSync(outfile).size;
  if (size < MIN_ARTIFACT_BYTES) {
    throw new Error(
      `build-sidecar: ${target.outfileName} is ${String(size)} bytes, below the ${String(MIN_ARTIFACT_BYTES)}-byte floor — truncated or empty build.`,
    );
  }

  const head = readFileSync(outfile).subarray(0, HEADER_BYTES_NEEDED);
  const actual = readExecutableHeader(head);
  if (actual.format !== target.format || actual.arch !== target.arch) {
    throw new Error(
      `build-sidecar: ${target.outfileName} declares ${actual.format}/${actual.arch ?? 'unknown'}, expected ${target.format}/${target.arch}.`,
    );
  }

  const mb = (size / 1024 / 1024).toFixed(1);
  console.log(`  verified ${target.outfileName}: ${actual.format}/${actual.arch}, ${mb} MB (header + size only; NOT executed)`);
}

async function buildOne(target: SidecarTarget, buildHash: string): Promise<void> {
  const outfile = join(OUT_DIR, target.outfileName);
  const result = await Bun.build({
    entrypoints: [ENTRYPOINT],
    compile: { target: target.bunTarget, outfile },
    define: { 'process.env.ONBOARD_BUILD_HASH': JSON.stringify(buildHash) },
  });
  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join('\n');
    throw new Error(`build-sidecar: failed for ${target.bunTarget} (${outfile}):\n${messages}`);
  }
  console.log(`built ${target.outfileName}`);
}

interface SmokeAnalyzeOutcome {
  readonly exitCode: number;
  readonly errorMessage: string | null;
  readonly engineVersion: string | null;
  readonly symbolCount: number;
  readonly edgeCount: number;
  readonly parseFailedCount: number;
}

async function spawnSmokeAnalyze(binaryPath: string, appDataDir: string): Promise<SmokeAnalyzeOutcome> {
  const proc = Bun.spawn([binaryPath, '--grammars-dir', GRAMMARS_DIR], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  const responses: string[] = [];
  const consume = (async (): Promise<void> => {
    for await (const line of readLines(proc.stdout)) {
      if (line.trim().length > 0) {
        responses.push(line);
      }
    }
  })();

  const analyzeParams = { repoPath: SMOKE_FIXTURE_DIR, appDataDir, excludeGlobs: [], isForceRefresh: false };
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'engine.version', params: {} })}\n`);
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'engine.analyze', params: analyzeParams })}\n`);
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'engine.shutdown', params: {} })}\n`);
  void proc.stdin.flush();

  const exitCode = await proc.exited;
  await consume;

  const messages = responses.map((line) => JSON.parse(line) as Record<string, unknown>);
  const versionMessage = messages.find((m) => m.id === 0);
  const engineVersion = ((versionMessage?.result as { engineVersion?: string } | undefined)?.engineVersion) ?? null;

  const analyzeMessage = messages.find((m) => m.id === 1);
  const error = analyzeMessage?.error as { message?: string } | undefined;
  if (error !== undefined) {
    return { exitCode, errorMessage: error.message ?? JSON.stringify(error), engineVersion, symbolCount: 0, edgeCount: 0, parseFailedCount: 0 };
  }
  const analyzeResult = (analyzeMessage?.result as { result?: unknown } | undefined)?.result as
    | { symbols?: unknown[]; edges?: unknown[]; diagnostics?: { code: string }[] }
    | undefined;
  const symbolCount = analyzeResult?.symbols?.length ?? 0;
  const edgeCount = analyzeResult?.edges?.length ?? 0;
  const parseFailedCount = analyzeResult?.diagnostics?.filter((d) => d.code === 'PARSE_FAILED').length ?? 0;
  return {
    exitCode,
    errorMessage: analyzeMessage === undefined ? 'no engine.analyze response received' : null,
    engineVersion,
    symbolCount,
    edgeCount,
    parseFailedCount,
  };
}

/**
 * The gate that would have caught the tree-sitter.wasm regression before it
 * shipped: a 26-byte placeholder (or any non-functional binary) satisfies
 * "four filenames exist," so `build:sidecar` now launches the actual built
 * host-platform binary, runs a real `engine.analyze` against a known-good
 * fixture, and requires substance (`symbols > 0`, zero `PARSE_FAILED`) —
 * not just a successful RPC round-trip. Throws (failing the whole build) on
 * any shortfall.
 */
async function smokeTestHostBinary(): Promise<void> {
  const binaryPath = join(OUT_DIR, binaryNameForHost());
  const appDataDir = mkdtempSync(join(tmpdir(), 'onboard-build-smoke-'));
  let outcome: SmokeAnalyzeOutcome;
  try {
    outcome = await spawnSmokeAnalyze(binaryPath, appDataDir);
  } finally {
    rmSync(appDataDir, { recursive: true, force: true });
  }

  if (outcome.errorMessage !== null) {
    throw new Error(`build-sidecar smoke test: engine.analyze failed: ${outcome.errorMessage}`);
  }
  if (outcome.exitCode !== 0) {
    throw new Error(`build-sidecar smoke test: sidecar process exited with code ${String(outcome.exitCode)}, expected 0`);
  }
  if (outcome.parseFailedCount !== 0) {
    throw new Error(
      `build-sidecar smoke test: ${String(outcome.parseFailedCount)} PARSE_FAILED diagnostic(s) on node-express ` +
        '(a fixture known to parse cleanly) — the binary cannot actually parse.',
    );
  }
  if (outcome.symbolCount === 0) {
    throw new Error('build-sidecar smoke test: 0 symbols extracted from node-express (expected > 0) — the binary cannot actually parse.');
  }
  console.log(
    `smoke test PASS: ${binaryNameForHost()} (engineVersion=${outcome.engineVersion ?? 'unknown'}) analyzed node-express ` +
      `with symbols=${String(outcome.symbolCount)}, edges=${String(outcome.edgeCount)}, PARSE_FAILED=${String(outcome.parseFailedCount)}`,
  );
}

/**
 * `--host-only` builds just this platform's binary.
 *
 * Tauri resolves `externalBin: ["binaries/onboard-engine"]` to the HOST target
 * triple at build time, so `cargo clippy`/`cargo test` need exactly one sidecar
 * — the other three are dead weight in a gate job. That is not a micro-
 * optimisation: cross-compiling the two darwin targets is what fails on
 * windows-2022 (`Failed to extract executable for 'bun-darwin-aarch64'`), and
 * it was failing a job that never needed those binaries.
 *
 * The full four-triple build is not weakened, only moved to where it works and
 * is meaningful — see the `engine-no-network` job, which keeps it and is the
 * standing evidence for A9's "all four triples from one runner".
 */
function targetsToBuild(): readonly SidecarTarget[] {
  if (!process.argv.includes('--host-only')) {
    return SIDECAR_TARGETS;
  }
  const hostName = binaryNameForHost();
  const host = SIDECAR_TARGETS.filter((target) => target.outfileName === hostName);
  if (host.length !== 1) {
    // Refuse rather than build nothing: an unmatched host means the triple
    // table and `binaryNameForHost` have drifted apart.
    throw new Error(`build-sidecar: --host-only matched ${String(host.length)} targets for ${hostName}`);
  }
  return host;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const buildHash = await computeBuildHash();
  console.log(`build hash: ${buildHash}`);
  const targets = targetsToBuild();
  // Sequential by design: clear per-target progress output, one target at a time.
  for (const target of targets) {
    await buildOne(target, buildHash);
    verifyArtifact(target);
  }
  console.log(`${String(targets.length)} of ${String(SIDECAR_TARGETS.length)} sidecar binaries written to ${OUT_DIR}`);
  await smokeTestHostBinary();
}

await main();
