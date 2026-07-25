/**
 * @onboard/desktop — Phase 0 scaffold.
 *
 * This package is a deliberate stub. The real Tauri + React app (owner
 * react-ui / rust-tauri, Section 9, Phases 6-12) is not built until the
 * contract is frozen (Phase 1) and its own dependencies land (React 19, Vite
 * 7, Tailwind, shadcn/ui, Cytoscape, CodeMirror 6 — Section 4). This file
 * exists solely so the workspace's typecheck/lint/test chain has something
 * real to run before then.
 */

export const DESKTOP_STUB_VERSION = 0 as const;

export function describeDesktopStub(): string {
  return 'desktop app scaffold — React 19 + Tauri 2 shell lands from Phase 6 onward';
}
