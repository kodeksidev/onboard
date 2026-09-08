import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import expandCollapse from 'cytoscape-expand-collapse';
import type { AnalysisResult } from '@onboard/contract';
import { buildGraphStylesheet } from './graph-style';
import { buildLazyGraphElements, fileNodeId } from './graph-model';
import type { GraphElements } from './graph-model';
import {
  GRAPH_ENTERING_VIEW_MAX_NODES,
  collapseLazyDirectory,
  computeEnteringCollapsedDirectoryPaths,
  createNoopExpandCollapseApi,
  expandLazyDirectory,
  getExpandCollapseApi,
  reconcileLazyElements,
  revealPath,
} from './collapse';
import type { ExpandCollapseApi } from './collapse';
import { applyDetailLevel } from './detail-level';
import { layoutBoundingBox, packTopLevelIfUnforced, readableNodeBudget } from './pack-layout';

/** A11's pixel-ratio performance rule (Phase 8's paragraph). */
const GRAPH_PIXEL_RATIO_NODE_THRESHOLD = 2000;
const FOCUS_ANIMATION_DURATION_MS = 300;

/**
 * What is left of Phase 8's `GRAPH_AUTO_COLLAPSE_THRESHOLD = 600`
 * (amendment, 2026-09-08 — docs/DECISIONS.md). It no longer decides whether
 * to collapse — the entering view is always collapsed
 * (`computeEnteringCollapsedDirectoryPaths`) — but it still names the point
 * past which fcose's iterative refinement costs more than it is worth and
 * the layout drops to one spectral pass. A graph only gets this big now by
 * the user deliberately expanding into it.
 */
const GRAPH_DRAFT_LAYOUT_NODE_THRESHOLD = 600;

/** Deterministic placement ring for newly materialized children; no Math.random anywhere in the render path. */
const GOLDEN_ANGLE_RADIANS = 2.399963;
const NEW_NODE_SEED_RADIUS_PX = 45;

/** Breathing room around the entering view so its outermost boxes aren't flush against the panel edge. */
const ENTERING_VIEW_FIT_PADDING_PX = 40;

/**
 * How many nodes the entering view may show: the spec-level ceiling, or what
 * this panel can render legibly, whichever is smaller.
 *
 * The ceiling alone was not enough. It assumed a roughly square canvas; a
 * letterbox panel fits the same node count at a much lower zoom, and below
 * `GRAPH_MIN_READABLE_ZOOM` the labels are drawn but cannot be read. The
 * collapsed view exists so it can be READ, so when the panel cannot show the
 * ceiling legibly it shows fewer nodes rather than smaller ones. A container
 * of zero (the graph is built before the panel is laid out) yields the
 * ceiling, and the settle step re-fits once the real size is known.
 */
function enteringViewBudget(containerWidth: number, containerHeight: number): number {
  return Math.min(GRAPH_ENTERING_VIEW_MAX_NODES, readableNodeBudget(containerWidth, containerHeight));
}

let isExtensionsRegistered = false;

/** Idempotent: `cytoscape.use()` a second time on the same extension throws. */
export function registerCytoscapeExtensions(): void {
  if (isExtensionsRegistered) {
    return;
  }
  cytoscape.use(fcose);
  cytoscape.use(expandCollapse);
  isExtensionsRegistered = true;
}

/**
 * True only in a real browser/webview with a working 2D canvas context.
 * False under Vitest + jsdom (no `canvas` package) — the one, honest
 * environment gap called out in Section 9 Phase 7/8: this is a test-only
 * fallback, never exercised by the shipped desktop app.
 */
export function supportsCanvasRendering(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return document.createElement('canvas').getContext('2d') !== null;
}

/** Exported so `bench/graph`'s browser harness constructs the core identically to production. */
export function createCore(
  elements: GraphElements,
  container: HTMLDivElement | null,
  canRender: boolean,
): cytoscape.Core {
  return cytoscape({
    container: canRender ? container : null,
    headless: !canRender,
    elements: [...elements.nodes, ...elements.edges],
    style: buildGraphStylesheet(),
    hideEdgesOnViewport: true,
    textureOnViewport: true,
    pixelRatio: elements.nodes.length > GRAPH_PIXEL_RATIO_NODE_THRESHOLD ? 1 : 'auto',
  });
}

