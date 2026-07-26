import { useMemo } from 'react';
import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { MODULE_MAP_COPY } from '@/copy/messages';
import { ModuleCardView } from './ModuleCardView';

export interface ModuleMapProps {
  readonly modules: AnalysisResult['modules'];
  readonly onOpenFile?: (path: string, line?: number) => void;
}

const NOOP_OPEN_FILE = (): void => undefined;

/** The module map: one card per convention-derived module (Section 9 Phase 9), already sorted by `dirPath` (Section 7.1). */
export function ModuleMap({ modules, onOpenFile = NOOP_OPEN_FILE }: ModuleMapProps): JSX.Element {
  const moduleNamesById = useMemo(() => new Map(modules.map((module) => [module.id, module.name])), [modules]);

  return (
    <section aria-labelledby="module-map-title" className="p-4">
      <h2 id="module-map-title" className="mb-3 text-lg font-semibold">
        {MODULE_MAP_COPY.title}
      </h2>
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
    </section>
  );
}
