/**
 * @onboard/engine — tsconfig/jsconfig discovery and `paths`/`baseUrl` resolution
 * (Section 8.2, JS/TS rules 1, 2, 4).
 */
import { posixDirname, posixJoin } from '../util/posix-path';

const MAX_EXTENDS_DEPTH = 8;

export interface PathsPattern {
  readonly pattern: string;
  readonly targets: readonly string[];
}

export interface ResolvedTsconfig {
  readonly path: string; // repo-relative POSIX path to the tsconfig/jsconfig itself
  readonly dirPath: string; // its containing directory, repo-relative POSIX ('' for root)
  readonly baseUrl: string | null; // repo-relative POSIX, resolved against dirPath
  /** Sorted once by (non-wildcard character count desc, pattern asc) — Section 8.2 rule 4. */
  readonly paths: readonly PathsPattern[];
}

export interface TsconfigDiagnostic {
  readonly code: 'TSCONFIG_UNREADABLE';
  readonly path: string;
}

export interface TsconfigDiscoveryInput {
  readonly tsconfigPaths: readonly string[];
  readonly readFile: (repoRelPath: string) => string | null;
}

export interface TsconfigDiscoveryResult {
  readonly configs: readonly ResolvedTsconfig[];
  readonly diagnostics: readonly TsconfigDiagnostic[];
}

interface RawTsconfig {
  readonly extends?: unknown;
  readonly compilerOptions?: {
    readonly baseUrl?: unknown;
    readonly paths?: unknown;
  };
}

interface CommentStripState {
  result: string;
  inString: boolean;
  inLineComment: boolean;
  inBlockComment: boolean;
}

/** Returns the number of extra characters consumed (0 or 1), mutating `state`. */
function stepCommentStrip(state: CommentStripState, ch: string, next: string | undefined): number {
  if (state.inLineComment) {
    if (ch === '\n') {
      state.inLineComment = false;
      state.result += ch;
    }
    return 0;
  }
  if (state.inBlockComment) {
    if (ch === '*' && next === '/') {
      state.inBlockComment = false;
      return 1;
    }
    return 0;
  }
  if (state.inString) {
    state.result += ch;
    if (ch === '\\') {
      state.result += next ?? '';
      return 1;
    }
    if (ch === '"') {
      state.inString = false;
    }
    return 0;
  }
  if (ch === '"') {
    state.inString = true;
    state.result += ch;
    return 0;
  }
  if (ch === '/' && next === '/') {
    state.inLineComment = true;
    return 1;
  }
  if (ch === '/' && next === '*') {
    state.inBlockComment = true;
    return 1;
  }
  state.result += ch;
  return 0;
}

/** Strips `//` and `/* *‍/` comments outside of string literals (tsconfig is JSONC). */
function stripJsonComments(text: string): string {
  const state: CommentStripState = { result: '', inString: false, inLineComment: false, inBlockComment: false };
  for (let i = 0; i < text.length; i += 1) {
    i += stepCommentStrip(state, text[i]!, text[i + 1]);
  }
  return state.result;
}

function parseRawConfig(text: string): RawTsconfig | null {
  try {
    return JSON.parse(stripJsonComments(text)) as RawTsconfig;
  } catch {
    return null;
  }
}

function nonWildcardLength(pattern: string): number {
  return pattern.replace(/\*/g, '').length;
}

function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byPatternSpecificity(a: PathsPattern, b: PathsPattern): number {
  const lengthDiff = nonWildcardLength(b.pattern) - nonWildcardLength(a.pattern);
  return lengthDiff !== 0 ? lengthDiff : byteCompare(a.pattern, b.pattern);
}

function extractPaths(rawPaths: unknown): readonly PathsPattern[] {
  if (rawPaths === null || typeof rawPaths !== 'object') {
    return [];
  }
  const entries = Object.entries(rawPaths as Record<string, unknown>);
  const patterns: PathsPattern[] = [];
  for (const [pattern, targets] of entries) {
    if (Array.isArray(targets)) {
      patterns.push({ pattern, targets: targets.filter((t): t is string => typeof t === 'string') });
    }
  }
  return [...patterns].sort(byPatternSpecificity);
}

