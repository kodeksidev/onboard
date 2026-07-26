/**
 * @onboard/engine — Python import resolution (Section 8.2's Python rules).
 *
 * PURE: `(fromPath, specifier, context) -> PythonResolution`, against a
 * pre-built `existingPathSet`/`directories` set — never the live filesystem.
 * `specifier` is the combined "module[.symbol]" (dots preserved for relative
 * imports) string `parse/python-parser.ts` already produces (Section 9
 * Phase 3), e.g. `.sibling`, `..models.User`, `typing.Optional`, `os.path`.
 */
import { posixDirname, splitPosixSegments } from '../util/posix-path';

export type PythonResolution =
  | { readonly kind: 'resolved'; readonly toPath: string }
  | { readonly kind: 'external'; readonly ecosystem: 'stdlib' | 'pypi' | 'unknown'; readonly packageName: string }
  | { readonly kind: 'unresolved'; readonly reason: 'no-match-on-disk' | 'namespace-package' };

export interface PythonResolutionContext {
  readonly existingPathSet: ReadonlySet<string>;
  readonly directories: ReadonlySet<string>;
  /** Ordered per Section 8.2 rule 1 (path length desc, then path asc). */
  readonly packageRoots: readonly string[];
  readonly stdlibModules: ReadonlySet<string>;
  readonly manifestPackageNames: ReadonlySet<string>;
}

function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function joinNonEmpty(base: string, segments: readonly string[]): string {
  const suffix = segments.join('/');
  if (base === '' && suffix === '') {
    return '';
  }
  if (base === '') {
    return suffix;
  }
  return suffix === '' ? base : `${base}/${suffix}`;
}

/** Tries `<base>/<segments>.py` then `<base>/<segments>/__init__.py` (Section 8.2 rule 2). */
function tryModulePath(base: string, segments: readonly string[], existingPathSet: ReadonlySet<string>): string | null {
  const modulePath = joinNonEmpty(base, segments);
  if (modulePath === '') {
    return null;
  }
  const asFile = `${modulePath}.py`;
  if (existingPathSet.has(asFile)) {
    return asFile;
  }
  const asPackage = `${modulePath}/__init__.py`;
  return existingPathSet.has(asPackage) ? asPackage : null;
}

function isNamespacePackageDir(base: string, segments: readonly string[], directories: ReadonlySet<string>): boolean {
  const dirPath = joinNonEmpty(base, segments);
  return dirPath !== '' && directories.has(dirPath);
}

interface ParsedSpecifier {
  readonly dots: number;
  readonly segments: readonly string[];
}

function parseSpecifier(specifier: string): ParsedSpecifier {
  let i = 0;
  while (specifier[i] === '.') {
    i += 1;
  }
  const rest = specifier.slice(i);
  return { dots: i, segments: rest.length > 0 ? rest.split('.') : [] };
}

function walkUpDir(dir: string, count: number): string {
  let segments = splitPosixSegments(dir);
  for (let i = 0; i < count && segments.length > 0; i += 1) {
    segments = segments.slice(0, -1);
  }
  return segments.join('/');
}

/** Tries the full segment path, then (rule 2's "from" fallback) its parent with the last segment dropped. */
function resolveAgainstBase(
  base: string,
  segments: readonly string[],
  context: PythonResolutionContext,
): { toPath: string } | 'namespace-package' | null {
  const full = tryModulePath(base, segments, context.existingPathSet);
  if (full !== null) {
    return { toPath: full };
  }
  if (segments.length > 1) {
    const parent = tryModulePath(base, segments.slice(0, -1), context.existingPathSet);
    if (parent !== null) {
      return { toPath: parent };
    }
  }
  if (isNamespacePackageDir(base, segments, context.directories)) {
    return 'namespace-package';
  }
  return null;
}

function resolveRelative(fromPath: string, parsed: ParsedSpecifier, context: PythonResolutionContext): PythonResolution {
  const base = walkUpDir(posixDirname(fromPath), parsed.dots - 1);
  const result = resolveAgainstBase(base, parsed.segments, context);
  if (result === 'namespace-package') {
    return { kind: 'unresolved', reason: 'namespace-package' };
  }
  if (result !== null) {
    return { kind: 'resolved', toPath: result.toPath };
  }
  return { kind: 'unresolved', reason: 'no-match-on-disk' };
}

