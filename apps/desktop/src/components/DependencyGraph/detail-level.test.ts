import { describe, expect, test } from 'vitest';
import cytoscape from 'cytoscape';
import {
  GRAPH_EDGE_CLUTTER_LIMIT,
  GRAPH_VIEWPORT_LABEL_BUDGET,
  applyDetailLevel,
  bandForZoom,
  selectLabeledIds,
  shouldQuietEdges,
} from './detail-level';

/**
 * The zoom bands are pure logic plus a few class toggles on a real (headless)
 * `cytoscape.Core`, exactly like `collapse.ts` — no canvas needed, so the
 * rules are tested for what they decide rather than for how they look.
 */

describe('bandForZoom', () => {
  test('below Phase 8s label threshold the graph is in the overview band', () => {
    expect(bandForZoom(0.2)).toBe('overview');
    expect(bandForZoom(0.349)).toBe('overview');
  });

  test('between the label threshold and 1x it is the structure band', () => {
    expect(bandForZoom(0.35)).toBe('structure');
    expect(bandForZoom(0.99)).toBe('structure');
  });

  test('at 1x and above it is the detail band', () => {
    expect(bandForZoom(1)).toBe('detail');
    expect(bandForZoom(3)).toBe('detail');
  });
});

describe('shouldQuietEdges', () => {
  test('quiets edges in every band below detail', () => {
    expect(shouldQuietEdges('overview', 1)).toBe(true);
    expect(shouldQuietEdges('structure', 1)).toBe(true);
  });

  test('leaves a readable number of edges alone in the detail band', () => {
    expect(shouldQuietEdges('detail', GRAPH_EDGE_CLUTTER_LIMIT)).toBe(false);
  });

  test('quiets even in the detail band once there are more edges than anyone can follow by eye', () => {
    expect(shouldQuietEdges('detail', GRAPH_EDGE_CLUTTER_LIMIT + 1)).toBe(true);
  });
});

describe('selectLabeledIds', () => {
  test('keeps the most important candidates, by importance rank', () => {
    const candidates = [
      { id: 'c', importanceRank: 30 },
      { id: 'a', importanceRank: 1 },
      { id: 'b', importanceRank: 12 },
    ];

    expect(selectLabeledIds(candidates, 2)).toEqual(new Set(['a', 'b']));
  });

  test('breaks ties by id, so panning never flickers a label between two equals', () => {
    const candidates = [
      { id: 'z', importanceRank: 5 },
      { id: 'a', importanceRank: 5 },
    ];

    expect(selectLabeledIds(candidates, 1)).toEqual(new Set(['a']));
  });

  test('returns nothing for a budget of zero rather than throwing', () => {
    expect(selectLabeledIds([{ id: 'a', importanceRank: 1 }], 0)).toEqual(new Set());
  });
});

describe('applyDetailLevel', () => {
  function buildCore(fileCount: number): cytoscape.Core {
    const elements: cytoscape.ElementDefinition[] = [];
    for (let index = 0; index < fileCount; index += 1) {
      elements.push({
        data: { id: `file:f${String(index)}.ts`, label: `f${String(index)}.ts`, importanceRank: index + 1 },
        position: { x: index, y: 0 },
        classes: 'file-node',
      });
    }
    for (let index = 1; index < fileCount; index += 1) {
      elements.push({
        data: { id: `e${String(index)}`, source: `file:f${String(index)}.ts`, target: 'file:f0.ts' },
        classes: 'import-edge',
      });
    }
    return cytoscape({ headless: true, styleEnabled: true, elements });
  }

  test('hides every label in the overview band, keeping Phase 8s zoom rule intact', () => {
    const cy = buildCore(3);
    cy.zoom(0.2);

    expect(applyDetailLevel(cy)).toBe('overview');
    expect(cy.nodes().map((node) => node.hasClass('labels-hidden')).every(Boolean)).toBe(true);
    cy.destroy();
  });

  test('labels no more than the viewport budget, however many files are on screen', () => {
    const cy = buildCore(GRAPH_VIEWPORT_LABEL_BUDGET + 40);
    cy.zoom(2);

    applyDetailLevel(cy);

    const labeled = cy.nodes('.file-node').filter((node) => !node.hasClass('label-suppressed'));
    expect(labeled.length).toBeLessThanOrEqual(GRAPH_VIEWPORT_LABEL_BUDGET);
    cy.destroy();
  });

  test('quiets a hairball of edges and leaves a readable one alone', () => {
    const dense = buildCore(GRAPH_EDGE_CLUTTER_LIMIT + 10);
    dense.zoom(2);
    applyDetailLevel(dense);
    expect(dense.edges('.import-edge').map((edge) => edge.hasClass('edge-quiet')).every(Boolean)).toBe(true);
    dense.destroy();

    const sparse = buildCore(5);
    sparse.zoom(2);
    applyDetailLevel(sparse);
    expect(sparse.edges('.import-edge').map((edge) => edge.hasClass('edge-quiet')).some(Boolean)).toBe(false);
    sparse.destroy();
  });
});
