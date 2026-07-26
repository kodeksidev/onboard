import type cytoscape from 'cytoscape';
import type { AnalysisResult } from '@onboard/contract';
import { buildLazyGraphElements } from './graph-model';
import type { LazyGraphElements } from './graph-model';

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

// #region lazy materialization (Section 9 Phase 8 follow-up performance fix)
//
// `autoCollapseIfNeeded` above operates on a `cytoscape.Core` that already
// has every node/edge in it — that is exactly the cost problem
// `graph-model.ts`'s doc comment on `buildLazyGraphElements` explains:
// building, then instantly hiding, thousands of file nodes still costs
// Cytoscape real construction+styling time. The functions below let
// `useCytoscape.ts` decide the collapsed-directory set FIRST, from the
// `AnalysisResult` alone (no `cytoscape.Core` needed yet), so it only ever
// builds the elements that will actually be visible.

export interface DirectoryLike {
  readonly path: string;
}

/**
 * Pure, data-only version of the same ">600 nodes -> collapse depth>=2"
 * rule as `collapseDeepDirectories`, usable before any Cytoscape element
 * exists.
 */
export function computeAutoCollapsedDirectoryPaths(
  directories: readonly DirectoryLike[],
  totalElementCount: number,
  threshold: number = GRAPH_AUTO_COLLAPSE_THRESHOLD,
  minDepth: number = GRAPH_AUTO_COLLAPSE_MIN_DEPTH,
): ReadonlySet<string> {
  if (totalElementCount <= threshold) {
    return new Set();
  }
  return new Set(
    directories
      .filter((directory) => directoryDepth(directory.path) >= minDepth)
      .map((directory) => directory.path),
  );
}

const MATERIALIZED_EDGE_SELECTOR = '.import-edge';

/** `cytoscape.NodeDefinition['classes']` is typed `string | string[] | undefined`; this project always produces a space-separated string, but normalize defensively rather than assume. */
function classNamesOf(classes: string | readonly string[] | undefined): readonly string[] {
  if (classes === undefined) {
    return [];
  }
  if (typeof classes === 'string') {
    return classes.split(' ').filter((name) => name.length > 0);
  }
  return classes;
}

/**
 * Brings `cy`'s live elements in line with `target` (a
 * `buildLazyGraphElements` result for some collapsed-directory set): adds
 * every node/edge in `target` not yet in `cy`, removes any `.import-edge`
 * no longer in `target` (a directory-level aggregate edge superseded by the
 * real edges of a directory that just expanded), and toggles each
 * directory node's `lazy-collapsed` / `hidden-by-collapse` classes to
 * match. Never removes a node — once a file or directory node is real, it
 * stays real; only visibility and the edge set change. This is the "add
 * elements yourself" alternative to `cytoscape-expand-collapse`'s expand
 * path: that extension expects a collapsed node's children to already
 * exist in the graph, which is false here by construction.
 */
export function reconcileLazyElements(cy: cytoscape.Core, target: LazyGraphElements): void {
  const existingNodeIds = new Set(cy.nodes().map((node) => node.id()));
  const newNodes = target.nodes.filter((node) => !existingNodeIds.has(node.data.id as string));
  if (newNodes.length > 0) {
    cy.add(newNodes);
  }

  target.nodes
    .filter((node) => classNamesOf(node.classes).includes('directory-node'))
    .forEach((node) => {
      const liveNode = cy.getElementById(node.data.id as string);
      if (liveNode.empty()) {
        return;
      }
      const targetClasses = classNamesOf(node.classes);
      liveNode.toggleClass('hidden-by-collapse', targetClasses.includes('hidden-by-collapse'));
      liveNode.toggleClass('lazy-collapsed', targetClasses.includes('lazy-collapsed'));
    });

  const targetEdgeIds = new Set(target.edges.map((edge) => edge.data.id as string));
  cy.edges(MATERIALIZED_EDGE_SELECTOR).forEach((edge) => {
    if (!targetEdgeIds.has(edge.id())) {
      cy.remove(edge);
    }
  });
  const existingEdgeIds = new Set(cy.edges(MATERIALIZED_EDGE_SELECTOR).map((edge) => edge.id()));
  const newEdges = target.edges.filter((edge) => !existingEdgeIds.has(edge.data.id as string));
  if (newEdges.length > 0) {
    cy.add(newEdges);
  }
}

/**
 * Expands one lazily-collapsed directory: drops it from the collapsed set,
 * recomputes the now-visible element set from the full, unabridged
 * `AnalysisResult` (never from whatever Cytoscape happens to already know
 * about), and reconciles `cy` to match — real work, on demand, scaled to
 * what just became visible, not the whole repo. Returns the new
 * collapsed-directory set for the caller to remember.
 */
export function expandLazyDirectory(
  cy: cytoscape.Core,
  result: AnalysisResult,
  directoryPath: string,
  collapsedDirs: ReadonlySet<string>,
): ReadonlySet<string> {
  const nextCollapsedDirs = new Set(collapsedDirs);
  nextCollapsedDirs.delete(directoryPath);
  reconcileLazyElements(cy, buildLazyGraphElements(result, nextCollapsedDirs));
  return nextCollapsedDirs;
}
// #endregion