interface MergedOptions {
  baseUrl: string | null;
  paths: readonly PathsPattern[];
}

/** Follows `extends` root-to-leaf (leaf overrides), capped at `MAX_EXTENDS_DEPTH`. */
function loadChain(
  path: string,
  readFile: (p: string) => string | null,
  visited: Set<string>,
  diagnostics: TsconfigDiagnostic[],
): readonly RawTsconfig[] {
  if (visited.has(path) || visited.size >= MAX_EXTENDS_DEPTH) {
    return [];
  }
  visited.add(path);
  const content = readFile(path);
  if (content === null) {
    diagnostics.push({ code: 'TSCONFIG_UNREADABLE', path });
    return [];
  }
  const raw = parseRawConfig(content);
  if (raw === null) {
    diagnostics.push({ code: 'TSCONFIG_UNREADABLE', path });
    return [];
  }
  const parentChain =
    typeof raw.extends === 'string'
      ? loadChain(posixJoin(posixDirname(path), raw.extends), readFile, visited, diagnostics)
      : [];
  return [...parentChain, raw];
}

function mergeChain(chain: readonly RawTsconfig[], dirPath: string): MergedOptions {
  let baseUrl: string | null = null;
  let pathsRecord: Record<string, unknown> = {};
  for (const raw of chain) {
    const compilerOptions = raw.compilerOptions;
    if (compilerOptions === undefined) {
      continue;
    }
    if (typeof compilerOptions.baseUrl === 'string') {
      baseUrl = posixJoin(dirPath, compilerOptions.baseUrl);
    }
    if (compilerOptions.paths !== null && typeof compilerOptions.paths === 'object') {
      pathsRecord = { ...pathsRecord, ...(compilerOptions.paths as Record<string, unknown>) };
    }
  }
  return { baseUrl, paths: extractPaths(pathsRecord) };
}

/** Loads and merges every `tsconfig.json`/`jsconfig.json` found in the walk. */
export function discoverTsconfigs(input: TsconfigDiscoveryInput): TsconfigDiscoveryResult {
  const diagnostics: TsconfigDiagnostic[] = [];
  const configs: ResolvedTsconfig[] = [];
  for (const path of input.tsconfigPaths) {
    const chain = loadChain(path, input.readFile, new Set(), diagnostics);
    if (chain.length === 0) {
      continue; // the leaf itself was unreadable/unparseable — already diagnosed, skip
    }
    const dirPath = posixDirname(path) === '.' ? '' : posixDirname(path);
    const merged = mergeChain(chain, dirPath);
    configs.push({ path, dirPath, baseUrl: merged.baseUrl, paths: merged.paths });
  }
  return { configs, diagnostics };
}

/** The tsconfig whose directory is the nearest ancestor of `fromPath` (Section 8.2 rule 2). */
export function findNearestTsconfig(
  configs: readonly ResolvedTsconfig[],
  fromPath: string,
): ResolvedTsconfig | null {
  let best: ResolvedTsconfig | null = null;
  for (const config of configs) {
    const isAncestor = config.dirPath === '' || fromPath.startsWith(`${config.dirPath}/`);
    if (!isAncestor) {
      continue;
    }
    if (best === null || config.dirPath.length > best.dirPath.length) {
      best = config;
    }
  }
  return best;
}

/** Matches `specifier` against a `paths` pattern (at most one `*`), returning the wildcard capture. */
export function matchPathsPattern(pattern: string, specifier: string): string | null {
  const starIndex = pattern.indexOf('*');
  if (starIndex === -1) {
    return specifier === pattern ? '' : null;
  }
  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return null;
  }
  if (specifier.length < prefix.length + suffix.length) {
    return null;
  }
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

/** Substitutes a wildcard capture into a `paths` target template. */
export function substituteTarget(target: string, capture: string): string {
  return target.replace('*', capture);
}
