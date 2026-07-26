import { analyzeFixtureRepo, waitForAnalysisToSettle } from './support/repo';

/**
 * Section 11's first E2E flow: "pick a fixture repo → graph renders → click
 * a node → file opens" starts here with the picker/empty-state and the real
 * `analyze_repo` round trip. The dependency-graph half of that flow is
 * `graph.spec.ts`.
 */
describe('picker', () => {
  it('shows the empty state and the static-mode indicator before any repo is chosen', async () => {
    const heading = await $('h2=No repository open');
    await heading.waitForDisplayed({ timeout: 15_000 });

    // `*=text` matches ANY element whose aggregate text (including all
    // descendants) contains the string — since every ancestor up to
    // <html> also "contains" it transitively, an untagged `*=` selector
    // grabs the outermost ancestor first, not the actual leaf. Scoping to
    // the real tag (`p*=`, `span*=`) selects the element that is actually
    // constrained to just that text, matching how a real user reads it.
    const description = await $('p*=Nothing is uploaded');
    await expect(description).toBeDisplayed();

    // A6: frozen verbatim, byte-exact, and shown whenever AI is off.
    const modeIndicator = await $('span*=🔒 Static mode · no network · nothing leaves this machine');
    await expect(modeIndicator).toBeDisplayed();

    const chooseFolderButton = await $('button=Choose folder');
    await expect(chooseFolderButton).toBeDisplayed();
    await expect(chooseFolderButton).toBeEnabled();
  });

  it('analyzes a real fixture repo end to end: real analyze_repo, real sidecar, rendered overview', async () => {
    // The native OS folder-picker dialog `pickFolder` opens is outside the
    // webview and unreachable from WebDriver (see `e2e/support/repo.ts`'s
    // doc comment) — `analyzeFixtureRepo` drives the exact same
    // `analyze_repo` Tauri command with a known fixture path instead.
    await analyzeFixtureRepo();

    const status = await waitForAnalysisToSettle();
    if (status !== 'ready') {
      // Surface the real AppError in the test report rather than just
      // "expected ready, got error" — this is what actually caught the
      // Rust/React `AppError.message` convention mismatch this suite was
      // built to catch (see docs/DECISIONS.md).
      const error = await browser.execute(() => {
        const bridge = (
          window as unknown as { __onboardE2E: { useRepoStore: { getState: () => { error: unknown } } } }
        ).__onboardE2E;
        return bridge.useRepoStore.getState().error;
      });
      console.log('analyzeFixtureRepo failed:', JSON.stringify(error));
    }
    expect(status).toBe('ready');

    const tabList = await $('[role="tablist"][aria-label="Repository views"]');
    await tabList.waitForDisplayed({ timeout: 15_000 });

    const overviewTab = await $('[role="tab"]=Overview');
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true');

    const graphTab = await $('[role="tab"]=Dependency graph');
    await expect(graphTab).toBeDisplayed();
  });
});
