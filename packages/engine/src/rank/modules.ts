/**
 * @onboard/engine — module derivation (Section 8.6's closing paragraph).
 *
 * "Modules are directories at depth 1-2 below each sourceRoot containing
 * >= MODULE_MIN_FILES parsed files; a file belongs to its deepest qualifying
 * ancestor; module count is capped at MAX_MODULES, with the smallest merged
 * into a synthetic 'other' module."
 *
 * Qualification counts files DIRECTLY inside a candidate directory (not
 * recursively): recursive counting would let a directory qualify purely
 * because of a deeper subdirectory's files, and then — once "deepest
 * qualifying ancestor" reassigns those files to the deeper subdirectory
 * instead — leave the shallower directory qualifying but empty. Direct
 * counting avoids that paradox; see docs/DECISIONS.md.
 */
import { MAX_MODULES, MODULE_MIN_FILES } from '../constants';
import { byteCompare } from '../util/sort';
import { posixBasename, splitPosixSegments } from '../util/posix-path';

/** `purposeByConvention` static table, keyed by lowercased directory basename (Section 8.6). */
export const MODULE_PURPOSE_BY_DIRECTORY_NAME: Readonly<Record<string, string>> = {
  routes: 'HTTP route registration and request dispatch.',
  router: 'HTTP route registration and request dispatch.',
  api: 'Public API surface for this application.',
  controllers: 'Request handlers that translate HTTP input into service calls.',
  handlers: 'Request or event handlers.',
  services: 'Business logic, independent of any transport layer.',
  usecases: 'Application use-case orchestration.',
  domain: 'Core domain logic and business rules.',
  models: 'Data models, entities, and schemas.',
  entities: 'Data models, entities, and schemas.',
  schemas: 'Validation and data schemas.',
  migrations: 'Database schema migrations.',
  repositories: 'Data-access layer over a persistence store.',
  components: 'UI components.',
  ui: 'UI components and primitives.',
  widgets: 'UI components and primitives.',
  hooks: 'Reusable stateful logic (React-style hooks).',
  store: 'Application/client-side state management.',
  stores: 'Application/client-side state management.',
  state: 'Application/client-side state management.',
  reducers: 'State transition logic.',
  slices: 'State transition logic.',
  utils: 'Shared utility functions.',
  util: 'Shared utility functions.',
  helpers: 'Shared helper functions.',
  lib: 'Shared library code.',
  libs: 'Shared library code.',
  common: 'Code shared across modules.',
  shared: 'Code shared across modules.',
  config: 'Configuration and environment setup.',
  tests: 'Automated tests.',
  test: 'Automated tests.',
  scripts: 'Standalone operational or build scripts.',
  bin: 'Executable entry scripts.',
  middleware: 'Cross-cutting request/response middleware.',
  types: 'Shared type definitions.',
  constants: 'Shared constant values.',
  pages: 'Top-level routed pages/views.',
  views: 'Top-level views.',
};

export interface ModuleFileInput {
  readonly path: string;
  readonly isParsed: boolean;
  readonly importance: number;
  readonly importanceRank: number;
}

export interface ModuleEdgeInput {
  readonly fromPath: string;
  readonly toPath: string;
}

export interface ModuleInput {
  readonly files: readonly ModuleFileInput[];
  readonly sourceRoots: readonly string[];
  readonly edges: readonly ModuleEdgeInput[];
}

export interface ModuleResult {
  readonly id: string;
  readonly name: string;
  readonly dirPath: string;
  readonly purposeByConvention: string;
  readonly fileCount: number;
  readonly keyFilePaths: readonly string[];
  readonly dependsOnModuleIds: readonly string[];
  readonly dependedOnByModuleIds: readonly string[];
}

const OTHER_MODULE_DIR_PATH = 'other';
const KEY_FILE_LIMIT = 5;

function slugify(dirPath: string): string {
  return dirPath.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root';
}

