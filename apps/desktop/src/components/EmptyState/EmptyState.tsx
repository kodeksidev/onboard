import type { JSX } from 'react';
import { Button } from '@/components/ui/button';

export interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly isActionDisabled?: boolean;
}

/**
 * Generic empty-state presentational shell (Section 10's "No repository
 * open" row and any future empty list). Semantic heading + paragraph so a
 * screen reader announces it as ordinary content, not an alert — nothing
 * has gone wrong here, there is simply nothing yet.
 */
export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  isActionDisabled = false,
}: EmptyStateProps): JSX.Element {
  return (
    <section
      aria-labelledby="empty-state-title"
      className="flex flex-1 flex-col items-center justify-center gap-4 p-12 text-center"
    >
      <h2 id="empty-state-title" className="text-xl font-semibold">
        {title}
      </h2>
      <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">{description}</p>
      {actionLabel !== undefined && onAction !== undefined ? (
        <Button onClick={onAction} disabled={isActionDisabled}>
          {actionLabel}
        </Button>
      ) : null}
    </section>
  );
}
