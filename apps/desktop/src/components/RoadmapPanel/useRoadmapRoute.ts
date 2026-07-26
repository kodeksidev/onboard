import { useEffect } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { useGraphStore } from '@/state/graphStore';

type RoadmapStep = AnalysisResult['roadmap']['steps'][number];

export interface RoutePair {
  readonly from: string;
  readonly to: string;
}

/**
 * Exactly `steps.length - 1` pairs connecting consecutive roadmap steps by
 * their representative `path`, in reading order (Section 9 Phase 9: "the
 * route overlay renders exactly steps.length - 1 connector segments"). A
 * cycle step's `companionPaths` (e.g. the fixture's step 6, a 3-file cycle
 * collapsed into one step) are deliberately NOT given their own segments —
 * the route is a reading path through STEPS, not through every file.
 */
export function buildRoutePairs(steps: readonly RoadmapStep[]): readonly RoutePair[] {
  const pairs: RoutePair[] = [];
  for (let index = 0; index < steps.length - 1; index += 1) {
    const from = steps[index];
    const to = steps[index + 1];
    if (from !== undefined && to !== undefined) {
      pairs.push({ from: from.path, to: to.path });
    }
  }
  return pairs;
}

/**
 * Publishes the roadmap's reading-order route (the ordered list of step
 * paths) into `graphStore` so `DependencyGraph` can render the overlay
 * whenever it happens to be mounted — `RoadmapPanel` never needs to know
 * whether the graph tab is even open. Clears the route on unmount so
 * closing the roadmap doesn't leave a stale overlay on the graph.
 */
export function useRoadmapRoute(steps: readonly RoadmapStep[]): void {
  const setRoutePaths = useGraphStore((state) => state.setRoutePaths);

  useEffect(() => {
    setRoutePaths(steps.map((step) => step.path));
    return () => setRoutePaths([]);
  }, [steps, setRoutePaths]);
}
