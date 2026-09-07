/**
 * @onboard/engine — JS/TS/TSX import resolution (Section 8.2, JS/TS rules 3-8).
 *
 * PURE: `(fromPath, specifier, context) -> NodeResolution`. `context` is built
 * once per `analyze()` call from the walk's `existingPathSet` plus parsed
 * tsconfigs/package.json metadata; this module never touches the filesystem.
 */
import { posixDirname, posixJoin } from '../util/posix-path';
import {
  findNearestTsconfig,
  matchPathsPattern,
  substituteTarget,
  type PathsPattern,
  type ResolvedTsconfig,
} from './tsconfig-paths';
import type { DeclaredWorkspacePackage, WorkspacePackage } from './workspaces';

const DIRECT_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const INDEX_SUFFIXES = ['/index.ts', '/index.tsx', '/index.mts', '/index.js', '/index.jsx', '/index.mjs', '/index.json'];

export type NodeResolution =
  | { readonly kind: 'resolved'; readonly toPath: string }
  | { readonly kind: 'external'; readonly packageName: string }
  | { readonly kind: 'unresolved'; readonly reason: 'no-match-on-disk' | 'alias-unmapped' };

export interface PackageImportsEntry {
  readonly dirPath: string; // directory containing the declaring package.json
  readonly patterns: readonly PathsPattern[];
}

export interface NodeResolutionContext {
  readonly existingPathSet: ReadonlySet<string>;
  readonly tsconfigs: readonly ResolvedTsconfig[];
  readonly packageImports: readonly PackageImportsEntry[];
  /**
   * `DeclaredWorkspacePackage`, not `WorkspacePackage` — deliberately narrower
   * than what `analyze.ts` knows overall (docs/DECISIONS.md, "resolution
   * isolation made structural"). An inferred workspace name is a guess from
   * directory shape; trusting it here would let a same-named real npm
   * dependency silently misresolve as an internal edge. `workspaces.ts`'s
   * `declaredOnly()` is the only way to produce this type, so a caller that
   * hands this context the full (declared + inferred) list does not compile.
   */
  readonly workspacePackages: readonly DeclaredWorkspacePackage[];
}

/** Every direct-candidate then every `/index.*`-candidate, in Section 8.2 rule 6's exact order. */
function candidatePaths(base: string): readonly string[] {
  return [...DIRECT_SUFFIXES.map((suffix) => `${base}${suffix}`), ...INDEX_SUFFIXES.map((suffix) => `${base}${suffix}`)];
}

