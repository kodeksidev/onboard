/**
 * @onboard/contract — Phase 0 scaffold.
 *
 * This package is a deliberate stub. Phase 1 ("FREEZE THE CONTRACT", Section 9)
 * is the hard gate that defines every schema in Section 7 of the build spec
 * (analysis-result.ts, search.ts, rpc.ts, error.ts, stable-stringify.ts) — none
 * of that belongs here yet. This file exists solely so the workspace's
 * typecheck/lint/test chain has something real to run before Phase 1 lands.
 */

export const CONTRACT_STUB_VERSION = 0 as const;

export function describeContractStub(): string {
  return 'contract package scaffold — Phase 1 freezes the real AnalysisResult schema';
}
