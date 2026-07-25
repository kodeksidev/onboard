import { describe, expect, test } from 'bun:test';
import { buildParseDiagnostics, parseFiles, type ParsePoolEntry, type ParsePoolResult } from '../../src/parse/parser-pool';
import type { LanguageParser, ParsedFile, SupportedLanguageId } from '../../src/parse/language-parser';

function emptyParsedFile(hasSyntaxError = false): ParsedFile {
  return { imports: [], symbols: [], hasSyntaxError };
}

/** A fake parser whose delay is inversely related to index, so results would
 * complete OUT of submission order if the pool appended instead of indexing. */
function makeSlowestFirstGetParser(delaysMs: readonly number[]): (languageId: SupportedLanguageId) => Promise<LanguageParser> {
  let callCount = 0;
  return async (languageId) => {
    const myCallIndex = callCount;
    callCount += 1;
    const delay = delaysMs[myCallIndex] ?? 0;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return {
      languageId,
      parse: (sourceText: string) => emptyParsedFile(sourceText.includes('BROKEN')),
    };
  };
}

describe('parseFiles — determinism (Section 8.8)', () => {
  test('writes results into a pre-sized array by index, never appended, regardless of completion order', async () => {
    const entries: ParsePoolEntry[] = Array.from({ length: 6 }, (_, i) => ({
      path: `file-${String(i)}.ts`,
      languageId: 'typescript',
      sourceText: `const marker = ${String(i)};`,
    }));
    // Earlier-indexed entries are made artificially SLOWER, so if completion
    // order ever leaked into result order, index 0 would land last.
    const delays = [50, 40, 30, 20, 10, 0];
    const getParser = makeSlowestFirstGetParser(delays);

    const results = await parseFiles(entries, getParser, { concurrency: 6 });

    expect(results).toHaveLength(entries.length);
    for (let i = 0; i < entries.length; i += 1) {
      const result = results[i];
      expect(result?.status).toBe('ok');
    }
  });

  test('returns an empty array for zero entries without invoking the parser factory', async () => {
    let called = false;
    const results = await parseFiles([], async (languageId) => {
      called = true;
      return { languageId, parse: () => emptyParsedFile() };
    });
    expect(results).toEqual([]);
    expect(called).toBe(false);
  });

  test('respects an explicit concurrency below the file count', async () => {
    const entries: ParsePoolEntry[] = Array.from({ length: 10 }, (_, i) => ({
      path: `f${String(i)}.ts`,
      languageId: 'typescript',
      sourceText: 'const x = 1;',
    }));
    let inFlight = 0;
    let maxInFlight = 0;
    const getParser = async (languageId: SupportedLanguageId): Promise<LanguageParser> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { languageId, parse: () => emptyParsedFile() };
    };
    await parseFiles(entries, getParser, { concurrency: 3 });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  test('captures a thrown error as a "failed" result rather than propagating it', async () => {
    const entries: ParsePoolEntry[] = [{ path: 'bad.ts', languageId: 'typescript', sourceText: 'x' }];
    const results = await parseFiles(entries, async () => {
      throw new Error('boom');
    });
    expect(results[0]).toEqual({ status: 'failed', message: 'boom' });
  });
});

describe('buildParseDiagnostics', () => {
  test('produces a PARSE_FAILED diagnostic for a syntax-error result', () => {
    const entries: ParsePoolEntry[] = [{ path: 'src/broken.ts', languageId: 'typescript', sourceText: 'BROKEN' }];
    const results: ParsePoolResult[] = [{ status: 'ok', parsed: emptyParsedFile(true) }];
    const diagnostics = buildParseDiagnostics(entries, results);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('PARSE_FAILED');
    expect(diagnostics[0]?.path).toBe('src/broken.ts');
    expect(diagnostics[0]?.severity).toBe('warning');
  });

  test('produces an error-severity PARSE_FAILED diagnostic when the parser itself threw', () => {
    const entries: ParsePoolEntry[] = [{ path: 'src/oops.ts', languageId: 'typescript', sourceText: '' }];
    const results: ParsePoolResult[] = [{ status: 'failed', message: 'kaboom' }];
    const diagnostics = buildParseDiagnostics(entries, results);
    expect(diagnostics).toEqual([{ severity: 'error', code: 'PARSE_FAILED', path: 'src/oops.ts', message: 'kaboom' }]);
  });

  test('produces no diagnostics for a clean parse', () => {
    const entries: ParsePoolEntry[] = [{ path: 'src/clean.ts', languageId: 'typescript', sourceText: 'const x = 1;' }];
    const results: ParsePoolResult[] = [{ status: 'ok', parsed: emptyParsedFile(false) }];
    expect(buildParseDiagnostics(entries, results)).toEqual([]);
  });
});
