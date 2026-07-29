import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { analyze } from '../../src/analyze';

const GRAMMARS_DIR = join(import.meta.dir, '..', '..', 'grammars');
const FIXTURES_DIR = join(import.meta.dir, '..', '..', 'fixtures');

function options(fixture: string) {
  return {
    repoRootAbs: join(FIXTURES_DIR, fixture),
    grammarsDir: GRAMMARS_DIR,
    engineVersion: '0.0.0-overlap',
  };
}

/**
 * The engine is single-threaded per process and does not survive overlap:
 * identical content analysed concurrently from two paths disagreed on `edges`,
 * `symbolCount`, `pageRank`, `inDegree`/`outDegree`, `diagnostics` and
 * `graph.componentCount` — 107 differing leaves, against 3 sequentially.
 *
 * That was previously prevented by nothing in this package. It held only
 * because `apps/desktop/src-tauri/src/sidecar/supervisor.rs` keeps a single
 * process-wide `analysis_in_progress` flag — which is STRICTER than the build
 * spec's Phase 6 wording, "one analysis at a time per repo". A faithful
 * implementation of that wording would permit two repos to overlap and corrupt
 * both results.
 *
 * These tests exist so that stops being luck. If someone makes `analyze()`
 * re-entrant without first fixing the shared state, the first test fails.
 */
describe('analyze() refuses to overlap with itself', () => {
  test('a second analysis started while one is in flight is rejected', async () => {
    const first = analyze(options('kitchen-sink'));
    // Deliberately NOT awaited before starting the second: overlap is the
    // condition under test.
    const second = analyze(options('node-express'));

    await expect(second).rejects.toThrow(/already running/i);
    await first; // the in-flight one still completes normally
  });

  test('the refusal carries E_ANALYSIS_IN_PROGRESS, matching the Rust shell', async () => {
    const first = analyze(options('kitchen-sink'));
    const second = analyze(options('react-app')).catch((error: unknown) => error);

    const rejection = (await second) as { appError?: { code?: string } };
    await first;

    // Same code the supervisor returns, so the UI copy is identical whichever
    // layer refuses (Section 10's "Second analysis started while one runs").
    expect(rejection.appError?.code).toBe('E_ANALYSIS_IN_PROGRESS');
  });

  test('the guard releases, so sequential analyses still work', async () => {
    // Non-vacuity in the other direction: a guard that never clears would make
    // every test above pass while breaking the product outright.
    const first = await analyze(options('node-express'));
    const second = await analyze(options('node-express'));

    expect(second.fingerprint).toBe(first.fingerprint);
  });

  test('the guard releases after a FAILED analysis too', async () => {
    // A `try` without `finally` passes every test above and wedges the engine
    // permanently on the first bad repo path.
    await expect(analyze(options('does-not-exist'))).rejects.toThrow();

    const after = await analyze(options('node-express'));
    expect(after.repo.name).toBe('node-express');
  });
});
