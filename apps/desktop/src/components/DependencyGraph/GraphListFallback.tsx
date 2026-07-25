import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { buildAdjacency } from './graph-model';

export interface GraphListFallbackProps {
  readonly result: AnalysisResult;
  readonly onOpenFile: (path: string) => void;
}

function formatList(paths: readonly string[] | undefined): string {
  if (paths === undefined || paths.length === 0) {
    return 'none';
  }
  return paths.join(', ');
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
  return (
    <table className="sr-only">
      <caption>Dependency graph, as a table: one row per file, ordered by importance rank.</caption>
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
        {result.files.map((file) => (
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
