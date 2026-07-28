import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Fails if a hand-rolled newline-framing loop appears anywhere outside
 * `@onboard/contract`'s `line-framing.ts`.
 *
 * This exists because the last defect of this class was not a missing
 * `scanFrom` — it was DUPLICATION. `packages/engine/src/rpc/server.ts` had a
 * correct reader and `apps/desktop/bench/support/engine-rpc-client.ts` had a
 * second, hand-rolled one that never received the Phase 11 fix, so every
 * large bench measurement ran through a quadratic reader for months. Patching
 * the copy would have left two implementations free to diverge again; the
 * only durable fix is one implementation plus a check that a third cannot
 * quietly appear.
 *
 * Deliberately a repo scan rather than an ESLint rule: the two call sites
 * live in different packages with different lint configs and different
 * runners (`bun test` vs `vitest`), and a rule that only runs where it is
 * configured would miss exactly the cross-package case that produced the
 * defect. A test that walks the tree is config-independent.
 */

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

/** Source trees that could plausibly frame a stream. */
const SCANNED_DIRS = [
  join('packages', 'contract', 'src'),
  join('packages', 'engine', 'src'),
  join('packages', 'engine', 'scripts'),
  join('apps', 'desktop', 'src'),
  join('apps', 'desktop', 'bench'),
  join('apps', 'desktop', 'e2e'),
  'scripts',
];

/** The one file allowed to implement framing. */
const ALLOWED = join('packages', 'contract', 'src', 'line-framing.ts');

/**
 * The signature of an accumulate-and-scan framing loop: searching a buffer
 * for a newline. Matches `.indexOf('\n')` and `.indexOf("\n")` with or
 * without a second argument, which covers both the correct and the quadratic
 * spelling — the point is that NEITHER belongs outside the shared module.
 */
const FRAMING_SEARCH = /\.indexOf\(\s*(['"])\\n\1/;

function* walk(dir: string): Generator<string> {
  let entries: readonly string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // an optional tree (e.g. e2e) that does not exist in this checkout
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'target') {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

describe('newline framing has exactly one implementation', () => {
  test('no file outside line-framing.ts searches a buffer for a newline', () => {
    const offenders: string[] = [];

    for (const dir of SCANNED_DIRS) {
      for (const file of walk(join(REPO_ROOT, dir))) {
        const relativePath = relative(REPO_ROOT, file);
        if (relativePath === ALLOWED || relativePath.split(sep).join('/') === ALLOWED.split(sep).join('/')) {
          continue;
        }
        // The guard test itself contains the pattern in this constant.
        if (relativePath.includes('line-framing.guard.test')) {
          continue;
        }
        const source = readFileSync(file, 'utf8');
        if (FRAMING_SEARCH.test(source)) {
          offenders.push(relativePath);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * Non-vacuity: the scan must actually reach real files, or an empty
   * `offenders` list would prove nothing. A typo'd path or a broken walker
   * would otherwise render the assertion above permanently, silently green.
   */
  test('the scan actually visited the source trees it claims to cover', () => {
    const visited = SCANNED_DIRS.map((dir) => ({
      dir,
      count: [...walk(join(REPO_ROOT, dir))].length,
    }));

    // These three definitely exist and definitely contain TypeScript.
    const required = [
      join('packages', 'contract', 'src'),
      join('packages', 'engine', 'src'),
      join('apps', 'desktop', 'bench'),
    ];
    for (const dir of required) {
      const found = visited.find((v) => v.dir === dir);
      expect(found?.count ?? 0).toBeGreaterThan(0);
    }
  });

  /** The pattern must match the defect it was written to catch. */
  test('the detector matches the exact loop that shipped', () => {
    const shipped = "let newlineIndex = buffer.indexOf('\\n');";
    expect(FRAMING_SEARCH.test(shipped)).toBe(true);
    expect(FRAMING_SEARCH.test('const i = haystack.indexOf(needle);')).toBe(false);
  });
});
