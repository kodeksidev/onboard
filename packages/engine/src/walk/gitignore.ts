/**
 * @onboard/engine — nested `.gitignore` handling (Section 8.1 step 2d).
 *
 * Delegates all glob/negation semantics to the `ignore` package (Section 4:
 * "hand-rolling this is a known bug farm"). Nested `.gitignore` files are
 * modeled as a STACK of independent `Ignore` instances, one per directory
 * that contains a `.gitignore`, each holding patterns relative to its own
 * directory. A path is tested against the DEEPEST layer first; if that
 * layer's patterns say nothing about the path, the next-shallowest layer is
 * consulted, and so on up to the repo root. This is what "deepest file wins"
 * means: a nested `.gitignore`'s explicit `!negation` re-includes a path a
 * shallower `.gitignore` ignored, because the deepest layer that actually
 * matches the path decides the outcome.
 */
import ignore, { type Ignore } from 'ignore';

export interface IgnoreLayer {
  /** POSIX path of this layer's directory, relative to the repo root; `''` for the root. */
  readonly dirRelPath: string;
  readonly matcher: Ignore;
}

export interface GitignoreTextReader {
  /** Returns the raw `.gitignore` text for a directory, or `null` if absent/unreadable. */
  readonly readGitignoreText: (absDirPath: string) => string | null;
}

/** Loads the `.gitignore` layer for one directory, or `null` when it has none. */
export function loadGitignoreLayer(
  reader: GitignoreTextReader,
  absDirPath: string,
  dirRelPath: string,
): IgnoreLayer | null {
  const text = reader.readGitignoreText(absDirPath);
  if (text === null) {
    return null;
  }
  const matcher = ignore().add(text);
  return { dirRelPath, matcher };
}

/** Strips a layer's own directory prefix from a repo-relative path, or `null` if outside it. */
function relativeToLayer(relPath: string, dirRelPath: string): string | null {
  if (dirRelPath === '') {
    return relPath;
  }
  const prefix = `${dirRelPath}/`;
  return relPath.startsWith(prefix) ? relPath.slice(prefix.length) : null;
}

/**
 * Tests `relPath` (repo-relative POSIX) against a stack of `.gitignore`
 * layers ordered shallowest-first (root at index 0). Returns `true` when the
 * deepest layer with an opinion on the path says to ignore it.
 */
export function isIgnoredByStack(relPath: string, layers: readonly IgnoreLayer[]): boolean {
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (layer === undefined) {
      continue;
    }
    const scoped = relativeToLayer(relPath, layer.dirRelPath);
    if (scoped === null || scoped.length === 0) {
      continue;
    }
    const result = layer.matcher.test(scoped);
    if (result.ignored || result.unignored) {
      return result.ignored;
    }
  }
  return false;
}
