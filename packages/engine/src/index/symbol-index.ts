/**
 * @onboard/engine — symbol index rows (Section 6.1's `symbol` table).
 *
 * Converts a file's `RawSymbol[]` (Section 9 Phase 3's parse output) into
 * `SymbolRow[]` (Phase 2's `CacheStore` shape), computing the one field the
 * parser doesn't know about: the symbol's cache-primary-key `id`.
 */
import { sha1Hex } from '../util/hash';
import type { RawSymbol } from '../parse/language-parser';
import type { SymbolRow } from '../cache/cache-store';

const SYMBOL_ID_HEX_LENGTH = 16;

/** `sha1(path + '#' + name + '#' + startLine)[:16]` (Section 6.1). */
export function computeSymbolId(path: string, name: string, startLine: number): string {
  return sha1Hex(`${path}#${name}#${String(startLine)}`).slice(0, SYMBOL_ID_HEX_LENGTH);
}

function toSymbolRow(path: string, symbol: RawSymbol): SymbolRow {
  return {
    id: computeSymbolId(path, symbol.name, symbol.startLine),
    path,
    name: symbol.name,
    nameLower: symbol.name.toLowerCase(),
    kind: symbol.kind,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    isExported: symbol.isExported,
    container: symbol.containerName,
    signature: symbol.signature,
  };
}

/** Builds the cache `symbol` rows for one file's raw symbols, sorted by start line. */
export function buildSymbolRows(path: string, symbols: readonly RawSymbol[]): readonly SymbolRow[] {
  return symbols.map((symbol) => toSymbolRow(path, symbol));
}
