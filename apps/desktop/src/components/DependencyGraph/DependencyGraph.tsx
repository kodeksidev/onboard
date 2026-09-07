import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import type cytoscape from 'cytoscape';
import type { AnalysisResult } from '@onboard/contract';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { GRAPH_COPY } from '@/copy/messages';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { registerGraphFocusHandler, useGraphStore } from '@/state/graphStore';
import { buildAdjacency, fileNodeId, orderPathsByImportance, pathFromNodeId } from './graph-model';
import type { GraphKeyboardModel } from './keyboard-nav';
import { interpretGraphKey, reduceGraphFocus } from './keyboard-nav';
import { useCytoscape } from './useCytoscape';
import type { UseCytoscapeApi } from './useCytoscape';
import { GraphToolbar } from './GraphToolbar';
import { GraphListFallback } from './GraphListFallback';

export interface DependencyGraphProps {
  readonly result: AnalysisResult;
  readonly onOpenFile?: (path: string, line?: number) => void;
  /** Test-only escape hatch (see `UseCytoscapeApi.getCore`'s doc comment); never used by production UI. */
  readonly onCytoscapeReady?: (cy: cytoscape.Core) => void;
}

const NOOP_OPEN_FILE = (): void => undefined;

function buildKeyboardModel(result: AnalysisResult): GraphKeyboardModel {
  const adjacency = buildAdjacency(result.edges);
  return {
    orderedPaths: orderPathsByImportance(result.files),
    dependencies: adjacency.dependencies,
    dependents: adjacency.dependents,
  };
}

/** aria-live text for a focus/selection change (Section 9 Phase 8: "every focus change announced via aria-live"). */
function describeFocusedFile(result: AnalysisResult, path: string): string {
  const file = result.files.find((candidate) => candidate.path === path);
  if (file === undefined) {
    return path;
  }
  return `${file.path}, rank ${file.importanceRank} of ${result.files.length}, ${file.classification}, imported by ${file.inDegree} file${file.inDegree === 1 ? '' : 's'}.`;
}

interface FocusMoveContext {
  readonly result: AnalysisResult;
  readonly keyboardModel: GraphKeyboardModel;
  readonly graph: UseCytoscapeApi;
  readonly focusPath: (path: string) => void;
  readonly announce: (text: string) => void;
}

function applyFocusMove(context: FocusMoveContext, focusedPath: string | null, command: ReturnType<typeof interpretGraphKey>): void {
  const nextPath = reduceGraphFocus(context.keyboardModel, focusedPath, command);
  if (nextPath === null) {
    return;
  }
  context.focusPath(nextPath);
  context.graph.highlightNeighborhood(fileNodeId(nextPath));
  context.announce(describeFocusedFile(context.result, nextPath));
}

interface NodeTapContext {
  readonly result: AnalysisResult;
  readonly selectPath: (path: string | null) => void;
  readonly graph: UseCytoscapeApi;
  readonly announce: (text: string) => void;
}

function handleNodeTap(context: NodeTapContext, id: string): void {
  const path = pathFromNodeId(id);
  if (path === null) {
    return;
  }
  context.selectPath(path);
  context.graph.highlightNeighborhood(id);
  context.announce(describeFocusedFile(context.result, path));
}

interface KeyDownContext extends FocusMoveContext {
  readonly focusedPath: string | null;
  readonly selectPath: (path: string | null) => void;
  readonly requestSearchFocus: () => void;
  readonly onOpenFile: (path: string, line?: number) => void;
}

/** Section 9 Phase 8's keyboard scheme, dispatched from `DependencyGraph`'s `onKeyDown`. */
function createKeyDownHandler(context: KeyDownContext): (event: ReactKeyboardEvent<HTMLDivElement>) => void {
  return (event) => {
    const command = interpretGraphKey(event.key);
    if (command.type === 'none') {
      return;
    }
    event.preventDefault();
    if (command.type === 'search') {
      context.requestSearchFocus();
    } else if (command.type === 'exit') {
      context.graph.clearHighlight();
      context.selectPath(null);
    } else if (command.type === 'open') {
      if (context.focusedPath !== null) {
        context.onOpenFile(context.focusedPath);
      }
    } else {
      applyFocusMove(context, context.focusedPath, command);
    }
  };
}

