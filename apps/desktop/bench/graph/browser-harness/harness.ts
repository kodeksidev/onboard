import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import expandCollapse from 'cytoscape-expand-collapse';
import { buildLazyGraphElements } from '../../../src/components/DependencyGraph/graph-model';
import { createCore, buildLayoutOptions } from '../../../src/components/DependencyGraph/useCytoscape';
import { computeEnteringCollapsedDirectoryPaths } from '../../../src/components/DependencyGraph/collapse';
import { generateSyntheticResult } from '../generate-synthetic-graph';

/**
 * Runs INSIDE a real (headless) browser, driven over CDP by
 * `run-bench-graph.ts` — this is the genuine-measurement half of Section 9
 * Phase 8's `bench:graph`. It reuses the exact production entry points
 * (`createCore`, `buildLayoutOptions`, `computeEnteringCollapsedDirectoryPaths`,
 * `buildLazyGraphElements`) rather than a parallel reimplementation, so a
 * real-browser number here is a number about the shipped code path, not a
 * lookalike.
 */

const PAN_FRAME_COUNT = 60;
const PAN_STEP_PX = 15;

export interface GraphBenchResult {
  readonly nodeCount: number;
  readonly visibleNodeCount: number;
  readonly constructLayoutMs: number;
  readonly firstPaintMs: number;
  readonly panP95Ms: number;
  readonly panFrameDeltasMs: readonly number[];
}

let isRegistered = false;
function registerOnce(): void {
  if (isRegistered) {
    return;
  }
  cytoscape.use(fcose);
  cytoscape.use(expandCollapse);
  isRegistered = true;
}

function waitForAnimationFrame(): Promise<number> {
  return new Promise((resolve) => {
    requestAnimationFrame((timestamp) => resolve(timestamp));
  });
}

function percentile95(sortedAscending: readonly number[]): number {
  if (sortedAscending.length === 0) {
    return 0;
  }
  const index = Math.min(sortedAscending.length - 1, Math.ceil(0.95 * sortedAscending.length) - 1);
  return sortedAscending[index] ?? 0;
}

/**
 * Builds the graph via lazy materialization (the production path: decide
 * the collapsed-directory set FIRST, then build only the visible elements —
 * `collapse.ts` + `graph-model.ts`) and runs the production layout. Returns
 * the live core.
 */
async function buildAndLayout(
  nodeCount: number,
  container: HTMLElement,
): Promise<{ cy: cytoscape.Core; visibleNodeCount: number }> {
  const result = generateSyntheticResult(nodeCount);
  const collapsedDirs = computeEnteringCollapsedDirectoryPaths(result.directories, result.files);
  const elements = buildLazyGraphElements(result, collapsedDirs);

  const cy = createCore(elements, container as HTMLDivElement, true);
  const visibleNodeCount = cy.nodes(':visible').length;

  await new Promise<void>((resolve) => {
    cy.one('layoutstop', () => resolve());
    cy.layout(buildLayoutOptions({ canRender: true, visibleNodeCount })).run();
  });

  return { cy, visibleNodeCount };
}

/** Scripted pan across `PAN_FRAME_COUNT` real rAF ticks; returns per-frame deltas, sorted ascending. */
async function measurePan(cy: cytoscape.Core): Promise<readonly number[]> {
  const deltas: number[] = [];
  let last = await waitForAnimationFrame();
  for (let frame = 0; frame < PAN_FRAME_COUNT; frame += 1) {
    cy.panBy({ x: PAN_STEP_PX, y: 0 });
    const now = await waitForAnimationFrame();
    deltas.push(now - last);
    last = now;
  }
  return [...deltas].sort((a, b) => a - b);
}

async function runGraphBench(nodeCount: number): Promise<GraphBenchResult> {
  registerOnce();
  const container = document.getElementById('cy');
  if (container === null) {
    throw new Error('browser-harness/index.html is missing the #cy container');
  }

  const start = performance.now();
  const { cy, visibleNodeCount } = await buildAndLayout(nodeCount, container);
  const constructLayoutMs = performance.now() - start;
  await waitForAnimationFrame(); // one more real frame: the layout's own paint
  const firstPaintMs = performance.now() - start;

  const panFrameDeltasMs = await measurePan(cy);
  const panP95Ms = percentile95(panFrameDeltasMs);
  cy.destroy();

  return { nodeCount, visibleNodeCount, constructLayoutMs, firstPaintMs, panP95Ms, panFrameDeltasMs };
}

declare global {
  interface Window {
    __runGraphBench: (nodeCount: number) => Promise<GraphBenchResult>;
    __graphBenchReady: boolean;
  }
}

window.__runGraphBench = runGraphBench;
window.__graphBenchReady = true;
