/**
 * @onboard/engine — `bun run verify:determinism` (Section 8.8, Section 9
 * Phase 4's gate: "cold-vs-cold, cold-vs-warm, shuffled-walk — 15 fingerprint
 * comparisons total").
 *
 * A fingerprint comparison alone cannot catch an engine that reliably
 * produces the same EMPTY result every time — two runs of a broken parser
 * agree with each other just as readily as two runs of a working one. So
 * before any fingerprint is compared, every fixture's result is checked for
 * substance (`symbols > 0`, `edges > 0`) — this is the floor a truthful
 * "determinism" claim needs underneath it, added after a compiled-binary
 * regression shipped a stable-but-meaningless `AnalysisResult` that this
 * gate did not catch (see `docs/DECISIONS.md`).
 *
 * For each of the 5 fixtures, asserts:
 *   1. cold-vs-cold   — two independent cold `analyze()` runs agree.
 *   2. cold-vs-warm   — a cache-primed run agrees with the cold fingerprint.
 *   3. shuffled-walk  — a run with `readdir` results reversed (never sorted
 *      by the walker itself) still agrees, proving the global re-sort
 *      (Section 8.1 step 4) is what makes the walk order-independent.
 * 5 fixtures x 3 comparisons = 15 total, matching the gate exactly.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnalysisResult as AnalysisResultValue } from '@onboard/contract';
import { analyze } from '../src/analyze';
import { SqliteCacheStore } from '../src/cache/sqlite-cache-store';
import type { DirEntryInfo, WalkFs } from '../src/walk/walk';

const ROOT = join(import.meta.dir, '..');
const GRAMMARS_DIR = join(ROOT, 'grammars');
const FIXTURES_DIR = join(ROOT, 'fixtures');
const ENGINE_VERSION = '0.0.0-verify-determinism';

/**
 * Overridable so this script's own gate can be demonstrated failing against
 * a broken engine (Section 9 Phase 5's gate evidence requirement) without a
 * separate copy of the script: `VERIFY_DETERMINISM_GRAMMARS_DIR=<empty-dir>
 * bun run verify:determinism` points every parse at a grammar-free
 * directory, so every file degrades to zero symbols/edges — exactly the
 * "deliberately emptied result" this floor exists to catch.
 */
const EFFECTIVE_GRAMMARS_DIR = process.env.VERIFY_DETERMINISM_GRAMMARS_DIR ?? GRAMMARS_DIR;

const FIXTURES = ['node-express', 'react-app', 'python-flask', 'mixed-monorepo', 'kitchen-sink'] as const;

function reversedReadDir(absDirPath: string): readonly DirEntryInfo[] {
  const dirents = readdirSync(absDirPath, { withFileTypes: true });
  const infos: DirEntryInfo[] = [];
  for (const dirent of dirents) {
    if (dirent.isDirectory()) {
      infos.push({ name: dirent.name, isDirectory: true });
    } else if (dirent.isFile()) {
      infos.push({ name: dirent.name, isDirectory: false });
    } else if (dirent.isSymbolicLink()) {
      try {
        infos.push({ name: dirent.name, isDirectory: statSync(join(absDirPath, dirent.name)).isDirectory() });
      } catch {
        continue;
      }
    }
  }
  return infos.reverse();
}

const SHUFFLED_WALK_FS: Partial<WalkFs> = { readDir: reversedReadDir };

interface ComparisonResult {
  readonly fixture: string;
  readonly comparison: string;
  readonly passed: boolean;
}

async function runColdFull(fixtureDir: string): Promise<AnalysisResultValue> {
  return analyze({ repoRootAbs: fixtureDir, grammarsDir: EFFECTIVE_GRAMMARS_DIR, engineVersion: ENGINE_VERSION });
}

async function runWarm(fixtureDir: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'onboard-verify-determinism-'));
  try {
    const dbPath = join(dir, 'cache.sqlite');
    const first = new SqliteCacheStore(dbPath);
    await analyze({ repoRootAbs: fixtureDir, grammarsDir: EFFECTIVE_GRAMMARS_DIR, engineVersion: ENGINE_VERSION, cacheStore: first });
    first.close();

    const second = new SqliteCacheStore(dbPath);
    const result = await analyze({
      repoRootAbs: fixtureDir,
      grammarsDir: EFFECTIVE_GRAMMARS_DIR,
      engineVersion: ENGINE_VERSION,
      cacheStore: second,
    });
    second.close();
    return result.fingerprint;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runShuffled(fixtureDir: string): Promise<string> {
  const result = await analyze({
    repoRootAbs: fixtureDir,
    grammarsDir: EFFECTIVE_GRAMMARS_DIR,
    engineVersion: ENGINE_VERSION,
    walkFs: SHUFFLED_WALK_FS,
  });
  return result.fingerprint;
}

/**
 * The determinism floor (see this file's header comment): every fixture
 * must produce at least one symbol, and at least one resolved import edge.
 * All 5 vendored fixtures have real symbols and real imports by design
 * (Section 11), so a `0` here always means the engine degraded, never that
 * a fixture legitimately has nothing to find.
 */
function checkSubstance(fixture: string, result: AnalysisResultValue): readonly string[] {
  const failures: string[] = [];
  if (result.symbols.length === 0) {
    failures.push(`${fixture}: 0 symbols extracted (expected > 0) — the engine did not really parse this fixture.`);
  }
  if (result.edges.length === 0) {
    failures.push(`${fixture}: 0 import edges resolved (expected > 0) — the engine did not really parse this fixture.`);
  }
  return failures;
}

async function verifyFixture(fixture: string): Promise<{ substanceFailures: readonly string[]; comparisons: ComparisonResult[] }> {
  const fixtureDir = join(FIXTURES_DIR, fixture);
  const coldAFull = await runColdFull(fixtureDir);
  const substanceFailures = checkSubstance(fixture, coldAFull);
  if (substanceFailures.length > 0) {
    // No point comparing fingerprints of a result we already know is empty.
    return { substanceFailures, comparisons: [] };
  }

  const coldA = coldAFull.fingerprint;
  const coldB = (await runColdFull(fixtureDir)).fingerprint;
  const warm = await runWarm(fixtureDir);
  const shuffled = await runShuffled(fixtureDir);

  return {
    substanceFailures,
    comparisons: [
      { fixture, comparison: 'cold-vs-cold', passed: coldA === coldB },
      { fixture, comparison: 'cold-vs-warm', passed: coldA === warm },
      { fixture, comparison: 'cold-vs-shuffled-walk', passed: coldA === shuffled },
    ],
  };
}

async function main(): Promise<void> {
  const allSubstanceFailures: string[] = [];
  const allResults: ComparisonResult[] = [];
  for (const fixture of FIXTURES) {
    const { substanceFailures, comparisons } = await verifyFixture(fixture);
    allSubstanceFailures.push(...substanceFailures);
    if (substanceFailures.length > 0) {
      substanceFailures.forEach((message) => console.log(`FAIL  ${message}`));
      continue;
    }
    const results = comparisons;
    allResults.push(...results);
    results.forEach((r) => {
      console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.fixture} :: ${r.comparison}`);
    });
  }

  const failed = allResults.filter((r) => !r.passed);
  console.log(`\n${String(allResults.length)} fingerprint comparisons, ${String(failed.length)} failed.`);
  if (allSubstanceFailures.length > 0) {
    console.log(`${String(allSubstanceFailures.length)} determinism-floor substance failure(s) — see FAIL lines above.`);
  }
  if (failed.length > 0 || allSubstanceFailures.length > 0) {
    process.exit(1);
  }
}

await main();
