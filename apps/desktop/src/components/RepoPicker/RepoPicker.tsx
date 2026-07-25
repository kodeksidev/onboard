import type { JSX } from 'react';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EMPTY_STATE_NO_REPO } from '@/copy/messages';
import { useRepoStore } from '@/state/repoStore';

/**
 * "No repo chosen yet" (Section 10 row 1). The picker button is disabled
 * while an analysis is already running rather than allowing a second one to
 * queue (Section 10's "second analysis started" row: "the UI disables the
 * picker rather than queueing").
 */
export function RepoPicker(): JSX.Element {
  const status = useRepoStore((state) => state.status);
  const pickFolder = useRepoStore((state) => state.pickFolder);

  return (
    <EmptyState
      title={EMPTY_STATE_NO_REPO.title}
      description={EMPTY_STATE_NO_REPO.description}
      actionLabel={EMPTY_STATE_NO_REPO.actionLabel}
      onAction={() => {
        void pickFolder();
      }}
      isActionDisabled={status === 'analyzing' || status === 'picking'}
    />
  );
}
