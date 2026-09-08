import path from 'node:path';
import os from 'node:os';
import { rm } from 'node:fs/promises';
import { build } from 'vite';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import expandCollapse from 'cytoscape-expand-collapse';
import { buildLazyGraphElements } from '../../src/components/DependencyGraph/graph-model';
import { buildLayoutOptions } from '../../src/components/DependencyGraph/useCytoscape';
import { computeEnteringCollapsedDirectoryPaths } from '../../src/components/DependencyGraph/collapse';
import { generateSyntheticResult } from './generate-synthetic-graph';
import type { GraphBenchResult } from './browser-harness/harness';

/**
 * `bun run bench:graph` (Section 9 Phase 8's gate).
 *
 * Drives the machine's installed Microsoft Edge, headless, over the Chrome
 * DevTools Protocol (a plain WebSocket — no Playwright, no browser
 * download): builds `browser-harness/` with Vite, serves it from a local
 * Bun HTTP server, navigates a headless Edge tab to it, and evaluates the
 * harness's exported `window.__runGraphBench(nodeCount)` with
 * `awaitPromise: true`, getting real numbers back directly — no DOM
 * scraping.
 *
 * Why CDP instead of `--dump-dom` or `playwright-core`: `playwright-core`
 * driving this same Edge binary via `executablePath` exits immediately
 * (code 255) on launch — reproducible, not a fluke. `--dump-dom` dumps the
 * DOM the instant `load` fires and never waits for the async layout/pan
 * measurement below; `--virtual-time-budget` does make it wait, but it also
 * starves `requestAnimationFrame` under `--disable-gpu` (a single rAF firing
 * near the very end of the virtual budget instead of every ~16ms) and,
 * without `--disable-gpu`, still failed to ever fire a busy rAF loop to
 * completion in this sandbox. CDP's `Runtime.evaluate` with
 * `awaitPromise: true` runs the whole page in real wall-clock time and
 * blocks on the actual result — no timing model to fight.
 *
 * **Caveats that affect what these numbers are worth (report both, always):**
 *   - Headless Chromium/Edge typically renders via SwiftShader software
 *     rasterization rather than the real WebView2 on-screen compositor, so
 *     frame times here are plausibly pessimistic versus what a user sees.
 *     A PASS under these conditions is strong evidence; a FAIL is not
 *     necessarily a real-world fail.
 *   - This is still not the Tauri webview. Phase 11's `bun run bench`
 *     (Section 11, WebdriverIO + tauri-driver) is the authoritative
 *     measurement; this script is Phase 8's best honest approximation.
 *
 * **What the real numbers say (see docs/DECISIONS.md for the full story):**
 * `useCytoscape.ts` decides the collapsed-directory set BEFORE building any
 * Cytoscape element (`collapse.ts`'s `computeEnteringCollapsedDirectoryPaths`)
 * and then materializes ONLY the elements that will actually be visible
 * (`graph-model.ts`'s `buildLazyGraphElements`) — a directory's descendants
 * are added to the live core on demand, when that directory is expanded
 * (`collapse.ts`'s `expandLazyDirectory`), not up front. Construction cost
 * now scales with what is visible (13 nodes for both the 1,000- and
 * 5,000-file synthetic graphs below, since neither graph's directory count
 * changes with file count), not with `result.files.length`, closing the
 * gap this comment used to describe: first paint used to pass at 1,000
 * nodes but fail at 5,000 purely from building, then instantly hiding,
 * thousands of extra file nodes and edges.
 */

const GRAPH_FIRST_PAINT_BUDGET_MS = 1500;
const GRAPH_PAN_P95_BUDGET_1K_MS = 22;
const GRAPH_PAN_P95_BUDGET_5K_MS = 33;
/**
 * Section 9 Phase 8's two scenarios. Overridable via `BENCH_GRAPH_NODE_COUNTS`
 * (comma-separated) so the INSTRUMENT can be validated independently of the
 * budgets — sweeping the node count is the only way to tell a real renderer
 * cost from a pinned frame source. Not used by the default run.
 */
const BENCH_NODE_COUNTS: readonly number[] = (process.env.BENCH_GRAPH_NODE_COUNTS ?? '1000,5000')
  .split(',')
  .map((raw) => Number.parseInt(raw.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0);

const EDGE_CANDIDATE_PATHS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
] as const;

// #region headless (no-browser) baseline — always available, never fabricated
let isHeadlessRegistered = false;
function registerHeadlessExtensionsOnce(): void {
  if (isHeadlessRegistered) {
    return;
  }
  cytoscape.use(fcose);
  cytoscape.use(expandCollapse);
  isHeadlessRegistered = true;
}

