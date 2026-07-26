/**
 * @onboard/engine — orphan (fully-isolated) files (`graph.orphanPaths`).
 *
 * An orphan is a file with zero incoming AND zero outgoing edges — nothing
 * imports it and it imports nothing itself. This is deliberately narrower
 * than the roadmap's broader `unreached` section (Section 8.5 step 6), which
 * also catches files that DO have edges but are simply never reached by a
 * BFS from any entry point; Section 10 lists orphans as appearing inside
 * that broader `unreached` section, not as identical to it.
 */
import type { FileDegree } from './build-graph';
import { byteCompare } from '../util/sort';

/** Every fully-isolated file path, sorted ascending. */
export function findOrphanPaths(degrees: ReadonlyMap<string, FileDegree>): readonly string[] {
  const orphans: string[] = [];
  degrees.forEach((degree) => {
    if (degree.inDegree === 0 && degree.outDegree === 0) {
      orphans.push(degree.path);
    }
  });
  return orphans.sort(byteCompare);
}