function tryCandidates(base: string, existingPathSet: ReadonlySet<string>): NodeResolution | null {
  for (const candidate of candidatePaths(base)) {
    if (existingPathSet.has(candidate)) {
      return { kind: 'resolved', toPath: candidate };
    }
  }
  return null;
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function findNearestByDir<T extends { readonly dirPath: string }>(items: readonly T[], fromPath: string): T | null {
  let best: T | null = null;
  for (const item of items) {
    const isAncestor = item.dirPath === '' || fromPath.startsWith(`${item.dirPath}/`);
    if (!isAncestor) {
      continue;
    }
    if (best === null || item.dirPath.length > best.dirPath.length) {
      best = item;
    }
  }
  return best;
}

function resolveViaPatterns(
  specifier: string,
  patterns: readonly PathsPattern[],
  baseDir: string,
  existingPathSet: ReadonlySet<string>,
): NodeResolution | null {
  for (const { pattern, targets } of patterns) {
    const capture = matchPathsPattern(pattern, specifier);
    if (capture === null) {
      continue;
    }
    for (const target of targets) {
      const base = posixJoin(baseDir, substituteTarget(target, capture));
      const hit = tryCandidates(base, existingPathSet);
      if (hit !== null) {
        return hit;
      }
    }
    return { kind: 'unresolved', reason: 'alias-unmapped' };
  }
  return null;
}

function resolveRelative(fromPath: string, specifier: string, context: NodeResolutionContext): NodeResolution {
  const base = posixJoin(posixDirname(fromPath), specifier);
  return tryCandidates(base, context.existingPathSet) ?? { kind: 'unresolved', reason: 'no-match-on-disk' };
}

function resolvePackageImportsAlias(fromPath: string, specifier: string, context: NodeResolutionContext): NodeResolution {
  const entry = findNearestByDir(context.packageImports, fromPath);
  if (entry === null) {
    return { kind: 'unresolved', reason: 'no-match-on-disk' };
  }
  const result = resolveViaPatterns(specifier, entry.patterns, entry.dirPath, context.existingPathSet);
  return result ?? { kind: 'unresolved', reason: 'no-match-on-disk' };
}

function externalPackageName(specifier: string): string {
  const segments = specifier.split('/');
  if (specifier.startsWith('@') && segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0] ?? specifier;
}

function matchWorkspaceBase(specifier: string, pkg: WorkspacePackage): string | null {
  if (specifier === pkg.name) {
    return posixJoin(pkg.dirPath, pkg.entryField ?? 'index');
  }
  const prefix = `${pkg.name}/`;
  if (specifier.startsWith(prefix)) {
    return posixJoin(pkg.dirPath, specifier.slice(prefix.length));
  }
  return null;
}

function resolveBareSpecifier(specifier: string, context: NodeResolutionContext): NodeResolution {
  for (const pkg of context.workspacePackages) {
    const base = matchWorkspaceBase(specifier, pkg);
    if (base === null) {
      continue;
    }
    return tryCandidates(base, context.existingPathSet) ?? { kind: 'unresolved', reason: 'no-match-on-disk' };
  }
  return { kind: 'external', packageName: externalPackageName(specifier) };
}

/** Resolves one JS/TS/TSX specifier per Section 8.2's exact rule order. */
export function resolveNodeImport(fromPath: string, specifier: string, context: NodeResolutionContext): NodeResolution {
  if (isRelativeSpecifier(specifier)) {
    return resolveRelative(fromPath, specifier, context);
  }
  if (specifier.startsWith('#')) {
    return resolvePackageImportsAlias(fromPath, specifier, context);
  }
  const tsconfig = findNearestTsconfig(context.tsconfigs, fromPath);
  if (tsconfig !== null) {
    const baseDir = tsconfig.baseUrl ?? tsconfig.dirPath;
    const aliasResult = resolveViaPatterns(specifier, tsconfig.paths, baseDir, context.existingPathSet);
    if (aliasResult !== null) {
      return aliasResult;
    }
  }
  return resolveBareSpecifier(specifier, context);
}

function importsValueToTargets(value: unknown): readonly string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (value !== null && typeof value === 'object') {
    const fallback = (value as Record<string, unknown>).default;
    if (typeof fallback === 'string') {
      return [fallback];
    }
  }
  return [];
}

/** Discovers every `package.json#imports` (`#alias`) map in the walk (Section 8.2 rule 5). */
export function discoverPackageImports(
  existingPaths: ReadonlySet<string>,
  readFile: (repoRelPath: string) => string | null,
): readonly PackageImportsEntry[] {
  const entries: PackageImportsEntry[] = [];
  for (const path of existingPaths) {
    if (path !== 'package.json' && !path.endsWith('/package.json')) {
      continue;
    }
    const content = readFile(path);
    if (content === null) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== 'object') {
      continue;
    }
    const imports = (parsed as Record<string, unknown>).imports;
    if (imports === null || typeof imports !== 'object') {
      continue;
    }
    const patterns: PathsPattern[] = Object.entries(imports as Record<string, unknown>).map(([pattern, value]) => ({
      pattern,
      targets: importsValueToTargets(value),
    }));
    const dirPath = path === 'package.json' ? '' : path.slice(0, -'/package.json'.length);
    entries.push({ dirPath, patterns });
  }
  return entries;
}
