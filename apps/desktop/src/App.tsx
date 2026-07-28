import { Suspense, lazy, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { AppShell } from '@/components/AppShell/AppShell';
import { RepoPicker } from '@/components/RepoPicker/RepoPicker';
import { AnalysisProgress } from '@/components/AnalysisProgress/AnalysisProgress';
import { OverviewPanel } from '@/components/OverviewPanel/OverviewPanel';
import { RoadmapPanel } from '@/components/RoadmapPanel/RoadmapPanel';
import { ModuleMap } from '@/components/ModuleMap/ModuleMap';
import { WhereIsSearch } from '@/components/WhereIsSearch/WhereIsSearch';
import { AiPanel } from '@/components/AiPanel/AiPanel';
import { ErrorState } from '@/components/ErrorState/ErrorState';
import { LABELS, resolveErrorCopy } from '@/copy/messages';
import { useRepoStore } from '@/state/repoStore';
import type { RepoState } from '@/state/repoStore';
import { useSettingsStore } from '@/state/settingsStore';
import { useGraphStore } from '@/state/graphStore';

type ReadyView = 'overview' | 'graph' | 'roadmap' | 'modules' | 'search' | 'file' | 'ai';

interface ReadyContentProps {
  readonly result: AnalysisResult;
}

/**
 * Cytoscape + its two extensions are the app's single heaviest dependency
 * (Section 4/A11) and irrelevant to the Overview a user sees first
 * (criterion 12: overview in under 10s). Loading it only when the
 * "Dependency graph" tab is actually opened keeps that first paint lean.
 */
const DependencyGraph = lazy(() =>
  import('@/components/DependencyGraph/DependencyGraph').then((module) => ({
    default: module.DependencyGraph,
  })),
);

/**
 * CodeMirror 6 plus its four language packages (Section 4) is the app's
 * second-heaviest dependency after Cytoscape — irrelevant until a user
 * actually opens a file, so it is deferred the same way.
 */
const FileViewer = lazy(() =>
  import('@/components/FileViewer/FileViewer').then((module) => ({ default: module.FileViewer })),
);

const READY_TABS: ReadonlyArray<{ readonly id: ReadyView; readonly label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'graph', label: 'Dependency graph' },
  { id: 'roadmap', label: 'Start here' },
  { id: 'modules', label: 'Module map' },
  { id: 'search', label: 'Where is X?' },
  { id: 'file', label: 'File viewer' },
  /**
   * Phase 12 step 6. The tab is always present, including with AI off (the
   * default): what it shows then is the reason it is off and the control that
   * turns it on. Hiding it would make the feature undiscoverable; disabling
   * it would leave a control that explains nothing.
   */
  { id: 'ai', label: 'Ask AI' },
];

function tabClassName(isActive: boolean): string {
  return isActive
    ? 'border-b-2 border-blue-600 px-3 py-2 text-sm font-medium text-blue-600 dark:border-blue-400 dark:text-blue-400'
    : 'border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200';
}

