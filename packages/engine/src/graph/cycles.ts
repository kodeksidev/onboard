/**
 * @onboard/engine — import cycles (Section 7.1's `Cycle` type, Section 8.5
 * step 1: "a cycle is ONE step, never a loop in the reading path").
 *
 * Every strongly-connected component of size >= 2 (Section 8.5 filters
 * singletons out implicitly — a lone file is not a cycle) becomes one
 * `Cycle`. `paths` is "rotated so the lexicographically smallest is first":
 * reconstructed as a deterministic greedy tour starting at the smallest
 * member and always stepping to the smallest unvisited in-SCC neighbor,
 * falling back to the smallest remaining unvisited member when the walk
 * dead-ends (an SCC can have internal branching beyond one simple loop).
 */
import { byteCompare } from '../util/sort';

export interface CycleResult {
  readonly id: string;
  readonly paths: readonly string[];
  readonly edgeCount: number;
}

function buildCyclePath(members: readonly string[], outLinks: ReadonlyMap<string, readonly string[]>): readonly string[] {
  const memberSet = new Set(members);
  const sorted = [...members].sort(byteCompare);
  const visited = new Set<string>();
  const path: string[] = [];
  let current = sorted[0]!;
  for (let step = 0; step < sorted.length; step += 1) {
    visited.add(current);
    path.push(current);
    const neighbors = (outLinks.get(current) ?? []).filter((n) => memberSet.has(n) && !visited.has(n));
    const remaining = sorted.filter((m) => !visited.has(m));
    if (remaining.length === 0) {
      break;
    }
    current = neighbors.length > 0 ? [...neighbors].sort(byteCompare)[0]! : remaining[0]!;
  }
  return path;
}

function countInternalEdges(members: readonly string[], outLinks: ReadonlyMap<string, readonly string[]>): number {
  const memberSet = new Set(members);
  let count = 0;
  for (let i = 0; i < members.length; i += 1) {
    const links = outLinks.get(members[i]!) ?? [];
    for (let j = 0; j < links.length; j += 1) {
      if (memberSet.has(links[j]!)) {
        count += 1;
      }
    }
  }
  return count;
}

type UnrankedCycle = Omit<CycleResult, 'id'>;

function byCycleOrder(a: UnrankedCycle, b: UnrankedCycle): number {
  if (a.edgeCount !== b.edgeCount) {
    return b.edgeCount - a.edgeCount; // desc
  }
  return byteCompare(a.paths[0] ?? '', b.paths[0] ?? ''); // asc
}

/** Builds every `Cycle`, ranked by `edgeCount` desc then `paths[0]` asc (the contract's order). */
export function buildCycles(
  sccs: readonly (readonly string[])[],
  outLinks: ReadonlyMap<string, readonly string[]>,
): readonly CycleResult[] {
  const unranked = sccs
    .filter((scc) => scc.length >= 2)
    .map((scc) => ({ paths: buildCyclePath(scc, outLinks), edgeCount: countInternalEdges(scc, outLinks) }));
  const ranked = [...unranked].sort(byCycleOrder);
  return ranked.map((cycle, index) => ({ id: `cycle-${String(index + 1)}`, paths: cycle.paths, edgeCount: cycle.edgeCount }));
}
