import type { JSX } from 'react';

export interface CitationLinkProps {
  readonly path: string;
  readonly line: number;
  /**
   * The one `onOpenFile` seam every panel already takes (`App.tsx`'s
   * `handleOpenFile`): it opens the file viewer at that line AND focuses the
   * same path in `graphStore`. A citation therefore lands the user exactly
   * where a search hit or a roadmap step would — no second focus mechanism.
   */
  readonly onOpenFile: (path: string, line?: number) => void;
}

/**
 * One verified citation, rendered as a jump link (Section 8.10 step 4).
 *
 * A native `<button>`, so it is tab-reachable, Enter/Space-activatable and
 * focus-visible for free. The accessible name matches `SearchResultRow`'s
 * ("Open {path}, line {n}") so the same phrasing means the same action
 * everywhere in the app.
 *
 * This component never decides whether a path is legitimate — `AnswerMarkdown`
 * only renders it for a token whose path the backend returned in
 * `citedPaths`. It is a leaf that displays what it is given.
 */
export function CitationLink({ path, line, onOpenFile }: CitationLinkProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={`Open ${path}, line ${line}`}
      onClick={() => onOpenFile(path, line)}
      className="rounded font-mono text-xs text-blue-700 underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-blue-300"
    >
      {path}:{line}
    </button>
  );
}
