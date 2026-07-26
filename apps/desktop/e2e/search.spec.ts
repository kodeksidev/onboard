import {
  analyzeFixtureRepo,
  assertEngineActuallyParsed,
  waitForAnalysisToSettle,
} from './support/repo';

/**
 * Section 11: "search 'auth' → click a hit → viewer scrolls to the hit
 * line." The fixture repo (`e2e/fixtures/tiny-repo`) has no auth code, so
 * this searches for `greet` — a real exported symbol declared in
 * `greeter.ts` and referenced in `index.ts` — which exercises the identical
 * "type a query → real `search_repo` round trip → click a hit → file opens
 * at a line" path Section 11 describes.
 */
describe('where is X search', () => {
  before(async () => {
    await analyzeFixtureRepo();
    const status = await waitForAnalysisToSettle();
    if (status !== 'ready') {
      throw new Error(`fixture analysis did not reach ready (status: ${status})`);
    }
    // Reaching `ready` proves the round trip completed, NOT that anything was
    // parsed — a sidecar that fails to load its WASM still reaches `ready`
    // with 0 symbols. Everything below asserts on parsed output, so refuse to
    // proceed on an empty analysis rather than pass vacuously.
    await assertEngineActuallyParsed();
    await $('[role="tablist"][aria-label="Repository views"]').then((tabList) =>
      tabList.waitForDisplayed({ timeout: 15_000 }),
    );
  });

  it('finds a real symbol and opens the file at the matched line', async () => {
    const searchTab = await $('[role="tab"]=Where is X?');
    await searchTab.waitForDisplayed({ timeout: 15_000 });
    await searchTab.click();

    const input = await $('#where-is-search-input');
    await input.waitForDisplayed({ timeout: 15_000 });
    await input.setValue('greet');

    const firstOption = await $('[role="option"]');
    await firstOption.waitForDisplayed({ timeout: 15_000 });

    // The hit must be a SYMBOL match, not a filename match. `greet` also
    // matches `greeter.ts` by basename (Section 8.7 W_FILENAME_SUBSTR), so
    // without this the test passes on an engine that extracted no symbols at
    // all — which is exactly how it passed against a broken sidecar once.
    const rowText = await firstOption.getText();
    expect(rowText).toMatch(/symbol-(exact|prefix|substring)/);
    // SearchResultRow renders the symbol's kind and name only when
    // `hit.symbol !== null`, so this asserts the engine really resolved one.
    expect(rowText).toContain('greet');

    // The open action's accessible name carries the resolved hit line, so
    // asserting on it proves a line was resolved rather than defaulted.
    const openAction = await firstOption.$('[role="button"]');
    const openLabel = await openAction.getAttribute('aria-label');
    expect(openLabel).toMatch(/line \d+/);
    await openAction.click();

    const fileViewerTab = await $('[role="tab"]=File viewer');
    await expect(fileViewerTab).toHaveAttribute('aria-selected', 'true');

    const editor = await $('[aria-label^="File contents:"]');
    await editor.waitForDisplayed({ timeout: 15_000 });
    const text = await editor.getText();
    expect(text).toContain('greet');
  });

  it('reports the expanded/dropped terms so ranking is explainable', async () => {
    // The previous test's result click switched to the "File viewer" tab
    // (`ReadyViewPanel` renders exactly one view at a time), which unmounts
    // `WhereIsSearch` — switch back first.
    const searchTab = await $('[role="tab"]=Where is X?');
    await searchTab.click();

    const input = await $('#where-is-search-input');
    await input.waitForDisplayed({ timeout: 15_000 });
    await input.setValue('db');
    // Section 10: a term under 3 characters is dropped and surfaced, not
    // silently discarded.
    const droppedNotice = await $("p*=Ignored: 'db'");
    await droppedNotice.waitForDisplayed({ timeout: 15_000 });
  });
});
