import type cytoscape from 'cytoscape';

/**
 * Cytoscape stylesheet (A11). Node size/color are pre-computed data fields
 * (`graph-model.ts`) so the style layer only maps them — no per-frame style
 * function calls. Class toggles drive every dynamic state: `.labels-hidden`
 * (zoom < 0.35, `useCytoscape.ts`), `.selected-node` / `.highlighted-*` /
 * `.dimmed` (click-to-highlight), `.keyboard-focused` (keyboard nav).
 */

function buildNodeStyles(): cytoscape.StylesheetJson {
  return [
    {
      selector: 'node.file-node',
      style: {
        width: 'data(size)',
        height: 'data(size)',
        'background-color': 'data(color)',
        label: 'data(label)',
        'font-size': 8,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 2,
        'border-width': 1,
        'border-color': '#1e293b',
      },
    },
    {
      selector: 'node.directory-node',
      style: {
        shape: 'round-rectangle',
        'background-color': '#e2e8f0',
        'background-opacity': 0.5,
        'border-width': 1,
        'border-style': 'dashed',
        'border-color': '#94a3b8',
        label: 'data(label)',
        'text-valign': 'top',
        'text-halign': 'center',
        'font-size': 9,
        'font-weight': 'bold',
        padding: '12px',
      },
    },
    {
      selector: '.labels-hidden',
      style: { label: '' },
    },
  ];
}

function buildEdgeStyles(): cytoscape.StylesheetJson {
  return [
    {
      selector: 'edge.import-edge',
      style: {
        width: 1,
        'line-color': '#94a3b8',
        'target-arrow-color': '#94a3b8',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.7,
        'curve-style': 'bezier',
        opacity: 0.6,
      },
    },
    {
      // Section 9 Phase 9: the roadmap's reading-order route, overlaid on
      // top of (and visually distinct from) real import edges.
      selector: 'edge.route-edge',
      style: {
        width: 3,
        'line-color': '#7c3aed',
        'target-arrow-color': '#7c3aed',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 1,
        'line-style': 'dashed',
        'curve-style': 'bezier',
        opacity: 0.9,
        'z-index': 10,
      },
    },
  ];
}

/** Click-to-highlight and keyboard-focus states (Phase 8: highlight dependencies + dependents on click). */
function buildInteractionStyles(): cytoscape.StylesheetJson {
  return [
    {
      selector: 'node.selected-node',
      style: { 'border-width': 3, 'border-color': '#2563eb' },
    },
    {
      selector: 'node.highlighted-dependency',
      style: { 'border-width': 3, 'border-color': '#16a34a' },
    },
    {
      selector: 'node.highlighted-dependent',
      style: { 'border-width': 3, 'border-color': '#d97706' },
    },
    {
      selector: 'node.keyboard-focused',
      style: { 'border-width': 4, 'border-color': '#7c3aed', 'border-style': 'solid' },
    },
    {
      selector: '.dimmed',
      style: { opacity: 0.15 },
    },
    {
      selector: 'node.search-match',
      style: { 'border-width': 3, 'border-color': '#0891b2' },
    },
  ];
}

export function buildGraphStylesheet(): cytoscape.StylesheetJson {
  return [...buildNodeStyles(), ...buildEdgeStyles(), ...buildInteractionStyles()];
}
