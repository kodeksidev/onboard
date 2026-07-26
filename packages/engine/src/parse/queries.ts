/**
 * @onboard/engine — loads the `.scm` tree-sitter query source for a language.
 *
 * Each file is imported with the `type: 'text'` attribute (not
 * `readFileSync(join(import.meta.dir, ...))`) so `bun build --compile`
 * actually embeds these `.scm` files in the standalone sidecar binary. The
 * old dynamic-path pattern resolves to a virtual `B:\~BUN\root\queries\...`
 * path at runtime inside a compiled executable and throws ENOENT — the same
 * class of bug already fixed for `schema.sql` and `tree-sitter.wasm` (see
 * `docs/DECISIONS.md`). The import specifier must be a static string
 * literal for Bun's bundler to embed it, so each of the four query files is
 * imported explicitly rather than built from a joined path at runtime.
 */
import javascriptQuery from './queries/javascript.scm' with { type: 'text' };
import tsQuery from './queries/ts.scm' with { type: 'text' };
import tsxQuery from './queries/tsx.scm' with { type: 'text' };
import pythonQuery from './queries/python.scm' with { type: 'text' };
import type { SupportedLanguageId } from './language-parser';

const QUERY_SOURCES: Readonly<Record<SupportedLanguageId, string>> = {
  javascript: javascriptQuery,
  typescript: tsQuery,
  tsx: tsxQuery,
  python: pythonQuery,
};

export function readQuerySource(languageId: SupportedLanguageId): string {
  return QUERY_SOURCES[languageId];
}
