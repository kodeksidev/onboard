import type { JSX } from 'react';
import type { AnalysisResult } from '@onboard/contract';
import { FILE_VIEWER_COPY } from '@/copy/messages';

/** `SymbolEntry` isn't re-exported as a type by `@onboard/contract` (only its zod schema); derive it from a field that is. */
export type SymbolEntry = AnalysisResult['symbols'][number];

export interface SymbolOutlineProps {
  readonly symbols: readonly SymbolEntry[];
  readonly onSelectSymbol: (line: number) => void;
}

/** The file viewer's symbol outline (Section 6.1: `idx_symbol_path` — one ordered range scan per file), jump-to-line on click. */
export function SymbolOutline({ symbols, onSelectSymbol }: SymbolOutlineProps): JSX.Element {
  if (symbols.length === 0) {
    return <p className="text-xs text-slate-500 dark:text-slate-500">{FILE_VIEWER_COPY.noSymbols}</p>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {symbols.map((symbol) => (
        <li key={symbol.id}>
          <button
            type="button"
            onClick={() => onSelectSymbol(symbol.startLine)}
            className="flex w-full items-center gap-2 truncate rounded px-1 py-0.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <span className="shrink-0 text-slate-500 dark:text-slate-500">{symbol.kind}</span>
            <span className="truncate font-mono">{symbol.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
