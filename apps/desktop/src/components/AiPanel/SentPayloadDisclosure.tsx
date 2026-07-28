import type { JSX } from 'react';
import { AI_PANEL_COPY } from '@/copy/messages';

export interface SentPayloadDisclosureProps {
  readonly provider: string;
  readonly sentFileCount: number;
  readonly sentByteCount: number;
}

/**
 * Criterion 17: the real `sentFileCount` and `sentByteCount` from the
 * response the user is looking at, for every AI action.
 *
 * Deliberately NOT a `<details>` element despite the name inherited from
 * Section 9's file list. This is the app's central privacy claim — how much
 * of the user's code left their machine — so it is ordinary, always-visible
 * text that needs no hover, no expansion and no focus to read. A zero-file
 * payload still renders, stating zero, because silence would be
 * indistinguishable from "we didn't bother to say".
 */
export function SentPayloadDisclosure({
  provider,
  sentFileCount,
  sentByteCount,
}: SentPayloadDisclosureProps): JSX.Element {
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      {AI_PANEL_COPY.sentPayload(provider, sentFileCount, sentByteCount)}
    </p>
  );
}
