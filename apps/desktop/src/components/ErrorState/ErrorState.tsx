import type { JSX } from 'react';
import { Button } from '@/components/ui/button';
import { LABELS } from '@/copy/messages';

export interface ErrorStateAction {
  readonly label: string;
  readonly onAction: () => void;
}

export interface ErrorStateProps {
  readonly title: string;
  readonly description: string;
  readonly detail?: string | null | undefined;
  readonly primaryAction?: ErrorStateAction | undefined;
  readonly secondaryAction?: ErrorStateAction | undefined;
}

/**
 * Generic error-state shell for every `AppError`-driven row in Section 10
 * (path not found, permission denied, repo too large, engine crashed, ...).
 * `role="alert"` so assistive tech announces it the moment it mounts.
 * Developer `detail` (Section 12: "shown only behind a Details disclosure")
 * uses a native `<details>`/`<summary>` — keyboard- and screen-reader
 * operable with zero extra JavaScript.
 */
export function ErrorState({
  title,
  description,
  detail,
  primaryAction,
  secondaryAction,
}: ErrorStateProps): JSX.Element {
  return (
    <section
      role="alert"
      aria-labelledby="error-state-title"
      className="flex flex-1 flex-col items-center justify-center gap-4 p-12 text-center"
    >
      <h2 id="error-state-title" className="text-xl font-semibold">
        {title}
      </h2>
      <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">{description}</p>
      <div className="flex gap-3">
        {primaryAction !== undefined ? (
          <Button onClick={primaryAction.onAction}>{primaryAction.label}</Button>
        ) : null}
        {secondaryAction !== undefined ? (
          <Button variant="secondary" onClick={secondaryAction.onAction}>
            {secondaryAction.label}
          </Button>
        ) : null}
      </div>
      {detail !== undefined && detail !== null ? (
        <details className="max-w-md text-left text-xs text-slate-500 dark:text-slate-500">
          <summary className="cursor-pointer">{LABELS.details}</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words">{detail}</pre>
        </details>
      ) : null}
    </section>
  );
}
