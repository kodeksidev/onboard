import { Suspense, lazy, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { AppShell } from '@/components/AppShell/AppShell';
import { RepoPicker } from '@/components/RepoPicker/RepoPicker';
import { AnalysisProgress } from '@/components/AnalysisProgress/AnalysisProgress';
import { OverviewPanel } from '@/components/OverviewPanel/OverviewPanel';
import { RoadmapPanel } from '@/components/RoadmapPanel/RoadmapPanel';
import { ModuleMap } from '@/components/ModuleMap/ModuleMap';
import { ErrorState } from '@/components/ErrorState/ErrorState';
import { LABELS, resolveErrorCopy } from '@/copy/messages';
import { useRepoStore } from '@/state/repoStore';
import type { RepoState } from '@/state/repoStore';
import { useSettingsStore } from '@/state/settingsStore';

type ReadyView = 'overview' | 'graph' | 'roadmap' | 'modules';

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

const READY_TABS: ReadonlyArray<{ readonly id: ReadyView; readonly label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'graph', label: 'Dependency graph' },
  { id: 'roadmap', label: 'Start here' },
  { id: 'modules', label: 'Module map' },
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

function ReadyViewPanel({ view, result }: { readonly view: ReadyView; readonly result: AnalysisResult }): JSX.Element {
  if (view === 'graph') {
    return (
      <Suspense fallback={<p className="p-6 text-sm text-slate-500">Loading the dependency graph…</p>}>
        <DependencyGraph result={result} />
      </Suspense>
    );
  }
  if (view === 'roadmap') {
    return <RoadmapPanel steps={result.roadmap.steps} />;
  }
  if (view === 'modules') {
    return <ModuleMap modules={result.modules} />;
  }
  return <OverviewPanel result={result} />;
}

/** Once analysis completes: overview, graph (Phase 8), roadmap + module map (Phase 9), one tab apart. */
function ReadyContent({ result }: ReadyContentProps): JSX.Element {
  const [view, setView] = useState<ReadyView>('overview');
  return (
    <div className="flex flex-1 flex-col">
      <ReadyTabList view={view} onSelect={setView} />
      <ReadyViewPanel view={view} result={result} />
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