/** Wires the graph-focus registration, `/`-triggered search focus, and live search filtering. */
function useGraphSideEffects(
  graph: UseCytoscapeApi,
  searchInputRef: RefObject<HTMLInputElement | null>,
  searchQuery: string,
  searchFocusToken: number,
  result: AnalysisResult,
  announce: (text: string) => void,
): void {
  useEffect(() => {
    // A roadmap step click (or any other future caller of
    // `graphStore.focusPath`) gets the same aria-live announcement as an
    // in-graph keyboard move or click — cross-component focus changes are
    // not a second-class experience for screen reader users.
    registerGraphFocusHandler((path) => {
      graph.focusNodeById(fileNodeId(path));
      announce(describeFocusedFile(result, path));
    });
    return () => registerGraphFocusHandler(null);
  }, [graph.focusNodeById, result, announce]);

  useEffect(() => {
    if (searchFocusToken > 0) {
      searchInputRef.current?.focus();
    }
  }, [searchFocusToken, searchInputRef]);

  useEffect(() => {
    graph.applySearchFilter(searchQuery);
  }, [searchQuery, graph.applySearchFilter]);
}

/**
 * Section 9 Phase 9's "highlighted route through the graph": re-applies the
 * roadmap's overlay whenever `routePaths` changes (e.g. a new analysis, or
 * `RoadmapPanel` mounting/unmounting) and whenever the graph itself becomes
 * ready (so the overlay survives a re-mount of `DependencyGraph`).
 */
function useRouteOverlayEffect(graph: UseCytoscapeApi, routePaths: readonly string[]): void {
  useEffect(() => {
    graph.applyRouteOverlay(routePaths);
  }, [routePaths, graph.applyRouteOverlay, graph.isReady]);
}

/**
 * Closes the Phase 8 handoff's flagged loose end: a roadmap click while the
 * graph tab is closed sets `graphStore.focusedPath` but there is no mounted
 * graph to center on it. Once the (re-)mounted graph finishes its layout,
 * re-center on whatever was already focused — this is exactly the "start
 * here" flow of clicking a roadmap step, then opening the graph tab.
 */
function useRecenterOnReadyEffect(graph: UseCytoscapeApi): void {
  useEffect(() => {
    if (!graph.isReady) {
      return;
    }
    const existingFocusedPath = useGraphStore.getState().focusedPath;
    if (existingFocusedPath !== null) {
      graph.focusNodeById(fileNodeId(existingFocusedPath));
    }
    // Deliberately depends only on `graph.isReady`: this reads the current
    // store value once per "graph became ready" transition, not as a
    // reactive subscription (no react-hooks plugin in this project's
    // eslint config, so no exhaustive-deps suppression comment is needed).
  }, [graph.isReady]);
}

