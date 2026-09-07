import type { AnalysisResult } from '@onboard/contract';
import { generateSyntheticResult } from '../bench/graph/generate-synthetic-graph';

/**
 * Stands in for the CacttusEdu report (308 files) this spec exists because
 * of: CacttusEdu itself is not available in this environment. A REAL repo
 * through the real `analyze_repo` path was tried first and abandoned, in
 * this order: the full monorepo root (429 files) hit `E_ANALYSIS_FAILED` /
 * `UNIQUE constraint failed: symbol.id`; `packages/engine` alone (105
 * files, real production TypeScript, no `node_modules` involved) hit the
 * SAME crash. That rules out repo size or `node_modules` as the cause —
 * it is a real, pre-existing parser defect this environment's engine build
 * hits on its own real source, independent of anything this spec is
 * checking. Recorded as its own finding in docs/DECISIONS.md, NOT fixed
 * here — out of scope for a layout regression test, and fixing it was not
 * what this spec was written to verify. `generateSyntheticResult` (also
 * used by `bench:graph`, so this is a second consumer, not a parallel
 * reimplementation) sidesteps analysis entirely: the graph is injected
 * directly into `useRepoStore` via the E2E bridge, so this spec still
 * exercises real production Cytoscape/DOM code on real WebView2 — only the
 * PARSE step is synthetic, which is exactly the boundary this spec does
 * not care about.
 */
const SYNTHETIC_FILE_COUNT = 429;

declare global {
  interface Window {
    __onboardE2E: {
      useRepoStore: {
        setState: (patch: {
          status: string;
          envelope: { schemaVersion: number; result: AnalysisResult };
          error: null;
          progress: null;
        }) => void;
      };
    };
  }
}

/** How many times to tear down and remount the graph tab. The feedback loop this guards against (docs/DECISIONS.md) lands on a DIFFERENT wrong value per mount — a single render proves nothing, only a repeated one does. */
const REMOUNT_COUNT = 8;

/** Small allowance for borders/scrollbar rounding — not a tolerance for the bug, which inflates by 3-6x when it reproduces. */
const CONTAINMENT_TOLERANCE_PX = 4;

interface GraphContainment {
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly availableWidth: number;
  readonly availableHeight: number;
  /**
   * `<main>`'s OWN scroll box, one level up from the mount-div-vs-`<main>`
   * comparison above. That comparison catches overflow that originates in
   * the mount div specifically; it does NOT independently confirm `<main>`
   * itself never needs to scroll at all, which is the more direct read on
   * "is the shell intact" — `<main>` needing to scroll (`scrollWidth` /
   * `scrollHeight` exceeding `clientWidth` / `clientHeight`) is exactly
   * what shifts `ReadyTabList`'s tab strip out of view, since the tab strip
   * and the graph panel are both `<main>`'s scrolled content, not
   * independently clipped.
   */
  readonly mainScrollWidth: number;
  readonly mainScrollHeight: number;
  readonly mainClientWidth: number;
  readonly mainClientHeight: number;
  /**
   * The literal symptom reported live: "Overview, Dependency graph and
   * Start here are clipped off the left." True only if the Overview tab
   * button — always rendered, regardless of which view is selected — is
   * horizontally within `<main>`'s visible viewport right now.
   */
  readonly isOverviewTabVisible: boolean;
}

/**
 * Reads the graph's Cytoscape mount div, its scroll ancestor (`<main>`,
 * both its own box AND its scroll box), and the Overview tab's visibility —
 * the mount div and `<main>`'s box are the same two elements the live
 * devtools reproduction in docs/DECISIONS.md measured by hand; the other
 * two close the "one level up" gap that comparison alone does not cover.
 */
async function measureGraphContainment(): Promise<GraphContainment | null> {
  return browser.execute(() => {
    const container = document.querySelector('[role="application"]');
    const main = document.querySelector('main');
    const overviewTab = [...document.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent === 'Overview',
    );
    if (container === null || main === null || overviewTab === undefined) {
      return null;
    }
    const containerRect = container.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const overviewTabRect = overviewTab.getBoundingClientRect();
    const isOverviewTabVisible = overviewTabRect.right > mainRect.left && overviewTabRect.left < mainRect.right;
    return {
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
      availableWidth: mainRect.width,
      availableHeight: mainRect.height,
      mainScrollWidth: main.scrollWidth,
      mainScrollHeight: main.scrollHeight,
      mainClientWidth: main.clientWidth,
      mainClientHeight: main.clientHeight,
      isOverviewTabVisible,
    };
  });
}

