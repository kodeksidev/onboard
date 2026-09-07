/**
 * Seam guard for the REAL Tauri IPC adapter (`createTauriIpc()`).
 *
 * WHY THIS FILE EXISTS. Every other UI test in this suite runs under
 * `VITE_IPC=mock` (forced in `vitest.config.ts`), so it exercises
 * `mock-ipc.ts` and never touches `tauri-ipc.ts`. Every Rust test exercises
 * the command bodies and never touches the webview. Both halves were green
 * while `aiProjectSummary`/`aiExplainModule`/`aiAsk` in the real adapter were
 * stubs that rejected with a hardcoded `E_AI_DISABLED` — the three AI
 * features were unreachable in the shipped app, and no gate noticed, because
 * nothing tested the SEAM between the halves.
 *
 * So this file tests exactly that seam, and nothing else. It mocks at the
 * `@tauri-apps/api` boundary — the last thing before the webview→Rust
 * bridge — NOT at the app's own IPC layer. That placement is the whole
 * point: a test that mocks `ipc` (or merely asserts `typeof ipc.aiAsk ===
 * 'function'`) passes happily against a stub that never calls Rust at all.
 *
 * Three failures it catches that nothing else did:
 *
 *   1. An UNWIRED method — the stub never reaches `invoke`, so the
 *      "invoked the bridge exactly once" assertion fails.
 *   2. A TYPO'D command name — `ai_project_sumary` would be accepted by
 *      TypeScript (the name is a plain string) and rejected at runtime by
 *      Tauri only on a real machine.
 *   3. A WRONG ARG SHAPE — `{ repo_id }` instead of `{ repoId }`, or a
 *      forgotten field, which Rust rejects as a deserialization error that
 *      no TS type can see.
 *
 * Plus a fourth, structural one: the command names this adapter invokes are
 * compared against the set Rust actually registers in
 * `src-tauri/src/lib.rs`, read as text (the same technique as
 * `module-min-files-drift.test.ts`, and for the same reason — a value
 * transcribed across a boundary no compiler spans is a lie waiting to
 * happen). A command registered in Rust but never invoked here is dead
 * backend work; a command invoked here but not registered there is a
 * runtime rejection on a user's machine.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AppError } from '@onboard/contract';
import type { OnboardIpc } from './ipc';
import { createMockIpc } from './mock-ipc';
import { createTauriIpc } from './tauri-ipc';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

/** A stand-in for whatever the command returns; the adapter must pass it through untouched. */
const BRIDGE_RESULT = { ok: 'bridge-result' } as const;

const REPO_ID = '9f3c1a7b2e5d4086';

interface CommandCase {
  /** The `OnboardIpc` method under test — keyed so the coverage check below can be exhaustive. */
  readonly method: keyof OnboardIpc;
  /** The exact Rust command name that must reach `invoke()`. */
  readonly command: string;
  /** The exact argument object that must reach `invoke()`, camelCase over the wire. */
  readonly args: Record<string, unknown> | undefined;
  readonly call: (ipc: OnboardIpc) => Promise<unknown>;
}

/**
 * Section 7.4's command table, one row per method. Argument objects are
 * written out literally rather than derived from the request, so a silent
 * rename on either side shows up as a diff here instead of passing.
 */
