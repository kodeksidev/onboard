import type { AnalysisResult } from '@onboard/contract';

/**
 * Transcribed from Section 8.6 / `packages/engine/src/constants.ts`'s
 * `MODULE_MIN_FILES`. The engine does not expose this threshold as a field
 * of `AnalysisResult` (Section 7's frozen contract), so it is named exactly
 * once here and referenced everywhere the module map's empty-state copy
 * needs it — never repeated as a bare literal — so the UI cannot silently
 * drift from the engine's own constant if it ever changes.
 */
export const MODULE_MIN_FILES = 3;

export interface LargestCandidateDirectory {
  readonly dirPath: string;
  readonly fileCount: number;
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function splitSegments(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/**
 * `dir` is a depth-1 or depth-2 directory below one of `sourceRoots`.
 * Mirrors `packages/engine/src/rank/modules.ts`'s `isAtDepth1Or2` exactly
 * (re-derived here, not imported, since `apps/desktop/**` cannot depend on
 * `packages/engine`) — re-derived ONLY to explain why the module map is
 * empty, never to assign modules itself (that stays the engine's job).
 */
function isAtDepth1Or2(dir: string, sourceRoots: readonly string[]): boolean {
  return sourceRoots.some((root) => {
    if (root === '') {
      const depth = dir === '' ? 0 : splitSegments(dir).length;
      return depth === 1 || depth === 2;
    }
    if (dir === root || !dir.startsWith(`${root}/`)) {
      return false;
    }
    const depth = splitSegments(dir.slice(root.length + 1)).length;
    return depth === 1 || depth === 2;
  });
}

/**
 * The biggest depth-1/2 candidate directory by DIRECT parsed-file count —
 * exactly the number Section 8.6 requires to reach `MODULE_MIN_FILES` and
 * qualify as a module. Used only to explain an empty module map with a real
 * number ("this repo's largest is `src` with 2"), never to assign modules.
 * Returns `null` when there is no candidate directory at all (e.g. no
 * parsed files, or no directory structure below any source root).
 */
export function findLargestCandidateDirectory(result: AnalysisResult): LargestCandidateDirectory | null {
  const directParsedCounts = new Map<string, number>();
  result.files.forEach((file) => {
    if (!file.isParsed) {
      return;
    }
    const dir = dirnameOf(file.path);
    directParsedCounts.set(dir, (directParsedCounts.get(dir) ?? 0) + 1);
  });

  let largest: LargestCandidateDirectory | null = null;
  directParsedCounts.forEach((fileCount, dirPath) => {
    if (!isAtDepth1Or2(dirPath, result.repo.sourceRoots)) {
      return;
    }
    if (largest === null || fileCount > largest.fileCount || (fileCount === largest.fileCount && dirPath < largest.dirPath)) {
      largest = { dirPath, fileCount };
    }
  });
  return largest;
}
