import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { buildAdjacency } from './graph-model';

export interface GraphListFallbackProps {
  readonly result: AnalysisResult;
  readonly onOpenFile: (path: string, line?: number) => void;
}

/**
 * Matches the engine roadmap's `ROADMAP_DEPENDS_ON_CAP` (packages/engine/src/constants.ts):
 * same rationale, applied here independently since the desktop app doesn't
 * depend on engine internals. A screen reader reading a hub file's full
 * dependent list (hundreds of entries, thousands of characters, unwrapped)
 * isn't usable accessibility — it's a wall of text.
 *
 * This alone is NOT sufficient to bound the table's rendered width (see
 * `table-fixed` below) — real repo paths are long enough that even 8 of
 * them per cell measured ~9,900px wide against this repo's own real
 * analysis, down from ~28,500px uncapped but still far from harmless. The
 * cap is the accessibility fix; `table-fixed` on the element itself is the
 * layout fix. Keep both: removing the cap would make a screen reader read
 * a wall of text again even though `table-fixed` alone would still bound
 * the box (see docs/DECISIONS.md, "GraphListFallback sr-only table width
 * blowout").
 */
const DEPENDENCY_LIST_CAP = 8;

/**
 * Same defect, the other axis (docs/DECISIONS.md, "GraphListFallback sr-only
 * table width blowout" and its height follow-up): `table-fixed` bounds
 * column width and `DEPENDENCY_LIST_CAP` bounds cell text, but neither
 * bounds ROW COUNT — a `<table>`'s minimum content height, like its minimum
 * content width, overrides `sr-only`'s `height: 1px` once there are enough
 * rows. 500 rows measured 12,142px tall against an 800px viewport. This is
 * a correctness fix, not just a layout one: a screen reader was never going
 * to read 500 rows usefully either.
 */
const MAX_FALLBACK_ROWS = 100;

function formatList(paths: readonly string[] | undefined): string {
  if (paths === undefined || paths.length === 0) {
    return 'none';
  }
  const shown = paths.slice(0, DEPENDENCY_LIST_CAP);
  const remaining = paths.length - shown.length;
  return remaining > 0 ? `${shown.join(', ')} (+${remaining} more)` : shown.join(', ');
}

/** Ascending by importance rank (1 = most important) — the cap below keeps the most important files, not an arbitrary prefix. */
function byImportanceRank(a: { importanceRank: number }, b: { importanceRank: number }): number {
  return a.importanceRank - b.importanceRank;
}

/**
 * "GraphListFallback renders the same data as a semantic table for screen
 * readers" (Section 9 Phase 8). Visually hidden (`sr-only`) since the
 * canvas + keyboard-navigable container is the primary interface, but it
 * carries real interaction (an "Open" button per row) rather than being an
 * inert data dump — an equivalent, not a token gesture.
 */
export function GraphListFallback({ result, onOpenFile }: GraphListFallbackProps): JSX.Element {
  const adjacency = buildAdjacency(result.edges);
  const sortedFiles = [...result.files].sort(byImportanceRank);
  const shownFiles = sortedFiles.slice(0, MAX_FALLBACK_ROWS);
  const omittedCount = sortedFiles.length - shownFiles.length;
  const caption =
    omittedCount > 0
      ? `Dependency graph, as a table: the ${String(MAX_FALLBACK_ROWS)} most important of ${String(sortedFiles.length)} files, ordered by importance rank. ${String(omittedCount)} more not shown — use "Where is X?" to search the rest.`
      : 'Dependency graph, as a table: one row per file, ordered by importance rank.';
  return (
    <table className="sr-only table-fixed">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Path</th>
          <th scope="col">Classification</th>
          <th scope="col">Module</th>
          <th scope="col">Importance rank</th>
          <th scope="col">Depends on</th>
          <th scope="col">Depended on by</th>
          <th scope="col">Action</th>
        </tr>
      </thead>
      <tbody>
        {shownFiles.map((file) => (
          <tr key={file.path}>
            <th scope="row">{file.path}</th>
            <td>{file.classification}</td>
            <td>{file.moduleId ?? 'none'}</td>
            <td>{file.importanceRank}</td>
            <td>{formatList(adjacency.dependencies.get(file.path))}</td>
            <td>{formatList(adjacency.dependents.get(file.path))}</td>
            <td>
              <button type="button" onClick={() => onOpenFile(file.path)}>
                {`Open ${file.path}`}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