/**
 * `visibleNodeCount` is measured AFTER collapse, not from
 * the raw `AnalysisResult`: `initializeGraph` decides the collapsed-directory
 * set and builds ONLY the resulting visible elements (`collapse.ts`'s
 * `computeEnteringCollapsedDirectoryPaths` + `graph-model.ts`'s
 * `buildLazyGraphElements`) before ever calling this, so a layout only ever
 * arranges what actually exists in the graph, not what exists-then-gets-hidden.
 * `quality: 'draft'` is the safety net for a graph the user has deliberately
 * expanded past `GRAPH_DRAFT_LAYOUT_NODE_THRESHOLD` — it skips fcose's
 * iterative refinement in favor of one spectral pass, trading layout quality
 * for bounded cost (see docs/DECISIONS.md for the measurements).
 *
 * Exported (with its input type) so `bench/graph`'s harness lays out with the
 * exact options production uses — no parallel copy to drift.
 *
 * **`animate: false`, unconditionally.** An ANIMATED fcose run does not
 * reliably terminate on the graphs this app produces: it emits `layoutstart`
 * and `layoutready` and then never `layoutstop`. Measured live on CacttusEdu
 * twice — first on the entering view (11 visible nodes, 0 visible edges,
 * still nothing after 9 seconds; the same graph with `animate: false`
 * completes and fires all three), then again on a drill step that HAD edges,
 * which is what killed the narrower "animate only when `visibleEdgeCount > 0`"
 * rule tried first. What these graphs share is a top level with no edges
 * across it, and there is no cheap predicate for "will fcose converge".
 * Everything downstream waits on `layoutstop` — `isReady`, the entering-view
 * fit, the packing pass, reveal-then-center — so a non-terminating layout
 * silently hangs all of them.
 *
 * This is not a corner case: a monorepo of independent workspaces has no
 * cross-directory imports at all (all 1,227 of CacttusEdu's live inside a
 * single top-level directory). Dropping the animation entirely costs a brief
 * motion on drill and buys an event that always fires — and it makes
 * criterion 21 trivially true rather than conditionally true, which is how
 * the bug hid: `prefers-reduced-motion` already forced `animate: false`, so
 * anyone testing with that preference on never saw it.
 *
 * DO NOT RE-NARROW THIS without a reproducible characterisation of the hang.
 * The `visibleEdgeCount > 0` predicate above is the one a reader naturally
 * reaches for, and it is wrong; "will fcose converge" is not answerable
 * without running the layout. See docs/DECISIONS.md, 2026-09-08.
 *
 * **`randomize`.** A drill step is incremental: it seeds from the positions
 * already on screen, so opening a directory adds detail in place instead of
 * re-scrambling the map the user has just learned.
 *
 * **`fit` is `false` here on purpose, and that is NOT the same as not
 * fitting.** Every layout is followed by an unconditional `fitToVisible`
 * (`settleAfterLayout`). The layout's own `fit` runs against the container as
 * measured when the layout STARTED, which is exactly the stale value that put
 * boxes off the panel edge; the settle step fits against the container as it
 * actually is. An earlier version tried to preserve the viewport across a
 * drill for spatial memory. That lost: a viewport the user cannot read is
 * worth nothing, and the aspect-targeted `boundingBox` below keeps the map
 * roughly stable across a drill anyway.
 *
 * **`boundingBox`.** fcose is otherwise free to produce a roughly SQUARE
 * layout, which is then fitted into a panel that is about 2.35:1. The fit is
 * limited by the short axis, so a square graph in a letterbox panel wastes
 * two thirds of the width and drags the zoom down — measured on the shipped
 * binary at zoom 0.409, where a 13px directory label renders at 5px: drawn,
 * and unreadable. Constraining the layout to a box with the PANEL's aspect,
 * scaled to the number of nodes, removes the mismatch at its source instead
 * of asking the fit to paper over it.
 */
