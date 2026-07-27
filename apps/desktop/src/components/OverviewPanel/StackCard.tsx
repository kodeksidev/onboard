import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { OVERVIEW_COPY } from '@/copy/messages';

export interface StackCardProps {
  readonly stack: AnalysisResult['stack'];
}

function LanguageList({ languages }: { readonly languages: AnalysisResult['stack']['languages'] }): JSX.Element {
  if (languages.length === 0) {
    return <p className="mb-3 text-xs text-slate-500 dark:text-slate-500">{OVERVIEW_COPY.noLanguages.description}</p>;
  }
  return (
    <ul className="mb-3 flex flex-wrap gap-2">
      {languages.map((language) => (
        <li key={language.language} className="rounded bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
          {language.language} · {language.sharePercent.toFixed(1)}%
        </li>
      ))}
    </ul>
  );
}

function ManifestList({ manifests }: { readonly manifests: AnalysisResult['stack']['manifests'] }): JSX.Element {
  if (manifests.length === 0) {
    return <p className="text-xs text-slate-500 dark:text-slate-500">{OVERVIEW_COPY.noManifests.description}</p>;
  }
  return (
    <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
      {manifests.map((manifest) => (
        <li key={manifest.path}>
          {manifest.projectName ?? manifest.path} ({manifest.kind})
        </li>
      ))}
    </ul>
  );
}

function RuntimeDependencyList({ dependencies }: { readonly dependencies: AnalysisResult['stack']['dependencies'] }): JSX.Element {
  const runtimeDependencies = dependencies.filter((dependency) => dependency.scope === 'runtime');
  if (runtimeDependencies.length === 0) {
    return <p className="mt-3 text-xs text-slate-500 dark:text-slate-500">{OVERVIEW_COPY.noRuntimeDependencies.description}</p>;
  }
  return (
    <ul className="mt-3 space-y-1 text-xs">
      {runtimeDependencies.map((dependency) => (
        <li key={dependency.name}>
          <span className="font-medium">{dependency.name}</span>
          {dependency.inferredRole !== null ? ` — ${dependency.inferredRole}` : ''}
        </li>
      ))}
    </ul>
  );
}

/** Stack summary: languages by share, manifests, and top runtime dependencies. */
export function StackCard({ stack }: StackCardProps): JSX.Element {
  return (
    <section aria-labelledby="stack-card-title" className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h3 id="stack-card-title" className="mb-3 text-sm font-semibold">
        Stack
      </h3>
      <LanguageList languages={stack.languages} />
      <ManifestList manifests={stack.manifests} />
      <RuntimeDependencyList dependencies={stack.dependencies} />
    </section>
  );
}
