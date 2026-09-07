import { AnalysisEnvelope } from '@onboard/contract';
import type { AppError, EngineProgress } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { DEFAULT_SETTINGS } from './settings-schema';
import type { Settings, SettingsPatch } from './settings-schema';
import { buildSearchResponse } from './mock-search';
import {
  BENCH_LARGE_FILE_LINE_COUNT,
  BENCH_LARGE_FILE_PATH,
  buildBenchLargeFileContent,
} from './mock-bench-file';
import { ERRORS } from '../copy/messages';
import type {
  AiActionResult,
  AnalysisErrorListener,
  AnalysisProgressListener,
  EngineInfo,
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

/**
 * `VITE_IPC=mock` implementation (Section 9 Phase 7): serves the frozen
 * `sample-analysis.json` fixture with no Tauri, no sidecar, and no network
 * call of any kind, so the whole UI renders and is testable in isolation
 * (Section 5: "Given an AnalysisResult fixture it renders fully with no
 * shell and no engine"). Parsed once through the real zod schema at module
 * load, so a drifted fixture fails loudly here rather than in a component.
 *
 * State lives in a single mutable `MockIpcState` cell per `createMockIpc()`
 * call (there is exactly one instance per app, like the real Tauri backend
 * process). Every *value* stored in it is still replaced immutably — only
 * the cell's field pointers are reassigned, the same pattern `zustand`
 * itself uses internally — so this file stays free of in-place mutation of
 * the settings/listener arrays it hands out.
 */
const SAMPLE_ENVELOPE: AnalysisEnvelope = AnalysisEnvelope.parse(rawSampleAnalysis);
const MOCK_REPO_PATH = '/mock/acme-billing-api';
/** No real sidecar handshake happens in mock mode, so this is fixed rather than state-dependent — good enough to exercise the UI, not a substitute for `get_engine_info`'s real null-until-handshake behavior. */
const MOCK_ENGINE_INFO: EngineInfo = {
  appVersion: '0.0.0-mock',
  engineVersion: '0.0.0-mock',
  contractSchemaVersion: 1,
  grammarFingerprint: '0'.repeat(16),
};
const PROGRESS_PHASES = ['walk', 'parse', 'resolve', 'graph', 'rank', 'persist'] as const;
const MOCK_TEST_KEY_LATENCY_MS = 42;
/** Stands in for the real snippet payload's size (Section 8.9's caps apply on the Rust side). */
const MOCK_SENT_BYTES_PER_FILE = 2_048;

interface MockIpcState {
  progressListeners: AnalysisProgressListener[];
  errorListeners: AnalysisErrorListener[];
  modeListeners: ModeChangedListener[];
  settings: Settings;
}

function createState(): MockIpcState {
  return {
    progressListeners: [],
    errorListeners: [],
    modeListeners: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

function buildProgressEvents(total: number): readonly EngineProgress[] {
  return PROGRESS_PHASES.map((phase, index) => ({
    phase,
    processed: Math.round((total * (index + 1)) / PROGRESS_PHASES.length),
    total,
    currentPath: null,
  }));
}

function rejectWith(appError: AppError): Promise<never> {
  return Promise.reject(appError);
}

function findFile(path: string) {
  return SAMPLE_ENVELOPE.result.files.find((file) => file.path === path) ?? null;
}

function buildSyntheticFileContent(lineCount: number, path: string): string {
  const lines = Array.from(
    { length: lineCount },
    (_unused, index) => `// ${path}:${index + 1} (mock content — sidecar not wired until Phase 11)`,
  );
  return lines.join('\n');
}

async function analyzeRepo(state: MockIpcState): Promise<AnalysisEnvelope> {
  const total = SAMPLE_ENVELOPE.result.stats.filesScanned;
  for (const event of buildProgressEvents(total)) {
    state.progressListeners.forEach((listener) => listener(event));
    await Promise.resolve();
  }
  return SAMPLE_ENVELOPE;
}

async function readRepoFile(request: ReadRepoFileRequest): Promise<ReadRepoFileResult> {
  if (request.path === BENCH_LARGE_FILE_PATH) {
    return {
      path: BENCH_LARGE_FILE_PATH,
      language: 'ts',
      lineCount: BENCH_LARGE_FILE_LINE_COUNT,
      isTruncated: false,
      content: buildBenchLargeFileContent(),
    };
  }
  const file = findFile(request.path);
  if (file === null) {
    return rejectWith({
      code: 'E_PATH_ESCAPES_REPO',
      message: 'That file is not part of this repository.',
      detail: `No indexed file at ${request.path}`,
      path: request.path,
    });
  }
  return {
    path: file.path,
    language: file.language,
    lineCount: file.lineCount,
    isTruncated: false,
    content: buildSyntheticFileContent(file.lineCount, file.path),
  };
}

function updateSettings(state: MockIpcState, patch: SettingsPatch): Settings {
  state.settings = {
    ...state.settings,
    ...patch,
    ai: { ...state.settings.ai, ...patch.ai },
  };
  return state.settings;
}

function storeAiKey(state: MockIpcState, request: StoreAiKeyRequest): StoreAiKeyResult {
  state.settings = {
    ...state.settings,
    ai: { ...state.settings.ai, hasStoredKey: true, provider: request.provider },
  };
  return { isStored: true, isSessionOnly: false };
}

function clearAiKey(state: MockIpcState): Record<string, never> {
  state.settings = { ...state.settings, ai: { ...state.settings.ai, hasStoredKey: false } };
  return {};
}

/**
 * Mirrors the Rust side's provider-aware credential rule (Phase 12 step 5:
 * `AiProvider::requires_stored_key` — Ollama is local/unauthenticated and
 * needs no key; Anthropic does). `message` is the long
 * Section 10 description (Section 12's convention, identical to how the
 * real backend builds `AppError.message` — `resolveErrorCopy` treats it as
 * the description, never re-deriving it from the title).
 */
async function testAiKey(state: MockIpcState, request: TestAiKeyRequest): Promise<TestAiKeyResult> {
  const requiresStoredKey = request.provider !== 'ollama';
  if (requiresStoredKey && !state.settings.ai.hasStoredKey) {
    return rejectWith({
      code: 'E_AI_KEY_INVALID',
      message: ERRORS.aiKeyInvalid(request.provider).description,
      detail: `${request.provider} returned 401.`,
      path: null,
    });
  }
  return { isOk: true, latencyMs: MOCK_TEST_KEY_LATENCY_MS, modelEcho: request.model };
}

/**
 * The provider-aware gate the Rust side enforces (`ai::permit`, Section 10's
 * "AI toggle on, no key stored" row): every `ai_*` command is `E_AI_DISABLED`
 * while the master toggle is off or a credentialed provider has no key. The
 * mock enforces it too, so the UI's gating is exercised against the same
 * refusal in development that it will meet in production.
 */
function aiPermitError(state: MockIpcState): AppError | null {
  const { isEnabled, provider, hasStoredKey } = state.settings.ai;
  if (isEnabled && (provider === 'ollama' || hasStoredKey)) {
    return null;
  }
  return {
    code: 'E_AI_DISABLED',
    message: ERRORS.aiDisabled().description,
    detail: null,
    path: null,
  };
}

/**
 * Builds a fixture answer whose citations are, by construction, exactly the
 * paths in `citedPaths` — the same invariant Section 8.10's verifier
 * guarantees in production. The mock never emits a `[[…]]` token for a path
 * it does not also return as cited, because the UI is entitled to assume the
 * backend already rejected any answer where that was untrue.
 */
function buildAiAnswer(markdown: string, citedPaths: readonly string[]): AiActionResult {
  return {
    markdown,
    citedPaths,
    sentFileCount: citedPaths.length,
    sentByteCount: citedPaths.length * MOCK_SENT_BYTES_PER_FILE,
  };
}

function topPaths(count: number): readonly string[] {
  const ranked = [
    ...SAMPLE_ENVELOPE.result.importantFilePaths,
    ...SAMPLE_ENVELOPE.result.entryPoints.map((entry) => entry.path),
  ];
  return [...new Set(ranked)].slice(0, count);
}

async function aiProjectSummary(state: MockIpcState): Promise<AiActionResult> {
  const permitError = aiPermitError(state);
  if (permitError !== null) {
    return rejectWith(permitError);
  }
  const paths = topPaths(3);
  const markdown = [
    '## What this project is',
    '',
    `${SAMPLE_ENVELOPE.result.repo.name} is a ${SAMPLE_ENVELOPE.result.repo.detectedType}.`,
    '',
    ...paths.map((path, index) => `${index + 1}. Start at [[${path}:1]].`),
  ].join('\n');
  return buildAiAnswer(markdown, paths);
}

async function aiExplainModule(state: MockIpcState, moduleId: string): Promise<AiActionResult> {
  const permitError = aiPermitError(state);
  if (permitError !== null) {
    return rejectWith(permitError);
  }
  const module = SAMPLE_ENVELOPE.result.modules.find((candidate) => candidate.id === moduleId);
  if (module === undefined) {
    return rejectWith({
      code: 'E_UNEXPECTED',
      message: 'That module is not part of the analysed repository.',
      detail: `No module with id ${moduleId}`,
      path: null,
    });
  }
  const paths = module.keyFilePaths.slice(0, 2);
  const markdown = [
    `## ${module.name}`,
    '',
    `${module.purposeByConvention} It holds ${module.fileCount} analysed files under \`${module.dirPath}\`.`,
    '',
    ...paths.map((path) => `- [[${path}:1]] is one of its key files.`),
  ].join('\n');
  return buildAiAnswer(markdown, paths);
}

async function aiAsk(state: MockIpcState, question: string): Promise<AiActionResult> {
  const permitError = aiPermitError(state);
  if (permitError !== null) {
    return rejectWith(permitError);
  }
  const paths = topPaths(2);
  const markdown = [
    `**${question}**`,
    '',
    `The most relevant files for that are below.`,
    '',
    ...paths.map((path) => `- [[${path}:1]]`),
  ].join('\n');
  return buildAiAnswer(markdown, paths);
}

function addListener<T>(listeners: T[], listener: T): T[] {
  return [...listeners, listener];
}

function removeListener<T>(listeners: T[], listener: T): T[] {
  return listeners.filter((existing) => existing !== listener);
}

export function createMockIpc(): OnboardIpc {
  const state = createState();

  return {
    pickRepoFolder: async (): Promise<PickRepoFolderResult> => ({ path: MOCK_REPO_PATH }),
    analyzeRepo: () => analyzeRepo(state),
    searchRepo: async (request) => buildSearchResponse(SAMPLE_ENVELOPE.result, request),
    readRepoFile,
    getSettings: async () => state.settings,
    updateSettings: async (patch) => updateSettings(state, patch),
    getEngineInfo: async () => MOCK_ENGINE_INFO,
    storeAiKey: async (request) => storeAiKey(state, request),
    clearAiKey: async () => clearAiKey(state),
    testAiKey: (request) => testAiKey(state, request),
    aiProjectSummary: () => aiProjectSummary(state),
    aiExplainModule: (request) => aiExplainModule(state, request.moduleId),
    aiAsk: (request) => aiAsk(state, request.question),
    onAnalysisProgress: (listener): Unsubscribe => {
      state.progressListeners = addListener(state.progressListeners, listener);
      return () => {
        state.progressListeners = removeListener(state.progressListeners, listener);
      };
    },
    onAnalysisError: (listener): Unsubscribe => {
      state.errorListeners = addListener(state.errorListeners, listener);
      return () => {
        state.errorListeners = removeListener(state.errorListeners, listener);
      };
    },
    onModeChanged: (listener): Unsubscribe => {
      state.modeListeners = addListener(state.modeListeners, listener);
      return () => {
        state.modeListeners = removeListener(state.modeListeners, listener);
      };
    },
  };
}