export interface GraphLayoutInputs {
  readonly canRender: boolean;
  readonly visibleNodeCount: number;
  /** Panel size in px. Drives the layout's aspect ratio — see `boundingBox` above. */
  readonly containerWidth: number;
  readonly containerHeight: number;
  /** A drill step, as opposed to a first paint or a wholesale expand/reset. */
  readonly isIncremental?: boolean;
}



export function buildLayoutOptions(inputs: GraphLayoutInputs): cytoscape.LayoutOptions {
  const { canRender, visibleNodeCount, containerWidth, containerHeight, isIncremental = false } = inputs;
  if (!canRender) {
    // fcose/cose-base's spring-embedder grid-repulsion pass indexes by
    // `container.width()/height()`, which are 0 with no real container
    // (true only of the headless jsdom-test fallback — a real webview
    // always has a sized canvas). `grid` is a core, physics-free layout
    // that never touches viewport dimensions, so the fallback path stays
    // exercisable without papering over a real production code path.
    return { name: 'grid', fit: true } as cytoscape.LayoutOptions;
  }
  // Note on the edgeless case: fcose still runs here, but its output at the
  // TOP LEVEL is arbitrary when no edge joins two top-level nodes, so
  // `pack-layout.ts` re-places those boxes afterwards. fcose keeps the job it
  // is good at — arranging each directory's contents — and does not keep the
  // one it cannot do without forces. (Cytoscape's `grid` was tried as the fix
  // first and is worse: it is not node-size aware, so the size-by-file-count
  // boxes overlap outright.)
  const isLargeVisibleGraph = visibleNodeCount > GRAPH_DRAFT_LAYOUT_NODE_THRESHOLD;
  return {
    name: 'fcose',
    animate: false,
    randomize: !isIncremental,
    fit: !isIncremental,
    // fcose's default node-tiling and component-packing passes throw or
    // degrade on some compound graphs (a real upstream cose-base bug,
    // reproduced by this project's own sample fixture). Directories already
    // give the layout explicit structure, so neither buys anything here.
    tile: false,
    packComponents: false,
    quality: isLargeVisibleGraph ? 'draft' : 'default',
    boundingBox: layoutBoundingBox(visibleNodeCount, containerWidth, containerHeight),
  } as cytoscape.LayoutOptions;
}

function runInitialLayout(
  cy: cytoscape.Core,
  isReducedMotion: boolean,
  canRender: boolean,
  visibleNodeCount: number,
  onStop: () => void,
): void {
  cy.one('layoutstop', onStop);
  cy.layout(
    buildLayoutOptions({
      canRender,
      visibleNodeCount,
      containerWidth: cy.width(),
      containerHeight: cy.height(),
    }),
  ).run();
}

/**
 * Re-applies the zoom band (`detail-level.ts`) on every viewport change,
 * coalesced to one application per animation frame — a drag fires `pan` far
 * more often than a style recalculation is worth doing.
 */
function attachDetailLevel(cy: cytoscape.Core): void {
  let isFramePending = false;
  const update = (): void => {
    if (isFramePending) {
      return;
    }
    isFramePending = true;
    requestAnimationFrame(() => {
      isFramePending = false;
      if (!cy.destroyed()) {
        applyDetailLevel(cy);
      }
    });
  };
  cy.on('zoom pan', update);
  applyDetailLevel(cy);
}

/** Everything a drill step (expand, collapse, keyboard reveal) needs; assembled once by `initializeGraph`. */
interface DrillContext {
  readonly cy: cytoscape.Core;
  readonly result: AnalysisResult;
  readonly isReducedMotion: boolean;
  readonly canRender: boolean;
  readonly collapsedDirsBox: CollapsedDirsBox;
}

interface InitializedGraph {
  readonly cy: cytoscape.Core;
  readonly api: ExpandCollapseApi;
  readonly context: DrillContext;
}

function snapshotNodeIds(cy: cytoscape.Core): ReadonlySet<string> {
  return new Set(cy.nodes().map((node) => node.id()));
}

/**
 * Places freshly materialized children on a small deterministic ring around
 * the directory box they came out of, before the incremental layout runs.
 * Cytoscape puts an added node at the origin, and fcose in incremental mode
 * starts from wherever nodes already are — so without this, expanding a
 * directory drags its contents in from the top-left corner of the world
 * instead of opening them out of the box the user just clicked.
 */
