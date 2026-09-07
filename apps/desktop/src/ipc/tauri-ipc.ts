import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AppError, EngineProgress } from '@onboard/contract';
import type {
  AiActionResult,
  AiAskRequest,
  AiExplainModuleRequest,
  AiProjectSummaryRequest,
  AnalysisErrorListener,
  AnalysisProgressListener,
  AnalyzeRepoRequest,
  ClearAiKeyRequest,
  EngineInfo,
  ModeChangedEvent,
  ModeChangedListener,
  OnboardIpc,
  PickRepoFolderResult,
  ReadRepoFileRequest,
  ReadRepoFileResult,
  StoreAiKeyRequest,
  StoreAiKeyResult,
  TestAiKeyRequest,
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

/**
 * The three AI FEATURE commands. Rust returns `AiAnswer`, which serializes
 * camelCase field-for-field into `AiActionResult`
 * (`{ markdown, citedPaths, sentFileCount, sentByteCount }`), so no mapping is
 * needed here — and no mapping SHOULD be here, because the whole Section 8.10
 * pipeline (gating, redaction, citation verification, rate limiting) lives
 * behind these commands. A rejection arrives as an already-serialized
 * `AppError` and is passed through by `toAppError` untouched, which is what
 * lets `AiAnswerView` render `E_AI_CITATION_REJECTED`'s `.path` and
 * `messages.ts` narrow on `E_AI_DISABLED` / `E_AI_RATE_LIMITED` /
 * `E_AI_NETWORK`.
 *
 * Split out of `createTauriIpc` only to keep that function under the
 * `max-lines-per-function` limit; they are spread back in below, so
 * `Object.keys(createTauriIpc())` is unchanged and the seam guard in
 * `tauri-ipc.seam.test.ts` still sees every command.
 */
function aiFeatureCommands(): Pick<OnboardIpc, 'aiProjectSummary' | 'aiExplainModule' | 'aiAsk'> {
  return {
    aiProjectSummary: (request: AiProjectSummaryRequest) =>
      call<AiActionResult>('ai_project_summary', { repoId: request.repoId }),

    aiExplainModule: (request: AiExplainModuleRequest) =>
      call<AiActionResult>('ai_explain_module', {
        repoId: request.repoId,
        moduleId: request.moduleId,
      }),

    aiAsk: (request: AiAskRequest) =>
      call<AiActionResult>('ai_ask', { repoId: request.repoId, question: request.question }),
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

    getEngineInfo: () => call<EngineInfo>('get_engine_info'),

    storeAiKey: (request: StoreAiKeyRequest) =>
      call<StoreAiKeyResult>('store_ai_key', {
        provider: request.provider,
        apiKey: request.apiKey,
      }),

    clearAiKey: (request: ClearAiKeyRequest) =>
      call<Record<string, never>>('clear_ai_key', { provider: request.provider }),

    testAiKey: (request: TestAiKeyRequest) =>
      call<TestAiKeyResult>('test_ai_key', { provider: request.provider, model: request.model }),

    ...aiFeatureCommands(),

    onAnalysisProgress: (listener: AnalysisProgressListener): Unsubscribe =>
      onEvent<EngineProgress>('onboard://analysis-progress', listener),
    onAnalysisError: (listener: AnalysisErrorListener): Unsubscribe =>
      onEvent<AppError>('onboard://analysis-error', listener),
    onModeChanged: (listener: ModeChangedListener): Unsubscribe =>
      onEvent<ModeChangedEvent>('onboard://mode-changed', listener),
  };
}
