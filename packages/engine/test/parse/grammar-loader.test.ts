import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { computeGrammarFingerprint, createGrammarLoader, GrammarLoadError } from '../../src/parse/grammar-loader';

const GRAMMARS_DIR = join(import.meta.dir, '..', '..', 'grammars');

describe('createGrammarLoader — loads WASM from a directory passed by flag', () => {
  test('loads every supported language from an explicit grammarsDir, not a hardcoded path', async () => {
    const loader = createGrammarLoader(GRAMMARS_DIR);
    const languages = await Promise.all([
      loader.getLanguage('javascript'),
      loader.getLanguage('typescript'),
      loader.getLanguage('tsx'),
      loader.getLanguage('python'),
    ]);
    for (const language of languages) {
      expect(language).toBeDefined();
    }
  });

  test('caches a language across repeated requests (no reloading the WASM grammar)', async () => {
    const loader = createGrammarLoader(GRAMMARS_DIR);
    const first = await loader.getLanguage('python');
    const second = await loader.getLanguage('python');
    expect(second).toBe(first);
  });

  test('rejects with GrammarLoadError when the directory does not contain the expected file', async () => {
    const loader = createGrammarLoader(join(import.meta.dir, 'does-not-exist-grammars-dir'));
    await expect(loader.getLanguage('javascript')).rejects.toBeInstanceOf(GrammarLoadError);
  });

  test('two different loader instances pointed at two different directories do not share state', async () => {
    const loaderA = createGrammarLoader(GRAMMARS_DIR);
    const loaderB = createGrammarLoader(join(import.meta.dir, 'nowhere'));
    const okResult = await loaderA.getLanguage('python');
    expect(okResult).toBeDefined();
    await expect(loaderB.getLanguage('python')).rejects.toBeInstanceOf(GrammarLoadError);
  });
});

describe('computeGrammarFingerprint', () => {
  test('is deterministic for the same grammarsDir', () => {
    expect(computeGrammarFingerprint(GRAMMARS_DIR)).toBe(computeGrammarFingerprint(GRAMMARS_DIR));
  });

  test('is a 64-character lowercase hex sha256 digest', () => {
    const fingerprint = computeGrammarFingerprint(GRAMMARS_DIR);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
