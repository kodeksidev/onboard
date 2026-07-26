import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { MODULE_MAP_COPY } from '@/copy/messages';

export type ModuleCard = AnalysisResult['modules'][number];

export interface ModuleCardViewProps {
  readonly module: ModuleCard;
  readonly moduleNamesById: ReadonlyMap<string, string>;
  readonly onOpenFile?: (path: string) => void;
}

const NOOP_OPEN_FILE = (): void => undefined;

function resolveModuleNames(ids: readonly string[], moduleNamesById: ReadonlyMap<string, string>): readonly string[] {
  return ids.map((id) => moduleNamesById.get(id) ?? id);
}

function ModuleNameList({ ids, moduleNamesById }: { readonly ids: readonly string[]; readonly moduleNamesById: ReadonlyMap<string, string> }): JSX.Element {
  const names = resolveModuleNames(ids, moduleNamesById);
  if (names.length === 0) {
    return <span>none</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {names.map((name) => (
        <span key={name} className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
          {name}
        </span>
      ))}
    </span>
  );
}

function KeyFileList({
  paths,
  onOpenFile,
}: {
  readonly paths: readonly string[];
  readonly onOpenFile: (path: string) => void;
}): JSX.Element {
  return (
    <ul className="space-y-1">
      {paths.map((path) => (
        <li key={path}>
          <button
            type="button"
            onClick={() => onOpenFile(path)}
            className="truncate text-left font-mono text-xs underline-offset-2 hover:underline"
          >
            {path}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * One module card: name, path, its static purpose-by-convention, key files
 * (working jump links, Section 9 Phase 9's gate), and its dependency
 * relationships to other modules, resolved from ids to human-readable names.
 */
export function ModuleCardView({
  module,
  moduleNamesById,
  onOpenFile = NOOP_OPEN_FILE,
}: ModuleCardViewProps): JSX.Element {
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div>
        <h3 className="text-sm font-semibold">{module.name}</h3>
        <p className="font-mono text-xs text-slate-500 dark:text-slate-500">{module.dirPath}</p>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">{module.purposeByConvention}</p>
      <p className="text-xs text-slate-500 dark:text-slate-500">
        {MODULE_MAP_COPY.fileCountLabel(module.fileCount)}
      </p>
      <div>
        <h4 className="mb-1 text-xs font-medium">{MODULE_MAP_COPY.keyFilesLabel}</h4>
        <KeyFileList paths={module.keyFilePaths} onOpenFile={onOpenFile} />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="font-medium">{MODULE_MAP_COPY.dependsOnModulesLabel}</dt>
          <dd className="text-slate-600 dark:text-slate-400">
            <ModuleNameList ids={module.dependsOnModuleIds} moduleNamesById={moduleNamesById} />
          </dd>
        </div>
        <div>
          <dt className="font-medium">{MODULE_MAP_COPY.dependedOnByModulesLabel}</dt>
          <dd className="text-slate-600 dark:text-slate-400">
            <ModuleNameList ids={module.dependedOnByModuleIds} moduleNamesById={moduleNamesById} />
          </dd>
        </div>
      </dl>
    </article>
  );
}