const COMMAND_CASES: readonly CommandCase[] = [
  {
    method: 'pickRepoFolder',
    command: 'pick_repo_folder',
    args: undefined,
    call: (ipc) => ipc.pickRepoFolder(),
  },
  {
    method: 'analyzeRepo',
    command: 'analyze_repo',
    args: { path: '/tmp/repo', isForceRefresh: true },
    call: (ipc) => ipc.analyzeRepo({ path: '/tmp/repo', isForceRefresh: true }),
  },
  {
    method: 'searchRepo',
    command: 'search_repo',
    args: { repoId: REPO_ID, query: 'auth', limit: 50 },
    call: (ipc) => ipc.searchRepo({ repoId: REPO_ID, query: 'auth', limit: 50 }),
  },
  {
    method: 'readRepoFile',
    command: 'read_repo_file',
    args: { repoId: REPO_ID, path: 'src/main.ts' },
    call: (ipc) => ipc.readRepoFile({ repoId: REPO_ID, path: 'src/main.ts' }),
  },
  {
    method: 'getSettings',
    command: 'get_settings',
    args: undefined,
    call: (ipc) => ipc.getSettings(),
  },
  {
    method: 'updateSettings',
    command: 'update_settings',
    args: { patch: { theme: 'dark' } },
    call: (ipc) => ipc.updateSettings({ theme: 'dark' }),
  },
  {
    method: 'getEngineInfo',
    command: 'get_engine_info',
    args: undefined,
    call: (ipc) => ipc.getEngineInfo(),
  },
  {
    method: 'storeAiKey',
    command: 'store_ai_key',
    args: { provider: 'anthropic', apiKey: 'sk-test-not-a-real-key' },
    call: (ipc) => ipc.storeAiKey({ provider: 'anthropic', apiKey: 'sk-test-not-a-real-key' }),
  },
  {
    method: 'clearAiKey',
    command: 'clear_ai_key',
    args: { provider: 'anthropic' },
    call: (ipc) => ipc.clearAiKey({ provider: 'anthropic' }),
  },
  {
    method: 'testAiKey',
    command: 'test_ai_key',
    args: { provider: 'anthropic', model: 'claude-sonnet-4' },
    call: (ipc) => ipc.testAiKey({ provider: 'anthropic', model: 'claude-sonnet-4' }),
  },
  {
    method: 'aiProjectSummary',
    command: 'ai_project_summary',
    args: { repoId: REPO_ID },
    call: (ipc) => ipc.aiProjectSummary({ repoId: REPO_ID }),
  },
  {
    method: 'aiExplainModule',
    command: 'ai_explain_module',
    args: { repoId: REPO_ID, moduleId: 'src/auth' },
    call: (ipc) => ipc.aiExplainModule({ repoId: REPO_ID, moduleId: 'src/auth' }),
  },
  {
    method: 'aiAsk',
    command: 'ai_ask',
    args: { repoId: REPO_ID, question: 'Where is login handled?' },
    call: (ipc) => ipc.aiAsk({ repoId: REPO_ID, question: 'Where is login handled?' }),
  },
];

/** The subscription half of `OnboardIpc` — `listen()`, not `invoke()`. */
interface EventCase {
  readonly method: keyof OnboardIpc;
  readonly eventName: string;
  readonly subscribe: (ipc: OnboardIpc) => () => void;
}

const EVENT_CASES: readonly EventCase[] = [
  {
    method: 'onAnalysisProgress',
    eventName: 'onboard://analysis-progress',
    subscribe: (ipc) => ipc.onAnalysisProgress(() => undefined),
  },
  {
    method: 'onAnalysisError',
    eventName: 'onboard://analysis-error',
    subscribe: (ipc) => ipc.onAnalysisError(() => undefined),
  },
  {
    method: 'onModeChanged',
    eventName: 'onboard://mode-changed',
    subscribe: (ipc) => ipc.onModeChanged(() => undefined),
  },
];

/** Rust's `generate_handler![...]` list, read as text — the other side of the seam. */
const RUST_LIB_RS = resolve(process.cwd(), 'src-tauri', 'src', 'lib.rs');

function readRegisteredRustCommands(): readonly string[] {
  const source = readFileSync(RUST_LIB_RS, 'utf8');
  const handlerBlock = /generate_handler!\[([\s\S]*?)\]/.exec(source);
  expect(
    handlerBlock,
    `no \`generate_handler![...]\` block found in ${RUST_LIB_RS} — was the registration moved? ` +
      'This guard must be updated, not deleted: without it an unwired command ships silently.',
  ).not.toBeNull();
  return [...(handlerBlock?.[1] ?? '').matchAll(/commands::(\w+)/g)].map((match) => match[1] ?? '');
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(BRIDGE_RESULT);
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => undefined);
});

describe('createTauriIpc reaches the Tauri bridge for every command', () => {
  test.each(COMMAND_CASES)(
    '$method invokes `$command` with the documented arguments',
    async ({ command, args, call }) => {
      // Arrange
      const ipc = createTauriIpc();

      // Act
      const result = await call(ipc);

      // Assert — the bridge was crossed exactly once. A method that never
      // calls `invoke` (an unwired stub) fails here first.
      expect(
        invokeMock,
        `\`${command}\` never reached @tauri-apps/api's invoke(). This method does not call Rust at all — ` +
          'it is unwired, and the feature behind it is dead in the shipped app.',
      ).toHaveBeenCalledTimes(1);
      // ...with the exact command name and the exact camelCase arg object.
      expect(invokeMock).toHaveBeenCalledWith(command, args);
      // ...and the adapter returns the bridge's payload untouched.
      expect(result).toBe(BRIDGE_RESULT);
    },
  );

  test.each(EVENT_CASES)('$method subscribes to `$eventName`', ({ eventName, subscribe }) => {
    // Arrange
    const ipc = createTauriIpc();

    // Act
    const unsubscribe = subscribe(ipc);

    // Assert
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith(eventName, expect.any(Function));
    unsubscribe();
  });
});

