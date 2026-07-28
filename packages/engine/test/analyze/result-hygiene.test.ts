import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Section 13 acceptance criteria 4 and 5, which had no dedicated test.
 *
 *   4. "Every path in every `AnalysisResult` is repo-relative POSIX; a test
 *      asserts zero occurrences of `\`, `:`, or a leading `/` across all
 *      fixture outputs."
 *   5. "`AnalysisResult` contains no timestamp, no duration, no absolute
 *      path, no hostname, and no PID; timings appear only in
 *      `AnalysisEnvelope.timings`."
 *
 * `snapshots.test.ts` asserts that each fixture REPRODUCES its committed
 * snapshot, which is a determinism property — it would happily reproduce a
 * snapshot full of backslashes forever. These two criteria are about the
 * CONTENT of that output, so they need their own assertions.
 *
 * Run against the committed snapshots rather than a live `analyze()` so the
 * check covers every fixture without re-running the pipeline, and so a
 * regression that reaches a snapshot is caught at review time.
 */

const SNAPSHOT_DIR = join(import.meta.dir, '..', '__snapshots__');

function snapshotFiles(): readonly string[] {
  return readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith('.json'));
}

/** Every string leaf in the document, with the key path that reached it. */
function* stringLeaves(value: unknown, trail: readonly string[] = []): Generator<{
  readonly key: string;
  readonly trail: readonly string[];
  readonly value: string;
}> {
  if (typeof value === 'string') {
    yield { key: trail[trail.length - 1] ?? '', trail, value };
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* stringLeaves(item, trail);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      yield* stringLeaves(v, [...trail, k]);
    }
  }
}

function* objectKeys(value: unknown, trail: readonly string[] = []): Generator<{
  readonly key: string;
  readonly trail: readonly string[];
}> {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* objectKeys(item, trail);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      yield { key: k, trail: [...trail, k] };
      yield* objectKeys(v, [...trail, k]);
    }
  }
}

/**
 * A string that names a file or directory. Detected structurally rather than
 * by key name, so a path smuggled into an unexpected field is still checked.
 *
 * `evidence` strings such as `python:module-guard` and `package.json#main`
 * are deliberately NOT paths — criterion 4 says "every PATH", and applying a
 * blanket no-colon rule to every string would fail on those by design.
 */
function looksLikePath(s: string): boolean {
  return /[\\/]/.test(s) || /\.[a-z0-9]{1,5}$/i.test(s);
}

/**
 * Every field in the contract whose declared type is `RepoPath`, DERIVED from
 * `analysis-result.ts` rather than hand-listed.
 *
 * Two failed attempts got us here, and both were the same error:
 *
 *   1. Detecting by string shape was too broad — `node-express`'s snapshot has
 *      `symbols.name = "/users"` and `"/:id"`, Express ROUTE strings that
 *      legitimately begin with a slash and are not paths.
 *   2. Hand-listing the keys was too narrow — the list said `from`/`to`, which
 *      the contract does not have (it uses `fromPath`/`toPath`), and missed
 *      `dirPath` entirely. Criterion 4 read PROVEN with three path fields
 *      never checked.
 *
 * So the set is derived: a field added to the contract later is covered by
 * construction. This is a scan of a SOURCE file (legitimate) rather than a
 * scrape of our own output (not) — the same distinction that separates the
 * egress-chokepoint checker from the bench's old prose-matching gate.
 */
const CONTRACT_SOURCE = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  'contract',
  'src',
  'analysis-result.ts',
);

/**
 * `name: RepoPath`, `name: RepoPath.nullable()`, `name: z.array(RepoPath)`.
 *
 * Deliberately NOT anchored to line start: `workspacePackages` declares
 * `dirPath: RepoPath` inline inside a nested `z.object({ ... })`, and a
 * line-anchored pattern silently skipped it. `[^,\n{}]*` stops the scan at a
 * comma or brace so a sibling field's name can never be captured instead.
 */
const DECLARATION = /(\w+)\s*:\s*[^,\n{}]*\bRepoPath\b/g;

interface Derivation {
  readonly fields: ReadonlySet<string>;
  /** Every parsed declaration site, including repeats of the same field name. */
  readonly parsedSites: number;
  /** Every `RepoPath` mention that is not its own definition. */
  readonly expectedSites: number;
}

function deriveRepoPathFields(): Derivation {
  const source = readFileSync(CONTRACT_SOURCE, 'utf8');
  const fields = new Set<string>();
  let parsedSites = 0;
  for (const match of source.matchAll(DECLARATION)) {
    const name = match[1];
    if (name !== undefined) {
      fields.add(name);
      parsedSites += 1;
    }
  }
  const allMentions = [...source.matchAll(/\bRepoPath\b/g)].length;
  const definitions = [...source.matchAll(/export const RepoPath\b/g)].length;
  return { fields, parsedSites, expectedSites: allMentions - definitions };
}

const DERIVATION = deriveRepoPathFields();
const REPO_PATH_FIELDS = DERIVATION.fields;

function isPathField(key: string): boolean {
  return REPO_PATH_FIELDS.has(key);
}

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const FORBIDDEN_KEYS = new Set([
  'timestamp',
  'timestamps',
  'createdAt',
  'generatedAt',
  'durationMs',
  'duration',
  'elapsedMs',
  'hostname',
  'host',
  'pid',
  'processId',
  'user',
  'username',
]);

