import { Suspense, lazy, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { AppShell } from '@/components/AppShell/AppShell';
import { RepoPicker } from '@/components/RepoPicker/RepoPicker';
import { AnalysisProgress } from '@/components/AnalysisProgress/AnalysisProgress';
import { OverviewPanel } from '@/components/OverviewPanel/OverviewPanel';
import { ErrorState } from '@/components/ErrorState/ErrorState';
import { LABELS, resolveErrorCopy } from '@/copy/messages';
import { useRepoStore } from '@/state/repoStore';
import type { RepoState } from '@/state/repoStore';
import { useSettingsStore } from '@/state/settingsStore';

type ReadyView = 'overview' | 'graph';

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

function tabClassName(isActive: boolean): string {
  return isActive
    ? 'border-b-2 border-blue-600 px-3 py-2 text-sm font-medium text-blue-600 dark:border-blue-400 dark:text-blue-400'
    : 'border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200';
}

/** Once analysis completes: the overview and the dependency graph (Phase 8), one repo-relative view switch apart. */
function ReadyContent({ result }: ReadyContentProps): JSX.Element {
  const [view, setView] = useState<ReadyView>('overview');
  return (
    <div className="flex flex-1 flex-col">
      <div role="tablist" aria-label="Repository views" className="flex gap-2 border-b border-slate-200 px-4 dark:border-slate-800">
        <button type="button" role="tab" aria-selected={view === 'overview'} className={tabClassName(view === 'overview')} onClick={() => setView('overview')}>
          Overview
        </button>
        <button type="button" role="tab" aria-selected={view === 'graph'} className={tabClassName(view === 'graph')} onClick={() => setView('graph')}>
          Dependency graph
        </button>
      </div>
      {view === 'overview' ? (
        <OverviewPanel result={result} />
      ) : (
        <Suspense fallback={<p className="p-6 text-sm text-slate-500">Loading the dependency graph…</p>}>
          <DependencyGraph result={result} />
        </Suspense>
      )}
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
