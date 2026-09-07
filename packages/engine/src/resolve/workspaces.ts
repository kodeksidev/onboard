/**
 * @onboard/engine — monorepo workspace package discovery (Section 8.2, JS/TS
 * rule 7; Section 10 "monorepo workspace import"; Section 14 known-hard-part 5).
 *
 * Resolves workspace package NAMES to their in-repo directory from
 * `package.json#workspaces`, `pnpm-workspace.yaml`, or `lerna.json` — never
 * by descending into `node_modules`. Glob expansion runs once, against the
 * walk's already-known directories (never the live filesystem), matching the
 * purity requirement resolution itself must uphold.
 */
import { splitPosixSegments } from '../util/posix-path';
import { parseJsonObject, parseManifest, type UnparseableSink } from '../util/json';

/**
 * How confidently this package's boundary is known — NOT part of the frozen
 * contract (`analyze-assemble.ts`'s `buildRepoSection` maps only `name`/
 * `dirPath` into `AnalysisResult.repo.workspacePackages`); this stays
 * engine-internal and exists for exactly one consumer:
 * `node-resolution.ts`'s bare-specifier resolution trusts `'declared'`
 * packages only (docs/DECISIONS.md, "inferred workspace names do not
 * participate in resolution"). A `'declared'` name is the repo's own root
 * manifest saying "this name is mine, resolve it locally." An `'inferred'`
 * name is this project guessing from directory shape alone — if an
 * inferred name collided with a real npm dependency's name, a genuine
 * external import would silently misresolve as an internal one: a WRONG
 * edge, not a missing one, and wrong edges propagate into PageRank,
 * importance, and the roadmap. Manifests, dependencies, `detectedType`,
 * `sourceRoots`, and `entryPoints` all use both kinds; resolution does not.
 */
export type WorkspacePackageSource = 'declared' | 'inferred';

export interface WorkspacePackage {
  readonly name: string;
  readonly dirPath: string; // repo-relative POSIX, '' for the repo root
  /** `exports['.']`/`exports` (string form) -> `module` -> `main`, whichever is found first. */
  readonly entryField: string | null;
  readonly source: WorkspacePackageSource;
}

/**
 * The narrowed shape `node-resolution.ts`'s `NodeResolutionContext` actually
 * requires. Making the isolation above structural rather than a filtering
 * convention at one call site: a comment saying "filter this before passing
 * it to the resolver" can be missed by the next caller; a type that will
 * not accept the unfiltered list cannot be. `declaredOnly` below is the
 * only supported way to produce this type — there is no public constructor
 * for it other than filtering a real `WorkspacePackage[]`, so a future
 * caller cannot manufacture a `DeclaredWorkspacePackage` that skipped the
 * filter.
 */
export interface DeclaredWorkspacePackage extends WorkspacePackage {
  readonly source: 'declared';
}

/** Narrows a mixed (declared + inferred) list to the ones resolution may trust. */
export function declaredOnly(packages: readonly WorkspacePackage[]): readonly DeclaredWorkspacePackage[] {
  return packages.filter((pkg): pkg is DeclaredWorkspacePackage => pkg.source === 'declared');
}

export interface WorkspaceDiscoveryInput {
  readonly existingPaths: ReadonlySet<string>;
  readonly readFile: (repoRelPath: string) => string | null;
  /** Notified with the path of any manifest that did not parse (see `util/json.ts`). */
  readonly onUnparseable?: UnparseableSink;
}

function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** `package.json#workspaces`: either a bare array or `{ packages: [...] }`. */
function globsFromPackageJson(content: string | null): readonly string[] {
  if (content === null) {
    return [];
  }
  const outcome = parseJsonObject(content);
  if (!outcome.ok) {
    return [];
  }
  const workspaces = outcome.value.workspaces;
  if (Array.isArray(workspaces)) {
    return stringArray(workspaces);
  }
  if (workspaces !== null && typeof workspaces === 'object') {
    return stringArray((workspaces as { packages?: unknown }).packages);
  }
  return [];
}

