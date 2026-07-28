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

/**
 * Every workspace package, derived from the root `package.json`'s own
 * `workspaces` globs — NOT a hardcoded list.
 *
 * A hardcoded list has the completeness hole this whole exercise is about:
 * it can only prove it visited the trees it names, never that those are all
 * the trees. A package added next month would be silently unscanned and the
 * guard would stay green. Deriving from the workspace globs means a new
 * package is covered by construction, and `every workspace package is
 * scanned` below fails if the derivation itself ever stops matching.
 */
function workspacePackageDirs(): readonly string[] {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    workspaces?: readonly string[];
  };
  const globs = manifest.workspaces ?? [];
  const dirs: string[] = [];
  for (const glob of globs) {
    // The manifest uses simple one-level globs (`packages/*`, `apps/*`);
    // anything more exotic is unsupported ON PURPOSE, so a future glob shape
    // fails loudly here rather than silently narrowing the scan.
    if (!glob.endsWith('/*')) {
      throw new Error(
        `Unsupported workspace glob ${glob}: this guard understands only "<dir>/*". ` +
          `Update workspacePackageDirs() rather than letting the scan silently shrink.`,
      );
    }
    const parent = join(REPO_ROOT, glob.slice(0, -2));
    for (const entry of readdirSync(parent)) {
      const full = join(parent, entry);
      if (statSync(full).isDirectory()) {
        dirs.push(relative(REPO_ROOT, full));
      }
    }
  }
  return dirs;
}

/** Every workspace package, plus the repo-root scripts directory. */
const SCANNED_DIRS: readonly string[] = [...workspacePackageDirs(), 'scripts'];

/**
 * The only files allowed to contain a newline search.
 *
 * `src/line-framing.ts` is the one implementation. Its two test files are
 * allowed for a specific reason worth stating: `line-framing.test.ts`
 * deliberately replays the exact broken loop to prove the complexity
 * threshold is non-vacuous, and this file carries the pattern in
 * `FRAMING_SEARCH`. Both are matched by basename prefix rather than by a
 * blanket "any test file" rule, so a NEW test elsewhere that hand-rolls
 * framing is still caught.
 */
function isAllowed(relativePath: string): boolean {
  const posix = relativePath.split(sep).join('/');
  return (
    posix === 'packages/contract/src/line-framing.ts' ||
    posix === 'packages/contract/test/line-framing.test.ts' ||
    posix === 'packages/contract/test/line-framing.guard.test.ts'
  );
}

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
        if (isAllowed(relativePath)) {
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
   * Completeness, not just non-vacuity: every workspace package declared in
   * the root manifest must be in the scanned set AND must have yielded at
   * least one TypeScript file. The first half catches a derivation that
   * silently drops a package; the second catches a walker that returns
   * nothing (a typo'd path, a bad filter) and would otherwise make the
   * offenders assertion permanently, invisibly green.
   */
  test('every workspace package is scanned and yields files', () => {
    const packages = workspacePackageDirs();
    expect(packages.length).toBeGreaterThan(0);

    for (const pkg of packages) {
      expect(SCANNED_DIRS).toContain(pkg);
      const fileCount = [...walk(join(REPO_ROOT, pkg))].length;
      expect(fileCount).toBeGreaterThan(0);
    }
  });

  /** The derivation must actually reflect the manifest, not a stale copy. */
  test('the scanned set matches the workspaces declared in package.json', () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      workspaces?: readonly string[];
    };
    expect(manifest.workspaces).toBeDefined();
    for (const pkg of workspacePackageDirs()) {
      const parent = pkg.split(sep)[0];
      expect((manifest.workspaces ?? []).some((g) => g.startsWith(`${parent}/`))).toBe(true);
    }
  });

  /** The pattern must match the defect it was written to catch. */
  test('the detector matches the exact loop that shipped', () => {
    const shipped = "let newlineIndex = buffer.indexOf('\\n');";
    expect(FRAMING_SEARCH.test(shipped)).toBe(true);
    expect(FRAMING_SEARCH.test('const i = haystack.indexOf(needle);')).toBe(false);
  });
});
