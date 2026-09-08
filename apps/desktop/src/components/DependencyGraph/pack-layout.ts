import type cytoscape from 'cytoscape';

/**
 * Deterministic size-aware packing for the case a force layout cannot handle:
 * a visible graph whose TOP LEVEL has no edges (amendment, 2026-09-08 —
 * docs/DECISIONS.md).
 *
 * fcose positions nodes by forces. When no edge connects two top-level nodes
 * there are no forces at that level, and the result is arbitrary: boxes drift
 * into empty regions, and — worse — a node that belongs to nobody can come to
 * rest INSIDE an expanded directory's compound box, which draws containment
 * that does not exist. Both were visible on CacttusEdu, whose 1,227 edges all
 * live inside a single top-level directory, so its entering view has exactly
 * zero top-level edges and every drill step keeps it that way.
 *
 * This is not a general layout replacement. It runs only when the top level
 * carries no edge information at all, and it never touches what is INSIDE a
 * compound — fcose still lays out a directory's contents, this just decides
 * where the resulting boxes sit relative to one another. When top-level edges
 * do exist (after "Expand all", say), their arrangement is meaningful and is
 * left alone.
 */

/** Space between packed boxes, and between a box and its neighbour's label. */
export const PACK_GAP_PX = 36;

/** Fallback when the container has no measurable aspect (headless tests). */
const DEFAULT_ASPECT_RATIO = 16 / 9;

export interface PackItem {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

export interface PackedPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * Shelf packing: tallest first, left to right, wrapping at a row width chosen
 * to land near `targetAspectRatio`. Ties break by id, so the same graph always
 * packs the same way — a map that rearranges itself between visits is not a
 * map. Returns CENTRE positions, which is what Cytoscape's `position()` takes.
 */
export function shelfPack(
  items: readonly PackItem[],
  targetAspectRatio: number,
  gap: number = PACK_GAP_PX,
): Map<string, PackedPosition> {
  const ordered = [...items].sort(
    (a, b) => b.height - a.height || b.width - a.width || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const totalArea = ordered.reduce((sum, item) => sum + (item.width + gap) * (item.height + gap), 0);
  const aspect = targetAspectRatio > 0 ? targetAspectRatio : DEFAULT_ASPECT_RATIO;
  const widestRow = Math.max(Math.sqrt(totalArea * aspect), ...ordered.map((item) => item.width + gap));

  const positions = new Map<string, PackedPosition>();
  let cursorX = 0;
  let rowTop = 0;
  let rowHeight = 0;
  ordered.forEach((item) => {
    if (cursorX > 0 && cursorX + item.width > widestRow) {
      rowTop += rowHeight + gap;
      cursorX = 0;
      rowHeight = 0;
    }
    positions.set(item.id, { x: cursorX + item.width / 2, y: rowTop + item.height / 2 });
    cursorX += item.width + gap;
    rowHeight = Math.max(rowHeight, item.height);
  });
  return positions;
}

/** Visible nodes with no visible ancestor — the boxes the packer arranges. */
export function topLevelVisibleNodes(cy: cytoscape.Core): cytoscape.NodeCollection {
  return cy.nodes(':visible').filter((node) => node.ancestors().filter(':visible').empty());
}

function topLevelAncestorId(node: cytoscape.NodeSingular): string {
  const visibleAncestors = node.ancestors().filter(':visible');
  return visibleAncestors.empty() ? node.id() : visibleAncestors.last().id();
}

/**
 * True when at least one visible edge joins two DIFFERENT top-level nodes —
 * i.e. the top level has force information worth respecting. An edge between
 * two files inside one directory does not count: it says nothing about where
 * that directory belongs relative to its siblings.
 */
export function hasTopLevelEdges(cy: cytoscape.Core): boolean {
  return cy
    .edges(':visible')
    .toArray()
    .some((edge) => topLevelAncestorId(edge.source()) !== topLevelAncestorId(edge.target()));
}

/**
 * Packs the top-level boxes when — and only when — the top level is edgeless.
 * Returns whether it did, so callers can tell a packed layout from a force
 * layout. Positions are set on the top-level nodes; Cytoscape translates each
 * compound's descendants with it, so a directory's internal arrangement is
 * preserved exactly.
 */
export function packTopLevelIfUnforced(cy: cytoscape.Core | null): boolean {
  if (cy === null || cy.destroyed()) {
    return false;
  }
  const nodes = topLevelVisibleNodes(cy);
  if (nodes.length < 2 || hasTopLevelEdges(cy)) {
    return false;
  }
  const items: PackItem[] = nodes.map((node) => {
    const box = node.boundingBox({ includeLabels: true, includeOverlays: false });
    return { id: node.id(), width: box.w, height: box.h };
  });
  const aspect = cy.width() > 0 && cy.height() > 0 ? cy.width() / cy.height() : DEFAULT_ASPECT_RATIO;
  const packed = shelfPack(items, aspect);
  cy.batch(() => {
    nodes.forEach((node) => {
      const target = packed.get(node.id());
      if (target !== undefined) {
        node.position({ x: target.x, y: target.y });
      }
    });
  });
  return true;
}