function seedNewNodePositions(cy: cytoscape.Core, knownIds: ReadonlySet<string>): void {
  let newNodeIndex = 0;
  cy.nodes().forEach((node) => {
    if (knownIds.has(node.id())) {
      return;
    }
    const parent = node.parent().first();
    if (parent.nonempty()) {
      const angle = newNodeIndex * GOLDEN_ANGLE_RADIANS;
      const origin = parent.position();
      node.position({
        x: origin.x + Math.cos(angle) * NEW_NODE_SEED_RADIUS_PX,
        y: origin.y + Math.sin(angle) * NEW_NODE_SEED_RADIUS_PX,
      });
    }
    newNodeIndex += 1;
  });
}

function runDrillLayout(context: DrillContext, onStop?: () => void): void {
  const visibleNodeCount = context.cy.nodes(':visible').length;
  context.cy.one('layoutstop', () => {
    // A drill step deliberately leaves the viewport alone (`fit: false`) so the
    // user keeps their place. But if packing ran, the top level was rearranged
    // wholesale anyway, and holding the old viewport would frame a region that
    // no longer means anything — so `settleAfterLayout` re-fits in that case.
    settleAfterLayout(context, onStop);
  });
  context.cy
    .layout(
      buildLayoutOptions({
        canRender: context.canRender,
        visibleNodeCount,
        containerWidth: context.cy.width(),
        containerHeight: context.cy.height(),
        isIncremental: true,
      }),
    )
    .run();
}

/**
 * Tapping a directory opens it or folds it back. Drilling is only a
 * navigation model if it is reversible — you have to be able to close the
 * subtree you finished reading — and this is the single source of truth for
 * that state: `cytoscape-expand-collapse`'s own cue-driven path (A11) is
 * disabled (`cueEnabled: false` below) precisely so there is only one.
 */
function toggleDirectory(context: DrillContext, node: cytoscape.NodeSingular): void {
  const path = node.data('path') as string;
  const isCollapsed = node.hasClass('lazy-collapsed');
  const knownIds = snapshotNodeIds(context.cy);
  context.collapsedDirsBox.current = isCollapsed
    ? expandLazyDirectory(context.cy, context.result, path, context.collapsedDirsBox.current)
    : collapseLazyDirectory(context.cy, context.result, path, context.collapsedDirsBox.current);
  if (isCollapsed) {
    seedNewNodePositions(context.cy, knownIds);
  }
  runDrillLayout(context);
}

/**
 * Focus a file BY PATH, expanding whatever is hiding it first. This is the
 * seam that keeps the keyboard model and the canvas from diverging:
 * `keyboard-nav.ts` traverses every file in the `AnalysisResult`, while the
 * canvas shows only what has been drilled into, so a keyboard move regularly
 * targets a file inside a collapsed directory. Centering happens after the
 * reveal layout settles, otherwise the layout moves the node out from under
 * the camera that was just pointed at it.
 */
function revealAndFocusPath(context: DrillContext, path: string): void {
  const knownIds = snapshotNodeIds(context.cy);
  const { collapsedDirs, didReveal } = revealPath(context.cy, context.result, path, context.collapsedDirsBox.current);
  context.collapsedDirsBox.current = collapsedDirs;
  const focus = (): void => focusNodeById(context.cy, fileNodeId(path), context.isReducedMotion);
  if (!didReveal) {
    focus();
    return;
  }
  seedNewNodePositions(context.cy, knownIds);
  runDrillLayout(context, focus);
}

/**
 * Mutable box shared between `initializeGraph` (which sets the initial
 * collapsed-directory set) and the directory tap handler installed below
 * (which shrinks it on expand) and `useCytoscape`'s own `expandAll`
 * (which empties it). A plain object rather than a React ref so this stays
 * usable from `initializeGraph`, a plain function with no hook access.
 */
type CollapsedDirsBox = { current: ReadonlySet<string> };