describe('criterion 4 — every path is repo-relative POSIX', () => {
  test('the fixture snapshots exist to check', () => {
    expect(snapshotFiles().length).toBeGreaterThanOrEqual(5);
  });

  /**
   * A derived set that silently matches nothing would make every assertion
   * below vacuously true, so the set is asserted non-empty AND printed. The
   * three names spelled out are the ones the previous hand-list got wrong:
   * `fromPath`/`toPath` (listed as `from`/`to`) and `dirPath` (missed).
   */
  test('the RepoPath field set is derived, non-empty, and includes the previously-missed fields', () => {
    console.log(`  derived RepoPath fields: ${[...REPO_PATH_FIELDS].sort().join(', ')}`);
    expect(REPO_PATH_FIELDS.size).toBeGreaterThanOrEqual(10);
    for (const required of ['path', 'parentPath', 'fromPath', 'toPath', 'dirPath', 'sourceRoots']) {
      expect(REPO_PATH_FIELDS.has(required)).toBe(true);
    }
  });

  /**
   * COMPLETENESS, as distinct from the regression guard above.
   *
   * Naming the three fields the old hand-list missed proves the scanner
   * catches THOSE — it says nothing about a fourth the scanner also cannot
   * parse, which is the same "trusted because it looked right" shape the
   * hand-list had. So: every `RepoPath` mention in the contract that is not
   * its own definition must have been parsed into a declaration site. A
   * reference the regex cannot read fails here loudly instead of being
   * silently dropped from the checked set.
   */
  test('every RepoPath reference in the contract was parsed', () => {
    console.log(
      `  parsed ${String(DERIVATION.parsedSites)} declaration sites; ` +
        `contract mentions RepoPath ${String(DERIVATION.expectedSites)} times (excluding its definition)`,
    );
    expect(DERIVATION.parsedSites).toBe(DERIVATION.expectedSites);
    expect(DERIVATION.expectedSites).toBeGreaterThan(0);
  });

  for (const file of snapshotFiles()) {
    test(`${file}: no backslash, drive letter, or leading slash in any path`, () => {
      const doc: unknown = JSON.parse(readFileSync(join(SNAPSHOT_DIR, file), 'utf8'));
      const offenders: string[] = [];

      for (const leaf of stringLeaves(doc)) {
        if (!isPathField(leaf.key) || !looksLikePath(leaf.value)) {
          continue;
        }
        const where = `${leaf.trail.join('.')} = ${JSON.stringify(leaf.value)}`;
        if (leaf.value.includes('\\')) {
          offenders.push(`backslash: ${where}`);
        }
        if (WINDOWS_DRIVE.test(leaf.value)) {
          offenders.push(`drive letter: ${where}`);
        }
        if (leaf.value.startsWith('/')) {
          offenders.push(`leading slash: ${where}`);
        }
      }

      expect(offenders).toEqual([]);
    });
  }
});

describe('criterion 5 — no timestamp, duration, absolute path, hostname or PID', () => {
  for (const file of snapshotFiles()) {
    test(`${file}: carries no environment-derived or time-derived field`, () => {
      const doc: unknown = JSON.parse(readFileSync(join(SNAPSHOT_DIR, file), 'utf8'));

      const badKeys = [...objectKeys(doc)]
        .filter((k) => FORBIDDEN_KEYS.has(k.key))
        .map((k) => k.trail.join('.'));
      expect(badKeys).toEqual([]);

      const badValues: string[] = [];
      for (const leaf of stringLeaves(doc)) {
        if (ISO_TIMESTAMP.test(leaf.value)) {
          badValues.push(`timestamp-like: ${leaf.trail.join('.')} = ${leaf.value}`);
        }
        if (isPathField(leaf.key) && (WINDOWS_DRIVE.test(leaf.value) || leaf.value.startsWith("/"))) {
          badValues.push(`absolute path: ${leaf.trail.join('.')} = ${leaf.value}`);
        }
      }
      expect(badValues).toEqual([]);
    });
  }
});

/**
 * Non-vacuity. Both suites above assert an EMPTY offender list, which is the
 * shape that passes when the detector is broken — a typo in `looksLikePath`,
 * a walker that never recurses, or a snapshot directory that resolves to
 * nothing would all produce a permanent green. These two cases prove the
 * detectors fire on the exact violations the criteria name.
 */
describe('the criterion 4 and 5 detectors actually discriminate', () => {
  test('a planted Windows path is caught by both detectors', () => {
    const poisoned = {
      files: [{ path: 'src\\index.ts' }, { path: 'C:/repo/src/main.ts' }, { path: '/etc/passwd' }],
    };
    const found = [...stringLeaves(poisoned)].filter((l) => looksLikePath(l.value));
    expect(found.length).toBe(3);
    expect(found.some((l) => l.value.includes('\\'))).toBe(true);
    expect(found.some((l) => WINDOWS_DRIVE.test(l.value))).toBe(true);
    expect(found.some((l) => l.value.startsWith('/'))).toBe(true);
  });

  test('a planted timestamp and pid are caught, and evidence strings are not', () => {
    const poisoned = { meta: { generatedAt: '2026-07-28T11:04:00Z', pid: 4242 } };
    const badKeys = [...objectKeys(poisoned)].filter((k) => FORBIDDEN_KEYS.has(k.key));
    expect(badKeys.map((k) => k.key).sort()).toEqual(['generatedAt', 'pid']);

    // Colons in non-path evidence must NOT be treated as a path violation.
    expect(looksLikePath('python:module-guard')).toBe(false);
  });
});
