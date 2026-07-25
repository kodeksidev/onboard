import type { JSX, RefObject } from 'react';
import { Button } from '@/components/ui/button';

export interface GraphToolbarProps {
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (value: string) => void;
  readonly onExpandAll: () => void;
  readonly onCollapseAll: () => void;
}

/**
 * The graph's own quick filter plus manual expand/collapse-all (Phase 8).
 * The search input is what `/` focuses (Section 9 Phase 8's keyboard
 * paragraph) — wired by `DependencyGraph.tsx` via `graphStore`'s
 * `searchFocusToken`.
 */
export function GraphToolbar({
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onExpandAll,
  onCollapseAll,
}: GraphToolbarProps): JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-slate-200 p-2 dark:border-slate-800">
      <label htmlFor="graph-search-input" className="sr-only">
        Search the dependency graph by file name
      </label>
      <input
        id="graph-search-input"
        ref={searchInputRef}
        type="search"
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
        placeholder="Search the graph…"
        className="h-8 flex-1 rounded-md border border-slate-300 px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
      <Button type="button" variant="secondary" size="sm" onClick={onExpandAll}>
        Expand all
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onCollapseAll}>
        Collapse all
      </Button>
    </div>
  );
}
