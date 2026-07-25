import type { AppError } from '@onboard/contract';
import type { OnboardIpc, Unsubscribe } from './ipc';

/**
 * Real Tauri IPC (Section 7.4). Rust-side commands land in Phase 6 and are
 * wired end-to-end in Phase 11 (Section 9); until then every method rejects
 * with the same `AppError` shape every other failure uses, rather than
 * throwing a bare `Error` a caller wouldn't recognize. The interface this
 * implements is byte-for-byte `OnboardIpc` (Section 7.4's command table), so
 * swapping this in for `mock-ipc.ts` is a one-line change with no call-site
 * updates required.
 */
const NOT_WIRED: AppError = {
  code: 'E_NOT_WIRED',
  message: 'Onboard is running in mock mode; the real desktop shell is not wired until Phase 11.',
  detail: null,
  path: null,
};

function notWired<T>(): Promise<T> {
  return Promise.reject(NOT_WIRED);
}

function noopUnsubscribe(): Unsubscribe {
  return () => undefined;
}

export function createTauriIpc(): OnboardIpc {
  return {
    pickRepoFolder: () => notWired(),
    analyzeRepo: () => notWired(),
    searchRepo: () => notWired(),
    readRepoFile: () => notWired(),
    getSettings: () => notWired(),
    updateSettings: () => notWired(),
    storeAiKey: () => notWired(),
    clearAiKey: () => notWired(),
    testAiKey: () => notWired(),
    aiProjectSummary: () => notWired(),
    aiExplainModule: () => notWired(),
    aiAsk: () => notWired(),
    onAnalysisProgress: () => noopUnsubscribe(),
    onAnalysisError: () => noopUnsubscribe(),
    onModeChanged: () => noopUnsubscribe(),
  };
}
