import type cytoscape from 'cytoscape';
import type { AnalysisResult } from '@onboard/contract';
import { buildLazyGraphElements, directoryAncestorChain, directoryContaining } from './graph-model';
import type { LazyGraphElements } from './graph-model';

/**
 * Directory collapse state for the graph. This file never constructs a
 * `cytoscape.Core` itself — `useCytoscape.ts` owns the instance lifecycle —
 * so every function here is a plain, headless-testable operation on a core
 * (or on the `AnalysisResult` alone).
 *
 * **The entering view (amendment, 2026-09-08 — see docs/DECISIONS.md).**
 * Phase 8's original rule was "auto-collapse all directories at depth >= 2
 * WHEN node count > GRAPH_AUTO_COLLAPSE_THRESHOLD = 600" — i.e. show
 * everything by default, and fall back to collapsing only for repos big
 * enough to be slow. That rule optimized for *render cost*, and it left the
 * default view of any repo under 600 nodes as a single fit-to-window force
 * layout of every file at once. Such a view is not readable at any zoom: a
 * node-link diagram's legibility collapses well below 500 nodes regardless of
 * how labels and edges are styled, so "everything at once" is the wrong
 * default at 500 files and at 100.
 *
 * The rule is now: **always start collapsed, and collapse deep enough that
 * the entering view fits a legibility budget** (`GRAPH_ENTERING_VIEW_MAX_NODES`),
 * regardless of node count. Expanding is a deliberate act — tapping a
 * directory, keyboard-revealing a file, or the toolbar's "Show everything".
 * `computeEnteringCollapsedDirectoryPaths` picks the deepest level of detail
 * that still fits the budget, so a small repo still shows all its files (it
 * fits) while a large one opens on its directory tree.
 */

/**
 * Maximum node count for the view a user lands on. Chosen for label
 * legibility, not render cost: fcose fits its result to the viewport, so on a
 * maximized ~1600x900 canvas 60 nodes leaves each roughly a 180x150px cell —
 * enough for a 18-60px node plus the 10px filename beneath it without
 * neighboring labels overlapping. It is a judgment call validated by
 * screenshot (docs/DECISIONS.md), not a derived constant; the automatic
 * guard against regression is `collapse.test.ts`'s assertion that the
 * entering view of a real 500-file analysis never exceeds it.
 */
export const GRAPH_ENTERING_VIEW_MAX_NODES = 60;

/**
 * The shallowest level the entering view will ever collapse to: every
 * depth-1 directory as one box. Below this there is nothing left to hide —
 * repo-root files are always visible — so a repo with hundreds of files
 * directly at its root cannot be brought under the budget by collapsing at
 * all (an honest residual, asserted in `collapse.test.ts`).
 */
const ENTERING_VIEW_FLOOR_DEPTH = 1;

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

export interface FileLike {
  readonly path: string;
}

/** Depth of the directory directly containing `filePath`; 0 for a file at the repo root. */
function containingDirectoryDepth(filePath: string): number {
  const lastSlash = filePath.lastIndexOf('/');
  return lastSlash === -1 ? 0 : directoryDepth(filePath.slice(0, lastSlash));
}

/**
 * How many nodes are visible when every directory at depth >= `depth` is
 * collapsed. A directory at depth k is hidden exactly when its PARENT (depth
 * k-1) is collapsed, i.e. when k > depth; a file is hidden exactly when its
 * own containing directory is collapsed, i.e. when that directory's depth
 * >= depth. Monotonically non-decreasing in `depth` — which is what lets
 * `computeEnteringCollapsedDirectoryPaths` find the best depth with one scan.
 */
function visibleNodeCountAtDepth(
  directories: readonly DirectoryLike[],
  files: readonly FileLike[],
  depth: number,
): number {
  const visibleDirectories = directories.filter((directory) => directoryDepth(directory.path) <= depth).length;
  const visibleFiles = files.filter((file) => containingDirectoryDepth(file.path) < depth).length;
  return visibleDirectories + visibleFiles;
}

/**
 * The collapsed-directory set for the view a user lands on: the DEEPEST
 * level of detail whose visible node count still fits `maxVisibleNodes`.
 * Pure and data-only, so `useCytoscape.ts` can decide the entering view
 * before building a single Cytoscape element (which is also what keeps first
 * paint proportional to what is shown rather than to `files.length`).
 *
 * A repo small enough to fit entirely returns an empty set — nothing is
 * collapsed, every file is shown, exactly as before this amendment. A repo
 * too flat to fit even at the floor depth (hundreds of files directly at the
 * repo root) returns the floor-depth set and is still over budget; collapsing
 * cannot hide root files, and inventing synthetic groupings to force the
 * number down would be a different product.
 */
