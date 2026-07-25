import { create } from 'zustand';

/**
 * Its own small store (Section 4: "one small store per domain"), separate
 * from `repoStore` — the dependency graph's selection/focus/search-focus
 * state has nothing to do with analysis lifecycle.
 *
 * **The Phase 9 API contract:** centering a node on the graph is an
 * imperative Cytoscape operation (`cy.animate({ center: ... })`,
 * `useCytoscape.ts`), which cannot live in this framework-agnostic store.
 * `DependencyGraph.tsx` bridges the two with `registerGraphFocusHandler`,
 * called once on mount with its `focusNodeById` function. Any other panel
 * — `RoadmapPanel` in Phase 9 — focuses and centers a file purely by
 * calling `useGraphStore.getState().focusPath(path)`; it never needs to
 * know a `cytoscape.Core` exists.
 */
export type GraphFocusHandler = (path: string) => void;

let focusHandler: GraphFocusHandler | null = null;

/** Called once by `DependencyGraph` on mount/unmount; `null` means no graph is currently mounted. */
export function registerGraphFocusHandler(handler: GraphFocusHandler | null): void {
  focusHandler = handler;
}

export interface GraphState {
  readonly selectedPath: string | null;
  readonly focusedPath: string | null;
  /** Increments on every `focusPath` call, so an effect can react even to a repeated request for the same path. */
  readonly focusToken: number;
  /** Increments on every `requestSearchFocus` call, so the toolbar's search input can react by focusing itself. */
  readonly searchFocusToken: number;
  selectPath: (path: string | null) => void;
  focusPath: (path: string) => void;
  clearFocus: () => void;
  requestSearchFocus: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  selectedPath: null,
  focusedPath: null,
  focusToken: 0,
  searchFocusToken: 0,

  selectPath: (path) => set({ selectedPath: path }),

  focusPath: (path) => {
    set((state) => ({ selectedPath: path, focusedPath: path, focusToken: state.focusToken + 1 }));
    focusHandler?.(path);
  },

  clearFocus: () => set({ focusedPath: null }),

  requestSearchFocus: () => set((state) => ({ searchFocusToken: state.searchFocusToken + 1 })),
}));
