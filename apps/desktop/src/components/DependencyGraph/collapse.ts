import type cytoscape from 'cytoscape';

/**
 * `cytoscape-expand-collapse` (A11) integration: the auto-collapse rule from
 * Phase 8's paragraph ("auto-collapse all directories at depth >= 2 when
 * node count > GRAPH_AUTO_COLLAPSE_THRESHOLD = 600") plus the toolbar's
 * manual expand/collapse-all actions. This file never constructs a
 * `cytoscape.Core` itself — `useCytoscape.ts` owns the instance lifecycle —
 * so every function here is a plain, headless-testable operation on a core
 * passed in by the caller.
 */
export const GRAPH_AUTO_COLLAPSE_THRESHOLD = 600;
export const GRAPH_AUTO_COLLAPSE_MIN_DEPTH = 2;

export interface ExpandCollapseApi {
  collapse(eles: cytoscape.NodeCollection): void;
  expand(eles: cytoscape.NodeCollection): void;
  collapseAll(): void;
  expandAll(): void;
  isCollapsible(node: cytoscape.NodeSingular): boolean;
  isExpandable(node: cytoscape.NodeSingular): boolean;
}

interface ExpandCollapseInitOptions {
  readonly animate: boolean;
  readonly undoable: boolean;
  /** Draws expand/collapse +/- icons on nodes; requires a real canvas layer, so off under headless/test cores. */
  readonly cueEnabled: boolean;
}

interface CoreWithExpandCollapse extends cytoscape.Core {
  expandCollapse(options: ExpandCollapseInitOptions): ExpandCollapseApi;
}

/** Initializes (or re-initializes) the extension on `cy` and returns its API. */
export function getExpandCollapseApi(
  cy: cytoscape.Core,
  options: ExpandCollapseInitOptions,
): ExpandCollapseApi {
  return (cy as CoreWithExpandCollapse).expandCollapse(options);
}

/**
 * `cytoscape-expand-collapse`'s cue layer requires a real canvas container
 * (it does `cy.container().append(...)` unconditionally), so it cannot be
 * initialized on the headless fallback core `useCytoscape.ts` uses under
 * jsdom (no `canvas` package, Section 9 Phase 7's environment). This inert
 * stand-in keeps every caller (auto-collapse, the toolbar's expand/collapse
 * buttons) working with no behavior in that fallback, matching what the
 * user actually experiences: a real desktop webview always has a canvas.
 */
export function createNoopExpandCollapseApi(): ExpandCollapseApi {
  return {
    collapse: () => undefined,
    expand: () => undefined,
    collapseAll: () => undefined,
    expandAll: () => undefined,
    isCollapsible: () => false,
    isExpandable: () => false,
  };
}

/** Number of `/`-separated segments in a repo-relative directory path (`'src'` -> 1). */
export function directoryDepth(path: string): number {
  return path.split('/').length;
}

function collapsibleDeepDirectories(
  cy: cytoscape.Core,
  minDepth: number,
): cytoscape.NodeCollection {
  return cy.nodes('.directory-node').filter((node) => {
    const path = node.data('path') as string;
    return directoryDepth(path) >= minDepth;
  });
}

export function collapseDeepDirectories(
  cy: cytoscape.Core,
  api: ExpandCollapseApi,
  minDepth: number = GRAPH_AUTO_COLLAPSE_MIN_DEPTH,
): void {
  const deepDirectories = collapsibleDeepDirectories(cy, minDepth);
  if (deepDirectories.length > 0) {
    api.collapse(deepDirectories);
  }
}

/** Phase 8: "auto-collapse all directories at depth >= 2 when node count > 600". */
export function autoCollapseIfNeeded(
  cy: cytoscape.Core,
  api: ExpandCollapseApi,
  nodeCount: number,
): void {
  if (nodeCount > GRAPH_AUTO_COLLAPSE_THRESHOLD) {
    collapseDeepDirectories(cy, api);
  }
}
