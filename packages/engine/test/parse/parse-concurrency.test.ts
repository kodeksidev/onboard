import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLanguageParserFactory, parseFiles } from '../../src/parse/parser-pool';
import type { ParsePoolEntry, ParsePoolResult } from '../../src/parse/parser-pool';

const GRAMMARS_DIR = join(import.meta.dir, '..', '..', 'grammars');
const FIXTURE_SRC = join(import.meta.dir, '..', '..', 'fixtures', 'kitchen-sink', 'src');

function entries(): ParsePoolEntry[] {
  return readdirSync(FIXTURE_SRC)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.js'))
    .sort()
    .map((name) => ({
      path: `src/${name}`,
      languageId: name.endsWith('.js') ? ('javascript' as const) : ('typescript' as const),
      sourceText: readFileSync(join(FIXTURE_SRC, name), 'utf8'),
    }));
}

function summarize(results: readonly ParsePoolResult[]): string {
  return results
    .map((result) =>
      result.status === 'ok'
        ? `ok:${String(result.parsed.symbols.length)}:${String(result.parsed.imports.length)}`
        : `FAILED:${result.message}`,
    )
    .join(' | ');
}

/** A whole parse run through its own factory, as `analyze()` does it. */
async function parseThroughOwnFactory(): Promise<string> {
  return summarize(await parseFiles(entries(), createLanguageParserFactory(GRAMMARS_DIR)));
}

/**
 * `Parser.init()` initializes a process-global WASM runtime. The grammar loader
 * used to memoize that per LOADER, so two loaders created concurrently each
 * called it, and the second re-initialized the runtime under the first — which
 * came back as `Incompatible language version 0`, failing every parse in the
 * losing run.
 *
 * This is the root cause of the 107-leaf divergence between two overlapping
 * `analyze()` calls (`docs/DECISIONS.md`). It is invisible once anything has
 * warmed the runtime, which is why every existing test missed it: they run
 * sequentially, and by the second run the global is already initialized.
 *
 * So the load-bearing word in these tests is COLD.
 */
describe('parsing survives concurrent cold starts', () => {
  test('two parse runs started COLD and concurrently agree exactly', async () => {
    // Nothing warms the runtime first, deliberately. With the init promise
    // scoped per loader, one side returns FAILED for every file.
    const [first, second] = await Promise.all([parseThroughOwnFactory(), parseThroughOwnFactory()]);

    expect(first).toBe(second);
  });

  test('neither concurrent run degrades to a failed parse', async () => {
    // Equality alone is not enough: two runs that BOTH failed every file would
    // agree perfectly. This is the substance floor.
    const [first, second] = await Promise.all([parseThroughOwnFactory(), parseThroughOwnFactory()]);

    expect(first).not.toContain('FAILED');
    expect(second).not.toContain('FAILED');
  });

  test('a concurrent run matches what a lone run produces', async () => {
    const [concurrent] = await Promise.all([parseThroughOwnFactory(), parseThroughOwnFactory()]);
    const alone = await parseThroughOwnFactory();

    expect(concurrent).toBe(alone);
  });

  test('the fixture actually exercises the parser', async () => {
    // Non-vacuity: if the fixture stopped yielding parseable files, every
    // assertion above would hold over an empty set.
    const parsed = await parseThroughOwnFactory();

    expect(entries().length).toBeGreaterThan(5);
    expect(parsed).toContain('ok:');
  });
});
