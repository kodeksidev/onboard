import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeFixtureRepo, getAnalysisSubstance, waitForAnalysisToSettle } from './support/repo';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * A repo with real scale, standing in for the CacttusEdu report (308 files)
 * that this spec exists because of: CacttusEdu itself is not available in
 * this environment, so this monorepo's own `apps/`+`packages/` tree (429
 * source files at the time this was written) is used instead — comparable
 * order of magnitude, not the identical repo. `tiny-repo` (the suite's usual
 * fixture, 3-5 files) never exercised enough Cytoscape construction/render
 * passes to land on a badly-inflated measurement even before the fix; see
 * docs/DECISIONS.md's "dependency-graph measurement feedback loop" entry.
 */
const REAL_SCALE_REPO_PATH = path.join(__dirname, '..', '..', '..');

/** How many times to tear down and remount the graph tab. The feedback loop this guards against (docs/DECISIONS.md) lands on a DIFFERENT wrong value per mount — a single render proves nothing, only a repeated one does. */
const REMOUNT_COUNT = 8;

/** Small allowance for borders/scrollbar rounding — not a tolerance for the bug, which inflates by 3-6x when it reproduces. */
const CONTAINMENT_TOLERANCE_PX = 4;

interface GraphContainment {
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly availableWidth: number;
  readonly availableHeight: number;
}

/** Reads the graph's Cytoscape mount div and its scroll ancestor (`<main>`) directly — the same two elements the live devtools reproduction in docs/DECISIONS.md measured by hand. */
async function measureGraphContainment(): Promise<GraphContainment | null> {
  return browser.execute(() => {
    const container = document.querySelector('[role="application"]');
    const main = document.querySelector('main');
    if (container === null || main === null) {
      return null;
    }
    const containerRect = container.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    return {
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
      availableWidth: mainRect.width,
      availableHeight: mainRect.height,
    };
  });
}

/**
 * Section 9 Phase 8's graph tab, checked for the defect no jsdom-based test
 * can see: jsdom has no layout engine, so a container that measures itself
 * wrong is invisible to all 385 UI tests and 4 axe suites by construction.
 * This spec runs against `tauri-driver`'s real WebView2 session — the same
 * class of gap the E2E suite exists to close for `analyze_repo` → real
 * sidecar round trips, applied here to real layout instead.
 */
describe('dependency graph layout', () => {
  before(async () => {
    await analyzeFixtureRepo(REAL_SCALE_REPO_PATH);
    const status = await waitForAnalysisToSettle(120_000);
    if (status !== 'ready') {
      throw new Error(`real-scale repo analysis did not reach ready (status: ${status})`);
    }
    const substance = await getAnalysisSubstance();
    if (substance.edgeCount === 0) {
      throw new Error('real-scale repo produced a graph with zero edges — not a real containment check');
    }
    await $('[role="tablist"][aria-label="Repository views"]').then((tabList) =>
      tabList.waitForDisplayed({ timeout: 15_000 }),
    );
  });

  it(`stays within its available space across ${String(REMOUNT_COUNT)} remounts`, async () => {
    const overviewTab = await $('[role="tab"]=Overview');
    const graphTab = await $('[role="tab"]=Dependency graph');
    const readings: GraphContainment[] = [];

    for (let mountIndex = 0; mountIndex < REMOUNT_COUNT; mountIndex += 1) {
      await graphTab.click();
      const container = await $('[role="application"]');
      await container.waitForDisplayed({ timeout: 15_000 });
      // Cytoscape's own construction/layout passes are async (fcose, the
      // expand-collapse extension's init); give them a beat to run before
      // reading — the loop this guards against needs several of those
      // passes to have already happened to reproduce at all.
      await browser.pause(500);

      const reading = await measureGraphContainment();
      if (reading === null) {
        throw new Error(`mount ${String(mountIndex)}: graph container or <main> not found`);
      }
      readings.push(reading);

      // Tear the graph down (unmounts DependencyGraph, per its useEffect
      // cleanup calling cy.destroy()) so the next iteration is a genuinely
      // fresh Cytoscape construction, not a resize of the existing one.
      await overviewTab.click();
      await browser.pause(150);
    }

    // Report every violating mount, not just the first — the loop this
    // guards against lands on a different wrong value each time, so seeing
    // which of the 8 failed (and by how much) is worth more than a single
    // assertion that stops at the first one.
    const overflowed = readings
      .map((reading, mountIndex) => ({ mountIndex, reading }))
      .filter(
        ({ reading }) =>
          reading.containerHeight > reading.availableHeight + CONTAINMENT_TOLERANCE_PX ||
          reading.containerWidth > reading.availableWidth + CONTAINMENT_TOLERANCE_PX,
      );

    expect(overflowed).toEqual([]);
    expect(readings).toHaveLength(REMOUNT_COUNT);
  });
});
