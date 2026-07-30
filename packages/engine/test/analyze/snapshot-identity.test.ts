import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stableStringify } from '@onboard/contract';
import type { AnalysisResult as AnalysisResultValue } from '@onboard/contract';
import { analyze } from '../../src/analyze';
import { deriveFingerprint, normalizeForSnapshot } from '../snapshot-identity';

const GRAMMARS_DIR = join(import.meta.dir, '..', '..', 'grammars');
const FIXTURES_DIR = join(import.meta.dir, '..', '..', 'fixtures');

/** One fixture is enough: the property under test is about paths, not content. */
const FIXTURE = 'kitchen-sink';

/**
 * Analyses the same fixture CONTENT from a fresh absolute path, keeping the
 * leaf directory name — which is what a checkout on another machine does. The
 * leaf name is deliberately held fixed: `repo.name` is derived from it, and a
 * checkout preserves it, so a name difference would not model reality. The last
 * test in this file proves the model is honest about that by showing the leaf
 * name IS load-bearing.
 */
async function analyzeFromFreshPath(leafName = FIXTURE): Promise<AnalysisResultValue> {
  const parent = mkdtempSync(join(tmpdir(), 'onboard-identity-'));
  try {
    const target = join(parent, leafName);
    cpSync(join(FIXTURES_DIR, FIXTURE), target, { recursive: true });
    return await analyze({
      repoRootAbs: target,
      grammarsDir: GRAMMARS_DIR,
      engineVersion: '0.0.0-snapshot',
    });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

/**
 * SEQUENTIALLY, never `Promise.all`. Two `analyze()` calls overlapping in one
 * process do not produce independent results — the first draft of this file used
 * `Promise.all` and the two runs disagreed on `edges`, `symbolCount`, `pageRank`
 * and `diagnostics`, not just on the path-derived fields. Run one after the
 * other and they differ in exactly three fields.
 *
 * That is a real constraint on this module, recorded in `docs/DECISIONS.md`: it
 * is unreachable today only because `rpc/server.ts` awaits each request line
 * before reading the next.
 */
async function analyzeTwiceFromFreshPaths(): Promise<[AnalysisResultValue, AnalysisResultValue]> {
  const first = await analyzeFromFreshPath();
  const second = await analyzeFromFreshPath();
  return [first, second];
}

/** Dotted paths of every leaf that differs between two results. */
function differingPaths(a: unknown, b: unknown, path = ''): string[] {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${path}[length]`];
    return a.flatMap((item, i) => differingPaths(item, b[i], `${path}[${i}]`));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((key) =>
      differingPaths(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      ),
    );
  }
  return a === b ? [] : [path];
}

/** What `normalizeForSnapshot` actually neutralises, read off the function itself. */
function fieldsNormalized(result: AnalysisResultValue): string[] {
  return differingPaths(result, normalizeForSnapshot(result)).sort();
}

describe('what a snapshot must forget is derived, not declared', () => {
  test('normalization neutralises EXACTLY the fields that vary with checkout location', async () => {
    // The set of path-dependent fields is not stated anywhere — it is measured,
    // by analysing identical content from two unrelated absolute paths. If the
    // engine ever starts leaking the path into a new field, this fails: the
    // measured set grows and stops matching what normalization covers.
    const [first, second] = await analyzeTwiceFromFreshPaths();

    const variesWithLocation = differingPaths(first, second).sort();

    expect(variesWithLocation.length).toBeGreaterThan(0); // else the probe is broken
    expect(variesWithLocation).toEqual(fieldsNormalized(first));
  });

  test('two checkouts at different absolute paths normalize to the same bytes', async () => {
    const [first, second] = await analyzeTwiceFromFreshPaths();

    expect(first.repo.rootPathHash).not.toBe(second.repo.rootPathHash); // the probe really moved
    expect(stableStringify(normalizeForSnapshot(first))).toBe(
      stableStringify(normalizeForSnapshot(second)),
    );
  });

  test('the emitted fingerprint is the Section 8.8 hash of the emitted result', async () => {
    // Asserted on the RAW result, never the normalized one. Normalization
    // re-derives the fingerprint, so a snapshot comparison alone would agree
    // with a broken fingerprint computation — this is the assertion that does
    // not.
    const result = await analyzeFromFreshPath();

    expect(result.fingerprint).toBe(deriveFingerprint(result));
  });

  test('a fingerprint that does not cover the content is caught', async () => {
    // Non-vacuity for the assertion above: perturb one field and the stored
    // fingerprint must stop matching.
    const result = await analyzeFromFreshPath();
    const tampered: AnalysisResultValue = {
      ...result,
      stats: { ...result.stats, filesScanned: result.stats.filesScanned + 1 },
    };

    expect(tampered.fingerprint).not.toBe(deriveFingerprint(tampered));
  });

  test('the leaf directory name IS load-bearing, so holding it fixed is a real assumption', async () => {
    // Stated rather than hidden: `repo.name` is path-derived too. It is not
    // normalized because a checkout preserves the directory name, and the
    // product's repo name is meant to be meaningful. This proves the claim
    // instead of asserting it in a comment.
    const renamed = await analyzeFromFreshPath('some-other-name');

    expect(renamed.repo.name).toBe('some-other-name');
  });
});
