import type { JSX } from 'react';
import { SEARCH_COPY, WHERE_IS_SEARCH_COPY } from '@/copy/messages';

export interface ExpandedTermsProps {
  readonly expandedTerms: readonly string[];
  readonly droppedTerms: readonly string[];
}

/**
 * "The expanded terms are displayed so ranking is explainable" (Section 9
 * Phase 10) and Section 10's literal dropped-term notice, one per term.
 */
export function ExpandedTerms({ expandedTerms, droppedTerms }: ExpandedTermsProps): JSX.Element | null {
  if (expandedTerms.length === 0 && droppedTerms.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
      {expandedTerms.length > 0 ? (
        <p>
          <span className="font-medium">{WHERE_IS_SEARCH_COPY.expandedTermsLabel}</span>{' '}
          {expandedTerms.join(', ')}
        </p>
      ) : null}
      {droppedTerms.map((term) => (
        <p key={term}>{SEARCH_COPY.droppedTerm(term)}</p>
      ))}
    </div>
  );
}
