import { describe, expect, test } from 'vitest';
import cytoscape from 'cytoscape';
import {
  applySearchFilter,
  clearHighlight,
  focusNodeById,
  highlightNeighborhood,
  supportsCanvasRendering,
} from './useCytoscape';

/**
 * `focusNodeById` / `highlightNeighborhood` / `clearHighlight` are plain
 * functions over a `cytoscape.Core` (no React, no extensions needed), so
 * they are tested directly against a real headless core — genuine
 * Cytoscape.js behavior, just without a renderer attached (Section 9 Phase
 * 8's "honest about jsdom" instruction: this is real graph-model behavior,
 * not a faked measurement).
 */
function buildTriangleGraph(): cytoscape.Core {
  return cytoscape({
    headless: true,
    styleEnabled: false,
    elements: [
      { data: { id: 'a', label: 'auth.service.ts' }, classes: 'file-node' },
      { data: { id: 'b', label: 'user.model.ts' }, classes: 'file-node' },
      { data: { id: 'c', label: 'auth.controller.ts' }, classes: 'file-node' },
      { data: { id: 'd', label: 'logger.ts' }, classes: 'file-node' }, // unrelated to 'a'
      { data: { id: 'ab', source: 'a', target: 'b' } }, // a depends on b
      { data: { id: 'ca', source: 'c', target: 'a' } }, // c depends on a (c is a's dependent)
    ],
  });
}

describe('supportsCanvasRendering', () => {
  test('reports false under jsdom (no canvas package) — the documented, honest fallback trigger', () => {
    expect(supportsCanvasRendering()).toBe(false);
  });
});

describe('highlightNeighborhood', () => {
  test('marks the tapped node selected, its dependency, and its dependent — dims everything else', () => {
    const cy = buildTriangleGraph();

    highlightNeighborhood(cy, 'a');

    expect(cy.getElementById('a').hasClass('selected-node')).toBe(true);
    expect(cy.getElementById('b').hasClass('highlighted-dependency')).toBe(true);
    expect(cy.getElementById('c').hasClass('highlighted-dependent')).toBe(true);
    expect(cy.getElementById('d').hasClass('dimmed')).toBe(true);
    cy.destroy();
  });

  test('does not dim the edges connected to the selected node', () => {
    const cy = buildTriangleGraph();

    highlightNeighborhood(cy, 'a');

    expect(cy.getElementById('ab').hasClass('dimmed')).toBe(false);
    expect(cy.getElementById('ca').hasClass('dimmed')).toBe(false);
    cy.destroy();
  });

  test('is a no-op for an id that does not exist in the graph', () => {
    const cy = buildTriangleGraph();
    expect(() => highlightNeighborhood(cy, 'does-not-exist')).not.toThrow();
    cy.destroy();
  });
});

describe('clearHighlight', () => {
  test('removes every highlight/selection/dim class', () => {
    const cy = buildTriangleGraph();
    highlightNeighborhood(cy, 'a');

    clearHighlight(cy);

    expect(cy.elements().filter('.dimmed, .selected-node, .highlighted-dependency, .highlighted-dependent').length).toBe(0);
    cy.destroy();
  });

  test('is a no-op when cy is null', () => {
    expect(() => clearHighlight(null)).not.toThrow();
  });
});

describe('focusNodeById', () => {
  test('centers the viewport on the node when reduced motion is requested (no animation)', () => {
    const cy = buildTriangleGraph();
    cy.getElementById('a').position({ x: 500, y: 500 });

    focusNodeById(cy, 'a', true);

    // cy.center() is synchronous and headless-safe; pan moves so the node's
    // model position sits at the viewport center.
    const rendered = cy.getElementById('a').renderedPosition();
    expect(rendered.x).toBeCloseTo(cy.width() / 2, 0);
    expect(rendered.y).toBeCloseTo(cy.height() / 2, 0);
    cy.destroy();
  });

  test('is a no-op when cy is null or the id is unknown', () => {
    expect(() => focusNodeById(null, 'a', true)).not.toThrow();
    const cy = buildTriangleGraph();
    expect(() => focusNodeById(cy, 'does-not-exist', true)).not.toThrow();
    cy.destroy();
  });
});

describe('applySearchFilter', () => {
  test('marks matching file nodes and dims the rest', () => {
    const cy = buildTriangleGraph();

    applySearchFilter(cy, 'auth');

    expect(cy.getElementById('a').hasClass('search-match')).toBe(true);
    expect(cy.getElementById('c').hasClass('search-match')).toBe(true);
    expect(cy.getElementById('b').hasClass('dimmed')).toBe(true);
    expect(cy.getElementById('d').hasClass('dimmed')).toBe(true);
    cy.destroy();
  });

  test('an empty query clears every match/dim class', () => {
    const cy = buildTriangleGraph();
    applySearchFilter(cy, 'auth');

    applySearchFilter(cy, '');

    expect(cy.nodes('.file-node').filter('.dimmed, .search-match').length).toBe(0);
    cy.destroy();
  });

  test('is a no-op when cy is null', () => {
    expect(() => applySearchFilter(null, 'auth')).not.toThrow();
  });
});
