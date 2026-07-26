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
