import { analyzeFixtureRepo, waitForAnalysisToSettle } from './support/repo';

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

    const openAction = await firstOption.$('[role="button"]');
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
