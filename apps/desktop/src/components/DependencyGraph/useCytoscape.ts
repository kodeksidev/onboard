import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import expandCollapse from 'cytoscape-expand-collapse';
import { buildGraphStylesheet } from './graph-style';
import type { GraphElements } from './graph-model';
import { autoCollapseIfNeeded, createNoopExpandCollapseApi, getExpandCollapseApi } from './collapse';
import type { ExpandCollapseApi } from './collapse';

/** A11's pixel-ratio and label-visibility performance rules (Phase 8's paragraph). */
const GRAPH_LABEL_ZOOM_THRESHOLD = 0.35;
const GRAPH_PIXEL_RATIO_NODE_THRESHOLD = 2000;
const FOCUS_ANIMATION_DURATION_MS = 300;

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

function createCore(elements: GraphElements, container: HTMLDivElement | null, canRender: boolean): cytoscape.Core {
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

function buildLayoutOptions(isReducedMotion: boolean, canRender: boolean): cytoscape.LayoutOptions {
  if (!canRender) {
    // fcose/cose-base's spring-embedder grid-repulsion pass indexes by
    // `container.width()/height()`, which are 0 with no real container
    // (true only of the headless jsdom-test fallback — a real webview
    // always has a sized canvas). `grid` is a core, physics-free layout
    // that never touches viewport dimensions, so the fallback path stays
    // exercisable without papering over a real production code path.
    return { name: 'grid', fit: true } as cytoscape.LayoutOptions;
  }
  return {
    name: 'fcose',
    animate: !isReducedMotion,
    randomize: true,
    fit: true,
    // fcose's default node-tiling pass (grouping disconnected/orphan
    // nodes) throws on some small compound graphs (a real upstream
    // cose-base bug, reproduced by this project's own fixture). Directories
    // already give the layout explicit structure, so tiling buys nothing.
    tile: false,
  } as cytoscape.LayoutOptions;
}

function runInitialLayout(
  cy: cytoscape.Core,
  isReducedMotion: boolean,
  canRender: boolean,
  onStop: () => void,
): void {
  cy.one('layoutstop', onStop);
  cy.layout(buildLayoutOptions(isReducedMotion, canRender)).run();
}

function attachLabelVisibility(cy: cytoscape.Core): void {
  const update = (): void => {
    cy.nodes().toggleClass('labels-hidden', cy.zoom() < GRAPH_LABEL_ZOOM_THRESHOLD);
  };
  cy.on('zoom', update);
  update();
}

interface InitializedGraph {
  readonly cy: cytoscape.Core;
  readonly api: ExpandCollapseApi;
}

function initializeGraph(
  elements: GraphElements,
  container: HTMLDivElement | null,
  isReducedMotion: boolean,
  onNodeTap: ((id: string) => void) | undefined,
  onReady: () => void,
): InitializedGraph {
  registerCytoscapeExtensions();
  const canRender = supportsCanvasRendering();
  const cy = createCore(elements, container, canRender);
  const api = canRender
    ? getExpandCollapseApi(cy, { animate: !isReducedMotion, undoable: false, cueEnabled: true })
    : createNoopExpandCollapseApi();

  runInitialLayout(cy, isReducedMotion, canRender, () => {
    autoCollapseIfNeeded(cy, api, elements.nodes.length);
    onReady();
  });
  attachLabelVisibility(cy);
  if (onNodeTap !== undefined) {
    cy.on('tap', 'node.file-node', (event) => onNodeTap(event.target.id()));
  }
  return { cy, api };
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
    .removeClass('selected-node highlighted-dependency highlighted-dependent');
  node.removeClass('dimmed').addClass('selected-node');
  node.outgoers('node').removeClass('dimmed').addClass('highlighted-dependency');
  node.incomers('node').removeClass('dimmed').addClass('highlighted-dependent');
  node.connectedEdges().removeClass('dimmed');
}

export function clearHighlight(cy: cytoscape.Core | null): void {
  cy?.elements().removeClass('dimmed selected-node highlighted-dependency highlighted-dependent');
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
  readonly elements: GraphElements;
  readonly isReducedMotion: boolean;
  readonly onNodeTap?: (id: string) => void;
}

export interface UseCytoscapeApi {
  readonly isReady: boolean;
  focusNodeById: (id: string) => void;
  highlightNeighborhood: (id: string) => void;
  clearHighlight: () => void;
  applySearchFilter: (query: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

/** Owns the one `cytoscape.Core` instance for the mounted `DependencyGraph` (Section 5). */
export function useCytoscape(options: UseCytoscapeOptions): UseCytoscapeApi {
  const { containerRef, elements, isReducedMotion, onNodeTap } = options;
  const cyRef = useRef<cytoscape.Core | null>(null);
  const apiRef = useRef<ExpandCollapseApi | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const { cy, api } = initializeGraph(elements, containerRef.current, isReducedMotion, onNodeTap, () =>
      setIsReady(true),
    );
    cyRef.current = cy;
    apiRef.current = api;
    return () => {
      cy.destroy();
      cyRef.current = null;
      apiRef.current = null;
      setIsReady(false);
    };
    // Re-initializing on every `isReducedMotion`/`onNodeTap` change would tear
    // down and rebuild the whole graph (losing layout/expand state) for an
    // unrelated preference toggle; only new `elements` (a new analysis) does.
    // This project's eslint config has no react-hooks plugin, so no
    // exhaustive-deps suppression comment is needed here.
  }, [elements]);

  return {
    isReady,
    focusNodeById: useCallback((id: string) => focusNodeById(cyRef.current, id, isReducedMotion), [isReducedMotion]),
    highlightNeighborhood: useCallback((id: string) => highlightNeighborhood(cyRef.current, id), []),
    clearHighlight: useCallback(() => clearHighlight(cyRef.current), []),
    applySearchFilter: useCallback((query: string) => applySearchFilter(cyRef.current, query), []),
    expandAll: useCallback(() => apiRef.current?.expandAll(), []),
    collapseAll: useCallback(() => apiRef.current?.collapseAll(), []),
  };
}
