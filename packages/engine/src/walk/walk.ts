/**
 * @onboard/engine — deterministic filesystem walk (Section 8.1).
 *
 * Mirrors the spec's pseudocode with a recursive traversal instead of an
 * explicit stack: observable output is identical either way because (a)
 * every directory's entries are sorted before use, (b) the final result is
 * globally re-sorted (step 4), and (c) each recursive call carries its own
 * `.gitignore` layer stack, which is exactly the "ignoreStack" the explicit
 * stack version would need to carry alongside each pushed frame. All
 * filesystem access is behind `WalkFs`, replaceable in tests (see
 * `test/walk/walk.test.ts`'s shuffled-readdir and symlink-loop cases).
 */
import { readFileSync, readdirSync, realpathSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { HARD_IGNORE_DIRS, HARD_IGNORE_GLOBS, MAX_REPO_FILES } from '../constants';
import { splitPosixSegments } from '../util/posix-path';
import { isIgnoredByStack, loadGitignoreLayer, type IgnoreLayer } from './gitignore';

export interface FileRecord {
  readonly path: string; // repo-relative POSIX
  readonly sizeBytes: number;
}

export type WalkDiagnosticCode = 'SYMLINK_LOOP_SKIPPED';

export interface WalkDiagnostic {
  readonly code: WalkDiagnosticCode;
  readonly path: string;
}

export interface WalkResult {
  readonly files: readonly FileRecord[]; // sorted ascending by path (step 4)
  readonly filesIgnoredCount: number;
  readonly diagnostics: readonly WalkDiagnostic[]; // sorted ascending by path
}

export interface DirEntryInfo {
  readonly name: string;
  readonly isDirectory: boolean;
}

export interface WalkFs {
  readonly readDir: (absDirPath: string) => readonly DirEntryInfo[];
  readonly realPath: (absPath: string) => string;
  readonly readGitignoreText: (absDirPath: string) => string | null;
  readonly statSize: (absPath: string) => number;
}

export interface WalkOptions {
  readonly excludeGlobs?: readonly string[];
  readonly fs?: Partial<WalkFs>;
}

/** Thrown when the walk exceeds `MAX_REPO_FILES` (A16, Section 8.1 step 3). */
export class RepoTooLargeError extends Error {
  readonly code = 'E_REPO_TOO_LARGE' as const;
  readonly fileCount: number;

  constructor(fileCount: number) {
    super(
      `Repository has ${String(fileCount)} candidate files, exceeding the ` +
        `${String(MAX_REPO_FILES)}-file limit.`,
    );
    this.name = 'RepoTooLargeError';
    this.fileCount = fileCount;
  }
}

function resolveEntryIsDirectory(absDirPath: string, dirent: Dirent): boolean | null {
  if (dirent.isDirectory()) {
    return true;
  }
  if (dirent.isFile()) {
    return false;
  }
  if (dirent.isSymbolicLink()) {
    try {
      return statSync(join(absDirPath, dirent.name)).isDirectory();
    } catch {
      return null; // broken symlink target — not walkable
    }
  }
  return null; // socket, FIFO, device, etc.
}

function defaultReadDir(absDirPath: string): readonly DirEntryInfo[] {
  const dirents = readdirSync(absDirPath, { withFileTypes: true });
  const infos: DirEntryInfo[] = [];
  for (const dirent of dirents) {
    const isDirectory = resolveEntryIsDirectory(absDirPath, dirent);
    if (isDirectory === null) {
      continue;
    }
    infos.push({ name: dirent.name, isDirectory });
  }
  return infos;
}

function defaultReadGitignoreText(absDirPath: string): string | null {
  try {
    return readFileSync(join(absDirPath, '.gitignore'), 'utf8');
  } catch {
    return null;
  }
}

const DEFAULT_WALK_FS: WalkFs = {
  readDir: defaultReadDir,
  realPath: (absPath) => realpathSync(absPath),
  readGitignoreText: defaultReadGitignoreText,
  statSize: (absPath) => statSync(absPath).size,
};

function byName(a: DirEntryInfo, b: DirEntryInfo): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function byPath<T extends { readonly path: string }>(a: T, b: T): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function matchesHardIgnoreDir(relPath: string): boolean {
  return splitPosixSegments(relPath).some((segment) => HARD_IGNORE_DIRS.includes(segment));
}

/**
 * Joins a directory with an entry name using a plain `/`, never the
 * platform-native `node:path.join`. Real filesystem calls on every OS this
 * engine targets (Windows included) accept `/`-joined paths, and using a
 * fixed separator here — rather than one that changes with `process.platform`
 * — is what lets `WalkFs` fakes in tests use plain string keys.
 */
function joinAbsPath(absDir: string, name: string): string {
  return absDir.endsWith('/') || absDir.endsWith('\\') ? `${absDir}${name}` : `${absDir}/${name}`;
}

interface WalkContext {
  readonly fs: WalkFs;
  readonly excludeMatcher: Ignore;
  readonly hardGlobMatcher: Ignore;
  readonly visitedRealPaths: Set<string>;
  readonly diagnostics: WalkDiagnostic[];
}

function isEntryIgnored(ctx: WalkContext, relPath: string, layers: readonly IgnoreLayer[]): boolean {
  if (isIgnoredByStack(relPath, layers)) {
    return true;
  }
  if (matchesHardIgnoreDir(relPath)) {
    return true;
  }
  return ctx.hardGlobMatcher.ignores(relPath) || ctx.excludeMatcher.ignores(relPath);
}

function visitDirectoryEntry(
  ctx: WalkContext,
  absPath: string,
  relPath: string,
  layers: readonly IgnoreLayer[],
  files: FileRecord[],
): number {
  const real = ctx.fs.realPath(absPath);
  if (ctx.visitedRealPaths.has(real)) {
    ctx.diagnostics.push({ code: 'SYMLINK_LOOP_SKIPPED', path: relPath });
    return 0;
  }
  ctx.visitedRealPaths.add(real);
  return walkDirectory(ctx, absPath, relPath, layers, files);
}

function walkDirectory(
  ctx: WalkContext,
  absDir: string,
  relDir: string,
  parentLayers: readonly IgnoreLayer[],
  files: FileRecord[],
): number {
  const ownLayer = loadGitignoreLayer(ctx.fs, absDir, relDir);
  const layers = ownLayer ? [...parentLayers, ownLayer] : parentLayers;
  const entries = [...ctx.fs.readDir(absDir)].sort(byName);

  let ignoredCount = 0;
  for (const entry of entries) {
    const absPath = joinAbsPath(absDir, entry.name);
    const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
    if (isEntryIgnored(ctx, relPath, layers)) {
      ignoredCount += 1;
      continue;
    }
    if (entry.isDirectory) {
      ignoredCount += visitDirectoryEntry(ctx, absPath, relPath, layers, files);
      continue;
    }
    files.push({ path: relPath, sizeBytes: ctx.fs.statSize(absPath) });
  }
  return ignoredCount;
}

/** Runs the deterministic walk described in Section 8.1 from `repoRootAbs`. */
export function walk(repoRootAbs: string, options: WalkOptions = {}): WalkResult {
  const fs: WalkFs = { ...DEFAULT_WALK_FS, ...options.fs };
  const excludeMatcher = ignore().add([...(options.excludeGlobs ?? [])]);
  const hardGlobMatcher = ignore().add([...HARD_IGNORE_GLOBS]);
  const diagnostics: WalkDiagnostic[] = [];
  const files: FileRecord[] = [];
  const visitedRealPaths = new Set<string>();
  visitedRealPaths.add(fs.realPath(repoRootAbs));

  const ctx: WalkContext = { fs, excludeMatcher, hardGlobMatcher, visitedRealPaths, diagnostics };
  const filesIgnoredCount = walkDirectory(ctx, repoRootAbs, '', [], files);

  if (files.length > MAX_REPO_FILES) {
    throw new RepoTooLargeError(files.length);
  }

  return {
    files: [...files].sort(byPath),
    filesIgnoredCount,
    diagnostics: [...diagnostics].sort(byPath),
  };
}