/**
 * Section 9 Phase 8's graph tab, checked for the defect no jsdom-based test
 * can see: jsdom has no layout engine, so a container that measures itself
 * wrong is invisible to all 385 UI tests and 4 axe suites by construction.
 * This spec runs against `tauri-driver`'s real WebView2 session — most of
 * the E2E suite's other specs use that same session for `analyze_repo` →
 * real sidecar round trips; this one uses it for real layout instead, and
 * (see `SYNTHETIC_FILE_COUNT` above) does not also need the real sidecar
 * to do that.
 *
 * What this covers, stated precisely rather than left to be assumed:
 *   1. The Cytoscape mount div does not exceed its immediate parent
 *      (`<main>`) — the original devtools reproduction's own measurement.
 *   2. `<main>` itself never needs to scroll — one level up from (1), and
 *      the more direct read on "is the shell intact" (see
 *      `GraphContainment.mainScrollWidth`'s doc comment for why (1) alone
 *      does not imply this).
 *   3. The Overview tab (leftmost, always rendered) stays horizontally
 *      visible — the literal symptom as reported, not just its cause.
 * All three run against a SYNTHETIC `AnalysisResult` (`SYNTHETIC_FILE_COUNT`
 * above explains why: every real repo tried in this environment hit an
 * unrelated engine crash), injected directly into `useRepoStore` via the
 * `window.__onboardE2E` bridge — bypassing `analyze_repo` and the real
 * sidecar entirely, but exercising real production Cytoscape/DOM code on
 * real WebView2 from that point on. What remains outside this spec: a real
 * repo through the real IPC path at this scale, and CacttusEdu itself
 * rather than a same-order-of-magnitude stand-in — both intentionally left
 * to the smoke checklist, see docs/DECISIONS.md.
 */
describe('dependency graph layout', () => {
  before(async () => {
    const result = generateSyntheticResult(SYNTHETIC_FILE_COUNT);
    await browser.execute((analysisResult: AnalysisResult) => {
      window.__onboardE2E.useRepoStore.setState({
        status: 'ready',
        envelope: { schemaVersion: 1, result: analysisResult },
        error: null,
        progress: null,
      });
    }, result);
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
      // expand-collapse extension's init); wait for `<main>`'s scroll box to
      // stop changing across two consecutive reads, rather than guessing a
      // fixed delay — a still-settling layout produces a small, real, but
      // TRANSIENT overflow that a fixed pause can catch mid-transition and
      // report as a false positive, categorically smaller than the
      // thousands-of-pixels signature the actual feedback loop leaves (see
      // docs/DECISIONS.md) but still worth not conflating with it.
      await browser.waitUntil(
        async () => {
          const first = await browser.execute(() => {
            const main = document.querySelector('main');
            return main === null ? null : [main.scrollWidth, main.scrollHeight];
          });
          await browser.pause(150);
          const second = await browser.execute(() => {
            const main = document.querySelector('main');
            return main === null ? null : [main.scrollWidth, main.scrollHeight];
          });
          return (
            first !== null && second !== null && first[0] === second[0] && first[1] === second[1]
          );
        },
        { timeout: 4_000, interval: 0, timeoutMsg: `mount ${String(mountIndex)}: <main>'s scroll box never settled` },
      );

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
    // which of the 8 failed (and by how much, and on which of the three
    // independent checks) is worth more than a single assertion that stops
    // at the first one.
    const violations = readings
      .map((reading, mountIndex) => ({ mountIndex, reading }))
      .filter(
        ({ reading }) =>
          // The mount div vs. its immediate parent — the original
          // reproduction's measurement.
          reading.containerHeight > reading.availableHeight + CONTAINMENT_TOLERANCE_PX ||
          reading.containerWidth > reading.availableWidth + CONTAINMENT_TOLERANCE_PX ||
          // `<main>` vs. ITSELF — one level up: the shell should never need
          // to scroll at all, regardless of what is inside it.
          reading.mainScrollWidth > reading.mainClientWidth + CONTAINMENT_TOLERANCE_PX ||
          reading.mainScrollHeight > reading.mainClientHeight + CONTAINMENT_TOLERANCE_PX ||
          // The literal symptom: the tab strip must not be scrolled out of view.
          !reading.isOverviewTabVisible,
      );

    expect(violations).toEqual([]);
    expect(readings).toHaveLength(REMOUNT_COUNT);
  });
});
