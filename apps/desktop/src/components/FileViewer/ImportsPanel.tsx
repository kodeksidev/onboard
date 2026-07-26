import type { JSX } from 'react';
import { FILE_VIEWER_COPY } from '@/copy/messages';

export interface ImportsPanelProps {
  readonly imports: readonly string[];
  readonly importedBy: readonly string[];
  readonly onOpenFile: (path: string, line?: number) => void;
}

function PathList({
  label,
  paths,
  onOpenFile,
}: {
  readonly label: string;
  readonly paths: readonly string[];
  readonly onOpenFile: (path: string) => void;
}): JSX.Element {
  return (
    <div role="region" aria-label={label}>
      <h4 className="mb-1 text-xs font-medium">{label}</h4>
      {paths.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-500">{FILE_VIEWER_COPY.noneLabel}</p>
      ) : (
        <ul className="space-y-0.5">
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
      )}
    </div>
  );
}

/** Imports/importers "in-context" beside the file viewer (Section 9 Phase 10). */
export function ImportsPanel({ imports, importedBy, onOpenFile }: ImportsPanelProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <PathList label={FILE_VIEWER_COPY.importsLabel} paths={imports} onOpenFile={onOpenFile} />
      <PathList label={FILE_VIEWER_COPY.importedByLabel} paths={importedBy} onOpenFile={onOpenFile} />
    </div>
  );
}