/** Minimal `packages:` list reader for `pnpm-workspace.yaml` — not a general YAML parser. */
function globsFromPnpmWorkspaceYaml(content: string | null): readonly string[] {
  if (content === null) {
    return [];
  }
  const lines = content.split('\n');
  const globs: string[] = [];
  let inPackagesList = false;
  for (const line of lines) {
    if (/^packages\s*:/.test(line.trim())) {
      inPackagesList = true;
      continue;
    }
    if (inPackagesList) {
      const match = /^\s*-\s*['"]?([^'"#]+)['"]?\s*$/.exec(line);
      if (match?.[1] !== undefined) {
        globs.push(match[1].trim());
        continue;
      }
      if (line.trim().length > 0 && !line.startsWith(' ')) {
        inPackagesList = false;
      }
    }
  }
  return globs;
}

function globsFromLernaJson(content: string | null): readonly string[] {
  if (content === null) {
    return [];
  }
  const outcome = parseJsonObject(content);
  if (!outcome.ok) {
    return [];
  }
  return stringArray(outcome.value.packages);
}

function collectWorkspaceGlobs(input: WorkspaceDiscoveryInput): readonly string[] {
  return [
    ...globsFromPackageJson(input.readFile('package.json')),
    ...globsFromPnpmWorkspaceYaml(input.readFile('pnpm-workspace.yaml')),
    ...globsFromLernaJson(input.readFile('lerna.json')),
  ];
}

/** Every unique ancestor directory (repo-relative POSIX, `''` = root) implied by the file set. */
function collectDirectories(existingPaths: ReadonlySet<string>): ReadonlySet<string> {
  const directories = new Set<string>(['']);
  for (const path of existingPaths) {
    const segments = splitPosixSegments(path);
    let prefix = '';
    for (let i = 0; i < segments.length - 1; i += 1) {
      prefix = prefix === '' ? segments[i]! : `${prefix}/${segments[i]!}`;
      directories.add(prefix);
    }
  }
  return directories;
}

/** A workspace glob supports a single trailing `*` segment (the common case) or `**`. */
function globToPattern(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withGlobs = escaped.replace(/\*\*|\*/g, (m) => (m === String.raw`**` ? ".*" : "[^/]+"));
  return new RegExp(`^${withGlobs}$`);
}

function directoriesMatchingGlobs(globs: readonly string[], directories: ReadonlySet<string>): ReadonlySet<string> {
  const matched = new Set<string>();
  for (const glob of globs) {
    const pattern = globToPattern(glob);
    for (const dir of directories) {
      if (pattern.test(dir)) {
        matched.add(dir);
      }
    }
  }
  return matched;
}

function packageJsonPath(dirPath: string): string {
  return dirPath === '' ? 'package.json' : `${dirPath}/package.json`;
}

/** `exports['.']`/`exports` (string form) -> `module` -> `main` (Section 8.2 rule 7). */
function extractEntryField(parsed: Record<string, unknown>): string | null {
  const exportsField = parsed.exports;
  if (typeof exportsField === 'string') {
    return exportsField;
  }
  if (exportsField !== null && typeof exportsField === 'object') {
    const dot = (exportsField as Record<string, unknown>)['.'];
    if (typeof dot === 'string') {
      return dot;
    }
  }
  if (typeof parsed.module === 'string') {
    return parsed.module;
  }
  return typeof parsed.main === 'string' ? parsed.main : null;
}

/** Reads `<dirPath>/package.json`, if present and parseable and named, as one `WorkspacePackage`. */
function buildWorkspacePackage(
  dirPath: string,
  input: WorkspaceDiscoveryInput,
  source: WorkspacePackageSource,
): WorkspacePackage | null {
  const manifestPath = packageJsonPath(dirPath);
  if (!input.existingPaths.has(manifestPath)) {
    return null;
  }
  const content = input.readFile(manifestPath);
  const record = content === null ? null : parseManifest(content, manifestPath, input.onUnparseable);
  if (record === null) {
    return null;
  }
  const name = record.name;
  return typeof name === 'string' && name.length > 0
    ? { name, dirPath, entryField: extractEntryField(record), source }
    : null;
}

/** Immediate ('depth-1') child directories implied by the file set — `'a/b/c.ts'` contributes `'a'`, not `'a/b'`. */
function topLevelDirectories(existingPaths: ReadonlySet<string>): ReadonlySet<string> {
  const dirs = new Set<string>();
  for (const path of existingPaths) {
    const slash = path.indexOf('/');
    if (slash !== -1) {
      dirs.add(path.slice(0, slash));
    }
  }
  return dirs;
}

