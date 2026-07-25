/**
 * @onboard/engine — parser pool (Section 8.8, Section 11's `min(cpuCount-1,8)`).
 *
 * Determinism first: results are written into a PRE-SIZED array by index,
 * never appended, so the order files were queued in is always the order
 * they come back in — regardless of which one finishes parsing first
 * (Section 8.8: "Workers return `(index, ParsedFile)`; results are written
 * into a pre-sized array by index, never appended.").
 *
 * Concurrency is bounded (`min(cpuCount-1,8)`) via an in-process pull-based
 * scheduler rather than real `worker_threads`/`Worker` instances — see
 * docs/DECISIONS.md for why, and what would need to change to upgrade this
 * to real OS-thread parallelism without touching the public API below.
 */
import { cpus } from 'node:os';
import { z } from 'zod';
import { Diagnostic } from '@onboard/contract';
import { createGrammarLoader, type GrammarLoader } from './grammar-loader';
import { readQuerySource } from './queries';
import { createTsFamilyParser } from './ts-parser';
import { createPythonParser } from './python-parser';
import type { LanguageParser, ParsedFile, SupportedLanguageId } from './language-parser';

const MAX_POOL_CONCURRENCY = 8;

type DiagnosticValue = z.infer<typeof Diagnostic>;

export interface ParsePoolEntry {
  readonly path: string; // repo-relative POSIX, used only for diagnostics
  readonly languageId: SupportedLanguageId;
  readonly sourceText: string;
}

export type ParsePoolResult =
  | { readonly status: 'ok'; readonly parsed: ParsedFile }
  | { readonly status: 'failed'; readonly message: string };

export interface ParsePoolOptions {
  readonly concurrency?: number;
}

function defaultConcurrency(): number {
  return Math.max(1, Math.min(cpus().length - 1, MAX_POOL_CONCURRENCY));
}

async function buildParser(loader: GrammarLoader, languageId: SupportedLanguageId): Promise<LanguageParser> {
  const language = await loader.getLanguage(languageId);
  const querySource = readQuerySource(languageId);
  return languageId === 'python'
    ? createPythonParser(language, querySource)
    : createTsFamilyParser(languageId, language, querySource);
}

/**
 * Creates a per-language `LanguageParser` factory scoped to one `grammarsDir`.
 * Each language's parser (and the `Language`/`Query` it wraps) is built at
 * most once and cached, regardless of how many files request it.
 */
export function createLanguageParserFactory(
  grammarsDir: string,
): (languageId: SupportedLanguageId) => Promise<LanguageParser> {
  const loader = createGrammarLoader(grammarsDir);
  const cache = new Map<SupportedLanguageId, Promise<LanguageParser>>();
  return async (languageId: SupportedLanguageId): Promise<LanguageParser> => {
    let cached = cache.get(languageId);
    if (cached === undefined) {
      cached = buildParser(loader, languageId);
      cache.set(languageId, cached);
    }
    return cached;
  };
}

async function parseOne(
  entry: ParsePoolEntry,
  getParser: (languageId: SupportedLanguageId) => Promise<LanguageParser>,
): Promise<ParsePoolResult> {
  try {
    const parser = await getParser(entry.languageId);
    return { status: 'ok', parsed: parser.parse(entry.sourceText) };
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Parses every entry, bounded to `min(cpuCount-1,8)` in-flight parses by
 * default. The returned array's length always equals `entries.length`, and
 * `result[i]` always corresponds to `entries[i]` (Section 8.8).
 */
export async function parseFiles(
  entries: readonly ParsePoolEntry[],
  getParser: (languageId: SupportedLanguageId) => Promise<LanguageParser>,
  options: ParsePoolOptions = {},
): Promise<readonly ParsePoolResult[]> {
  if (entries.length === 0) {
    return [];
  }
  const results = new Array<ParsePoolResult>(entries.length);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? defaultConcurrency(), entries.length));
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const entry = entries[index];
      if (entry === undefined) {
        return;
      }
      results[index] = await parseOne(entry, getParser);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, runWorker));
  return results;
}

/** Maps parse results back to path-scoped `Diagnostic`s (contract shape, ready for `analyze.ts`). */
export function buildParseDiagnostics(
  entries: readonly ParsePoolEntry[],
  results: readonly ParsePoolResult[],
): readonly DiagnosticValue[] {
  const diagnostics: DiagnosticValue[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const result = results[i];
    if (entry === undefined || result === undefined) {
      continue;
    }
    if (result.status === 'failed') {
      diagnostics.push({ severity: 'error', code: 'PARSE_FAILED', path: entry.path, message: result.message });
    } else if (result.parsed.hasSyntaxError) {
      diagnostics.push({
        severity: 'warning',
        code: 'PARSE_FAILED',
        path: entry.path,
        message: 'Syntax error(s) encountered while parsing; some symbols or imports may be incomplete.',
      });
    }
  }
  return diagnostics;
}
