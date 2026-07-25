import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';

export interface StackCardProps {
  readonly stack: AnalysisResult['stack'];
}

/** Stack summary: languages by share, manifests, and top runtime dependencies. */
export function StackCard({ stack }: StackCardProps): JSX.Element {
  return (
    <section aria-labelledby="stack-card-title" className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h3 id="stack-card-title" className="mb-3 text-sm font-semibold">
        Stack
      </h3>
      <ul className="mb-3 flex flex-wrap gap-2">
        {stack.languages.map((language) => (
          <li
            key={language.language}
            className="rounded bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800"
          >
            {language.language} · {language.sharePercent.toFixed(1)}%
          </li>
        ))}
      </ul>
      <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
        {stack.manifests.map((manifest) => (
          <li key={manifest.path}>
            {manifest.projectName ?? manifest.path} ({manifest.kind})
          </li>
        ))}
      </ul>
      <ul className="mt-3 space-y-1 text-xs">
        {stack.dependencies
          .filter((dependency) => dependency.scope === 'runtime')
          .map((dependency) => (
            <li key={dependency.name}>
              <span className="font-medium">{dependency.name}</span>
              {dependency.inferredRole !== null ? ` — ${dependency.inferredRole}` : ''}
            </li>
          ))}
      </ul>
    </section>
  );
}
