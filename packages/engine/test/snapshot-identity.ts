/**
 * Removes machine identity from an `AnalysisResult` so a snapshot can be
 * compared on a machine other than the one that generated it.
 *
 * `repo.rootPathHash` is `sha256(canonicalRoot)` — the ABSOLUTE path — and
 * `repo.id` is its first 16 characters. That is deliberate and must not change:
 * the contract's comment on the field ("absolute path is NEVER emitted") is the
 * whole reason it is a hash. But it means the value differs on every checkout,
 * and `fingerprint` covers it, so a committed snapshot of the raw result could
 * only ever match on the exact directory it was generated in.
 *
 * It did only match there. All five snapshots failed on all four CI verify jobs
 * the first time the test stage was ever allowed to run — on Linux, macOS and
 * Windows alike, which is what rules out a platform-ordering cause.
 *
 * So both sides substitute a fixed sentinel and then RE-DERIVE the fingerprint
 * over the normalized object, using the engine's own formula. The snapshot
 * keeps a real fingerprint that still fails on any content change; what it
 * stops asserting is which directory the analysis ran in.
 *
 * The raw result's own fingerprint is not left unchecked — `snapshots.test.ts`
 * asserts separately that it is the correct hash of its own content, which is
 * a stronger claim than a stored constant and holds on any machine.
 */
import type { AnalysisResult as AnalysisResultValue } from '@onboard/contract';
import { stableStringify } from '@onboard/contract';
import { sha256Hex } from '../src/util/hash';

/** Not a real hash of anything: an obvious placeholder, so a leak reads as one. */
export const SNAPSHOT_ROOT_PATH_HASH = '0'.repeat(64);
export const SNAPSHOT_REPO_ID = SNAPSHOT_ROOT_PATH_HASH.slice(0, 16);

/** The engine's fingerprint formula (`analyze-assemble.ts`), applied to any result. */
export function deriveFingerprint(result: AnalysisResultValue): string {
  return sha256Hex(stableStringify({ ...result, fingerprint: '' }));
}

export function normalizeForSnapshot(result: AnalysisResultValue): AnalysisResultValue {
  const withoutIdentity: AnalysisResultValue = {
    ...result,
    repo: { ...result.repo, id: SNAPSHOT_REPO_ID, rootPathHash: SNAPSHOT_ROOT_PATH_HASH },
    fingerprint: '',
  };
  return { ...withoutIdentity, fingerprint: deriveFingerprint(withoutIdentity) };
}