/**
 * Builds the ENTERING VIEW and nothing else (amendment, 2026-09-08 —
 * docs/DECISIONS.md): `collapse.ts`'s `computeEnteringCollapsedDirectoryPaths`
 * decides the collapsed set from the `AnalysisResult` alone, always, whatever
 * the repo's size, and `buildLazyGraphElements` materializes only what that
 * leaves visible. So the panel opens on a legible directory tree rather than
 * on every file at once, and first paint costs what the entering view costs
 * rather than what the repo costs. Everything deeper is materialized on
 * demand — by tapping a directory, by a keyboard move revealing a file, or
 * by the toolbar's deliberate "expand everything".
 */
function initializeGraph(
  result: AnalysisResult,
  container: HTMLDivElement | null,
  isReducedMotion: boolean,
  collapsedDirsBox: CollapsedDirsBox,
  onNodeTap: ((id: string) => void) | undefined,
  onReady: () => void,
): InitializedGraph {
  registerCytoscapeExtensions();
  const canRender = supportsCanvasRendering();
  collapsedDirsBox.current = computeEnteringCollapsedDirectoryPaths(
    result.directories,
    result.files,
    enteringViewBudget(container?.clientWidth ?? 0, container?.clientHeight ?? 0),
  );

  const elements = buildLazyGraphElements(result, collapsedDirsBox.current);
  const cy = createCore(elements, container, canRender);
  const api = canRender
    ? // `cueEnabled: false`: the extension's own +/- cues collapse a node by
      // hiding children it can see, which would be a SECOND source of truth
      // for collapse state alongside `collapsedDirsBox` — and it already
      // cannot expand a lazily-collapsed directory, whose children it has
      // never seen. `toggleDirectory` owns the interaction instead.
      getExpandCollapseApi(cy, { animate: !isReducedMotion, undoable: false, cueEnabled: false })
    : createNoopExpandCollapseApi();
  const context: DrillContext = { cy, result, isReducedMotion, canRender, collapsedDirsBox };

  runInitialLayout(cy, isReducedMotion, canRender, cy.nodes(':visible').length, onReady);
  attachDetailLevel(cy);
  if (onNodeTap !== undefined) {
    cy.on('tap', 'node.file-node', (event) => onNodeTap(event.target.id()));
  }
  cy.on('tap', 'node.directory-node', (event) => toggleDirectory(context, event.target));
  return { cy, api, context };
}

/**
 * Fits the visible graph to the panel. Deliberately NOT called from
 * `layoutstop`: at that moment Cytoscape is still working from the container
 * size it captured when the layout began, which during a tab switch is not
 * the final one — fitting there computed a zoom ~40% too large and left the
 * biggest directory boxes hanging off the bottom edge (measured on
 * CacttusEdu: 0.96 from `layoutstop` versus 0.68 once settled). The caller is
 * a React effect, which runs after the DOM commit, when the panel has its
 * real height.
 */
export function fitToVisible(cy: cytoscape.Core | null): void {
  if (cy === null || cy.destroyed() || cy.width() === 0 || cy.height() === 0) {
    return;
  }
  cy.fit(cy.elements(':visible'), ENTERING_VIEW_FIT_PADDING_PX);
}

/** Centers and (unless reduced-motion is set) animates the viewport onto a node. Phase 9's roadmap-step focus uses this via `graphStore`. */
export function focusNodeById(cy: cytoscape.Core | null, id: string, isReducedMotion: boolean): void {
  if (cy === null) {
    return;
  }
  const node = cy.getElementById(id);
  if (node.empty()) {
    return;
  }
  if (isReducedMotion) {
    cy.center(node);
    return;
  }
  cy.animate({ center: { eles: node } }, { duration: FOCUS_ANIMATION_DURATION_MS });
}

/** Click-to-highlight (Phase 8): the tapped node plus its dependencies and dependents stay lit; everything else dims. */
export function highlightNeighborhood(cy: cytoscape.Core | null, id: string): void {
  if (cy === null) {
    return;
  }
  const node = cy.getElementById(id);
  if (node.empty()) {
    return;
  }
  cy.elements()
    .addClass('dimmed')
    .removeClass('selected-node highlighted-dependency highlighted-dependent edge-focused');
  node.removeClass('dimmed').addClass('selected-node');
  node.outgoers('node').removeClass('dimmed').addClass('highlighted-dependency');
  node.incomers('node').removeClass('dimmed').addClass('highlighted-dependent');
  // `edge-focused` overrides the zoom bands' `edge-quiet` (it is styled last
  // in `graph-style.ts`), so the one dependency chain you asked about stays
  // fully drawn even in a band where ambient edges are faint texture.
  node.connectedEdges().removeClass('dimmed').addClass('edge-focused');
}

