import type cytoscape from 'cytoscape';

/**
 * Cytoscape stylesheet (A11). Node size/color are pre-computed data fields
 * (`graph-model.ts`) so the style layer only maps them — no per-frame style
 * function calls. Class toggles drive every dynamic state: `.labels-hidden`
 * (zoom < 0.35, `useCytoscape.ts`), `.label-suppressed` / `.edge-quiet` /
 * `.edge-focused` (the zoom bands, same file), `.selected-node` /
 * `.highlighted-*` / `.dimmed` (click-to-highlight), `.keyboard-focused`
 * (keyboard nav).
 */

/**
 * The canvas has no CSS: Cytoscape draws to a bitmap, so every color is a
 * literal in this file and none of the app's `dark:` Tailwind variants reach
 * it. That was survivable while the graph was a field of colored file dots
 * whose labels were incidental; it is not now that collapsed DIRECTORY boxes
 * and their labels are the entering view's whole content. Rendered against
 * the app's dark theme, the old fixed palette drew near-black labels on dark
 * boxes — "legible" only in the light theme nobody was running
 * (docs/DECISIONS.md, 2026-09-08).
 */
export interface GraphPalette {
  readonly label: string;
  readonly fileBorder: string;
  readonly directoryBackground: string;
  readonly directoryBorder: string;
  readonly edge: string;
  readonly edgeFocused: string;
}

const LIGHT_PALETTE: GraphPalette = {
  label: '#0f172a',
  fileBorder: '#1e293b',
  directoryBackground: '#e2e8f0',
  directoryBorder: '#94a3b8',
  edge: '#94a3b8',
  edgeFocused: '#475569',
};

const DARK_PALETTE: GraphPalette = {
  label: '#e2e8f0',
  fileBorder: '#0f172a',
  directoryBackground: '#334155',
  directoryBorder: '#64748b',
  edge: '#64748b',
  edgeFocused: '#e2e8f0',
};

/** Which palette the webview's current theme calls for. Media-query based, matching Tailwind's default `dark:` strategy (this app sets no `dark` class). */
export function resolveGraphPalette(): GraphPalette {
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? DARK_PALETTE : LIGHT_PALETTE;
}

function buildNodeStyles(palette: GraphPalette): cytoscape.StylesheetJson {
  return [
    {
      selector: 'node.file-node',
      style: {
        width: 'data(size)',
        height: 'data(size)',
        'background-color': 'data(color)',
        label: 'data(label)',
        'font-size': 10,
        color: palette.label,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 2,
        'border-width': 1,
        'border-color': palette.fileBorder,
      },
    },
    {
      // Directories are the entering view's primary content now (the
      // 2026-09-08 amendment in docs/DECISIONS.md), not faint containers
      // around the "real" nodes, so their label is sized to be read rather
      // than to stay out of the way.
      selector: 'node.directory-node',
      style: {
        shape: 'round-rectangle',
        'background-color': palette.directoryBackground,
        'background-opacity': 0.5,
        'border-width': 1,
        'border-style': 'dashed',
        'border-color': palette.directoryBorder,
        label: 'data(label)',
        color: palette.label,
        'text-valign': 'top',
        'text-halign': 'center',
        'font-size': 13,
        'font-weight': 'bold',
        'text-wrap': 'wrap',
        'text-max-width': '150px',
        padding: '12px',
      },
    },
  ];
}

/** Section 9 Phase 8 follow-up (lazy materialization): styles for a directory node's collapsed/hidden states. */
function buildLazyCollapseStyles(): cytoscape.StylesheetJson {
  return [
    {
      // A directory whose descendants have not been materialized into
      // Cytoscape yet (`collapse.ts`'s lazy-collapse set). Solid border + a
      // "(+N hidden files)" label (`graph-model.ts`) distinguishes it from
      // an ordinary, fully-expanded directory node; tapping it expands it
      // (`useCytoscape.ts`).
      selector: 'node.directory-node.lazy-collapsed',
      style: {
        'border-style': 'solid',
        'border-width': 2,
        // Sized by `descendantFileCount` and tinted by the module that owns
        // most of what is inside (`graph-model.ts`). Without these two, every
        // collapsed directory rendered at Cytoscape's default node size in
        // the same grey — identical blobs whatever they contained, which is
        // most of what the entering view shows.
        width: 'data(size)',
        height: 'data(size)',
        'background-color': 'data(color)',
        'background-opacity': 0.35,
        'border-color': 'data(color)',
        'text-valign': 'center',
        'font-size': 14,
        'text-max-width': '130px',
      },
    },
    {
      // A directory nested inside another, still-collapsed directory: real
      // Cytoscape node, but not shown (`collapse.ts`'s `reconcileLazyElements`
      // toggles this class rather than removing/re-adding the node).
      selector: '.hidden-by-collapse',
      style: { display: 'none' },
    },
  ];
}

function buildEdgeStyles(palette: GraphPalette): cytoscape.StylesheetJson {
  return [
    {
      selector: 'edge.import-edge',
      style: {
        width: 1,
        'line-color': palette.edge,
        'target-arrow-color': palette.edge,
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
    {
      // A directory-level stand-in for one or more real import edges whose
      // endpoint is currently hidden by collapse (`graph-model.ts`'s
      // `buildLazyGraphElements`) — "edges to a collapsed directory still
      // render as directory-level edges."
      selector: 'edge.directory-edge',
      style: { 'line-style': 'dotted' },
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

/**
 * The zoom-band rules (amendment, 2026-09-08 — docs/DECISIONS.md). Drilling
 * changes WHAT is on the canvas; these change how much of it is drawn at the
 * zoom you are at, so there is a continuum between "orient" and "read"
 * instead of two disconnected states. `useCytoscape.ts` owns which class is
 * applied at which zoom; this file only says what each one looks like.
 *
 * MUST stay last in the stylesheet: Cytoscape resolves a property to the LAST
 * matching rule, so these have to be able to override `label` and `opacity`
 * from every rule above.
 */
function buildDetailLevelStyles(palette: GraphPalette): cytoscape.StylesheetJson {
  return [
    {
      // Whole-graph label cut-off below zoom 0.35 (Phase 8's own rule).
      selector: '.labels-hidden',
      style: { label: '' },
    },
    {
      // Per-node label cut-off: a file node that is not among the most
      // important currently in view. Fixes labels colliding in dense
      // directories, where a zoom threshold alone cannot help — at any zoom
      // that fits the directory on screen, its files are equally crowded.
      selector: 'node.label-suppressed',
      style: { label: '' },
    },
    {
      // Ambient edges below the detail band: present enough to read as
      // texture ("this area is densely connected"), too faint to read as
      // hundreds of individual crossing lines.
      selector: 'edge.import-edge.edge-quiet',
      style: { opacity: 0.07 },
    },
    {
      // ...and the edges of whatever is selected or keyboard-focused, which
      // stay fully drawn in every band. Following one dependency is an
      // interaction, not something the eye does across a hairball.
      selector: 'edge.import-edge.edge-focused',
      style: {
        opacity: 0.95,
        width: 2,
        'line-color': palette.edgeFocused,
        'target-arrow-color': palette.edgeFocused,
        'z-index': 5,
      },
    },
  ];
}

export function buildGraphStylesheet(palette: GraphPalette = resolveGraphPalette()): cytoscape.StylesheetJson {
  return [
    ...buildNodeStyles(palette),
    ...buildLazyCollapseStyles(),
    ...buildEdgeStyles(palette),
    ...buildInteractionStyles(),
    ...buildDetailLevelStyles(palette),
  ];
}
