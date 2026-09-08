import type cytoscape from 'cytoscape';

/**
 * How much detail the canvas draws at the current zoom (amendment,
 * 2026-09-08 — docs/DECISIONS.md).
 *
 * Structure is chosen by drilling (`collapse.ts`): what exists on the canvas
 * is whatever directories are currently expanded. This file decides how much
 * of that is *drawn*, so that moving between "orient" and "read" is a
 * continuum rather than the two disconnected states the panel used to have —
 * a fitted view too dense to read, and a zoomed-in view showing 5% of the
 * repo.
 *
 * Everything here is a pure function or a plain operation on a
 * `cytoscape.Core` passed in by the caller, so it is unit-testable headlessly
 * (same arrangement as `collapse.ts`); `useCytoscape.ts` owns when it runs.
 */

/** Phase 8's own rule, unchanged: below this zoom, no node draws a label. */
export const GRAPH_LABEL_ZOOM_THRESHOLD = 0.35;

/** Boundary between the "structure" and "detail" bands. */
export const GRAPH_DETAIL_ZOOM_THRESHOLD = 1;

/**
 * Most file labels drawn at once, at any zoom. This is the fix for labels
 * colliding in dense directories, which a zoom threshold alone cannot
 * address: at every zoom that fits a crowded directory on screen, its files
 * are equally crowded, so the cut has to be by importance, not by scale.
 * The labels kept are the most important ones currently in the viewport —
 * exactly the files a newcomer should read a name for first.
 */
export const GRAPH_VIEWPORT_LABEL_BUDGET = 25;

/**
 * Above this many visible import edges, edges are drawn as faint texture
 * rather than as individual lines. Following one dependency by eye across a
 * hairball is not a thing anyone can do; following it by selecting a node
 * (which lights its own edges through `.edge-focused`) is. So past the point
 * where individual lines stop being followable, they stop pretending to be.
 */
export const GRAPH_EDGE_CLUTTER_LIMIT = 120;

export type GraphDetailBand = 'overview' | 'structure' | 'detail';

export function bandForZoom(zoom: number): GraphDetailBand {
  if (zoom < GRAPH_LABEL_ZOOM_THRESHOLD) {
    return 'overview';
  }
  if (zoom < GRAPH_DETAIL_ZOOM_THRESHOLD) {
    return 'structure';
  }
  return 'detail';
}

export function shouldQuietEdges(band: GraphDetailBand, visibleEdgeCount: number): boolean {
  return band !== 'detail' || visibleEdgeCount > GRAPH_EDGE_CLUTTER_LIMIT;
}

export interface LabelCandidate {
  readonly id: string;
  /** `FileNode.importanceRank` — 1 is the most important file in the repo (Section 8.4). */
  readonly importanceRank: number;
}

/**
 * The `budget` most important candidates. Ties break by id so the same
 * viewport always labels the same nodes — a label that flickers between two
 * files as you pan is worse than either choice.
 */
export function selectLabeledIds(candidates: readonly LabelCandidate[], budget: number): ReadonlySet<string> {
  const ordered = [...candidates].sort(
    (a, b) => a.importanceRank - b.importanceRank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return new Set(ordered.slice(0, Math.max(budget, 0)).map((candidate) => candidate.id));
}

interface Extent {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

function collectViewportFileNodes(fileNodes: cytoscape.NodeCollection, extent: Extent): LabelCandidate[] {
  const candidates: LabelCandidate[] = [];
  fileNodes.forEach((node) => {
    const position = node.position();
    const isInViewport =
      position.x >= extent.x1 && position.x <= extent.x2 && position.y >= extent.y1 && position.y <= extent.y2;
    if (isInViewport) {
      candidates.push({ id: node.id(), importanceRank: Number(node.data('importanceRank')) });
    }
  });
  return candidates;
}

/**
 * Applies the band for the core's current zoom: the whole-graph label
 * cut-off below 0.35, the per-viewport label budget above it, and edge
 * quieting. Returns the band it applied, for callers that want to announce
 * or test it. One `cy.batch` so a pan costs a single style recalculation.
 */
export function applyDetailLevel(cy: cytoscape.Core): GraphDetailBand {
  const band = bandForZoom(cy.zoom());
  const fileNodes = cy.nodes('.file-node:visible');
  const labeledIds = selectLabeledIds(
    collectViewportFileNodes(fileNodes, cy.extent()),
    GRAPH_VIEWPORT_LABEL_BUDGET,
  );
  const isQuiet = shouldQuietEdges(band, cy.edges('.import-edge:visible').length);
  cy.batch(() => {
    cy.nodes().toggleClass('labels-hidden', band === 'overview');
    fileNodes.forEach((node) => {
      node.toggleClass('label-suppressed', !labeledIds.has(node.id()));
    });
    cy.edges('.import-edge').toggleClass('edge-quiet', isQuiet);
  });
  return band;
}