function purposeFor(dirPath: string, fileCount: number): string {
  const known = MODULE_PURPOSE_BY_DIRECTORY_NAME[posixBasename(dirPath).toLowerCase()];
  return known ?? `${String(fileCount)} files; no directory convention matched.`;
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/** This file's depth-1 and depth-2 ancestor directories relative to whichever `sourceRoots` entry contains it. */
function candidateAncestors(filePath: string, sourceRoots: readonly string[]): readonly string[] {
  const ancestors: string[] = [];
  sourceRoots.forEach((root) => {
    if (root !== '' && !filePath.startsWith(`${root}/`)) {
      return;
    }
    const relative = root === '' ? filePath : filePath.slice(root.length + 1);
    const dirSegments = splitPosixSegments(relative).slice(0, -1); // drop the basename
    if (dirSegments.length >= 1) {
      ancestors.push(root === '' ? dirSegments[0]! : `${root}/${dirSegments[0]!}`);
    }
    if (dirSegments.length >= 2) {
      ancestors.push(root === '' ? `${dirSegments[0]!}/${dirSegments[1]!}` : `${root}/${dirSegments[0]!}/${dirSegments[1]!}`);
    }
  });
  return ancestors;
}

function isAtDepth1Or2(dir: string, sourceRoots: readonly string[]): boolean {
  return sourceRoots.some((root) => {
    if (root === '') {
      const depth = dir === '' ? 0 : splitPosixSegments(dir).length;
      return depth === 1 || depth === 2;
    }
    if (dir === root || !dir.startsWith(`${root}/`)) {
      return false;
    }
    const depth = splitPosixSegments(dir.slice(root.length + 1)).length;
    return depth === 1 || depth === 2;
  });
}

function selectQualifyingDirs(input: ModuleInput): ReadonlySet<string> {
  const directParsedCounts = new Map<string, number>();
  input.files.forEach((f) => {
    if (!f.isParsed) {
      return;
    }
    const dir = dirnameOf(f.path);
    directParsedCounts.set(dir, (directParsedCounts.get(dir) ?? 0) + 1);
  });
  const qualifying = new Set<string>();
  directParsedCounts.forEach((count, dir) => {
    if (count >= MODULE_MIN_FILES && isAtDepth1Or2(dir, input.sourceRoots)) {
      qualifying.add(dir);
    }
  });
  return qualifying;
}

/** The deepest of `dir`'s candidate ancestors that is itself qualifying, or `null`. */
function deepestQualifying(filePath: string, sourceRoots: readonly string[], qualifying: ReadonlySet<string>): string | null {
  const ancestors = candidateAncestors(filePath, sourceRoots).filter((a) => qualifying.has(a));
  if (ancestors.length === 0) {
    return null;
  }
  return ancestors.reduce((deepest, candidate) => (candidate.length > deepest.length ? candidate : deepest));
}

interface ModuleAssignment {
  readonly keptDirs: readonly string[];
  readonly moduleOfFile: ReadonlyMap<string, string>;
}

function assignFilesToModules(input: ModuleInput, qualifying: ReadonlySet<string>): ModuleAssignment {
  const assignedCounts = new Map<string, number>();
  const rawAssignment = new Map<string, string>();
  input.files.forEach((f) => {
    const dir = deepestQualifying(f.path, input.sourceRoots, qualifying);
    if (dir !== null) {
      rawAssignment.set(f.path, dir);
      assignedCounts.set(dir, (assignedCounts.get(dir) ?? 0) + 1);
    }
  });
  const rankedDirs = [...qualifying].sort(
    (a, b) => (assignedCounts.get(b) ?? 0) - (assignedCounts.get(a) ?? 0) || byteCompare(a, b),
  );
  const keptDirs = rankedDirs.slice(0, MAX_MODULES);
  const keptSet = new Set(keptDirs);

  const moduleOfFile = new Map<string, string>();
  rawAssignment.forEach((dir, path) => moduleOfFile.set(path, keptSet.has(dir) ? dir : OTHER_MODULE_DIR_PATH));
  return { keptDirs, moduleOfFile };
}

function buildModuleDependencies(
  moduleOfFile: ReadonlyMap<string, string>,
  edges: readonly ModuleEdgeInput[],
): { readonly dependsOn: Map<string, Set<string>>; readonly dependedOnBy: Map<string, Set<string>> } {
  const dependsOn = new Map<string, Set<string>>();
  const dependedOnBy = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    const fromModule = moduleOfFile.get(edge.fromPath);
    const toModule = moduleOfFile.get(edge.toPath);
    if (fromModule === undefined || toModule === undefined || fromModule === toModule) {
      return;
    }
    if (!dependsOn.has(fromModule)) {
      dependsOn.set(fromModule, new Set());
    }
    dependsOn.get(fromModule)?.add(toModule);
    if (!dependedOnBy.has(toModule)) {
      dependedOnBy.set(toModule, new Set());
    }
    dependedOnBy.get(toModule)?.add(fromModule);
  });
  return { dependsOn, dependedOnBy };
}

function keyFilesFor(dirPath: string, moduleOfFile: ReadonlyMap<string, string>, files: readonly ModuleFileInput[]): readonly string[] {
  return files
    .filter((f) => moduleOfFile.get(f.path) === dirPath)
    .sort((a, b) => a.importanceRank - b.importanceRank)
    .slice(0, KEY_FILE_LIMIT)
    .map((f) => f.path);
}

/** Derives every `ModuleCard`, sorted by `dirPath` (the contract's documented order). */
export function buildModules(input: ModuleInput): readonly ModuleResult[] {
  const qualifying = selectQualifyingDirs(input);
  if (qualifying.size === 0) {
    return [];
  }
  const { keptDirs, moduleOfFile } = assignFilesToModules(input, qualifying);
  const hasOther = [...moduleOfFile.values()].some((m) => m === OTHER_MODULE_DIR_PATH);
  const allModuleDirs = hasOther ? [...keptDirs, OTHER_MODULE_DIR_PATH] : keptDirs;
  const { dependsOn, dependedOnBy } = buildModuleDependencies(moduleOfFile, input.edges);

  const results: ModuleResult[] = allModuleDirs.map((dirPath) => {
    const fileCount = input.files.filter((f) => moduleOfFile.get(f.path) === dirPath).length;
    const isOther = dirPath === OTHER_MODULE_DIR_PATH;
    return {
      id: slugify(dirPath),
      name: isOther ? 'Other' : posixBasename(dirPath),
      dirPath,
      purposeByConvention: isOther ? 'Small modules grouped together.' : purposeFor(dirPath, fileCount),
      fileCount,
      keyFilePaths: keyFilesFor(dirPath, moduleOfFile, input.files),
      dependsOnModuleIds: [...(dependsOn.get(dirPath) ?? [])].sort(byteCompare).map(slugify),
      dependedOnByModuleIds: [...(dependedOnBy.get(dirPath) ?? [])].sort(byteCompare).map(slugify),
    };
  });
  return [...results].sort((a, b) => byteCompare(a.dirPath, b.dirPath));
}

/** Resolves the module id (not dirPath) a file belongs to, or `null` — used to populate `FileNode.moduleId`. */
export function computeModuleIdByPath(input: ModuleInput): ReadonlyMap<string, string> {
  const qualifying = selectQualifyingDirs(input);
  if (qualifying.size === 0) {
    return new Map();
  }
  const { moduleOfFile } = assignFilesToModules(input, qualifying);
  const result = new Map<string, string>();
  moduleOfFile.forEach((dirPath, path) => result.set(path, slugify(dirPath)));
  return result;
}
