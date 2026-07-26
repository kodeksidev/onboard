import { analyzeFixtureRepo, waitForAnalysisToSettle } from './support/repo';

/**
 * Section 11: "pick a fixture repo → graph renders → click a node → file
 * opens", continued from `picker.spec.ts`. The graph is Cytoscape canvas
 * (Section 4/A11) with no per-node DOM element, so "click a node" is driven
 * through the documented keyboard interface (Section 9 Phase 8: Tab enters,
 * arrow keys move by importance rank, Enter opens the focused file) rather
 * than a canvas coordinate click, which would be a position guess rather
 * than a real interaction.
 */
describe('dependency graph', () => {
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

  it('renders the graph canvas and opens a file via keyboard navigation', async () => {
    const graphTab = await $('[role="tab"]=Dependency graph');
    await graphTab.waitForDisplayed({ timeout: 15_000 });
    await graphTab.click();

    const canvas = await $('[role="application"]');
    await canvas.waitForDisplayed({ timeout: 15_000 });
    await expect(canvas).toHaveAttribute('tabindex', '0');

    // Focus the graph container the way a keyboard user would (Tab), then
    // move focus onto the highest-importance file (ArrowDown from no
    // selection lands on `orderedPaths[0]` — `keyboard-nav.ts`,
    // unit-tested in `keyboard-nav.test.ts`) and open it.
    await browser.execute((selector: string) => {
      document.querySelector<HTMLElement>(selector)?.focus();
    }, '[role="application"]');
    await browser.keys(['ArrowDown']);
    await browser.keys(['Enter']);

    const fileViewerTab = await $('[role="tab"]=File viewer');
    await expect(fileViewerTab).toHaveAttribute('aria-selected', 'true');

    const editor = await $('[aria-label^="File contents:"]');
    await editor.waitForDisplayed({ timeout: 15_000 });
    const text = await editor.getText();
    expect(text.length).toBeGreaterThan(0);
  });

  it('exposes the same graph data as an accessible table for screen readers', async () => {
    // The previous test's keyboard navigation switched to the "File viewer"
    // tab (`ReadyViewPanel` renders exactly one view at a time), which
    // unmounts `DependencyGraph`/`GraphListFallback` — switch back first.
    const graphTab = await $('[role="tab"]=Dependency graph');
    await graphTab.click();

    // `GraphListFallback` (Section 9 Phase 8): visually hidden, but present
    // in the DOM with one real "Open <path>" action per file.
    await browser.waitUntil(async () => (await $$('table button[type="button"]')).length > 0, {
      timeout: 15_000,
      timeoutMsg: 'expected the GraphListFallback table to render at least one Open button',
    });
    const openButtons = await $$('table button[type="button"]');
    expect(openButtons.length).toBeGreaterThan(0);
  });
});
