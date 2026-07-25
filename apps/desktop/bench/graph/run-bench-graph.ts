import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import expandCollapse from 'cytoscape-expand-collapse';
import { buildGraphElements } from '../../src/components/DependencyGraph/graph-model';
import { buildGraphStylesheet } from '../../src/components/DependencyGraph/graph-style';
import { generateSyntheticResult } from './generate-synthetic-graph';

/**
 * `bun run bench:graph` (Section 9 Phase 8's gate).
 *
 * **Read this before trusting a number out of this script.** Phase 8's gate
 * asks for two real-browser measurements: first paint at 1,000 nodes and
 * p95 scripted-pan frame time at 1,000/5,000 nodes. Both require an actual
 * compositor and a real `requestAnimationFrame` loop. This sandbox has
 * neither:
 *   - Vitest's jsdom environment has no working 2D canvas context (no
 *     `canvas` npm package; verified in `useCytoscape.ts`'s
 *     `supportsCanvasRendering()` and its own tests).
 *   - A real, out-of-jsdom browser cannot be launched from this environment
 *     either: `playwright-core` driving the system's installed Microsoft
 *     Edge (`chromium.launch({ executablePath: ... })`) was attempted and
 *     the browser process exited immediately (exit code 255) with the
 *     launch call timing out — logged in docs/DECISIONS.md.
 *
 * So this script does NOT fabricate a first-paint or frame-time number.
 * What it DOES do, genuinely, on whatever machine runs it: build the same
 * deterministic synthetic graphs Phase 11's real (browser-based) bench
 * harness will use, run the real `cytoscape` + `cytoscape-fcose` +
 * `cytoscape-expand-collapse` stack against them **headless**, and report
 * how long element construction + layout actually took. That is a genuine
 * measurement of a real, non-trivial code path — just not the one the
 * acceptance criterion's numbers describe. Phase 11 (Section 11's
 * WebdriverIO + tauri-driver harness) is where the real webview measurement
 * belongs, and where `docs/PRIVACY.md`'s sibling, `bench/budgets.json`,
 * will assert against the actual budgets.
 */

const GRAPH_FIRST_PAINT_BUDGET_MS = 1500;
const GRAPH_PAN_P95_BUDGET_1K_MS = 22;
const GRAPH_PAN_P95_BUDGET_5K_MS = 33;
/**
 * Generous sanity ceiling so a genuine hang (an infinite layout loop) still
 * fails the script. Headless fcose is measured (see the log this script
 * prints) at roughly 2s/1,000 nodes and well over a minute/5,000 nodes on
 * this machine — an order of magnitude slower than real-browser fcose,
 * because cose-base's spatial-grid repulsion optimization degrades without
 * real container dimensions (Section 9 Phase 8, `useCytoscape.ts`'s
 * `buildLayoutOptions`). That gap IS the headless-vs-browser difference
 * this script exists to be honest about, so the ceiling is generous rather
 * than tuned to the (unrepresentative) headless number.
 */
const HEADLESS_SANITY_CEILING_MS = 300_000;

let isRegistered = false;
function registerExtensionsOnce(): void {
  if (isRegistered) {
    return;
  }
  cytoscape.use(fcose);
  cytoscape.use(expandCollapse);
  isRegistered = true;
}

function runHeadlessLayout(nodeCount: number): Promise<number> {
  registerExtensionsOnce();
  const result = generateSyntheticResult(nodeCount);
  const elements = buildGraphElements(result);
  const start = performance.now();
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements: [...elements.nodes, ...elements.edges],
    style: buildGraphStylesheet(),
  });
  return new Promise<number>((resolve) => {
    cy.one('layoutstop', () => {
      const elapsedMs = performance.now() - start;
      cy.destroy();
      resolve(elapsedMs);
    });
    cy.layout({ name: 'fcose', randomize: true, animate: false, tile: false } as cytoscape.LayoutOptions).run();
  });
}

function printDisclosure(): void {
  console.log('=== bench:graph ===');
  console.log('');
  console.log('HONEST DISCLOSURE (see docs/DECISIONS.md): this environment has no working canvas');
  console.log('under Vitest/jsdom and cannot launch a real browser process either (Edge via');
  console.log('playwright-core exited immediately on launch). The two numbers Phase 8\'s gate');
  console.log('names —');
  console.log(`  - first paint <= ${GRAPH_FIRST_PAINT_BUDGET_MS} ms at 1,000 nodes`);
  console.log(
    `  - p95 scripted-pan frame time <= ${GRAPH_PAN_P95_BUDGET_1K_MS} ms at 1,000 nodes / <= ${GRAPH_PAN_P95_BUDGET_5K_MS} ms at 5,000 nodes`,
  );
  console.log('are real-compositor measurements this script cannot produce honestly, so it reports');
  console.log('them here as the target, not as a result, and defers the real measurement to Phase');
  console.log("11's browser-based `bun run bench` (Section 11).");
  console.log('');
  console.log('What this script DOES measure, genuinely: headless cytoscape + cytoscape-fcose +');
  console.log('cytoscape-expand-collapse construction and layout-completion time for the same');
  console.log('deterministic synthetic graphs at the same node counts.');
  console.log('');
}

async function main(): Promise<void> {
  printDisclosure();
  for (const nodeCount of [1000, 5000]) {
    const elapsedMs = await runHeadlessLayout(nodeCount);
    console.log(`nodes=${nodeCount}  headless construct+layout time = ${elapsedMs.toFixed(1)} ms`);
    if (elapsedMs > HEADLESS_SANITY_CEILING_MS) {
      throw new Error(
        `Headless construct+layout at ${nodeCount} nodes took ${elapsedMs.toFixed(1)} ms, exceeding the ${HEADLESS_SANITY_CEILING_MS} ms sanity ceiling.`,
      );
    }
  }
  console.log('');
  console.log('bench:graph finished. No pass/fail claim is made against the real paint/frame budgets above.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