function ReadyTabList({ view, onSelect }: { readonly view: ReadyView; readonly onSelect: (view: ReadyView) => void }): JSX.Element {
  return (
    <div role="tablist" aria-label="Repository views" className="flex gap-2 border-b border-slate-200 px-4 dark:border-slate-800">
      {READY_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={view === tab.id}
          className={tabClassName(view === tab.id)}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

interface OpenFileRequest {
  readonly path: string;
  readonly line?: number;
}

interface ReadyViewPanelProps {
  readonly view: ReadyView;
  readonly result: AnalysisResult;
  readonly openFile: OpenFileRequest | null;
  readonly onOpenFile: (path: string, line?: number) => void;
}

function ReadyViewPanel({ view, result, openFile, onOpenFile }: ReadyViewPanelProps): JSX.Element {
  if (view === 'graph') {
    return (
      <Suspense fallback={<p className="p-6 text-sm text-slate-500">Loading the dependency graph…</p>}>
        <DependencyGraph result={result} onOpenFile={onOpenFile} />
      </Suspense>
    );
  }
  if (view === 'roadmap') {
    return <RoadmapPanel steps={result.roadmap.steps} onOpenFile={onOpenFile} />;
  }
  if (view === 'modules') {
    return <ModuleMap result={result} onOpenFile={onOpenFile} />;
  }
  if (view === 'search') {
    return <WhereIsSearch repoId={result.repo.id} onOpenFile={onOpenFile} />;
  }
  if (view === 'ai') {
    return <AiPanel result={result} onOpenFile={onOpenFile} />;
  }
  if (view === 'file') {
    return (
      <Suspense fallback={<p className="p-6 text-sm text-slate-500">Loading the file viewer…</p>}>
        <FileViewer
          repoId={result.repo.id}
          result={result}
          path={openFile?.path ?? null}
          onOpenFile={onOpenFile}
          {...(openFile?.line !== undefined ? { line: openFile.line } : {})}
        />
      </Suspense>
    );
  }
  return <OverviewPanel result={result} onOpenFile={onOpenFile} />;
}

/**
 * Once analysis completes: overview, graph (Phase 8), roadmap + module map
 * (Phase 9), search + file viewer (Phase 10), one tab apart. `onOpenFile` is
 * the one shared callback every panel already accepts (Section 9 Phase 10's
 * reuse instruction): it switches to the "File viewer" tab, remembers which
 * path/line to open, and — reusing `graphStore.focusPath` rather than a
 * second focus mechanism — centers that same file in the dependency graph,
 * so opening a file from a search hit (or a roadmap step, or a module card)
 * keeps the graph in sync with whatever the user just looked at.
 */
function ReadyContent({ result }: ReadyContentProps): JSX.Element {
  const [view, setView] = useState<ReadyView>('overview');
  const [openFile, setOpenFile] = useState<OpenFileRequest | null>(null);
  const focusPath = useGraphStore((state) => state.focusPath);

  const handleOpenFile = (path: string, line?: number): void => {
    setOpenFile(line !== undefined ? { path, line } : { path });
    setView('file');
    focusPath(path);
  };

  return (
    <div className="flex flex-1 flex-col">
      <ReadyTabList view={view} onSelect={setView} />
      <ReadyViewPanel view={view} result={result} openFile={openFile} onOpenFile={handleOpenFile} />
    </div>
  );
}

interface ErrorPanelProps {
  readonly error: NonNullable<RepoState['error']>;
  readonly onRetry: () => void;
  readonly onReset: () => void;
}

function ErrorPanel({ error, onRetry, onReset }: ErrorPanelProps): JSX.Element {
  const copy = resolveErrorCopy(error);
  return (
    <ErrorState
      title={copy.title}
      description={copy.description}
      detail={error.detail}
      primaryAction={{ label: LABELS.retry, onAction: onRetry }}
      secondaryAction={
        copy.actionLabel !== null ? { label: copy.actionLabel, onAction: onReset } : undefined
      }
    />
  );
}

function MainContent(): JSX.Element {
  const status = useRepoStore((state) => state.status);
  const envelope = useRepoStore((state) => state.envelope);
  const progress = useRepoStore((state) => state.progress);
  const error = useRepoStore((state) => state.error);
  const retry = useRepoStore((state) => state.retry);
  const reset = useRepoStore((state) => state.reset);

  if (status === 'analyzing') {
    return <AnalysisProgress progress={progress} />;
  }
  if (status === 'ready' && envelope !== null) {
    return <ReadyContent result={envelope.result} />;
  }
  if (status === 'error' && error !== null) {
    return (
      <ErrorPanel
        error={error}
        onRetry={() => {
          void retry();
        }}
        onReset={reset}
      />
    );
  }
  return <RepoPicker />;
}

export default function App(): JSX.Element {
  const loadSettings = useSettingsStore((state) => state.loadSettings);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  return (
    <AppShell>
      <MainContent />
    </AppShell>
  );
}
