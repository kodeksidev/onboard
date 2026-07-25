/**
 * @onboard/engine — POSIX path helpers (Section 8.8, A22).
 *
 * "Normalize to POSIX at the walk boundary and nowhere else": `toPosixPath`
 * and `toRepoRelativePosixPath` are the ONLY functions in the engine allowed
 * to touch a platform-native (possibly backslash-separated) path. Every other
 * module works exclusively with the POSIX strings these produce, using the
 * pure string helpers below (which mirror `node:path/posix` and never touch
 * the filesystem or the host platform's separator).
 */
import { posix as pathPosix, relative as nativeRelative } from 'node:path';

/** Replaces backslashes with forward slashes. Pure string operation. */
export function toPosixPath(input: string): string {
  return input.replaceAll('\\', '/');
}

/**
 * Computes `absPath` relative to `repoRootAbs` (both platform-native
 * absolute paths) and returns it as a POSIX string with no leading `./`.
 * This is the walk boundary: the only place a native path is converted.
 */
export function toRepoRelativePosixPath(repoRootAbs: string, absPath: string): string {
  const nativeRel = nativeRelative(repoRootAbs, absPath);
  return toPosixPath(nativeRel);
}

/** Splits an already-POSIX path into its segments (no empty segments). */
export function splitPosixSegments(relPath: string): readonly string[] {
  return relPath.split('/').filter((segment) => segment.length > 0);
}

/** POSIX `dirname`, operating on an already-POSIX string. */
export function posixDirname(relPath: string): string {
  return pathPosix.dirname(relPath);
}

/** POSIX `basename`, operating on an already-POSIX string. */
export function posixBasename(relPath: string): string {
  return pathPosix.basename(relPath);
}

/** POSIX `extname` without the leading dot, lowercased; `''` when absent. */
export function posixExtLower(relPath: string): string {
  const ext = pathPosix.extname(relPath);
  return ext.startsWith('.') ? ext.slice(1).toLowerCase() : ext.toLowerCase();
}

/** POSIX `join`, operating on already-POSIX segments. */
export function posixJoin(...segments: readonly string[]): string {
  return pathPosix.join(...segments);
}

/** Basename without its extension, e.g. `'user.test.ts'` -> `'user.test'`. */
export function posixBasenameWithoutExt(relPath: string): string {
  const base = posixBasename(relPath);
  const ext = pathPosix.extname(base);
  return ext.length > 0 ? base.slice(0, -ext.length) : base;
}
