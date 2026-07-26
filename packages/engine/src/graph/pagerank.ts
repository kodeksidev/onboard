/**
 * @onboard/engine — PageRank (Section 8.3).
 *
 * Determinism is the entire point of this file: the outer AND inner loops
 * iterate sorted ARRAYS (never a `Map`/`Set`), so every floating-point
 * addition happens in the same sequence on every machine; the iteration
 * count is capped and the result is rounded to 6 decimals before it ever
 * reaches JSON. `for...of` is lint-banned in this directory (Section 8.8) —
 * every loop below is an indexed `for` on a pre-sorted array.
 */
import { PAGERANK_DAMPING, PAGERANK_EPSILON, PAGERANK_MAX_ITERATIONS, PAGERANK_PRECISION } from '../constants';
import { roundFixed } from '../util/round';
import { byteCompare } from '../util/sort';

export interface PageRankEdge {
  readonly from: string;
  readonly to: string;
}

/** Unique, self-edge-free, ascending-sorted out-links per node — computed once. */
function buildOutLinks(order: readonly string[], edges: readonly PageRankEdge[]): Map<string, readonly string[]> {
  const targetsByNode = new Map<string, Set<string>>();
  for (let i = 0; i < order.length; i += 1) {
    targetsByNode.set(order[i]!, new Set());
  }
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i]!;
    if (edge.from === edge.to) {
      continue; // self-edges dropped before ranking
    }
    const targets = targetsByNode.get(edge.from);
    targets?.add(edge.to); // duplicate edges collapse to one via Set membership
  }
  const outLinks = new Map<string, readonly string[]>();
  for (let i = 0; i < order.length; i += 1) {
    const node = order[i]!;
    const targets = targetsByNode.get(node);
    outLinks.set(node, targets === undefined ? [] : [...targets].sort(byteCompare));
  }
  return outLinks;
}

function sumDanglingMass(order: readonly string[], rank: ReadonlyMap<string, number>, outLinks: ReadonlyMap<string, readonly string[]>): number {
  let total = 0;
  for (let i = 0; i < order.length; i += 1) {
    const node = order[i]!;
    if ((outLinks.get(node) ?? []).length === 0) {
      total += rank.get(node) ?? 0;
    }
  }
  return total;
}

function iterateOnce(
  order: readonly string[],
  rank: ReadonlyMap<string, number>,
  outLinks: ReadonlyMap<string, readonly string[]>,
  baseShare: number,
): Map<string, number> {
  const next = new Map<string, number>();
  for (let i = 0; i < order.length; i += 1) {
    next.set(order[i]!, baseShare);
  }
  for (let i = 0; i < order.length; i += 1) {
    const node = order[i]!;
    const links = outLinks.get(node) ?? [];
    if (links.length === 0) {
      continue;
    }
    const share = (rank.get(node) ?? 0) / links.length;
    for (let j = 0; j < links.length; j += 1) {
      const target = links[j]!;
      next.set(target, (next.get(target) ?? 0) + share);
    }
  }
  return next;
}

function totalDelta(order: readonly string[], next: ReadonlyMap<string, number>, rank: ReadonlyMap<string, number>): number {
  let delta = 0;
  for (let i = 0; i < order.length; i += 1) {
    const node = order[i]!;
    delta += Math.abs((next.get(node) ?? 0) - (rank.get(node) ?? 0));
  }
  return delta;
}

/** Computes PageRank over `nodes`/`edges`, per Section 8.3's exact algorithm. */
export function computePageRank(nodes: readonly string[], edges: readonly PageRankEdge[]): ReadonlyMap<string, number> {
  const n = nodes.length;
  if (n === 0) {
    return new Map();
  }
  const order = [...nodes].sort(byteCompare);
  const outLinks = buildOutLinks(order, edges);

  let rank = new Map<string, number>();
  for (let i = 0; i < order.length; i += 1) {
    rank.set(order[i]!, 1 / n);
  }

  for (let iteration = 0; iteration < PAGERANK_MAX_ITERATIONS; iteration += 1) {
    const danglingMass = sumDanglingMass(order, rank, outLinks);
    const baseShare = (1 - PAGERANK_DAMPING) / n + (PAGERANK_DAMPING * danglingMass) / n;
    const next = iterateOnce(order, rank, outLinks, baseShare);
    const delta = totalDelta(order, next, rank);
    rank = next;
    if (delta < PAGERANK_EPSILON) {
      break;
    }
  }

  const result = new Map<string, number>();
  for (let i = 0; i < order.length; i += 1) {
    const node = order[i]!;
    result.set(node, roundFixed(rank.get(node) ?? 0, PAGERANK_PRECISION));
  }
  return result;
}
