import type { JSX } from 'react';
import type { EngineProgress } from '@onboard/contract';
import { ANALYSIS_PROGRESS_COPY } from '@/copy/messages';

export interface AnalysisProgressProps {
  readonly progress: EngineProgress | null;
}

function percentComplete(progress: EngineProgress): number {
  if (progress.total <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((progress.processed / progress.total) * 100));
}

/**
 * Mirrors `engine.progress` / `onboard://analysis-progress` (Section 7.3,
 * 7.4) while `engine.analyze` is in flight. `aria-live="polite"` announces
 * phase changes without interrupting a screen reader mid-sentence.
 */
export function AnalysisProgress({ progress }: AnalysisProgressProps): JSX.Element {
  const percent = progress === null ? 0 : percentComplete(progress);
  const phaseLabel =
    progress === null ? ANALYSIS_PROGRESS_COPY.title : ANALYSIS_PROGRESS_COPY.phaseLabels[progress.phase];

  return (
    <section
      aria-labelledby="analysis-progress-title"
      className="flex flex-1 flex-col items-center justify-center gap-4 p-12"
    >
      <h2 id="analysis-progress-title" className="text-xl font-semibold">
        {ANALYSIS_PROGRESS_COPY.title}
      </h2>
      <p aria-live="polite" className="text-sm text-slate-600 dark:text-slate-400">
        {phaseLabel}
      </p>
      <progress
        aria-label={ANALYSIS_PROGRESS_COPY.title}
        value={percent}
        max={100}
        className="h-2 w-64"
      />
    </section>
  );
}
