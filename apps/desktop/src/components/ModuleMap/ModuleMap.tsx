import { useMemo } from 'react';
import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { MODULE_MAP_COPY } from '@/copy/messages';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ModuleCardView } from './ModuleCardView';
import { MODULE_MIN_FILES, findLargestCandidateDirectory } from './module-empty-state';

export interface ModuleMapProps {
  readonly result: AnalysisResult;
  readonly onOpenFile?: (path: string, line?: number) => void;
}

const NOOP_OPEN_FILE = (): void => undefined;

/**
 * "Analysed fine, this is legitimately empty" (`ModuleMap` only ever mounts
 * once `App.tsx` has a real `AnalysisResult` — "no analysis loaded" and
 * "analysis failed" are handled above it, before this component exists).
 * Names Section 8.6's actual rule and the actual data behind it — a
 * hardcoded "3" or a generic "nothing here" would both let this silently
 * drift or hide a real answer (Section 9's empty-modules defect report).
 */
function EmptyModuleMap({ result }: { readonly result: AnalysisResult }): JSX.Element {
  const largest = findLargestCandidateDirectory(result);
  const copy =
    largest === null
      ? MODULE_MAP_COPY.emptyNoCandidate(MODULE_MIN_FILES)
      : MODULE_MAP_COPY.emptyWithCandidate(MODULE_MIN_FILES, largest.dirPath, largest.fileCount);
  return <EmptyState title={copy.title} description={copy.description} />;
}

/** The module map: one card per convention-derived module (Section 9 Phase 9), already sorted by `dirPath` (Section 7.1). */
export function ModuleMap({ result, onOpenFile = NOOP_OPEN_FILE }: ModuleMapProps): JSX.Element {
  const modules = result.modules;
  const moduleNamesById = useMemo(() => new Map(modules.map((module) => [module.id, module.name])), [modules]);

  return (
    <section aria-labelledby="module-map-title" className="p-4">
      <h2 id="module-map-title" className="mb-3 text-lg font-semibold">
        {MODULE_MAP_COPY.title}
      </h2>
      {modules.length === 0 ? (
        <EmptyModuleMap result={result} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => (
            <ModuleCardView
              key={module.id}
              module={module}
              moduleNamesById={moduleNamesById}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </section>
  );
}
