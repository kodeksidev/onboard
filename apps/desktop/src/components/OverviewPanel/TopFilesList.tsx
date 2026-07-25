import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';

export interface TopFilesListProps {
  readonly importantFilePaths: AnalysisResult['importantFilePaths'];
  readonly files: AnalysisResult['files'];
  readonly onOpenFile: (path: string) => void;
}

/** The "most important files" list (Section 8.4's `importantFilePaths`, top 20 by importance). */
export function TopFilesList({ importantFilePaths, files, onOpenFile }: TopFilesListProps): JSX.Element {
  const fileByPath = new Map(files.map((file) => [file.path, file] as const));

  return (
    <section
      aria-labelledby="top-files-title"
      className="rounded-lg border border-slate-200 p-4 dark:border-slate-800"
    >
      <h3 id="top-files-title" className="mb-3 text-sm font-semibold">
        Most important files
      </h3>
      <ol className="space-y-1 text-sm">
        {importantFilePaths.map((path) => {
          const file = fileByPath.get(path);
          return (
            <li key={path} className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onOpenFile(path)}
                className="truncate text-left font-mono text-xs underline-offset-2 hover:underline"
              >
                {path}
              </button>
              {file !== undefined ? (
                <span className="shrink-0 text-xs text-slate-500 dark:text-slate-500">
                  {file.classification}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
