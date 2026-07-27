import { useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AppError, SearchHit } from '@onboard/contract';
import { SEARCH_COPY, WHERE_IS_SEARCH_COPY, resolveErrorCopy } from '@/copy/messages';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ErrorState } from '@/components/ErrorState/ErrorState';
import { ExpandedTerms } from './ExpandedTerms';
import { SearchResultRow } from './SearchResultRow';
import { useSearch } from './useSearch';

export interface WhereIsSearchProps {
  readonly repoId: string;
  readonly onOpenFile?: (path: string, line?: number) => void;
}

const NOOP_OPEN_FILE = (): void => undefined;
const RESULT_ROW_ESTIMATED_HEIGHT_PX = 88;
const RESULTS_VIEWPORT_HEIGHT_PX = 384;
const RESULT_OVERSCAN = 8;

function resultHitId(index: number): string {
  return `where-is-search-hit-${index}`;
}

function primaryLine(hit: SearchHit): number | undefined {
  return hit.symbol?.startLine ?? hit.lineHits[0]?.line;
}

interface KeyboardNavContext {
  readonly hits: readonly SearchHit[];
  readonly selectedIndex: number;
  readonly setSelectedIndex: (index: number) => void;
  readonly onOpenFile: (path: string, line?: number) => void;
}

function handleSearchKeyDown(context: KeyboardNavContext, event: ReactKeyboardEvent<HTMLInputElement>): void {
  const { hits, selectedIndex, setSelectedIndex, onOpenFile } = context;
  if (hits.length === 0) {
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setSelectedIndex(Math.min(selectedIndex + 1, hits.length - 1));
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    setSelectedIndex(Math.max(selectedIndex - 1, 0));
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const hit = hits[selectedIndex];
    if (hit !== undefined) {
      onOpenFile(hit.path, primaryLine(hit));
    }
  }
}

interface ResultsListProps {
  readonly hits: readonly SearchHit[];
  readonly selectedIndex: number;
  readonly onOpenFile: (path: string, line?: number) => void;
}

/** Virtualized (Section 4: `@tanstack/react-virtual`) so the list stays fast at any result count. */
function ResultsList({ hits, selectedIndex, onOpenFile }: ResultsListProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: hits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => RESULT_ROW_ESTIMATED_HEIGHT_PX,
    overscan: RESULT_OVERSCAN,
  });

  return (
    <div
      ref={scrollRef}
      id="where-is-search-listbox"
      role="listbox"
      aria-label="Search results"
      style={{ height: RESULTS_VIEWPORT_HEIGHT_PX, overflow: 'auto' }}
      className="relative rounded-md border border-slate-200 dark:border-slate-800"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const hit = hits[virtualRow.index];
          if (hit === undefined) {
            return null;
          }
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <SearchResultRow
                id={resultHitId(virtualRow.index)}
                hit={hit}
                isSelected={virtualRow.index === selectedIndex}
                onOpenFile={onOpenFile}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ResultsAreaProps {
  readonly error: AppError | null;
  readonly isLoading: boolean;
  readonly showZeroHits: boolean;
  readonly query: string;
  readonly hits: readonly SearchHit[];
  readonly selectedIndex: number;
  readonly onOpenFile: (path: string, line?: number) => void;
}

/**
 * Three states that must never look identical (Section 9's audit): a search
 * that is still running (`isLoading`), a search that genuinely failed
 * (`error` — previously silently swallowed, never rendered), and a search
 * that succeeded but matched nothing (`showZeroHits`, Section 10's exact
 * copy). Error takes priority over a stale loading flag or a stale response
 * from before the failing request.
 */
function ResultsArea({ error, isLoading, showZeroHits, query, hits, selectedIndex, onOpenFile }: ResultsAreaProps): JSX.Element {
  if (error !== null) {
    const copy = resolveErrorCopy(error);
    return <ErrorState title={copy.title} description={copy.description} detail={error.detail} />;
  }
  if (isLoading) {
    return (
      <p role="status" className="p-2 text-sm text-slate-500">
        {WHERE_IS_SEARCH_COPY.loadingLabel}
      </p>
    );
  }
  if (showZeroHits) {
    return <EmptyState title={SEARCH_COPY.noResults(query).title} description={SEARCH_COPY.noResults(query).description} />;
  }
  return <ResultsList hits={hits} selectedIndex={selectedIndex} onOpenFile={onOpenFile} />;
}

/**
 * "Where is X?" (Section 9 Phase 10 — "the everyday feature"). Debounced,
 * virtualized, fully keyboard-operable (↑/↓ move selection, Enter opens the
 * selected result at its hit line), with the engine's `expandedTerms` and
 * `droppedTerms` surfaced so ranking is explainable.
 */
export function WhereIsSearch({ repoId, onOpenFile = NOOP_OPEN_FILE }: WhereIsSearchProps): JSX.Element {
  const { query, setQuery, response, isLoading, error } = useSearch(repoId);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const hits = response?.hits ?? [];

  useEffect(() => {
    setSelectedIndex(0);
  }, [response]);

  const hasQuery = query.trim().length > 0;
  const showZeroHits = response !== null && hits.length === 0 && hasQuery;

  return (
    <section aria-labelledby="where-is-search-title" className="flex flex-col gap-3 p-4">
      <h2 id="where-is-search-title" className="sr-only">
        {WHERE_IS_SEARCH_COPY.label}
      </h2>
      <label htmlFor="where-is-search-input" className="sr-only">
        {WHERE_IS_SEARCH_COPY.label}
      </label>
      <input
        id="where-is-search-input"
        type="search"
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls="where-is-search-listbox"
        aria-activedescendant={hits[selectedIndex] !== undefined ? resultHitId(selectedIndex) : undefined}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => handleSearchKeyDown({ hits, selectedIndex, setSelectedIndex, onOpenFile }, event)}
        placeholder={WHERE_IS_SEARCH_COPY.placeholder}
        className="h-10 rounded-md border border-slate-300 px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
      {response !== null ? (
        <ExpandedTerms expandedTerms={response.expandedTerms} droppedTerms={response.droppedTerms} />
      ) : null}
      <ResultsArea
        error={error}
        isLoading={isLoading}
        showZeroHits={showZeroHits}
        query={query}
        hits={hits}
        selectedIndex={selectedIndex}
        onOpenFile={onOpenFile}
      />
    </section>
  );
}