export function clearHighlight(cy: cytoscape.Core | null): void {
  cy?.elements().removeClass('dimmed selected-node highlighted-dependency highlighted-dependent edge-focused');
}

const ROUTE_EDGE_ID_PREFIX = 'route:';

/**
 * Draws the "start here" roadmap's reading-order route as an overlay
 * (Section 9 Phase 9: "highlighted route through the graph"). These are
 * synthetic edges — the roadmap's order is a BFS-layered reading path, not
 * necessarily real import edges — so they are added to (and, on every
 * call, first removed from) the Cytoscape model rather than toggling
 * classes on existing edges. Always exactly `paths.length - 1` segments,
 * one per consecutive pair, skipping only a pair whose endpoint isn't in
 * the graph (defensive; every roadmap step's path is always an indexed
 * file in practice).
 */
export function applyRouteOverlay(cy: cytoscape.Core | null, paths: readonly string[]): void {
  if (cy === null) {
    return;
  }
  cy.remove(`.route-edge`);
  for (let index = 0; index < paths.length - 1; index += 1) {
    const fromPath = paths[index];
    const toPath = paths[index + 1];
    if (fromPath === undefined || toPath === undefined) {
      continue;
    }
    const source = fileNodeId(fromPath);
    const target = fileNodeId(toPath);
    if (cy.getElementById(source).empty() || cy.getElementById(target).empty()) {
      continue;
    }
    cy.add({
      data: { id: `${ROUTE_EDGE_ID_PREFIX}${index}`, source, target },
      classes: 'route-edge',
    });
  }
}

/** The graph's own quick filter (Phase 8: "focus search"). Section 10's full "where is X?" search arrives in Phase 10. */
export function applySearchFilter(cy: cytoscape.Core | null, query: string): void {
  if (cy === null) {
    return;
  }
  const term = query.trim().toLowerCase();
  if (term.length === 0) {
    cy.nodes('.file-node').removeClass('dimmed search-match');
    return;
  }
  cy.nodes('.file-node').forEach((node) => {
    const matches = String(node.data('label')).toLowerCase().includes(term);
    node.toggleClass('search-match', matches);
    node.toggleClass('dimmed', !matches);
  });
}

export interface UseCytoscapeOptions {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly result: AnalysisResult;
  readonly isReducedMotion: boolean;
  readonly onNodeTap?: (id: string) => void;
}

export interface UseCytoscapeApi {
  readonly isReady: boolean;
  /**
   * Focus a file by repo-relative PATH, not by node id: the node may not be
   * on the canvas yet, and making it visible is part of focusing it
   * (`revealAndFocusPath`). Callers must not reach past this with a node id —
   * that is how the keyboard and the canvas drifted apart in the first place.
   */
  focusPath: (path: string) => void;
  highlightNeighborhood: (id: string) => void;
  clearHighlight: () => void;
  applySearchFilter: (query: string) => void;
  applyRouteOverlay: (paths: readonly string[]) => void;
  expandAll: () => void;
  collapseAll: () => void;
  /**
   * Escape hatch onto the live `cytoscape.Core`, `null` until `isReady`.
   * Not used by production UI (every real interaction goes through the
   * methods above) — it exists so integration tests can verify real
   * Cytoscape state (pan/zoom/rendered positions) end-to-end, the same way
   * `useCytoscape.test.ts`'s own unit tests already do against a
   * standalone core.
   */
  getCore: () => cytoscape.Core | null;
}

/**
 * Packs and re-fits AFTER the layout's synchronous tail has finished writing
 * positions. Deferring by a macrotask is what makes it stick: positions
 * written directly inside a `layoutstop` handler are overwritten by the
 * layout that just emitted it (measured on CacttusEdu — the packed
 * arrangement was applied and the canvas still showed fcose's). The initial
 * paint gets the same treatment from a React effect, which lands after the
 * commit for the same reason.
 */
