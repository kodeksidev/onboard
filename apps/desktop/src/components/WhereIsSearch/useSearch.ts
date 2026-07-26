import { useEffect, useRef, useState } from 'react';
import { SearchResponse } from '@onboard/contract';
import type { AppError } from '@onboard/contract';
import { ipc, parseIpcError } from '@/ipc/ipc';

/** Section 9 Phase 10: "Search is debounced at SEARCH_DEBOUNCE_MS = 180". */
export const SEARCH_DEBOUNCE_MS = 180;
const SEARCH_RESULT_LIMIT = 50;

export interface UseSearchResult {
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly response: SearchResponse | null;
  readonly isLoading: boolean;
  readonly error: AppError | null;
}

/**
 * The everyday "where is X?" search (Section 9 Phase 10). Debounced at
 * `SEARCH_DEBOUNCE_MS`; Section 12's "capped at 1 in-flight query, with
 * older queries cancelled" is enforced by a monotonically increasing
 * request token — a stale response (one whose token no longer matches the
 * latest request) is discarded rather than applied. The response is
 * re-parsed with the frozen `SearchResponse` zod schema before it ever
 * reaches a component, the same contract-drift guard `repoStore` and
 * `settingsStore` already use.
 */
export function useSearch(repoId: string): UseSearchResult {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const requestTokenRef = useRef(0);

  useEffect(() => {
    if (query.trim().length === 0) {
      requestTokenRef.current += 1;
      setResponse(null);
      setIsLoading(false);
      setError(null);
      return undefined;
    }

    setIsLoading(true);
    const token = (requestTokenRef.current += 1);
    const timer = setTimeout(() => {
      ipc
        .searchRepo({ repoId, query, limit: SEARCH_RESULT_LIMIT })
        .then((raw) => {
          if (requestTokenRef.current !== token) {
            return;
          }
          setResponse(SearchResponse.parse(raw));
          setIsLoading(false);
          setError(null);
        })
        .catch((raw: unknown) => {
          if (requestTokenRef.current !== token) {
            return;
          }
          setError(parseIpcError(raw));
          setIsLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, repoId]);

  return { query, setQuery, response, isLoading, error };
}