/** At least two named siblings, or inference does not apply — one incidental package.json proves nothing about repo shape. */
const MIN_INFERRED_SIBLING_PACKAGES = 2;
/**
 * Each candidate must hold at least this share of the LARGEST candidate's
 * file count to count as a real sibling rather than an incidental helper
 * (a `tools/` package sitting next to a substantial `app/` package). Ratio
 * to the largest candidate, not to the whole repo, so this scales with the
 * packages themselves rather than being diluted by unrelated root-level
 * files (docs, config, CI).
 */
const MIN_SIBLING_SIZE_RATIO = 0.2;
/** The qualifying candidates, combined, must cover a majority of the repo's own files — most of the repo living OUTSIDE every candidate means "packages exist in here somewhere," not "this repo IS these packages." */
const MIN_INFERRED_FILE_SHARE = 0.5;

function fileCountUnder(dirPath: string, existingPaths: ReadonlySet<string>): number {
  const prefix = `${dirPath}/`;
  let count = 0;
  for (const path of existingPaths) {
    if (path.startsWith(prefix)) {
      count += 1;
    }
  }
  return count;
}

/**
 * The "ordinary shape" named in docs/DECISIONS.md: sibling directories, each
 * independently a real named package, with no root manifest at all to
 * declare them (CacttusEdu: `backend/`, `dashboard/`, `cacttus-edu-front/`,
 * no root `package.json`). Deliberately narrow — this project has
 * repeatedly learned that an open-ended detection rule finds things nobody
 * meant (see docs/DECISIONS.md's route-query entry): a root `package.json`
 * being present at all opts out of inference entirely (an intentional
 * single-package repo is never reinterpreted), candidates need a real name
 * each, a candidate far smaller than its siblings does not count as one
 * (`MIN_SIBLING_SIZE_RATIO`), and the surviving candidates together must
 * hold a majority of the repo's own files (`MIN_INFERRED_FILE_SHARE`) — a
 * repo whose files mostly live outside every candidate is not "these
 * packages," whatever else is sitting alongside them.
 *
 * Uses the walk's existing-files count as the file-count basis, not the
 * "parsed source files" count specifically — that classification runs
 * later in `analyze.ts`'s pipeline (`classifyAll`, after workspace
 * discovery), so it is not available here yet. A deliberate simplification,
 * not an oversight: every walked file (source, config, fixtures) counts
 * toward "lives under this candidate," which is a coarser but adequate
 * proxy for repo shape.
 */
function inferSiblingPackages(input: WorkspaceDiscoveryInput): readonly WorkspacePackage[] {
  if (input.existingPaths.has('package.json')) {
    return [];
  }
  const candidateDirs = [...topLevelDirectories(input.existingPaths)].sort(byteCompare);
  const candidates = candidateDirs
    .map((dirPath) => buildWorkspacePackage(dirPath, input, 'inferred'))
    .filter((pkg): pkg is WorkspacePackage => pkg !== null);
  if (candidates.length < MIN_INFERRED_SIBLING_PACKAGES) {
    return [];
  }

  const fileCounts = new Map(candidates.map((pkg) => [pkg.dirPath, fileCountUnder(pkg.dirPath, input.existingPaths)]));
  const largestCount = Math.max(...fileCounts.values());
  const qualifying = candidates.filter((pkg) => (fileCounts.get(pkg.dirPath) ?? 0) >= largestCount * MIN_SIBLING_SIZE_RATIO);
  if (qualifying.length < MIN_INFERRED_SIBLING_PACKAGES) {
    return [];
  }

  const totalFileCount = input.existingPaths.size;
  const qualifyingFileCount = qualifying.reduce((sum, pkg) => sum + (fileCounts.get(pkg.dirPath) ?? 0), 0);
  if (totalFileCount === 0 || qualifyingFileCount / totalFileCount < MIN_INFERRED_FILE_SHARE) {
    return [];
  }
  return qualifying;
}

/** Discovers every in-repo workspace package, sorted by directory path. */
export function discoverWorkspacePackages(input: WorkspaceDiscoveryInput): readonly WorkspacePackage[] {
  const globs = collectWorkspaceGlobs(input);
  if (globs.length === 0) {
    return inferSiblingPackages(input);
  }
  const directories = collectDirectories(input.existingPaths);
  const matchedDirs = [...directoriesMatchingGlobs(globs, directories)].sort(byteCompare);
  return matchedDirs
    .map((dirPath) => buildWorkspacePackage(dirPath, input, 'declared'))
    .filter((pkg): pkg is WorkspacePackage => pkg !== null);
}
