/**
 * @onboard/engine — `AnalysisResult.directories` (Section 7.1's `DirectoryNode`).
 *
 * The repo root itself is never emitted as a `DirectoryNode` (`RepoPath`
 * requires a non-empty string, so `''` cannot be a valid `path`); a
 * top-level directory's `parentPath` is `null` rather than pointing at a
 * root that isn't itself represented.
 */
import { byteCompare } from './util/sort';
import { posixDirname } from './util/posix-path';

export interface DirectoryFileInput {
  readonly path: string;
  readonly classification: string;
}

export interface DirectoryNodeResult {
  readonly path: string;
  readonly parentPath: string | null;
  readonly fileCount: number;
  readonly descendantFileCount: number;
  readonly dominantClassification: string;
}

interface DirAccumulator {
  fileCount: number;
  descendantFileCount: number;
  readonly classificationCounts: Map<string, number>;
}

function ensureDir(dirMap: Map<string, DirAccumulator>, dir: string): DirAccumulator {
  let entry = dirMap.get(dir);
  if (entry === undefined) {
    entry = { fileCount: 0, descendantFileCount: 0, classificationCounts: new Map() };
    dirMap.set(dir, entry);
  }
  return entry;
}

function recordDirectFile(dirMap: Map<string, DirAccumulator>, dir: string, classification: string): void {
  if (dir === '') {
    return;
  }
  const entry = ensureDir(dirMap, dir);
  entry.fileCount += 1;
  entry.classificationCounts.set(classification, (entry.classificationCounts.get(classification) ?? 0) + 1);
}

function recordAncestors(dirMap: Map<string, DirAccumulator>, dir: string): void {
  if (dir === '') {
    return;
  }
  const segments = dir.split('/');
  let prefix = '';
  for (let i = 0; i < segments.length; i += 1) {
    prefix = prefix === '' ? segments[i]! : `${prefix}/${segments[i]!}`;
    ensureDir(dirMap, prefix).descendantFileCount += 1;
  }
}

function dominantClassificationOf(counts: ReadonlyMap<string, number>): string {
  let best = 'unknown';
  let bestCount = -1;
  counts.forEach((count, classification) => {
    if (count > bestCount || (count === bestCount && classification < best)) {
      bestCount = count;
      best = classification;
    }
  });
  return best;
}

function parentPathOf(dir: string): string | null {
  const lastSlash = dir.lastIndexOf('/');
  return lastSlash === -1 ? null : dir.slice(0, lastSlash);
}

/** Builds every non-root `DirectoryNode`, sorted by `path` (the contract's documented order). */
export function buildDirectoryNodes(files: readonly DirectoryFileInput[]): readonly DirectoryNodeResult[] {
  const dirMap = new Map<string, DirAccumulator>();
  files.forEach((file) => {
    const dir = posixDirname(file.path) === '.' ? '' : posixDirname(file.path);
    recordDirectFile(dirMap, dir, file.classification);
    recordAncestors(dirMap, dir);
  });
  const dirs = [...dirMap.keys()].sort(byteCompare);
  return dirs.map((dir) => {
    const entry = dirMap.get(dir)!;
    return {
      path: dir,
      parentPath: parentPathOf(dir),
      fileCount: entry.fileCount,
      descendantFileCount: entry.descendantFileCount,
      dominantClassification: dominantClassificationOf(entry.classificationCounts),
    };
  });
}
