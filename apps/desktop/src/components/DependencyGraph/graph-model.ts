import type cytoscape from 'cytoscape';
import type { AnalysisResult } from '@onboard/contract';

type FileNode = AnalysisResult['files'][number];
type ImportEdge = AnalysisResult['edges'][number];
type DirectoryNode = AnalysisResult['directories'][number];

/**
 * Pure transformation from the frozen `AnalysisResult` (Section 7) to
 * Cytoscape.js elements (A11). Nothing here touches the DOM or a `cytoscape`
 * core instance — `useCytoscape.ts` is the only place that does — so this
 * module is trivially unit-testable and reusable by `GraphListFallback` and
 * `keyboard-nav.ts` without a canvas.
 */

const FILE_NODE_ID_PREFIX = 'file:';
const DIRECTORY_NODE_ID_PREFIX = 'dir:';

/** Node size range in px, interpolated linearly by `FileNode.importance` (Section 8.4). */
const NODE_MIN_SIZE = 18;
const NODE_MAX_SIZE = 60;

/**
 * Size range in px for a COLLAPSED directory box (amendment, 2026-09-08 —
 * docs/DECISIONS.md). A lazily-collapsed directory has no children in the
 * core, so Cytoscape gives it the default node size: in the entering view,
 * which is now mostly collapsed directories, that rendered every directory as
 * the same small grey blob whatever it contained. Area (not diameter) is made
 * proportional to `descendantFileCount` — hence the `sqrt` — so "this box
 * holds most of the repo" is legible before reading a single label.
 */
const DIRECTORY_MIN_SIZE = 44;
const DIRECTORY_MAX_SIZE = 170;

/** Golden-angle hue step gives well-distributed, deterministic distinct hues per module. */
const MODULE_COLOR_HUE_STEP = 137.508;
const MODULE_COLOR_SATURATION = 55;
const MODULE_COLOR_LIGHTNESS = 52;
const NO_MODULE_COLOR = 'hsl(0, 0%, 60%)';

export function fileNodeId(path: string): string {
  return `${FILE_NODE_ID_PREFIX}${path}`;
}

export function directoryNodeId(path: string): string {
  return `${DIRECTORY_NODE_ID_PREFIX}${path}`;
}

/** Returns the repo-relative path for a file node id, or null for anything else (e.g. a directory id). */
export function pathFromNodeId(id: string): string | null {
  return id.startsWith(FILE_NODE_ID_PREFIX) ? id.slice(FILE_NODE_ID_PREFIX.length) : null;
}

export function computeNodeSize(importance: number): number {
  return NODE_MIN_SIZE + importance * (NODE_MAX_SIZE - NODE_MIN_SIZE);
}

/** Collapsed-directory box size: area proportional to `descendantFileCount`, relative to the biggest directory in the repo. */
export function computeDirectorySize(descendantFileCount: number, largestDescendantFileCount: number): number {
  if (largestDescendantFileCount <= 0) {
    return DIRECTORY_MIN_SIZE;
  }
  const ratio = Math.sqrt(Math.max(descendantFileCount, 0)) / Math.sqrt(largestDescendantFileCount);
  return DIRECTORY_MIN_SIZE + ratio * (DIRECTORY_MAX_SIZE - DIRECTORY_MIN_SIZE);
}

/**
 * Deterministic categorical palette: sorting the input first means the same
 * set of module ids always gets the same colors regardless of call-site
 * ordering, and the golden-angle hue step keeps colors visually distinct
 * even for the spec's ceiling of `MAX_MODULES = 40` (Section 8.6).
 */
