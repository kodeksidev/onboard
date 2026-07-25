/**
 * @onboard/engine — Phase 0 scaffold.
 *
 * This package is a deliberate stub. The real engine (walk, parse, resolve,
 * graph, rank, search, rpc — Section 9, Phases 2-5) lands only once the
 * contract is frozen in Phase 1. This file exists solely so the workspace's
 * typecheck/lint/test chain has something real to run before then.
 *
 * From Phase 0 onward this package has no network capability: `fetch` and
 * node:net|http|https|tls|dgram|dns are banned by eslint.config.js
 * (Section 12), and Phase 5 additionally stubs them to throw at boot.
 */

export const ENGINE_STUB_VERSION = 0 as const;

export function describeEngineStub(): string {
  return 'engine package scaffold — network access is banned by lint from Phase 0 onward';
}