/** Same production entry points as `browser-harness/harness.ts`, run headless (Bun, no canvas, no compositor). */
function runHeadlessConstructAndLayout(nodeCount: number): Promise<{ visibleNodeCount: number; elapsedMs: number }> {
  registerHeadlessExtensionsOnce();
  const result = generateSyntheticResult(nodeCount);
  const collapsedDirs = computeEnteringCollapsedDirectoryPaths(result.directories, result.files);
  const elements = buildLazyGraphElements(result, collapsedDirs);
  const start = performance.now();
  const cy = cytoscape({ headless: true, styleEnabled: true, elements: [...elements.nodes, ...elements.edges] });
  const visibleNodeCount = cy.nodes(':visible').length;
  return new Promise((resolve) => {
    cy.one('layoutstop', () => {
      const elapsedMs = performance.now() - start;
      cy.destroy();
      resolve({ visibleNodeCount, elapsedMs });
    });
    cy.layout(buildLayoutOptions({ canRender: true, visibleNodeCount })).run();
  });
}
// #endregion

// #region real-browser (Edge + CDP) measurement
interface CdpTarget {
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

async function findEdgeExecutable(): Promise<string> {
  for (const candidate of EDGE_CANDIDATE_PATHS) {
    if (await Bun.file(candidate).exists()) {
      return candidate;
    }
  }
  throw new Error(`No Edge executable found at any of: ${EDGE_CANDIDATE_PATHS.join(', ')}`);
}

async function waitForCdp(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // Edge hasn't opened its debugging port yet; keep polling.
    }
    await Bun.sleep(100);
  }
  throw new Error(`Edge's CDP endpoint on port ${port} did not become ready within ${timeoutMs} ms`);
}

async function findBlankTab(port: number): Promise<CdpTarget> {
  const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as CdpTarget[];
  const page = list.find((entry) => entry.url === 'about:blank');
  if (page === undefined) {
    throw new Error('no about:blank tab found on the launched Edge instance');
  }
  return page;
}

interface CdpResponseMessage {
  readonly id?: number;
  readonly result?: unknown;
  readonly error?: { readonly message: string };
}

function cdpSend(ws: WebSocket, id: number, method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent<string>): void => {
      const message = JSON.parse(event.data) as CdpResponseMessage;
      if (message.id !== id) {
        return;
      }
      ws.removeEventListener('message', handler);
      if (message.error !== undefined) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

interface RemoteEvalResult {
  readonly result?: { readonly value?: unknown; readonly description?: string };
  readonly exceptionDetails?: { readonly text: string };
}

async function evaluateExpression(ws: WebSocket, id: number, expression: string): Promise<unknown> {
  const raw = (await cdpSend(ws, id, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })) as RemoteEvalResult;
  if (raw.exceptionDetails !== undefined) {
    throw new Error(`page-side error: ${raw.exceptionDetails.text}`);
  }
  return raw.result?.value;
}

async function buildHarness(): Promise<{ outDir: string; serverPort: number; stopServer: () => void }> {
  const harnessRoot = path.join(import.meta.dir, 'browser-harness');
  const outDir = path.join(os.tmpdir(), `onboard-graph-bench-${Date.now()}`);
  await build({
    root: harnessRoot,
    base: './',
    logLevel: 'error',
    build: { outDir, emptyOutDir: true },
  });
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      const filePath = path.join(outDir, url.pathname === '/' ? '/index.html' : url.pathname);
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
      return new Response('not found', { status: 404 });
    },
  });
  const serverPort = server.port;
  if (serverPort === undefined) {
    throw new Error('Bun.serve() did not report a listening port');
  }
  return { outDir, serverPort, stopServer: () => server.stop(true) };
}