function settleAfterLayout(context: DrillContext, onSettled?: () => void): void {
  setTimeout(() => {
    if (context.cy.destroyed()) {
      return;
    }
    // These two are INDEPENDENT and were wrongly coupled. The packer arranges
    // top-level nodes and correctly declines when edges already constrain
    // them; the fit corrects the viewport and is needed either way. Writing
    // `if (pack) fit` meant that every repository whose top-level directories
    // import each other — the normal case — never fitted at all on any path
    // except first paint. CacttusEdu, the only repo this was tested against,
    // has zero top-level edges, so the packer always ran and the coupling
    // never showed. Diagnosed on the shipped binary (docs/DECISIONS.md).
    packTopLevelIfUnforced(context.cy);
    fitToVisible(context.cy);
    onSettled?.();
  }, 0);
}

/** Lays the whole graph out afresh and re-fits it — for the two wholesale changes (expand everything, back to overview), never for a drill step. */
function runWholesaleLayout(context: DrillContext): void {
  const visibleNodeCount = context.cy.nodes(':visible').length;
  context.cy.one('layoutstop', () => {
    // The layout's own `fit: true` ran before packing moved anything, so the
    // fit has to be redone against the packed positions.
    settleAfterLayout(context);
  });
  context.cy
    .layout(
      buildLayoutOptions({
        canRender: context.canRender,
        visibleNodeCount,
        containerWidth: context.cy.width(),
        containerHeight: context.cy.height(),
      }),
    )
    .run();
}

/**
 * Materializes every remaining lazily-collapsed directory in one pass
 * (Section 9 Phase 8's toolbar "Expand all"). Under the 2026-09-08 amendment
 * this is the deliberate escape hatch INTO the state that used to be the
 * default — every file at once — so it is also the only path that can still
 * produce an illegible graph, by explicit request.
 */
function materializeAllLazyDirectories(context: DrillContext): void {
  if (context.collapsedDirsBox.current.size === 0) {
    return;
  }
  const knownIds = snapshotNodeIds(context.cy);
  context.collapsedDirsBox.current = new Set();
  reconcileLazyElements(context.cy, buildLazyGraphElements(context.result, context.collapsedDirsBox.current));
  seedNewNodePositions(context.cy, knownIds);
  runWholesaleLayout(context);
}

/**
 * The toolbar's "Collapse all", which now means "back to the view you landed
 * on" — recomputed from the `AnalysisResult`, not remembered, so it is the
 * same view however deep the user drilled before pressing it.
 */
function resetToEnteringView(context: DrillContext): void {
  context.collapsedDirsBox.current = computeEnteringCollapsedDirectoryPaths(
    context.result.directories,
    context.result.files,
    enteringViewBudget(context.cy.width(), context.cy.height()),
  );
  reconcileLazyElements(context.cy, buildLazyGraphElements(context.result, context.collapsedDirsBox.current));
  runWholesaleLayout(context);
}

type CoreRef = RefObject<cytoscape.Core | null>;

/**
 * Fits once the graph is ready AND React has committed, so the panel is at
 * its real size (see `fitToVisible`). This is what makes good on the promise
 * the entering view makes: everything a user lands on is on screen.
 */
function useFitOnReadyEffect(cyRef: CoreRef, isReady: boolean): void {
  useEffect(() => {
    if (!isReady) {
      return;
    }
    // Packing has to happen here rather than in `layoutstop`, for the same
    // reason the fit does: measured on CacttusEdu, positions written from
    // `layoutstop` are overwritten by the layout's own tail — the packed
    // arrangement was computed and applied, and the graph still rendered
    // fcose's. A React effect runs after the commit, when nothing else is
    // still writing. Unconditional, like every other settle.
    packTopLevelIfUnforced(cyRef.current);
    fitToVisible(cyRef.current);
  }, [isReady, cyRef]);
}

/**
 * The stylesheet bakes in literal colors (`graph-style.ts` — a canvas gets no
 * CSS), so a theme change has to rebuild it. Cheap and rare; every dynamic
 * state is driven by classes on the elements, not by the stylesheet, so
 * nothing about the current selection or drill state is disturbed.
 */
