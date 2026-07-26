import type { JSX } from 'react';
import type { SearchHit } from '@onboard/contract';
import { cn } from '@/lib/cn';

export interface SearchResultRowProps {
  readonly hit: SearchHit;
  readonly isSelected: boolean;
  readonly onOpenFile: (path: string, line?: number) => void;
  /** Wired to the listbox's `aria-activedescendant` by `WhereIsSearch`. */
  readonly id?: string;
}

/** The single most relevant line for this hit: the matched symbol's start, else the first content line hit, else none. */
function primaryLine(hit: SearchHit): number | undefined {
  return hit.symbol?.startLine ?? hit.lineHits[0]?.line;
}

function openFileLabel(path: string, line: number | undefined): string {
  return line === undefined ? `Open ${path}` : `Open ${path}, line ${line}`;
}

function MatchKindBadges({ matchKinds }: { readonly matchKinds: SearchHit['matchKinds'] }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1">
      {matchKinds.map((kind) => (
        <span key={kind} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          {kind}
        </span>
      ))}
    </div>
  );
}

function LineHitList({
  path,
  lineHits,
  onOpenFile,
}: {
  readonly path: string;
  readonly lineHits: SearchHit['lineHits'];
  readonly onOpenFile: (path: string, line?: number) => void;
}): JSX.Element | null {
  if (lineHits.length === 0) {
    return null;
  }
  return (
    <ul className="mt-1 space-y-0.5">
      {lineHits.map((lineHit) => (
        <li key={lineHit.line}>
          <div
            role="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenFile(path, lineHit.line);
            }}
            aria-label={`Jump to line ${lineHit.line} in ${path}: ${lineHit.preview}`}
            className="cursor-pointer truncate text-left font-mono text-xs text-slate-500 hover:underline dark:text-slate-400"
          >
            {`L${lineHit.line}: ${lineHit.preview}`}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * One search hit: path, best-matching symbol (if any), match-kind badges
 * (so ranking is explainable), and up to 5 content line hits. Clicking the
 * row opens the file at the most relevant line (Section 9 Phase 10's gate);
 * clicking an individual line hit opens that exact line instead.
 *
 * The row itself is `role="option"` inside `WhereIsSearch`'s
 * `aria-activedescendant` listbox: real DOM focus always stays on the search
 * input, never on the option. Per the ARIA APG, an `option` must not contain
 * focusable descendants — a negative `tabIndex` alone does not satisfy this
 * (axe-core's `no-focusable-content` check flags it explicitly, since some
 * assistive tech can still reach a `tabIndex={-1}` `<button>`). So neither
 * nested action here is a native `<button>`: both are `role="button"`
 * `<div>`/`<span>` elements with no `tabIndex` at all, which makes them
 * genuinely non-focusable while keeping their accessible name (`aria-label`)
 * and mouse-click behavior. Keyboard users reach the primary "open file"
 * action through `WhereIsSearch`'s ArrowUp/ArrowDown + Enter handling on the
 * search input itself, so no keyboard-reachable behavior is lost; only the
 * secondary per-line-hit jump (a mouse convenience) has no dedicated
 * keyboard path, consistent with how the WAI-ARIA authoring practices treat
 * secondary actions inside composite listbox options.
 */
export function SearchResultRow({ hit, isSelected, onOpenFile, id }: SearchResultRowProps): JSX.Element {
  const line = primaryLine(hit);
  return (
    <div
      id={id}
      role="option"
      aria-selected={isSelected}
      className={cn(
        'flex flex-col gap-1 rounded-md border p-2',
        isSelected ? 'border-blue-500 ring-1 ring-blue-500' : 'border-transparent',
      )}
    >
      <div
        role="button"
        onClick={() => onOpenFile(hit.path, line)}
        aria-label={openFileLabel(hit.path, line)}
        className="flex cursor-pointer flex-col gap-1 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs">{hit.path}</span>
          {hit.symbol !== null ? (
            <span className="flex shrink-0 gap-1 text-xs text-slate-500 dark:text-slate-500">
              <span>{hit.symbol.kind}</span>
              <span>{hit.symbol.name}</span>
            </span>
          ) : null}
        </div>
        <MatchKindBadges matchKinds={hit.matchKinds} />
      </div>
      <LineHitList path={hit.path} lineHits={hit.lineHits} onOpenFile={onOpenFile} />
    </div>
  );
}
