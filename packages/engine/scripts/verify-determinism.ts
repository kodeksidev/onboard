/**
 * @onboard/engine — `bun run verify:determinism` (Section 8.8, Section 9
 * Phase 4's gate: "cold-vs-cold, cold-vs-warm, shuffled-walk — 15 fingerprint
 * comparisons total").
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
import { analyze } from '../src/analyze';
import { SqliteCacheStore } from '../src/cache/sqlite-cache-store';
import type { DirEntryInfo, WalkFs } from '../src/walk/walk';

const ROOT = join(import.meta.dir, '..');
const GRAMMARS_DIR = join(ROOT, 'grammars');
const FIXTURES_DIR = join(ROOT, 'fixtures');
const ENGINE_VERSION = '0.0.0-verify-determinism';

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

async function runCold(fixtureDir: string): Promise<string> {
  const result = await analyze({ repoRootAbs: fixtureDir, grammarsDir: GRAMMARS_DIR, engineVersion: ENGINE_VERSION });
  return result.fingerprint;
}

async function runWarm(fixtureDir: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'onboard-verify-determinism-'));
  try {
    const dbPath = join(dir, 'cache.sqlite');
    const first = new SqliteCacheStore(dbPath);
    await analyze({ repoRootAbs: fixtureDir, grammarsDir: GRAMMARS_DIR, engineVersion: ENGINE_VERSION, cacheStore: first });
    first.close();

    const second = new SqliteCacheStore(dbPath);
    const result = await analyze({
      repoRootAbs: fixtureDir,
      grammarsDir: GRAMMARS_DIR,
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
    grammarsDir: GRAMMARS_DIR,
    engineVersion: ENGINE_VERSION,
    walkFs: SHUFFLED_WALK_FS,
  });
  return result.fingerprint;
}

async function verifyFixture(fixture: string): Promise<ComparisonResult[]> {
  const fixtureDir = join(FIXTURES_DIR, fixture);
  const coldA = await runCold(fixtureDir);
  const coldB = await runCold(fixtureDir);
  const warm = await runWarm(fixtureDir);
  const shuffled = await runShuffled(fixtureDir);

  return [
    { fixture, comparison: 'cold-vs-cold', passed: coldA === coldB },
    { fixture, comparison: 'cold-vs-warm', passed: coldA === warm },
    { fixture, comparison: 'cold-vs-shuffled-walk', passed: coldA === shuffled },
  ];
}

async function main(): Promise<void> {
  const allResults: ComparisonResult[] = [];
  for (const fixture of FIXTURES) {
    const results = await verifyFixture(fixture);
    allResults.push(...results);
    results.forEach((r) => {
      console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.fixture} :: ${r.comparison}`);
    });
  }

  const failed = allResults.filter((r) => !r.passed);
  console.log(`\n${String(allResults.length)} fingerprint comparisons, ${String(failed.length)} failed.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

await main();