function useThemeRestyleEffect(cyRef: CoreRef, isReady: boolean): void {
  useEffect(() => {
    const cy = cyRef.current;
    if (cy === null || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const restyle = (): void => {
      if (!cy.destroyed()) {
        cy.style(buildGraphStylesheet()).update();
      }
    };
    media.addEventListener('change', restyle);
    return () => media.removeEventListener('change', restyle);
  }, [isReady, cyRef]);
}

/**
 * The imperative surface `DependencyGraph.tsx` drives the canvas through.
 *
 * `isReducedMotion` is captured in the `DrillContext` at mount, and the mount
 * effect deliberately does NOT re-initialize when it changes (that would tear
 * down the graph and lose all drill state for an unrelated preference
 * toggle). Overlaying the live value on each call keeps criterion 21 true for
 * a preference changed mid-session; the spread shares the same
 * `collapsedDirsBox` object, so drill state is untouched.
 */
function useGraphApi(
  cyRef: CoreRef,
  contextRef: RefObject<DrillContext | null>,
  isReducedMotion: boolean,
  isReady: boolean,
): UseCytoscapeApi {
  const withLiveMotionPreference = useCallback(
    (): DrillContext | null =>
      contextRef.current === null ? null : { ...contextRef.current, isReducedMotion },
    [isReducedMotion, contextRef],
  );

  return {
    isReady,
    focusPath: useCallback(
      (path: string) => {
        const context = withLiveMotionPreference();
        if (context !== null) {
          revealAndFocusPath(context, path);
        }
      },
      [withLiveMotionPreference],
    ),
    highlightNeighborhood: useCallback((id: string) => highlightNeighborhood(cyRef.current, id), [cyRef]),
    clearHighlight: useCallback(() => clearHighlight(cyRef.current), [cyRef]),
    applySearchFilter: useCallback((query: string) => applySearchFilter(cyRef.current, query), [cyRef]),
    applyRouteOverlay: useCallback((paths: readonly string[]) => applyRouteOverlay(cyRef.current, paths), [cyRef]),
    expandAll: useCallback(() => {
      const context = withLiveMotionPreference();
      if (context !== null) {
        materializeAllLazyDirectories(context);
      }
    }, [withLiveMotionPreference]),
    collapseAll: useCallback(() => {
      const context = withLiveMotionPreference();
      if (context !== null) {
        resetToEnteringView(context);
      }
    }, [withLiveMotionPreference]),
    getCore: useCallback(() => cyRef.current, [cyRef]),
  };
}

/** Owns the one `cytoscape.Core` instance for the mounted `DependencyGraph` (Section 5). */
export function useCytoscape(options: UseCytoscapeOptions): UseCytoscapeApi {
  const { containerRef, result, isReducedMotion, onNodeTap } = options;
  const cyRef = useRef<cytoscape.Core | null>(null);
  const apiRef = useRef<ExpandCollapseApi | null>(null);
  const contextRef = useRef<DrillContext | null>(null);
  const collapsedDirsRef = useRef<ReadonlySet<string>>(new Set());
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const { cy, api, context } = initializeGraph(
      result,
      containerRef.current,
      isReducedMotion,
      collapsedDirsRef,
      onNodeTap,
      () => setIsReady(true),
    );
    cyRef.current = cy;
    apiRef.current = api;
    contextRef.current = context;
    return () => {
      cy.destroy();
      cyRef.current = null;
      apiRef.current = null;
      contextRef.current = null;
      collapsedDirsRef.current = new Set();
      setIsReady(false);
    };
    // Re-initializing on every `isReducedMotion`/`onNodeTap` change would tear
    // down and rebuild the whole graph (losing layout/expand state) for an
    // unrelated preference toggle; only new `result` (a new analysis) does.
    // This project's eslint config has no react-hooks plugin, so no
    // exhaustive-deps suppression comment is needed here.
  }, [result]);

  useFitOnReadyEffect(cyRef, isReady);
  useThemeRestyleEffect(cyRef, isReady);

  return useGraphApi(cyRef, contextRef, isReducedMotion, isReady);
}
