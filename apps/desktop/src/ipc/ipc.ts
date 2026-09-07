import { AppError } from '@onboard/contract';
import type {
  AnalysisEnvelope,
  EngineProgress,
  EngineReadFileResult,
  SearchRequest,
  SearchResponse,
} from '@onboard/contract';
import type { Settings, SettingsPatch } from './settings-schema';
import { createMockIpc } from './mock-ipc';
import { createTauriIpc } from './tauri-ipc';

/**
 * The one typed IPC interface (Section 9 Phase 7). Its shape is Section
 * 7.4's Tauri command table, transcribed one command per method — nothing
 * added, nothing renamed. `mock-ipc.ts` (fixture-backed) and `tauri-ipc.ts`
 * (real, wired from Phase 11) are interchangeable implementations selected
 * by `resolveIpcMode()`.
 */

export interface AnalyzeRepoRequest {
  readonly path: string;
  readonly isForceRefresh: boolean;
}

export interface PickRepoFolderResult {
  readonly path: string | null;
}

export interface ReadRepoFileRequest {
  readonly repoId: string;
  readonly path: string;
}

/** `read_repo_file`'s response shape is identical to the sidecar's `engine.readFile` result. */
export type ReadRepoFileResult = EngineReadFileResult;

export type AiProviderName = 'anthropic' | 'ollama';

export interface StoreAiKeyRequest {
  readonly provider: AiProviderName;
  readonly apiKey: string;
}

export interface StoreAiKeyResult {
  readonly isStored: boolean;
  readonly isSessionOnly: boolean;
}

export interface ClearAiKeyRequest {
  readonly provider: AiProviderName;
}

export interface TestAiKeyRequest {
  readonly provider: AiProviderName;
  readonly model: string;
}

export interface TestAiKeyResult {
  readonly isOk: true;
  readonly latencyMs: number;
  readonly modelEcho: string;
}

export interface AiActionResult {
  readonly markdown: string;
  readonly citedPaths: readonly string[];
  readonly sentFileCount: number;
  readonly sentByteCount: number;
}

export interface AiProjectSummaryRequest {
  readonly repoId: string;
}

export interface AiExplainModuleRequest {
  readonly repoId: string;
  readonly moduleId: string;
}

export interface AiAskRequest {
  readonly repoId: string;
  readonly question: string;
}

export interface ModeChangedEvent {
  readonly isEnabled: boolean;
  readonly provider: AiProviderName | null;
  readonly model: string | null;
}

export type AnalysisProgressListener = (event: EngineProgress) => void;
export type AnalysisErrorListener = (event: AppError) => void;
export type ModeChangedListener = (event: ModeChangedEvent) => void;
export type Unsubscribe = () => void;

/**
 * `null` for the three engine fields until the sidecar has answered
 * `engine.version` at least once (before any analysis, or if the binary
 * was never found) — kept distinct from "unknown"/a stale placeholder so a
 * user comparing this against a bug report can tell those two states
 * apart. Read-only: this surfaces what `engine.version` already told the
 * shell, which nothing currently acts on beyond the frozen
 * `contractSchemaVersion` check (Section 7.3's `E_ENGINE_VERSION_MISMATCH`)
 * — see docs/DECISIONS.md ("engine.version was answered and discarded").
 */
export interface EngineInfo {
  readonly appVersion: string;
  readonly engineVersion: string | null;
  readonly contractSchemaVersion: number | null;
  readonly grammarFingerprint: string | null;
}

/**
 * Every method whose result can fail (Section 7.4's "Error codes" column)
 * rejects its Promise with a plain object conforming to `AppError` — never a
 * thrown `Error` instance and never a raw provider/OS error string (Section
 * 12). Callers narrow with `parseIpcError`.
 */
export interface OnboardIpc {
  pickRepoFolder(): Promise<PickRepoFolderResult>;
  analyzeRepo(request: AnalyzeRepoRequest): Promise<AnalysisEnvelope>;
  searchRepo(request: SearchRequest): Promise<SearchResponse>;
  readRepoFile(request: ReadRepoFileRequest): Promise<ReadRepoFileResult>;
  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  getEngineInfo(): Promise<EngineInfo>;
  storeAiKey(request: StoreAiKeyRequest): Promise<StoreAiKeyResult>;
  clearAiKey(request: ClearAiKeyRequest): Promise<Record<string, never>>;
  testAiKey(request: TestAiKeyRequest): Promise<TestAiKeyResult>;
  aiProjectSummary(request: AiProjectSummaryRequest): Promise<AiActionResult>;
  aiExplainModule(request: AiExplainModuleRequest): Promise<AiActionResult>;
  aiAsk(request: AiAskRequest): Promise<AiActionResult>;
  onAnalysisProgress(listener: AnalysisProgressListener): Unsubscribe;
  onAnalysisError(listener: AnalysisErrorListener): Unsubscribe;
  onModeChanged(listener: ModeChangedListener): Unsubscribe;
}

export type IpcMode = 'mock' | 'tauri';

/** Selected by `VITE_IPC=mock` (Section 9 Phase 7's gate). Anything else is real Tauri IPC. */
export function resolveIpcMode(): IpcMode {
  return import.meta.env.VITE_IPC === 'mock' ? 'mock' : 'tauri';
}

export function createIpc(mode: IpcMode = resolveIpcMode()): OnboardIpc {
  return mode === 'mock' ? createMockIpc() : createTauriIpc();
}

/**
 * A rejection from an `OnboardIpc` method should always be an `AppError`
 * (Section 7's error envelope). If it is not — a thrown `TypeError`, a
 * network-layer exception, anything that slipped past the boundary — that
 * is itself a contract violation, so it is normalized into a generic
 * `AppError` rather than allowed to render raw (Section 12: never show an
 * OS error string or a stack trace to the user).
 */
export function parseIpcError(error: unknown): AppError {
  const parsed = AppError.safeParse(error);
  if (parsed.success) {
    return parsed.data;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return {
    code: 'E_UNEXPECTED',
    message: 'Something went wrong and Onboard could not recover.',
    detail,
    path: null,
  };
}

export const ipc: OnboardIpc = createIpc();
