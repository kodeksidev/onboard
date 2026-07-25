import type { JSX } from 'react';
import type { AiProviderName } from '@/ipc/ipc';
import { MODE_INDICATOR } from '@/copy/messages';

export interface ModeIndicatorProps {
  readonly isEnabled: boolean;
  readonly provider: AiProviderName;
  readonly model: string;
  /**
   * Accepted so callers can pass the full `settings.ai` shape through, but
   * deliberately does not change the rendered string: A5/A6 require the
   * static-mode string to render whenever `isEnabled` is false, for every
   * value of `hasStoredKey` (a key stored with the master toggle off is
   * still "off" — AI never activates from a stored key alone).
   */
  readonly hasStoredKey: boolean;
}

/**
 * The persistent privacy-mode indicator (A5, A6). The two rendered strings
 * are frozen verbatim and must never be composed from smaller pieces that
 * could drift — `MODE_INDICATOR` in `copy/messages.ts` is the single place
 * either string is assembled.
 */
export function ModeIndicator({ isEnabled, provider, model }: ModeIndicatorProps): JSX.Element {
  const text = isEnabled ? MODE_INDICATOR.ai(provider, model) : MODE_INDICATOR.static;
  return (
    <span
      role="status"
      className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
    >
      {text}
    </span>
  );
}
