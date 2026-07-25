/**
 * @onboard/engine — the language-agnostic parser contract (A1, A2, A9).
 *
 * `LanguageParser` is the one interface every language plugs into. v1 ships
 * four implementations (javascript, typescript, tsx, python — A2); Go, Rust,
 * and Java are v2 (Section 3 non-goal 1) and slot in later behind this same
 * interface without any change to it.
 */
import { z } from 'zod';
import { SymbolKind } from '@onboard/contract';

/** The grammars this engine loads (Section 4). `js`/`jsx` both use `javascript`. */
export type SupportedLanguageId = 'javascript' | 'typescript' | 'tsx' | 'python';

export type SymbolKindValue = z.infer<typeof SymbolKind>;

export type RawImportKind = 'static' | 'dynamic' | 'require' | 'reexport' | 'type';

/** One import/require/dynamic-import found in a file, before resolution (Phase 4). */
export interface RawImport {
  readonly specifier: string;
  readonly line: number; // 1-based
  readonly kind: RawImportKind;
  readonly isTypeOnly: boolean;
}

/** One symbol found in a file, before it is written to the cache's `symbol` table. */
export interface RawSymbol {
  readonly name: string;
  readonly kind: SymbolKindValue;
  readonly startLine: number; // 1-based, inclusive
  readonly endLine: number; // 1-based, inclusive
  readonly isExported: boolean;
  readonly containerName: string | null;
  readonly signature: string | null; // normalized, max 200 chars
}

/** The raw extraction result for one file's content — "ParsedFile" (Section 6.1). */
export interface ParsedFile {
  readonly imports: readonly RawImport[];
  readonly symbols: readonly RawSymbol[];
  /** `true` when tree-sitter's error-tolerant parse produced an ERROR node. */
  readonly hasSyntaxError: boolean;
}

/** One parser per supported language, sharing this exact shape (A2). */
export interface LanguageParser {
  readonly languageId: SupportedLanguageId;
  parse(sourceText: string): ParsedFile;
}
