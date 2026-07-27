import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { ROADMAP_COPY } from '@/copy/messages';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useGraphStore } from '@/state/graphStore';
import { RoadmapStepCard } from './RoadmapStepCard';
import { useRoadmapRoute } from './useRoadmapRoute';

export interface RoadmapPanelProps {
  readonly steps: AnalysisResult['roadmap']['steps'];
  readonly onOpenFile?: (path: string, line?: number) => void;
}

const NOOP_OPEN_FILE = (): void => undefined;

/**
 * The "start here" roadmap, rendered BOTH ways (Section 9 Phase 9): this
 * numbered step list, and — via `useRoadmapRoute` publishing the route into
 * `graphStore`, read by `DependencyGraph` whenever it is mounted — a
 * highlighted route through the graph. Clicking a step focuses and centers
 * that node in the graph through the same `graphStore.focusPath` seam
 * Phase 8 froze for exactly this purpose.
 */
export function RoadmapPanel({ steps, onOpenFile = NOOP_OPEN_FILE }: RoadmapPanelProps): JSX.Element {
  useRoadmapRoute(steps);
  const focusedPath = useGraphStore((state) => state.focusedPath);
  const focusPath = useGraphStore((state) => state.focusPath);

  return (
    <section aria-labelledby="roadmap-panel-title" className="flex flex-col gap-3 p-4">
      <h2 id="roadmap-panel-title" className="text-lg font-semibold">
        {ROADMAP_COPY.title}
      </h2>
      {steps.length === 0 ? (
        <EmptyState title={ROADMAP_COPY.empty.title} description={ROADMAP_COPY.empty.description} />
      ) : (
        <ol className="flex flex-col gap-2">
          {steps.map((step) => (
            <RoadmapStepCard
              key={step.order}
              step={step}
              isFocused={focusedPath === step.path}
              onFocus={() => focusPath(step.path)}
              onOpenFile={onOpenFile}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
