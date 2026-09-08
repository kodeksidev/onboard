import type cytoscape from 'cytoscape';
import { fileNodeId } from './graph-model';

/**
 * Viewport and selection operations on a live `cytoscape.Core`.
 *
 * Split out of `useCytoscape.ts` when that file passed the 800-line limit
 * (criterion 27). The seam is real rather than arbitrary: nothing here knows
 * about the hook, the React lifecycle, drill state, or lazy materialization —
 * every function takes a core (or null) and does one thing to it, which is why
 * they are the easy half to test headlessly.
 */

const ROUTE_EDGE_ID_PREFIX = 'route:';

const FOCUS_ANIMATION_DURATION_MS = 300;

/** Breathing room around the entering view so its outermost boxes aren't flush against the panel edge. */
const ENTERING_VIEW_FIT_PADDING_PX = 40;

/**
 * Fits the visible graph to the panel. Deliberately NOT called from
 * `layoutstop`: at that moment Cytoscape is still working from the container
 * size it captured when the layout began, which during a tab switch is not
 * the final one — fitting there computed a zoom ~40% too large and left the
 * biggest directory boxes hanging off the bottom edge (measured on
 * CacttusEdu: 0.96 from `layoutstop` versus 0.68 once settled). The caller is
 * a React effect, which runs after the DOM commit, when the panel has its
 * real height.
 */
export function fitToVisible(cy: cytoscape.Core | null): void {
  if (cy === null || cy.destroyed() || cy.width() === 0 || cy.height() === 0) {
    return;
  }
  cy.fit(cy.elements(':visible'), ENTERING_VIEW_FIT_PADDING_PX);
}

/** Centers and (unless reduced-motion is set) animates the viewport onto a node. Phase 9's roadmap-step focus uses this via `graphStore`. */
export function focusNodeById(cy: cytoscape.Core | null, id: string, isReducedMotion: boolean): void {
  if (cy === null) {
    return;
  }
  const node = cy.getElementById(id);
  if (node.empty()) {
    return;
  }
  if (isReducedMotion) {
    cy.center(node);
    return;
  }
  cy.animate({ center: { eles: node } }, { duration: FOCUS_ANIMATION_DURATION_MS });
}

/** Click-to-highlight (Phase 8): the tapped node plus its dependencies and dependents stay lit; everything else dims. */
export function highlightNeighborhood(cy: cytoscape.Core | null, id: string): void {
  if (cy === null) {
    return;
  }
  const node = cy.getElementById(id);
  if (node.empty()) {
    return;
  }
  // Nothing to light means nothing to dim. A root file with no imports either
  // way — or, just as common, a file whose only dependencies lead into
  // collapsed directories, where the aggregate edge attaches to the DIRECTORY
  // and not to the file — used to dim the entire graph and light nothing:
  // the whole view destroyed in exchange for no information.
  if (node.connectedEdges(':visible').empty()) {
    cy.elements().removeClass('dimmed highlighted-dependency highlighted-dependent edge-focused');
    cy.elements().removeClass('selected-node');
    node.addClass('selected-node');
    return;
  }
  cy.elements()
    .addClass('dimmed')
    .removeClass('selected-node highlighted-dependency highlighted-dependent edge-focused');
  node.removeClass('dimmed').addClass('selected-node');
  node.outgoers('node').removeClass('dimmed').addClass('highlighted-dependency');
  node.incomers('node').removeClass('dimmed').addClass('highlighted-dependent');
  // `edge-focused` overrides the zoom bands' `edge-quiet` (it is styled last
  // in `graph-style.ts`), so the one dependency chain you asked about stays
  // fully drawn even in a band where ambient edges are faint texture.
  node.connectedEdges().removeClass('dimmed').addClass('edge-focused');
}

export function clearHighlight(cy: cytoscape.Core | null): void {
  cy?.elements().removeClass('dimmed selected-node highlighted-dependency highlighted-dependent edge-focused');
}

/**
 * Draws the "start here" roadmap's reading-order route as an overlay
 * (Section 9 Phase 9: "highlighted route through the graph"). These are
 * synthetic edges — the roadmap's order is a BFS-layered reading path, not
 * necessarily real import edges — so they are added to (and, on every
 * call, first removed from) the Cytoscape model rather than toggling
 * classes on existing edges. Always exactly `paths.length - 1` segments,
 * one per consecutive pair, skipping only a pair whose endpoint isn't in
 * the graph (defensive; every roadmap step's path is always an indexed
 * file in practice).
 */
export function applyRouteOverlay(cy: cytoscape.Core | null, paths: readonly string[]): void {
  if (cy === null) {
    return;
  }
  cy.remove(`.route-edge`);
  for (let index = 0; index < paths.length - 1; index += 1) {
    const fromPath = paths[index];
    const toPath = paths[index + 1];
    if (fromPath === undefined || toPath === undefined) {
      continue;
    }
    const source = fileNodeId(fromPath);
    const target = fileNodeId(toPath);
    if (cy.getElementById(source).empty() || cy.getElementById(target).empty()) {
      continue;
    }
    cy.add({
      data: { id: `${ROUTE_EDGE_ID_PREFIX}${index}`, source, target },
      classes: 'route-edge',
    });
  }
}

/** The graph's own quick filter (Phase 8: "focus search"). Section 10's full "where is X?" search arrives in Phase 10. */
export function applySearchFilter(cy: cytoscape.Core | null, query: string): void {
  if (cy === null) {
    return;
  }
  const term = query.trim().toLowerCase();
  if (term.length === 0) {
    cy.nodes('.file-node').removeClass('dimmed search-match');
    return;
  }
  cy.nodes('.file-node').forEach((node) => {
    const matches = String(node.data('label')).toLowerCase().includes(term);
    node.toggleClass('search-match', matches);
    node.toggleClass('dimmed', !matches);
  });
}