function classifyExternal(topLevelName: string, context: PythonResolutionContext): PythonResolution {
  if (context.stdlibModules.has(topLevelName)) {
    return { kind: 'external', ecosystem: 'stdlib', packageName: topLevelName };
  }
  if (context.manifestPackageNames.has(topLevelName)) {
    return { kind: 'external', ecosystem: 'pypi', packageName: topLevelName };
  }
  return { kind: 'external', ecosystem: 'unknown', packageName: topLevelName };
}

function resolveAbsolute(parsed: ParsedSpecifier, context: PythonResolutionContext): PythonResolution {
  let sawNamespacePackage = false;
  for (const root of context.packageRoots) {
    const result = resolveAgainstBase(root, parsed.segments, context);
    if (result === 'namespace-package') {
      sawNamespacePackage = true;
      continue;
    }
    if (result !== null) {
      return { kind: 'resolved', toPath: result.toPath };
    }
  }
  if (sawNamespacePackage) {
    return { kind: 'unresolved', reason: 'namespace-package' };
  }
  const topLevelName = parsed.segments[0];
  return topLevelName === undefined
    ? { kind: 'unresolved', reason: 'no-match-on-disk' }
    : classifyExternal(topLevelName, context);
}

/** Resolves one Python `import`/`from ... import` specifier per Section 8.2. */
export function resolvePythonImport(
  fromPath: string,
  specifier: string,
  context: PythonResolutionContext,
): PythonResolution {
  const parsed = parseSpecifier(specifier);
  if (parsed.segments.length === 0) {
    return { kind: 'unresolved', reason: 'no-match-on-disk' };
  }
  return parsed.dots > 0 ? resolveRelative(fromPath, parsed, context) : resolveAbsolute(parsed, context);
}

function hasInitPyAncestor(dir: string, initPyDirs: ReadonlySet<string>): boolean {
  const segments = splitPosixSegments(dir);
  let prefix = '';
  for (let i = 0; i < segments.length - 1; i += 1) {
    prefix = prefix === '' ? segments[i]! : `${prefix}/${segments[i]!}`;
    if (initPyDirs.has(prefix)) {
      return true;
    }
  }
  return false;
}

function collectInitPyDirs(existingPaths: ReadonlySet<string>): ReadonlySet<string> {
  const dirs = new Set<string>();
  for (const path of existingPaths) {
    if (path === '__init__.py') {
      dirs.add('');
    } else if (path.endsWith('/__init__.py')) {
      dirs.add(path.slice(0, -'/__init__.py'.length));
    }
  }
  return dirs;
}

/** `[tool.poetry].packages` / `[tool.setuptools].packages` dirs — a targeted scan, not a full TOML parser. */
function manifestPackageDirs(readFile: (path: string) => string | null): readonly string[] {
  const content = readFile('pyproject.toml');
  if (content === null) {
    return [];
  }
  const match = /packages\s*=\s*\[([^\]]*)\]/s.exec(content);
  if (match?.[1] === undefined) {
    return [];
  }
  const includeMatches = [...match[1].matchAll(/include\s*=\s*"([^"]+)"/g)].map((m) => m[1]).filter(
    (value): value is string => value !== undefined,
  );
  if (includeMatches.length > 0) {
    return includeMatches;
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((value): value is string => value !== undefined);
}

function hasSrcDirectory(existingPaths: ReadonlySet<string>): boolean {
  for (const path of existingPaths) {
    if (path === 'src' || path.startsWith('src/')) {
      return true;
    }
  }
  return false;
}

function byRootOrder(a: string, b: string): number {
  return b.length - a.length || byteCompare(a, b);
}

export interface PackageRootDiscoveryInput {
  readonly existingPaths: ReadonlySet<string>;
  readonly readFile: (path: string) => string | null;
}

/** Discovers Python package roots per Section 8.2 rule 1, ordered length desc then path asc. */
export function discoverPythonPackageRoots(input: PackageRootDiscoveryInput): readonly string[] {
  const initPyDirs = collectInitPyDirs(input.existingPaths);
  const roots = new Set<string>();
  for (const dir of initPyDirs) {
    if (!hasInitPyAncestor(dir, initPyDirs)) {
      roots.add(dir);
    }
  }
  if (hasSrcDirectory(input.existingPaths)) {
    roots.add('src');
  }
  for (const dir of manifestPackageDirs(input.readFile)) {
    roots.add(dir);
  }
  roots.add('');
  return [...roots].sort(byRootOrder);
}
