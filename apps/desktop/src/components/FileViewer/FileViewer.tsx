import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { AnalysisResult, AppError } from '@onboard/contract';
import { ipc, parseIpcError } from '@/ipc/ipc';
import type { ReadRepoFileResult } from '@/ipc/ipc';
import { buildAdjacency } from '@/components/DependencyGraph/graph-model';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ErrorState } from '@/components/ErrorState/ErrorState';
import { FILE_VIEWER_COPY, resolveErrorCopy } from '@/copy/messages';
import { SymbolOutline } from './SymbolOutline';
import { ImportsPanel } from './ImportsPanel';
import { useCodeMirror } from './useCodeMirror';

export interface FileViewerProps {
  readonly repoId: string;
  readonly result: AnalysisResult;
  readonly path: string | null;
  readonly line?: number;
  readonly onOpenFile?: (path: string, line?: number) => void;
}

const NOOP_OPEN_FILE = (): void => undefined;

interface FileFetchState {
  readonly isLoading: boolean;
  readonly file: ReadRepoFileResult | null;
  readonly error: AppError | null;
}

/**
 * Fetches `path`'s content through `read_repo_file` (Section 7.4) whenever
 * `repoId`/`path` change; a stale-response guard mirrors `useSearch.ts`'s
 * request-token pattern so a fast path switch never lets an older fetch
 * overwrite a newer one.
 */
function useFileContent(repoId: string, path: string | null): FileFetchState {
  const [state, setState] = useState<FileFetchState>({ isLoading: false, file: null, error: null });
  const requestTokenRef = useRef(0);

  useEffect(() => {
    if (path === null) {
      requestTokenRef.current += 1;
      setState({ isLoading: false, file: null, error: null });
      return;
    }
    const token = (requestTokenRef.current += 1);
    setState({ isLoading: true, file: null, error: null });
    ipc
      .readRepoFile({ repoId, path })
      .then((file) => {
        if (requestTokenRef.current !== token) {
          return;
        }
        setState({ isLoading: false, file, error: null });
      })
      .catch((raw: unknown) => {
        if (requestTokenRef.current !== token) {
          return;
        }
        setState({ isLoading: false, file: null, error: parseIpcError(raw) });
      });
  }, [repoId, path]);

  return state;
}

interface FileContentViewProps {
  readonly result: AnalysisResult;
  readonly path: string;
  readonly file: ReadRepoFileResult;
  readonly line?: number;
  readonly onOpenFile: (path: string, line?: number) => void;
}

/** The loaded-file layout: the editor beside its symbol outline and imports/importers (Section 9 Phase 10). */
function FileContentView({ result, path, file, line, onOpenFile }: FileContentViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const codeMirror = useCodeMirror({
    containerRef,
    content: file.content,
    language: file.language,
    ariaLabel: `File contents: ${path}`,
    ...(line !== undefined ? { line } : {}),
  });

  const symbols = result.symbols.filter((symbol) => symbol.path === path).sort((a, b) => a.startLine - b.startLine);
  const adjacency = buildAdjacency(result.edges);
  const imports = adjacency.dependencies.get(path) ?? [];
  const importedBy = adjacency.dependents.get(path) ?? [];

  return (
    <div className="flex flex-1 gap-4 overflow-hidden p-4">
      <div ref={containerRef} className="min-w-0 flex-1 overflow-auto rounded-md border border-slate-200 dark:border-slate-800" />
      <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-auto">
        <div>
          <h3 className="mb-1 text-xs font-medium">{FILE_VIEWER_COPY.symbolsLabel}</h3>
          <SymbolOutline symbols={symbols} onSelectSymbol={codeMirror.scrollToLine} />
        </div>
        <ImportsPanel imports={imports} importedBy={importedBy} onOpenFile={onOpenFile} />
      </aside>
    </div>
  );
}

/**
 * The file viewer (Section 9 Phase 10): read-only CodeMirror 6 (A13) beside
 * the file's symbol outline and its imports/importers, resolved from the
 * same `AnalysisResult` (Section 7) every other view reads — no parallel
 * data source.
 */
export function FileViewer({ repoId, result, path, line, onOpenFile = NOOP_OPEN_FILE }: FileViewerProps): JSX.Element {
  const { isLoading, file, error } = useFileContent(repoId, path);

  if (path === null) {
    return (
      <EmptyState title={FILE_VIEWER_COPY.noFileOpen.title} description={FILE_VIEWER_COPY.noFileOpen.description} />
    );
  }
  if (error !== null) {
    const copy = resolveErrorCopy(error);
    return <ErrorState title={copy.title} description={copy.description} detail={error.detail} />;
  }
  if (isLoading || file === null) {
    return (
      <p role="status" className="p-6 text-sm text-slate-500">
        {FILE_VIEWER_COPY.loadingLabel}
      </p>
    );
  }
  return (
    <FileContentView result={result} path={path} file={file} onOpenFile={onOpenFile} {...(line !== undefined ? { line } : {})} />
  );
}
