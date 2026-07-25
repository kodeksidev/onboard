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
  result: AnalysisResult,
  directoryPaths: ReadonlySet<string>,
  moduleColors: ReadonlyMap<string, string>,
): cytoscape.NodeDefinition[] {
  return result.files.map((file) => ({
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
      ...buildFileNodes(result, directoryPaths, moduleColors),
    ],
    edges: buildEdges(result),
  };
}
