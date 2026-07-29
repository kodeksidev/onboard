/**
 * @onboard/engine — Tarjan's strongly-connected-components algorithm
 * (Section 8.5 step 1: "nodes visited in sorted-path order, neighbors in
 * sorted order").
 *
 * Implemented iteratively (an explicit work stack standing in for the call
 * stack) rather than recursively: a 10,000-file repo (Section 11's largest
 * performance budget) could exceed the JS call stack with a naive recursive
 * DFS. `for...of` is lint-banned in this directory — every loop is an
 * indexed `for` or a `while` over an explicit stack.
 */
import { byteCompare } from '../util/sort';

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

interface Frame {
  readonly node: string;
  neighborIndex: number;
}

function buildAdjacency(order: readonly string[], edges: readonly GraphEdge[]): Map<string, readonly string[]> {
  const targetSets = new Map<string, Set<string>>();
  for (let i = 0; i < order.length; i += 1) {
    targetSets.set(order[i]!, new Set());
  }
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i]!;
    targetSets.get(edge.from)?.add(edge.to);
  }
  const adjacency = new Map<string, readonly string[]>();
  for (let i = 0; i < order.length; i += 1) {
    const node = order[i]!;
    const targets = targetSets.get(node);
    adjacency.set(node, targets === undefined ? [] : [...targets].sort(byteCompare));
  }
  return adjacency;
}

interface TarjanState {
  readonly indices: Map<string, number>;
  readonly lowlink: Map<string, number>;
  readonly onStack: Set<string>;
  readonly componentStack: string[];
  readonly counterRef: { value: number };
  readonly sccs: string[][];
}

function visitNewNode(node: string, state: TarjanState): void {
  state.indices.set(node, state.counterRef.value);
  state.lowlink.set(node, state.counterRef.value);
  state.counterRef.value += 1;
  state.componentStack.push(node);
  state.onStack.add(node);
}

/** Pops the finished frame; on exit, emits its SCC if it is its own component's root. */
function popFinishedFrame(frame: Frame, callStack: readonly Frame[], state: TarjanState): void {
  const parentFrame = callStack[callStack.length - 1];
  if (parentFrame !== undefined) {
    state.lowlink.set(parentFrame.node, Math.min(state.lowlink.get(parentFrame.node)!, state.lowlink.get(frame.node)!));
  }
  if (state.lowlink.get(frame.node) !== state.indices.get(frame.node)) {
    return;
  }
  const scc: string[] = [];
  // Declared without an initializer on purpose: the do-while body assigns
  // before any read, so a placeholder would be dead and would also mask a real
  // bug if the loop ever stopped executing at least once.
  let member: string;
  do {
    member = state.componentStack.pop()!;
    state.onStack.delete(member);
    scc.push(member);
  } while (member !== frame.node);
  state.sccs.push(scc);
}

/**
 * Runs one iterative Tarjan DFS rooted at `root`, appending every SCC found
 * to `state.sccs`. `state` is shared across roots, matching the standard
 * single-pass algorithm.
 */
function runFrom(root: string, adjacency: ReadonlyMap<string, readonly string[]>, state: TarjanState): void {
  const callStack: Frame[] = [{ node: root, neighborIndex: 0 }];
  visitNewNode(root, state);

  while (callStack.length > 0) {
    const frame = callStack[callStack.length - 1]!;
    const neighbors = adjacency.get(frame.node) ?? [];
    if (frame.neighborIndex < neighbors.length) {
      const next = neighbors[frame.neighborIndex]!;
      frame.neighborIndex += 1;
      if (!state.indices.has(next)) {
        visitNewNode(next, state);
        callStack.push({ node: next, neighborIndex: 0 });
      } else if (state.onStack.has(next)) {
        state.lowlink.set(frame.node, Math.min(state.lowlink.get(frame.node)!, state.indices.get(next)!));
      }
      continue;
    }
    callStack.pop();
    popFinishedFrame(frame, callStack, state);
  }
}

/** Computes every strongly-connected component of `nodes`/`edges` (Section 8.5 step 1). */
export function computeStronglyConnectedComponents(
  nodes: readonly string[],
  edges: readonly GraphEdge[],
): readonly (readonly string[])[] {
  const order = [...nodes].sort(byteCompare);
  const adjacency = buildAdjacency(order, edges);
  const state: TarjanState = {
    indices: new Map(),
    lowlink: new Map(),
    onStack: new Set(),
    componentStack: [],
    counterRef: { value: 0 },
    sccs: [],
  };

  for (let i = 0; i < order.length; i += 1) {
    const root = order[i]!;
    if (!state.indices.has(root)) {
      runFrom(root, adjacency, state);
    }
  }
  return state.sccs;
}