async function runBrowserBench(harnessUrl: string): Promise<readonly GraphBenchResult[]> {
  const edgePath = await findEdgeExecutable();
  const port = 9200 + Math.floor(Math.random() * 300);
  const userDataDir = path.join(os.tmpdir(), `onboard-edge-profile-${Date.now()}`);
  const edgeProcess = Bun.spawn({
    cmd: [
      edgePath,
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--disable-extensions',
      '--disable-sync',
      'about:blank',
    ],
    stdout: 'ignore',
    stderr: 'ignore',
  });

  try {
    await waitForCdp(port, 15000);
    const tab = await findBlankTab(port);
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(undefined));
      ws.addEventListener('error', () => reject(new Error('CDP websocket failed to open')));
    });

    let nextId = 1;
    await cdpSend(ws, nextId++, 'Runtime.enable', {});
    await cdpSend(ws, nextId++, 'Page.navigate', { url: harnessUrl });
    await evaluateExpression(
      ws,
      nextId++,
      'new Promise((resolve) => { const check = () => window.__graphBenchReady ? resolve(true) : setTimeout(check, 50); check(); })',
    );

    const results: GraphBenchResult[] = [];
    for (const nodeCount of BENCH_NODE_COUNTS) {
      const value = await evaluateExpression(ws, nextId++, `window.__runGraphBench(${nodeCount})`);
      results.push(value as GraphBenchResult);
    }
    ws.close();
    return results;
  } finally {
    edgeProcess.kill();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
// #endregion

function printHeader(): void {
  console.log('=== bench:graph ===');
  console.log('');
  console.log(`Target budgets (Section 9 Phase 8): first paint <= ${GRAPH_FIRST_PAINT_BUDGET_MS} ms @ 1,000 nodes;`);
  console.log(
    `p95 pan frame time <= ${GRAPH_PAN_P95_BUDGET_1K_MS} ms @ 1,000 nodes / <= ${GRAPH_PAN_P95_BUDGET_5K_MS} ms @ 5,000 nodes.`,
  );
  console.log('');
}

function printBrowserResult(result: GraphBenchResult): void {
  const paintBudget = GRAPH_FIRST_PAINT_BUDGET_MS;
  const panBudget = result.nodeCount >= 5000 ? GRAPH_PAN_P95_BUDGET_5K_MS : GRAPH_PAN_P95_BUDGET_1K_MS;
  const paintVerdict = result.firstPaintMs <= paintBudget ? 'PASS' : 'FAIL';
  const panVerdict = result.panP95Ms <= panBudget ? 'PASS' : 'FAIL';
  console.log(
    `nodes=${result.nodeCount} (visible in entering view=${result.visibleNodeCount})  ` +
      `constructLayout=${result.constructLayoutMs.toFixed(1)}ms  firstPaint=${result.firstPaintMs.toFixed(1)}ms [budget ${paintBudget}ms: ${paintVerdict}]  ` +
      `panP95=${result.panP95Ms.toFixed(1)}ms [budget ${panBudget}ms: ${panVerdict}]`,
  );
}

interface BrowserBenchOutcome {
  readonly results: readonly GraphBenchResult[] | null;
  readonly failureReason: string | null;
}

/** Builds, serves, and measures the harness in a real Edge instance; always cleans up its temp dir/server/process. */
async function attemptBrowserBench(): Promise<BrowserBenchOutcome> {
  let stopServer: (() => void) | null = null;
  let builtOutDir: string | null = null;
  try {
    const { outDir, serverPort, stopServer: stop } = await buildHarness();
    builtOutDir = outDir;
    stopServer = stop;
    const results = await runBrowserBench(`http://127.0.0.1:${serverPort}/index.html`);
    return { results, failureReason: null };
  } catch (error: unknown) {
    return { results: null, failureReason: error instanceof Error ? error.message : String(error) };
  } finally {
    stopServer?.();
    if (builtOutDir !== null) {
      await rm(builtOutDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function printBrowserCaveat(): void {
  console.log('');
  console.log('Caveat: headless Edge normally rasterizes via SwiftShader (software), not the on-screen WebView2 compositor,');
  console.log('so a PASS above is strong evidence but a FAIL is not necessarily a real-world fail. This is also still not');
  console.log("the Tauri webview — Phase 11's browser-based `bun run bench` (Section 11) remains authoritative.");
}

async function printHeadlessBaseline(): Promise<void> {
  console.log('');
  console.log('--- Headless-only baseline (no browser, no canvas; Bun/JavaScriptCore) — always available ---');
  for (const nodeCount of BENCH_NODE_COUNTS) {
    const { visibleNodeCount, elapsedMs } = await runHeadlessConstructAndLayout(nodeCount);
    console.log(
      `nodes=${nodeCount} (visible in entering view=${visibleNodeCount})  construct+layout=${elapsedMs.toFixed(1)}ms`,
    );
  }
}

async function main(): Promise<void> {
  printHeader();
  console.log('--- Real-browser measurement (headless Microsoft Edge, real requestAnimationFrame, real wall clock) ---');
  console.log('Flags: --headless=new (no --disable-gpu — see docs/DECISIONS.md: it starved requestAnimationFrame here).');

  const { results, failureReason } = await attemptBrowserBench();
  if (results === null) {
    console.log(`Real-browser measurement unavailable: ${failureReason}`);
  } else {
    results.forEach(printBrowserResult);
    printBrowserCaveat();
  }

  await printHeadlessBaseline();

  console.log('');
  console.log(
    results === null
      ? `bench:graph finished WITHOUT a real-browser measurement (${failureReason}); only the headless baseline above is available this run.`
      : 'bench:graph finished with a real-browser measurement — see PASS/FAIL against the target budgets above.',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
