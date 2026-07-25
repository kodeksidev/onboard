import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walk } from '../../src/walk/walk';
import { determineSkipReason } from '../../src/walk/skip-rules';
import { posixExtLower } from '../../src/util/posix-path';
import { BINARY_CHECK_BYTES } from '../../src/constants';
import { buildParseDiagnostics, createLanguageParserFactory, parseFiles, type ParsePoolEntry } from '../../src/parse/parser-pool';
import type { SupportedLanguageId } from '../../src/parse/language-parser';

const KITCHEN_SINK = join(import.meta.dir, '..', '..', 'fixtures', 'kitchen-sink');
const GRAMMARS_DIR = join(import.meta.dir, '..', '..', 'grammars');

const EXTENSION_TO_LANGUAGE: Readonly<Record<string, SupportedLanguageId>> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
};

/** Mirrors the skip-rule pipeline a real analyze() will run before parsing (Phase 4). */
function buildParsePoolEntries(): readonly ParsePoolEntry[] {
  const walkResult = walk(KITCHEN_SINK);
  const entries: ParsePoolEntry[] = [];
  for (const file of walkResult.files) {
    const languageId = EXTENSION_TO_LANGUAGE[posixExtLower(file.path)];
    if (languageId === undefined) {
      continue; // 'unsupported-language' — not part of Phase 3's scope (A2)
    }
    const absPath = join(KITCHEN_SINK, ...file.path.split('/'));
    const bytes = readFileSync(absPath);
    const skipReason = determineSkipReason({
      sizeBytes: file.sizeBytes,
      readFirstBytes: () => new Uint8Array(bytes.subarray(0, BINARY_CHECK_BYTES)),
      readFullText: () => bytes.toString('utf8'),
    });
    if (skipReason !== null) {
      continue; // too-large / binary / minified — never reaches the parser
    }
    entries.push({ path: file.path, languageId, sourceText: bytes.toString('utf8') });
  }
  return entries;
}

describe('parsing kitchen-sink (Phase 3 gate)', () => {
  test('produces zero unhandled exceptions and at least one PARSE_FAILED diagnostic', async () => {
    const entries = buildParsePoolEntries();
    expect(entries.length).toBeGreaterThan(0);
    // large-file.ts and minified.js must have been filtered out by skip-rules.
    expect(entries.some((e) => e.path === 'src/large-file.ts')).toBe(false);
    expect(entries.some((e) => e.path === 'src/minified.js')).toBe(false);
    // The deliberately broken file must have survived to reach the parser.
    expect(entries.some((e) => e.path === 'src/broken.ts')).toBe(true);

    const getParser = createLanguageParserFactory(GRAMMARS_DIR);

    let thrown: unknown = null;
    let results: Awaited<ReturnType<typeof parseFiles>> = [];
    try {
      results = await parseFiles(entries, getParser);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeNull();
    expect(results.every((result) => result.status === 'ok')).toBe(true);

    const diagnostics = buildParseDiagnostics(entries, results);
    const parseFailed = diagnostics.filter((d) => d.code === 'PARSE_FAILED');
    expect(parseFailed.length).toBeGreaterThanOrEqual(1);
    expect(parseFailed.some((d) => d.path === 'src/broken.ts')).toBe(true);
  });
});
