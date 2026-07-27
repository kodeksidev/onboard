import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { OVERVIEW_COPY } from '@/copy/messages';

export interface EntryPointListProps {
  readonly entryPoints: AnalysisResult['entryPoints'];
  readonly onOpenFile: (path: string, line?: number) => void;
}

/** Entry points ranked by likelihood (Section 7.1's `EntryPoint`, already sorted by `rank`). */
export function EntryPointList({ entryPoints, onOpenFile }: EntryPointListProps): JSX.Element {
  return (
    <section aria-labelledby="entry-points-title" className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h3 id="entry-points-title" className="mb-3 text-sm font-semibold">
        Entry points
      </h3>
      {entryPoints.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-500">{OVERVIEW_COPY.noEntryPoints.description}</p>
      ) : (
        <ol className="space-y-2 text-sm">
          {entryPoints.map((entryPoint) => (
            <li key={entryPoint.path} className="flex flex-col">
              <button
                type="button"
                onClick={() => onOpenFile(entryPoint.path)}
                className="text-left font-mono text-xs underline-offset-2 hover:underline"
              >
                {entryPoint.path}
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-500">{entryPoint.evidence}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
