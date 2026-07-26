/**
 * @onboard/engine — confines `engine.readFile`/`engine.snippets` paths to
 * the repo root (Section 7.3's `engine.readFile` doc comment: "`..` and
 * escaping symlinks are rejected by the engine before this ever resolves").
 */
import { realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { splitPosixSegments } from '../util/posix-path';

/** True if any path segment is literally `..` (a traversal attempt). */
export function containsDotDotSegment(relPosixPath: string): boolean {
  return splitPosixSegments(relPosixPath).some((segment) => segment === '..');
}

function isWithinRoot(candidateAbs: string, canonicalRoot: string): boolean {
  return candidateAbs === canonicalRoot || candidateAbs.startsWith(`${canonicalRoot}${sep}`);
}

export type ResolvedRepoPath =
  | { readonly ok: true; readonly absPath: string }
  | { readonly ok: false; readonly reason: 'escapes' | 'not-found' | 'permission-denied' };

function reasonForRealpathError(error: unknown): 'not-found' | 'permission-denied' {
  const code = (error as { code?: string } | null)?.code;
  return code === 'EACCES' || code === 'EPERM' ? 'permission-denied' : 'not-found';
}

/**
 * Joins `relPosixPath` onto `canonicalRoot`, resolves symlinks via
 * `realpathSync`, and confirms the real path is still inside the root. Any
 * `..` segment, or a symlink that escapes the repo, resolves as `'escapes'`;
 * a path that no longer exists or can't be read resolves as `'not-found'`/
 * `'permission-denied'` respectively — distinguished so the caller can pick
 * the right `AppErrorCode` rather than reporting every failure as an escape.
 */
export function resolveRepoRelativePath(canonicalRoot: string, relPosixPath: string): ResolvedRepoPath {
  if (containsDotDotSegment(relPosixPath)) {
    return { ok: false, reason: 'escapes' };
  }
  const joined = join(canonicalRoot, relPosixPath);
  let realAbs: string;
  try {
    realAbs = realpathSync(joined);
  } catch (error) {
    return { ok: false, reason: reasonForRealpathError(error) };
  }
  return isWithinRoot(realAbs, canonicalRoot) ? { ok: true, absPath: realAbs } : { ok: false, reason: 'escapes' };
}
