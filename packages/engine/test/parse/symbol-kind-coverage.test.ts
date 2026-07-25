import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SymbolKind } from '@onboard/contract';
import { createLanguageParserFactory } from '../../src/parse/parser-pool';
import type { SupportedLanguageId } from '../../src/parse/language-parser';

const GRAMMARS_DIR = join(import.meta.dir, '..', '..', 'grammars');
const FIXTURES_DIR = join(import.meta.dir, '..', '..', 'fixtures');

const EXTENSION_TO_LANGUAGE: Readonly<Record<string, SupportedLanguageId>> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
};

/**
 * Every file that, together, is expected to demonstrate every `SymbolKind`
 * at least once. Each is a real, already-vendored fixture file, EXCEPT
 * `kitchen-sink/src/symbols-showcase.ts`, added in this phase specifically
 * to cover the kinds (interface/type/enum/class/method/variable) no other
 * fixture happened to exercise.
 */
const COVERAGE_FILES: readonly string[] = [
  'kitchen-sink/src/symbols-showcase.ts',
  'kitchen-sink/src/index.ts',
  'node-express/src/controllers/user-controller.js',
  'node-express/src/models/user-model.js',
  'node-express/src/routes/user-routes.js',
  'react-app/src/components/App.tsx',
  'react-app/src/components/Button.tsx',
  'react-app/src/hooks/useToggle.ts',
];

describe('every SymbolKind is produced by at least one fixture (Phase 3 gate)', () => {
  test('the union of extracted symbol kinds across the coverage set equals SymbolKind', async () => {
    const getParser = createLanguageParserFactory(GRAMMARS_DIR);
    const observedKinds = new Set<string>();

    for (const relPath of COVERAGE_FILES) {
      const extension = relPath.split('.').at(-1) ?? '';
      const languageId = EXTENSION_TO_LANGUAGE[extension];
      if (languageId === undefined) {
        throw new Error(`unmapped extension for coverage file: ${relPath}`);
      }
      const sourceText = readFileSync(join(FIXTURES_DIR, relPath), 'utf8');
      const parser = await getParser(languageId);
      const parsed = parser.parse(sourceText);
      for (const symbol of parsed.symbols) {
        observedKinds.add(symbol.kind);
      }
    }

    const expectedKinds = [...SymbolKind.options].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const actualKinds = [...observedKinds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    expect(expectedKinds).toHaveLength(11);
    expect(actualKinds).toEqual(expectedKinds);
  });
});
