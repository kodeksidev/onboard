import { useEffect } from 'react';
import type { JSX } from 'react';
import { AppShell } from '@/components/AppShell/AppShell';
import { RepoPicker } from '@/components/RepoPicker/RepoPicker';
import { AnalysisProgress } from '@/components/AnalysisProgress/AnalysisProgress';
import { OverviewPanel } from '@/components/OverviewPanel/OverviewPanel';
import { ErrorState } from '@/components/ErrorState/ErrorState';
import { LABELS, resolveErrorCopy } from '@/copy/messages';
import { useRepoStore } from '@/state/repoStore';
import type { RepoState } from '@/state/repoStore';
import { useSettingsStore } from '@/state/settingsStore';

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
    return <OverviewPanel result={envelope.result} />;
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