export function assignModuleColors(moduleIds: readonly string[]): ReadonlyMap<string, string> {
  const sorted = [...moduleIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return new Map(
    sorted.map((moduleId, index) => {
      const hue = (index * MODULE_COLOR_HUE_STEP) % 360;
      return [moduleId, `hsl(${hue.toFixed(1)}, ${MODULE_COLOR_SATURATION}%, ${MODULE_COLOR_LIGHTNESS}%)`];
    }),
  );
}

export function orderPathsByImportance(files: readonly FileNode[]): readonly string[] {
  return [...files].sort((a, b) => a.importanceRank - b.importanceRank).map((file) => file.path);
}

export interface GraphAdjacency {
  /** path -> sorted-ascending paths it imports. */
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
  /** path -> sorted-ascending paths that import it. */
  readonly dependents: ReadonlyMap<string, readonly string[]>;
}

function pushSorted(target: Map<string, string[]>, key: string, value: string): void {
  const existing = target.get(key) ?? [];
  target.set(
    key,
    [...existing, value].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export function buildAdjacency(edges: readonly ImportEdge[]): GraphAdjacency {
  const dependencies = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  edges.forEach((edge) => {
    pushSorted(dependencies, edge.fromPath, edge.toPath);
    pushSorted(dependents, edge.toPath, edge.fromPath);
  });
  return { dependencies, dependents };
}

/** Compound-parent id, omitted entirely (never `parent: undefined`) when there is none. */
function parentIdField(parentId: string | undefined): { parent: string } | Record<string, never> {
  return parentId === undefined ? {} : { parent: parentId };
}

function directoryParentId(directory: DirectoryNode): string | undefined {
  return directory.parentPath === null ? undefined : directoryNodeId(directory.parentPath);
}

function fileParentId(file: FileNode, directoryPaths: ReadonlySet<string>): string | undefined {
  const lastSlash = file.path.lastIndexOf('/');
  if (lastSlash === -1) {
    return undefined;
  }
  const dirPath = file.path.slice(0, lastSlash);
  return directoryPaths.has(dirPath) ? directoryNodeId(dirPath) : undefined;
}

function buildDirectoryNodes(result: AnalysisResult): cytoscape.NodeDefinition[] {
  return result.directories.map((directory) => ({
    data: {
      id: directoryNodeId(directory.path),
      label: directory.path.slice(directory.path.lastIndexOf('/') + 1),
      path: directory.path,
      ...parentIdField(directoryParentId(directory)),
    },
    classes: 'directory-node',
  }));
}

function buildFileNodes(
  files: readonly FileNode[],
  directoryPaths: ReadonlySet<string>,
  moduleColors: ReadonlyMap<string, string>,
): cytoscape.NodeDefinition[] {
  return files.map((file) => ({
    data: {
      id: fileNodeId(file.path),
      label: file.path.slice(file.path.lastIndexOf('/') + 1),
      path: file.path,
      ...parentIdField(fileParentId(file, directoryPaths)),
      importance: file.importance,
      importanceRank: file.importanceRank,
      classification: file.classification,
      moduleId: file.moduleId,
      size: computeNodeSize(file.importance),
      color: file.moduleId === null ? NO_MODULE_COLOR : (moduleColors.get(file.moduleId) ?? NO_MODULE_COLOR),
      inDegree: file.inDegree,
      outDegree: file.outDegree,
      isParsed: file.isParsed,
    },
    classes: 'file-node',
  }));
}

function buildEdges(result: AnalysisResult): cytoscape.EdgeDefinition[] {
  return result.edges.map((edge) => ({
    data: {
      id: `${fileNodeId(edge.fromPath)}->${fileNodeId(edge.toPath)}#${edge.line}`,
      source: fileNodeId(edge.fromPath),
      target: fileNodeId(edge.toPath),
      kind: edge.kind,
    },
    classes: 'import-edge',
  }));
}

export interface GraphElements {
  readonly nodes: cytoscape.NodeDefinition[];
  readonly edges: cytoscape.EdgeDefinition[];
}

/** Section 5: the graph is file -> file (Non-goal #7); directories are compound containers only. */
export function buildGraphElements(result: AnalysisResult): GraphElements {
  const directoryPaths = new Set(result.directories.map((directory) => directory.path));
  const moduleColors = assignModuleColors(
    result.modules.map((moduleCard) => moduleCard.id),
  );
  return {
    nodes: [
      ...buildDirectoryNodes(result),
      ...buildFileNodes(result.files, directoryPaths, moduleColors),
    ],
    edges: buildEdges(result),
  };
}

// #region lazy materialization (Section 9 Phase 8 follow-up performance fix)
//
// `buildGraphElements` above feeds Cytoscape one node per file and one
// compound node per directory, unconditionally — correct, but its
// construction cost scales with `result.files.length` even for a directory
// that auto-collapse (`collapse.ts`) is about to hide immediately. Measured
// in `bench/graph`: at 5,000 files (all landing under 12 auto-collapsed
// directories, both node counts settling to the same 13 VISIBLE nodes),
// first paint cost 5,000/1,000 = 5x more than at 1,000 files, purely from
// building-then-hiding four thousand extra file nodes and their edges.
//
// `buildLazyGraphElements` below is the fix: given a set of directory paths
// that are (or will be) collapsed, it materializes EVERY directory node
// (directories are the compound structure and are typically far fewer than
// files — the synthetic bench graph has exactly 13 regardless of file
// count) but only the FILE nodes that are not hidden by a collapsed
// ancestor. An edge whose endpoint is hidden is redirected to (and
// deduplicated against) the shallowest collapsed ancestor directory, so
// "edges to a collapsed directory still render as directory-level edges."
// `collapse.ts`'s `expandLazyDirectory` recomputes and reconciles this same
// element set against a live `cytoscape.Core` when a lazy directory is
// expanded — real work happens once, on demand, not up front for the whole
// repo.

/** The directory path a file or directory lives directly under, or `null` at repo root. */
export function directoryContaining(path: string): string | null {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash === -1 ? null : path.slice(0, lastSlash);
}

/** `dirPath`'s ancestor chain, shallowest first, including `dirPath` itself as the last entry. */
export function directoryAncestorChain(dirPath: string): readonly string[] {
  const segments = dirPath.split('/');
  return segments.map((_segment, index) => segments.slice(0, index + 1).join('/'));
}

/**
 * The shallowest (topmost) directory in `collapsedDirs` that hides
 * `containingDirPath` (a file's own directory, or a directory's PARENT when
 * checking whether that directory itself is hidden) — always the currently
 * VISIBLE blocker even when a deeper ancestor is also collapsed, since a
 * directory nested inside another collapsed directory is itself hidden and
 * so cannot be a rendering target.
 */
function shallowestCollapsedAncestor(
  containingDirPath: string | null,
  collapsedDirs: ReadonlySet<string>,
): string | null {
  if (containingDirPath === null) {
    return null;
  }
  for (const candidate of directoryAncestorChain(containingDirPath)) {
    if (collapsedDirs.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isDirectoryHiddenByCollapse(directory: DirectoryNode, collapsedDirs: ReadonlySet<string>): boolean {
  return shallowestCollapsedAncestor(directoryContaining(directory.path), collapsedDirs) !== null;
}

/** The id of whatever currently-visible node stands in for `path`: itself, if visible, or its shallowest collapsed ancestor directory. */
export function resolveVisibleNodeId(path: string, collapsedDirs: ReadonlySet<string>): string {
  const hiddenBy = shallowestCollapsedAncestor(directoryContaining(path), collapsedDirs);
  return hiddenBy === null ? fileNodeId(path) : directoryNodeId(hiddenBy);
}

function directoryLabel(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * The module owning the most descendant files of each directory, by count,
 * ties broken by module id so the result is deterministic. A collapsed
 * directory stands in for everything beneath it, so it should carry the same
 * module color its contents would have shown — otherwise the entering view,
 * which is mostly collapsed directories, loses the module signal entirely.
 * Files with no module, and directories whose descendants all lack one, are
 * simply absent from the result.
 */
export function computeDominantModuleByDirectory(files: readonly FileNode[]): ReadonlyMap<string, string> {
  const countsByDirectory = new Map<string, Map<string, number>>();
  files.forEach((file) => {
    const moduleId = file.moduleId;
    const containing = directoryContaining(file.path);
    if (moduleId === null || containing === null) {
      return;
    }
    directoryAncestorChain(containing).forEach((ancestor) => {
      const counts = countsByDirectory.get(ancestor) ?? new Map<string, number>();
      counts.set(moduleId, (counts.get(moduleId) ?? 0) + 1);
      countsByDirectory.set(ancestor, counts);
    });
  });

  const dominant = new Map<string, string>();
  countsByDirectory.forEach((counts, directoryPath) => {
    const winner = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    )[0];
    if (winner !== undefined) {
      dominant.set(directoryPath, winner[0]);
    }
  });
  return dominant;
}

function formatFileCount(count: number): string {
  return `${String(count)} file${count === 1 ? '' : 's'}`;
}

interface DirectoryVisuals {
  readonly moduleColors: ReadonlyMap<string, string>;
  readonly dominantModuleByDirectory: ReadonlyMap<string, string>;
  readonly largestDescendantFileCount: number;
}

function buildLazyDirectoryNode(
  directory: DirectoryNode,
  collapsedDirs: ReadonlySet<string>,
  visuals: DirectoryVisuals,
): cytoscape.NodeDefinition {
  const isLazyCollapsed = collapsedDirs.has(directory.path);
  const isHidden = isDirectoryHiddenByCollapse(directory, collapsedDirs);
  const classes = ['directory-node', isLazyCollapsed ? 'lazy-collapsed' : null, isHidden ? 'hidden-by-collapse' : null]
    .filter((value): value is string => value !== null)
    .join(' ');
  const baseLabel = directoryLabel(directory.path);
  const dominantModule = visuals.dominantModuleByDirectory.get(directory.path);
  return {
    data: {
      id: directoryNodeId(directory.path),
      // Two lines, not "name (+239)": in a directory-first entering view this
      // label is the primary thing being read (`graph-style.ts` wraps it).
      label: isLazyCollapsed ? `${baseLabel}\n${formatFileCount(directory.descendantFileCount)}` : baseLabel,
      path: directory.path,
      ...parentIdField(directoryParentId(directory)),
      descendantFileCount: directory.descendantFileCount,
      size: computeDirectorySize(directory.descendantFileCount, visuals.largestDescendantFileCount),
      color:
        dominantModule === undefined ? NO_MODULE_COLOR : (visuals.moduleColors.get(dominantModule) ?? NO_MODULE_COLOR),
    },
    classes,
  };
}

function buildLazyDirectoryNodes(
  result: AnalysisResult,
  collapsedDirs: ReadonlySet<string>,
  moduleColors: ReadonlyMap<string, string>,
): cytoscape.NodeDefinition[] {
  const visuals: DirectoryVisuals = {
    moduleColors,
    dominantModuleByDirectory: computeDominantModuleByDirectory(result.files),
    largestDescendantFileCount: result.directories.reduce(
      (largest, directory) => Math.max(largest, directory.descendantFileCount),
      0,
    ),
  };
  return result.directories.map((directory) => buildLazyDirectoryNode(directory, collapsedDirs, visuals));
}

function buildLazyEdges(result: AnalysisResult, collapsedDirs: ReadonlySet<string>): cytoscape.EdgeDefinition[] {
  const directEdges: cytoscape.EdgeDefinition[] = [];
  const aggregateEdges = new Map<string, cytoscape.EdgeDefinition>();
  result.edges.forEach((edge) => {
    const sourceId = resolveVisibleNodeId(edge.fromPath, collapsedDirs);
    const targetId = resolveVisibleNodeId(edge.toPath, collapsedDirs);
    if (sourceId === targetId) {
      return; // both endpoints fold into the same visible node: an edge internal to one (collapsed) directory, not shown
    }
    const isDirect = sourceId === fileNodeId(edge.fromPath) && targetId === fileNodeId(edge.toPath);
    if (isDirect) {
      directEdges.push({
        data: { id: `${sourceId}->${targetId}#${edge.line}`, source: sourceId, target: targetId, kind: edge.kind },
        classes: 'import-edge',
      });
      return;
    }
    const key = `${sourceId}=>${targetId}`;
    if (!aggregateEdges.has(key)) {
      aggregateEdges.set(key, {
        data: { id: `dir-edge:${key}`, source: sourceId, target: targetId },
        classes: 'import-edge directory-edge',
      });
    }
  });
  return [...directEdges, ...aggregateEdges.values()];
}

export interface LazyGraphElements extends GraphElements {
  /** Directory paths currently collapsed (materialized as a compound node, but with no real descendant elements yet). */
  readonly lazyDirectoryPaths: ReadonlySet<string>;
}

/**
 * Builds only the Cytoscape elements that are actually visible given
 * `collapsedDirs`. When `collapsedDirs` is empty (the common case for a
 * repo under the auto-collapse threshold) this produces node-for-node,
 * edge-for-edge the same output as `buildGraphElements` — lazy
 * materialization is strictly additive, never a behavior change, for a repo
 * small enough that nothing is ever hidden.
 */
export function buildLazyGraphElements(result: AnalysisResult, collapsedDirs: ReadonlySet<string>): LazyGraphElements {
  const directoryPaths = new Set(result.directories.map((directory) => directory.path));
  const moduleColors = assignModuleColors(result.modules.map((moduleCard) => moduleCard.id));
  const visibleFiles = result.files.filter(
    (file) => shallowestCollapsedAncestor(directoryContaining(file.path), collapsedDirs) === null,
  );
  return {
    nodes: [
      ...buildLazyDirectoryNodes(result, collapsedDirs, moduleColors),
      ...buildFileNodes(visibleFiles, directoryPaths, moduleColors),
    ],
    edges: buildLazyEdges(result, collapsedDirs),
    lazyDirectoryPaths: collapsedDirs,
  };
}
// #endregion
