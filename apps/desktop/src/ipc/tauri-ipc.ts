import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AppError, EngineProgress } from '@onboard/contract';
import type {
  AiActionResult,
  AnalysisErrorListener,
  AnalysisProgressListener,
  AnalyzeRepoRequest,
  ClearAiKeyRequest,
  ModeChangedEvent,
  ModeChangedListener,
  OnboardIpc,
  PickRepoFolderResult,
  ReadRepoFileRequest,
  ReadRepoFileResult,
  StoreAiKeyRequest,
  StoreAiKeyResult,
  TestAiKeyResult,
  Unsubscribe,
} from './ipc';
import type { Settings, SettingsPatch } from './settings-schema';

/**
 * Real Tauri IPC (Section 7.4, wired in Phase 11). Every method invokes the
 * exact Rust command name registered in
 * `apps/desktop/src-tauri/src/commands/mod.rs` — Tauri's `#[tauri::command]`
 * macro deserializes arguments with `rename_all = "camelCase"`, so the
 * snake_case Rust parameter names (`repo_id`, `is_force_refresh`, ...) match
 * these camelCase JS argument objects without any renaming here. A command
 * rejection is already a serialized `AppError` (Rust's `AppError` derives
 * `Serialize` field-for-field identical to the TS one) — `toAppError` only
 * has to catch the case where something *other* than an `AppError` slipped
 * through (Section 12: never surface a raw error to the caller unnormalized).
 */
function toAppError(error: unknown): AppError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'detail' in error &&
    'path' in error
  ) {
    return error as AppError;
  }
  return {
    code: 'E_UNEXPECTED',
    message: 'Something went wrong and Onboard could not recover.',
    detail: error instanceof Error ? error.message : String(error),
    path: null,
  };
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw toAppError(error);
  }
}

/**
 * The Phase 12 `ai_*` commands do not exist on the Rust side yet — rejecting
 * with the real, honest `E_AI_DISABLED` code (rather than a placeholder
 * `E_NOT_WIRED`) means the AI panels' existing "AI is off" empty states
 * render correctly today, and nothing here needs to change again once
 * Phase 12 registers the real commands.
 */
const AI_NOT_YET_IMPLEMENTED: AppError = {
  code: 'E_AI_DISABLED',
  message: 'Turn on AI in Settings and store a key to use this feature.',
  detail: 'The AI commands land in Phase 12; the master toggle is off until then.',
  path: null,
};

function aiNotYetImplemented<T>(): Promise<T> {
  return Promise.reject(AI_NOT_YET_IMPLEMENTED);
}

/** Subscribes to a Tauri event, tolerating unsubscribe before `listen()` resolves. */
function onEvent<T>(eventName: string, listener: (payload: T) => void): Unsubscribe {
  let unlisten: (() => void) | null = null;
  let isDisposed = false;
  void listen<T>(eventName, (event) => listener(event.payload)).then((stop) => {
    if (isDisposed) {
      stop();
      return;
    }
    unlisten = stop;
  });
  return () => {
    isDisposed = true;
    unlisten?.();
  };
}

export function createTauriIpc(): OnboardIpc {
  return {
    pickRepoFolder: () => call<PickRepoFolderResult>('pick_repo_folder'),

    analyzeRepo: (request: AnalyzeRepoRequest) =>
      call('analyze_repo', { path: request.path, isForceRefresh: request.isForceRefresh }),

    searchRepo: (request) =>
      call('search_repo', { repoId: request.repoId, query: request.query, limit: request.limit }),

    readRepoFile: (request: ReadRepoFileRequest) =>
      call<ReadRepoFileResult>('read_repo_file', { repoId: request.repoId, path: request.path }),

    getSettings: () => call<Settings>('get_settings'),

    updateSettings: (patch: SettingsPatch) => call<Settings>('update_settings', { patch }),

    storeAiKey: (request: StoreAiKeyRequest) =>
      call<StoreAiKeyResult>('store_ai_key', { provider: request.provider, apiKey: request.apiKey }),

    clearAiKey: (request: ClearAiKeyRequest) =>
      call<Record<string, never>>('clear_ai_key', { provider: request.provider }),

    // The ai_* family lands in Phase 12; the signatures exist so OnboardIpc
    // stays satisfied, but every one rejects until then.
    testAiKey: () => aiNotYetImplemented<TestAiKeyResult>(),
    aiProjectSummary: () => aiNotYetImplemented<AiActionResult>(),
    aiExplainModule: () => aiNotYetImplemented<AiActionResult>(),
    aiAsk: () => aiNotYetImplemented<AiActionResult>(),

    onAnalysisProgress: (listener: AnalysisProgressListener): Unsubscribe =>
      onEvent<EngineProgress>('onboard://analysis-progress', listener),
    onAnalysisError: (listener: AnalysisErrorListener): Unsubscribe =>
      onEvent<AppError>('onboard://analysis-error', listener),
    onModeChanged: (listener: ModeChangedListener): Unsubscribe =>
      onEvent<ModeChangedEvent>('onboard://mode-changed', listener),
  };
}
