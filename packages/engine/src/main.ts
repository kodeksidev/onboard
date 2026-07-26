/**
 * @onboard/engine — sidecar process entry point (Section 9 Phase 5).
 *
 * The `guard/no-network` import MUST be the very first statement in this
 * file, before any other import. `no-network.ts` has its own top-level
 * `await installNoNetworkGuard()`, so by ES module evaluation order every
 * later import in this file (and everything they transitively import) only
 * runs after `fetch` and the node network modules are already poisoned —
 * nothing in this process can capture a live reference to them first.
 *
 * `ENGINE_VERSION` below is one of Section 6.1's four cache-invalidation keys,
 * and it is deliberately NOT the bare `package.json` version. `build-sidecar.ts`
 * injects a hash of the emitted bundle via `--define`, so the key moves whenever
 * engine code changes even without a version bump. This was added after a
 * confirmed bug: a defective build cached empty `ParsedFile` rows, and a fixed
 * binary then served that poison indefinitely because all four keys still
 * matched. Verified by an A/B experiment — see `docs/DECISIONS.md`.
 */
import './guard/no-network';

import { version as PACKAGE_VERSION } from '../package.json';
import { resolveEngineVersion } from './engine-version';
import { computeGrammarFingerprint } from './parse/grammar-loader';
import { createEngineMethods } from './rpc/methods';
import { createProgressReporter } from './rpc/progress';
import { readLines, runServer } from './rpc/server';

const ENGINE_VERSION = resolveEngineVersion(PACKAGE_VERSION, process.env.ONBOARD_BUILD_HASH);

const GRAMMARS_DIR_FLAG = '--grammars-dir';

/**
 * `--grammars-dir "<resolved path>"` (Sections 9 Phase 3 and Phase 5's
 * "known hard parts" #1): the Rust shell passes this at spawn time; the
 * grammar loader takes a path argument and has no hardcoded fallback.
 */
export function parseGrammarsDirFlag(argv: readonly string[]): string {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === GRAMMARS_DIR_FLAG && argv[i + 1] !== undefined) {
      return argv[i + 1] as string;
    }
    if (arg?.startsWith(`${GRAMMARS_DIR_FLAG}=`)) {
      return arg.slice(GRAMMARS_DIR_FLAG.length + 1);
    }
  }
  throw new Error(`main: ${GRAMMARS_DIR_FLAG} is required (grammar WASM loads from a directory passed by flag, never a hardcoded path).`);
}

function writeLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Section 11 bench investigation into the 10,000-file cold-analysis timeout
 * (see `docs/DECISIONS.md`): `AnalysisEnvelope.timings` is frozen at five
 * fields, so this reports a finer sub-phase breakdown to STDERR — never
 * stdout, which is the JSON-RPC channel — only when `ONBOARD_DEBUG_TIMINGS`
 * is set. Zero cost in normal operation (the sidecar never sets this).
 */
function debugTimingSink(label: string, ms: number): void {
  process.stderr.write(`${JSON.stringify({ debugTiming: label, ms })}\n`);
}

async function main(): Promise<void> {
  const grammarsDir = parseGrammarsDirFlag(process.argv.slice(2));
  const grammarFingerprint = computeGrammarFingerprint(grammarsDir);
  const debugTimingsEnabled = process.env.ONBOARD_DEBUG_TIMINGS === '1';

  const progressReporter = createProgressReporter((progress) => {
    writeLine(JSON.stringify({ jsonrpc: '2.0', method: 'engine.progress', params: progress }));
  });

  const methods = createEngineMethods({
    engineVersion: ENGINE_VERSION,
    grammarsDir,
    grammarFingerprint,
    onProgress: (progress) => progressReporter.report(progress, progress.processed === progress.total),
    ...(debugTimingsEnabled ? { onPhaseTiming: debugTimingSink } : {}),
  });

  await runServer({
    methods,
    lines: readLines(Bun.stdin.stream()),
    writeLine,
    ...(debugTimingsEnabled ? { onDebugTiming: debugTimingSink } : {}),
  });
  process.exit(0);
}

await main();
