import type { JSX, RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { GRAPH_COPY } from '@/copy/messages';

export interface GraphToolbarProps {
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (value: string) => void;
  readonly onExpandAll: () => void;
  readonly onResetView: () => void;
  readonly onClearSelection: () => void;
  /** Enables "Clear selection" — a control that cannot do anything should say so. */
  readonly hasSelection: boolean;
}

/**
 * The graph's quick filter and its three view actions (Phase 8, extended by
 * the 2026-09-08 amendment).
 *
 * "Clear selection" exists because clicking a node dimmed the entire graph
 * with NO way back: background tap was never wired, and Esc — which is wired —
 * could not reach its handler after a mouse click. Leaving the panel and
 * returning was the only exit a user could find. A visible control is the only
 * one of the three escape routes a first-time user can SEE.
 * The search input is what `/` focuses (Section 9 Phase 8's keyboard
 * paragraph) — wired by `DependencyGraph.tsx` via `graphStore`'s
 * `searchFocusToken`.
 */
export function GraphToolbar({
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onExpandAll,
  onResetView,
  onClearSelection,
  hasSelection,
}: GraphToolbarProps): JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-slate-200 p-2 dark:border-slate-800">
      <label htmlFor="graph-search-input" className="sr-only">
        {GRAPH_COPY.toolbar.searchLabel}
      </label>
      <input
        id="graph-search-input"
        ref={searchInputRef}
        type="search"
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
        placeholder={GRAPH_COPY.toolbar.searchPlaceholder}
        className="h-8 flex-1 rounded-md border border-slate-300 px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
      <Button type="button" variant="secondary" size="sm" onClick={onClearSelection} disabled={!hasSelection}>
        {GRAPH_COPY.toolbar.clearSelection}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onExpandAll}>
        {GRAPH_COPY.toolbar.expandAll}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onResetView}>
        {GRAPH_COPY.toolbar.resetView}
      </Button>
    </div>
  );
}
