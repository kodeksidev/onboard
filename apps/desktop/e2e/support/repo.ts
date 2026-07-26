import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Small, deterministic fixture repo analyzed by the E2E suite (Section 11). */
export const TINY_REPO_PATH = path.join(__dirname, '..', 'fixtures', 'tiny-repo');

export type RepoStatus = 'empty' | 'picking' | 'analyzing' | 'ready' | 'error';

/**
 * Drives a real `analyze_repo` → real sidecar → real `AnalysisEnvelope` →
 * rendered-UI round trip via the Phase 11 E2E bridge (`window.__onboardE2E`,
 * `src/main.tsx`), bypassing only the native OS folder-picker dialog itself
 * (unreachable from WebDriver — see `e2e/picker.spec.ts`).
 */
export async function analyzeFixtureRepo(repoPath: string = TINY_REPO_PATH): Promise<void> {
  await browser.execute((analyzedPath: string) => {
    const bridge = (
      window as unknown as {
        __onboardE2E: { useRepoStore: { getState: () => { analyzePath: (p: string) => Promise<void> } } };
      }
    ).__onboardE2E;
    void bridge.useRepoStore.getState().analyzePath(analyzedPath);
  }, repoPath);
}

export async function getRepoStatus(): Promise<RepoStatus> {
  return browser.execute(() => {
    const bridge = (window as unknown as { __onboardE2E: { useRepoStore: { getState: () => { status: string } } } })
      .__onboardE2E;
    return bridge.useRepoStore.getState().status as RepoStatus;
  });
}

export interface AnalysisSubstance {
  readonly symbolCount: number;
  readonly edgeCount: number;
  readonly filesParsed: number;
  readonly parseFailedCount: number;
}

/**
 * Reads what the analysis ACTUALLY produced, not merely that it finished.
 *
 * This exists because of a real incident: the staged sidecar silently failed to
 * load tree-sitter's core WASM, degraded every file to PARSE_FAILED, and still
 * returned a structurally valid AnalysisEnvelope with 0 symbols and 0 edges.
 * The whole E2E suite passed green against that binary — including a test named
 * "finds a real symbol" — because a query like `greet` still matched
 * `greeter.ts` by FILENAME (Section 8.7's W_FILENAME_SUBSTR) and the file
 * viewer renders raw bytes from `read_repo_file`, which needs no parsing at all.
 *
 * Every spec that claims to exercise parsed output must assert on this, so
 * "the app rendered something" can never again be mistaken for "the engine
 * worked".
 */
export async function getAnalysisSubstance(): Promise<AnalysisSubstance> {
  return browser.execute(() => {
    const bridge = (
      window as unknown as {
        __onboardE2E: {
          useRepoStore: {
            getState: () => {
              envelope: {
                result: {
                  symbols: readonly unknown[];
                  edges: readonly unknown[];
                  stats: { filesParsed: number };
                  diagnostics: readonly { code: string }[];
                };
              } | null;
            };
          };
        };
      }
    ).__onboardE2E;
    const envelope = bridge.useRepoStore.getState().envelope;
    if (envelope === null) {
      return { symbolCount: 0, edgeCount: 0, filesParsed: 0, parseFailedCount: 0 };
    }
    const { symbols, edges, stats, diagnostics } = envelope.result;
    return {
      symbolCount: symbols.length,
      edgeCount: edges.length,
      filesParsed: stats.filesParsed,
      parseFailedCount: diagnostics.filter((d) => d.code === 'PARSE_FAILED').length,
    };
  });
}

/**
 * Fails loudly when the engine produced a structurally valid but meaningless
 * result. Call this in a `before` hook before asserting on anything derived
 * from parsing (symbols, graph edges, roadmap, search-by-symbol).
 */
export async function assertEngineActuallyParsed(): Promise<AnalysisSubstance> {
  const substance = await getAnalysisSubstance();
  if (substance.symbolCount === 0 || substance.edgeCount === 0) {
    throw new Error(
      'Engine returned a valid but EMPTY analysis: ' +
        `symbols=${String(substance.symbolCount)}, edges=${String(substance.edgeCount)}, ` +
        `filesParsed=${String(substance.filesParsed)}, PARSE_FAILED=${String(substance.parseFailedCount)}. ` +
        'The sidecar most likely failed to load its tree-sitter WASM (check for ' +
        '"ENOENT ... tree-sitter.wasm" on stderr) and degraded silently. ' +
        'Re-run `bun run build:sidecar` then `bun run stage:sidecar`.',
    );
  }
  if (substance.parseFailedCount > 0) {
    throw new Error(
      `Engine reported ${String(substance.parseFailedCount)} PARSE_FAILED diagnostics on a fixture ` +
        'that is expected to parse cleanly.',
    );
  }
  return substance;
}

/** Polls `getRepoStatus()` until it reaches `ready` or `error`, or times out. */
export async function waitForAnalysisToSettle(timeoutMs = 60_000): Promise<RepoStatus> {
  await browser.waitUntil(
    async () => {
      const status = await getRepoStatus();
      return status === 'ready' || status === 'error';
    },
    { timeout: timeoutMs, timeoutMsg: 'analysis did not reach ready/error in time', interval: 250 },
  );
  return getRepoStatus();
}