export function computeEnteringCollapsedDirectoryPaths(
  directories: readonly DirectoryLike[],
  files: readonly FileLike[],
  maxVisibleNodes: number = GRAPH_ENTERING_VIEW_MAX_NODES,
): ReadonlySet<string> {
  const deepestDirectoryDepth = directories.reduce(
    (deepest, directory) => Math.max(deepest, directoryDepth(directory.path)),
    0,
  );
  // One past the deepest directory collapses nothing at all — the "small
  // repo shows everything" case, tried first and accepted if it fits.
  let chosenDepth = ENTERING_VIEW_FLOOR_DEPTH;
  for (let depth = deepestDirectoryDepth + 1; depth >= ENTERING_VIEW_FLOOR_DEPTH; depth -= 1) {
    if (visibleNodeCountAtDepth(directories, files, depth) <= maxVisibleNodes) {
      chosenDepth = depth;
      break;
    }
  }
  return new Set(
    directories
      .filter((directory) => directoryDepth(directory.path) >= chosenDepth)
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
 * real edges of a directory that just expanded), and toggles every live
 * node's `lazy-collapsed` / `hidden-by-collapse` classes to
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

  const targetClassesById = new Map(
    target.nodes.map((node) => [node.data.id as string, classNamesOf(node.classes)] as const),
  );
  cy.nodes().forEach((liveNode) => {
    const targetClasses = targetClassesById.get(liveNode.id());
    if (targetClasses === undefined) {
      // A file node whose containing directory has since been RE-collapsed
      // (`collapseLazyDirectory`, or the toolbar returning to the entering
      // view). `buildLazyGraphElements` omits such a file from its output
      // entirely rather than emitting it as hidden, and this function never
      // removes a node once it is real, so hiding it is this branch's job —
      // without it, re-collapsing a directory leaves its files on screen.
      liveNode.addClass('hidden-by-collapse');
      return;
    }
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

/**
 * Inverse of `expandLazyDirectory`: folds a directory back into a single
 * box. Drilling has to be reversible — "expand one subtree at a time" is
 * only a navigation model if you can also close the subtree you finished
 * with — and it is what the toolbar's "Back to overview" rebuilds from.
 */
export function collapseLazyDirectory(
  cy: cytoscape.Core,
  result: AnalysisResult,
  directoryPath: string,
  collapsedDirs: ReadonlySet<string>,
): ReadonlySet<string> {
  const nextCollapsedDirs = new Set(collapsedDirs);
  nextCollapsedDirs.add(directoryPath);
  reconcileLazyElements(cy, buildLazyGraphElements(result, nextCollapsedDirs));
  return nextCollapsedDirs;
}

/**
 * Every currently-collapsed directory standing between the repo root and
 * `path` — the full chain, not just the shallowest one `resolveVisibleNodeId`
 * reports, because revealing a file three collapsed levels deep has to open
 * all three.
 */
export function collapsedAncestorsOf(path: string, collapsedDirs: ReadonlySet<string>): readonly string[] {
  const containing = directoryContaining(path);
  if (containing === null) {
    return [];
  }
  return directoryAncestorChain(containing).filter((ancestor) => collapsedDirs.has(ancestor));
}

/**
 * Makes `path` actually visible on the canvas, expanding as many collapsed
 * directories as that takes, and reports whether anything changed.
 *
 * This is what keeps the keyboard model and the canvas from diverging.
 * `keyboard-nav.ts` traverses the whole `AnalysisResult` — every file, by
 * importance rank — while the canvas shows only the entering view, so
 * `ArrowDown`/`[`/`]` routinely land on a file that is inside a collapsed
 * directory and (under lazy materialization) not even in the Cytoscape core.
 * Before this existed, `focusNodeById` found nothing, returned silently, and
 * the panel announced a file to screen readers that no sighted user could
 * see. Criterion 20 held; the experience did not.
 */
export function revealPath(
  cy: cytoscape.Core,
  result: AnalysisResult,
  path: string,
  collapsedDirs: ReadonlySet<string>,
): { readonly collapsedDirs: ReadonlySet<string>; readonly didReveal: boolean } {
  const blockers = collapsedAncestorsOf(path, collapsedDirs);
  if (blockers.length === 0) {
    return { collapsedDirs, didReveal: false };
  }
  const nextCollapsedDirs = new Set(collapsedDirs);
  blockers.forEach((blocker) => nextCollapsedDirs.delete(blocker));
  reconcileLazyElements(cy, buildLazyGraphElements(result, nextCollapsedDirs));
  return { collapsedDirs: nextCollapsedDirs, didReveal: true };
}
// #endregion