interface DependencyGraphController {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly searchQuery: string;
  readonly setSearchQuery: (value: string) => void;
  readonly announcement: string;
  readonly graph: UseCytoscapeApi;
  readonly handleKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

function useCytoscapeReadyEffect(graph: UseCytoscapeApi, onCytoscapeReady: ((cy: cytoscape.Core) => void) | undefined): void {
  useEffect(() => {
    if (!graph.isReady || onCytoscapeReady === undefined) {
      return;
    }
    const core = graph.getCore();
    if (core !== null) {
      onCytoscapeReady(core);
    }
  }, [graph.isReady, graph.getCore, onCytoscapeReady]);
}

/** Everything `DependencyGraph`'s JSX needs, assembled in one hook so the component itself stays render-only. */
function useDependencyGraphController(
  result: AnalysisResult,
  onOpenFile: (path: string, line?: number) => void,
  onCytoscapeReady: ((cy: cytoscape.Core) => void) | undefined,
): DependencyGraphController {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isReducedMotion = useReducedMotion();
  const [searchQuery, setSearchQuery] = useState('');
  const [announcement, setAnnouncement] = useState('');

  const keyboardModel = useMemo(() => buildKeyboardModel(result), [result]);

  const focusedPath = useGraphStore((state) => state.focusedPath);
  const focusPath = useGraphStore((state) => state.focusPath);
  const selectPath = useGraphStore((state) => state.selectPath);
  const requestSearchFocus = useGraphStore((state) => state.requestSearchFocus);
  const searchFocusToken = useGraphStore((state) => state.searchFocusToken);
  const routePaths = useGraphStore((state) => state.routePaths);

  const graph = useCytoscape({
    containerRef,
    result,
    isReducedMotion,
    onNodeTap: (id) => handleNodeTap({ result, selectPath, graph, announce: setAnnouncement }, id),
  });

  useGraphSideEffects(graph, searchInputRef, searchQuery, searchFocusToken, result, setAnnouncement);
  useRouteOverlayEffect(graph, routePaths);
  useCytoscapeReadyEffect(graph, onCytoscapeReady);
  useRecenterOnReadyEffect(graph);

  const handleKeyDown = createKeyDownHandler({
    result,
    keyboardModel,
    graph,
    focusPath,
    selectPath,
    requestSearchFocus,
    onOpenFile,
    focusedPath,
    announce: setAnnouncement,
  });

  return { containerRef, searchInputRef, searchQuery, setSearchQuery, announcement, graph, handleKeyDown };
}

/**
 * A11's Cytoscape view: compound directory nodes, `fcose` layout,
 * expand/collapse, importance-sized/module-colored nodes, click-to-
 * highlight, a quick search filter, and full keyboard navigation (Section 9
 * Phase 8). `useGraphStore` is the seam Phase 9's roadmap uses to focus and
 * center a step's file without knowing a `cytoscape.Core` exists.
 *
 * `min-h-0`/`min-w-0` below (the `<section>` and the Cytoscape mount div)
 * are load-bearing, not cosmetic — delete either and this regresses. Without
 * them, this flex-column chain has no floor above it, so Cytoscape's own
 * `canvasContainer` — an IN-FLOW child it manages, sized via an explicit
 * inline pixel width/height from `matchCanvasSize` — can inflate its own
 * ancestors' content-based `min-height`/`min-width: auto`, which then hands
 * Cytoscape a bigger container to measure next time: a real feedback loop,
 * not a one-off race. Proven live (2026-09-07): hiding `canvasContainer` via
 * devtools collapsed the mount div from 4910px to 710px tall instantly, and
 * restored it instantly on un-hiding. `min-h-[28rem]` on the mount div is
 * already an explicit, non-`auto` floor and needs no `min-h-0` companion
 * (the two would just override each other) — only `min-w-0` was missing,
 * same as `FileViewer.tsx`'s CodeMirror mount already carries for the same
 * reason. Full mechanism and the remount-based e2e proof:
 * `docs/DECISIONS.md` ("the dependency-graph measurement feedback loop").
 *
 * `overflow-hidden` on the root `<section>` below is load-bearing too, for a
 * related but distinct reason: this panel is a canvas that fills its box and
 * manages its own pan/zoom, so nothing in it ever needs a native scrollbar.
 * Without it, the panel sits inside `AppShell`'s `overflow-auto` `<main>`
 * with no clipping boundary in between, so Cytoscape's own container-
 * matching resize (`useCytoscape.ts`) can affect `main`'s measured
 * scrollWidth/scrollHeight directly: a resize nudges `main` past its own box
 * by a sub-pixel amount, `main` grows a scrollbar, the scrollbar consumes
 * ~15px, the panel (and Cytoscape's container inside it) shrinks to fit, the
 * overflow reason disappears, the scrollbar is removed, and the panel grows
 * back — forever, roughly twice a second on a real repo (docs/DECISIONS.md,
 * "KI-11 is a scrollbar-reservation feedback loop"). `overflow-hidden` makes
 * this section its own clipping boundary: whatever Cytoscape does inside it
 * can no longer be seen by `main` at all, so `main` never has a reason to
 * grow a scrollbar because of this tab, regardless of what triggers a resize
 * in the future. Other tabs keep `main`'s `overflow-auto` unchanged — they
 * have real scrollable content; this one never did.
 */
export function DependencyGraph({
  result,
  onOpenFile = NOOP_OPEN_FILE,
  onCytoscapeReady,
}: DependencyGraphProps): JSX.Element {
  const { containerRef, searchInputRef, searchQuery, setSearchQuery, announcement, graph, handleKeyDown } =
    useDependencyGraphController(result, onOpenFile, onCytoscapeReady);

  if (result.files.length === 0) {
    return (
      <section aria-labelledby="dependency-graph-title" className="flex flex-1 flex-col overflow-hidden">
        <h2 id="dependency-graph-title" className="sr-only">
          Dependency graph
        </h2>
        <EmptyState title={GRAPH_COPY.empty.title} description={GRAPH_COPY.empty.description} />
      </section>
    );
  }

  return (
    // min-h-0, overflow-hidden: both load-bearing — see this component's doc comment above + docs/DECISIONS.md.
    <section aria-labelledby="dependency-graph-title" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <h2 id="dependency-graph-title" className="sr-only">
        Dependency graph
      </h2>
      <GraphToolbar
        searchInputRef={searchInputRef}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onExpandAll={graph.expandAll}
        onCollapseAll={graph.collapseAll}
      />
      {/* min-w-0 (not min-h-0 — see this component's doc comment above): the Cytoscape mount div, load-bearing. */}
      <div
        ref={containerRef}
        role="application"
        aria-label="Dependency graph canvas. Press slash to search. Arrow keys move between files by importance rank. Bracket keys step to dependents or dependencies. Enter opens the focused file. Escape exits."
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="relative min-h-[28rem] min-w-0 flex-1 border-y border-slate-200 dark:border-slate-800"
      />
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <GraphListFallback result={result} onOpenFile={onOpenFile} />
    </section>
  );
}