describe('the seam is covered exhaustively', () => {
  test('every OnboardIpc method has a case above', () => {
    // Arrange — `OnboardIpc` is a type and erased at runtime, so the runtime
    // roster comes from the two implementations that must satisfy it.
    const covered = new Set<string>([
      ...COMMAND_CASES.map((testCase) => testCase.method),
      ...EVENT_CASES.map((testCase) => testCase.method),
    ]);
    const tauriMethods = Object.keys(createTauriIpc()).sort();
    const mockMethods = Object.keys(createMockIpc()).sort();

    // Assert — the two implementations stay interchangeable...
    expect(tauriMethods).toEqual(mockMethods);
    // ...and no method escapes this file. A method added to `OnboardIpc`
    // without a case here would be wired blind, which is how the AI
    // commands shipped dead.
    const uncovered = tauriMethods.filter((method) => !covered.has(method));
    expect(
      uncovered,
      `these OnboardIpc methods have no seam case: ${uncovered.join(', ')}. ` +
        'Add one — a method nothing asserts against the bridge can be a stub forever.',
    ).toEqual([]);
  });
});

describe('adapter/Rust command registration drift guard', () => {
  test('every command the adapter invokes is registered in src-tauri/src/lib.rs, and vice versa', () => {
    // Arrange — a wrong path must fail the test, never silently skip it.
    expect(
      existsSync(RUST_LIB_RS),
      `Rust entrypoint not found at ${RUST_LIB_RS} — this guard would otherwise pass without checking anything`,
    ).toBe(true);

    // Act
    const registered = [...readRegisteredRustCommands()].sort();
    const invoked = COMMAND_CASES.map((testCase) => testCase.command).sort();

    // Assert
    expect(registered.length).toBeGreaterThan(0);
    const notRegistered = invoked.filter((command) => !registered.includes(command));
    expect(
      notRegistered,
      `the webview invokes commands Rust does not register: ${notRegistered.join(', ')}. ` +
        'These reject at runtime on a user machine with "command not found".',
    ).toEqual([]);
    const notInvoked = registered.filter((command) => !invoked.includes(command));
    expect(
      notInvoked,
      `Rust registers commands the webview never invokes: ${notInvoked.join(', ')}. ` +
        'That backend work is unreachable — this is exactly the defect this file was written for.',
    ).toEqual([]);
  });
});

describe('createTauriIpc error normalization across the seam', () => {
  test.each([
    {
      label: 'E_AI_CITATION_REJECTED keeps the offending path the UI renders',
      rejection: {
        code: 'E_AI_CITATION_REJECTED',
        message: 'The model cited a file that is not in this repository.',
        detail: 'cited path not present in the analysed file set',
        path: 'src/does-not-exist.ts',
      },
    },
    {
      label: 'E_AI_DISABLED passes through from the real backend',
      rejection: {
        code: 'E_AI_DISABLED',
        message: 'Turn on AI in Settings and store a key to use this feature.',
        detail: null,
        path: null,
      },
    },
    {
      label: 'E_AI_RATE_LIMITED passes through from the real backend',
      rejection: {
        code: 'E_AI_RATE_LIMITED',
        message: 'The provider is rate limiting this key.',
        detail: 'retry after 30s',
        path: null,
      },
    },
    {
      label: 'E_AI_NETWORK passes through from the real backend',
      rejection: {
        code: 'E_AI_NETWORK',
        message: 'Onboard could not reach the provider.',
        detail: 'connection refused',
        path: null,
      },
    },
  ])('$label', async ({ rejection }) => {
    // Arrange
    invokeMock.mockRejectedValueOnce(rejection);
    const ipc = createTauriIpc();

    // Act + Assert — a serialized Rust `AppError` reaches the store
    // field-for-field, because `aiStore`/`messages.ts` narrow on `.code` and
    // read `.path`. Re-wrapping it as `E_UNEXPECTED` would erase both.
    await expect(ipc.aiAsk({ repoId: REPO_ID, question: 'why?' })).rejects.toEqual(rejection);
  });

  test('a non-AppError rejection is normalized instead of escaping raw', async () => {
    // Arrange
    invokeMock.mockRejectedValueOnce(new TypeError('window.__TAURI_INTERNALS__ is undefined'));
    const ipc = createTauriIpc();

    // Act
    const error: AppError = await ipc
      .aiProjectSummary({ repoId: REPO_ID })
      .then(() => {
        throw new Error('expected aiProjectSummary to reject');
      })
      .catch((caught: AppError) => caught);

    // Assert
    expect(error.code).toBe('E_UNEXPECTED');
    expect(error.detail).toBe('window.__TAURI_INTERNALS__ is undefined');
  });
});
