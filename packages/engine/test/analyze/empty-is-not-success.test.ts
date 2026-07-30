import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../../src/analyze';

const GRAMMARS_DIR = join(import.meta.dir, '..', '..', 'grammars');
const FIXTURES_DIR = join(import.meta.dir, '..', '..', 'fixtures');

/**
 * An `AnalysisResult` with no symbols and no edges is still WELL FORMED. It
 * validates against the contract, fingerprints, caches and renders. So a total
 * parser failure has always been indistinguishable from a successful analysis
 * of an empty project — which is exactly how both of this repository's
 * `Parser.init()` defects stayed invisible:
 *
 *  - the first shipped in a compiled binary whose WASM lookup failed with
 *    ENOENT, degrading every parse to `PARSE_FAILED`, and poisoned a cache;
 *  - the second raced two grammar loaders and produced two different "valid"
 *    results for one repository.
 *
 * `grammar-loader.ts`'s own header documented the first, in the same file, and
 * that did not prevent the second. Documenting a fail-open does not close it.
 * These tests are the closure.
 */
describe('an empty result is not allowed to look like a successful one', () => {
  test('a fixture known to parse yields symbols and edges, not a valid empty result', async () => {
    // The positive control. Without it, the refusal below could be satisfied by
    // an engine that simply always throws.
    const result = await analyze({
      repoRootAbs: join(FIXTURES_DIR, 'kitchen-sink'),
      grammarsDir: GRAMMARS_DIR,
      engineVersion: '0.0.0-substance',
    });

    expect(result.stats.symbolCount).toBeGreaterThan(0);
    expect(result.stats.edgeCount).toBeGreaterThan(0);
    expect(result.stats.filesParsed).toBeGreaterThan(0);
  });

  test('a parser that cannot load any grammar is an ERROR, not an empty analysis', async () => {
    // Points the engine at a directory with no grammars in it: every parse
    // attempt throws, exactly as it did under the init race. Before this
    // assertion existed, this returned a clean `AnalysisResult` with zero
    // symbols and exit status success.
    const emptyGrammars = mkdtempSync(join(tmpdir(), 'onboard-nogrammars-'));
    try {
      await expect(
        analyze({
          repoRootAbs: join(FIXTURES_DIR, 'kitchen-sink'),
          grammarsDir: emptyGrammars,
          engineVersion: '0.0.0-substance',
        }),
      ).rejects.toThrow(/could not parse any file/i);
    } finally {
      rmSync(emptyGrammars, { recursive: true, force: true });
    }
  });

  test('a repository with nothing to parse is still allowed to be empty', async () => {
    // The refusal must not fire on a repository that legitimately has no
    // parseable source. A rule that cannot tell "the parser is broken" from
    // "this project is Markdown" is a rule that breaks real repositories.
    const repo = mkdtempSync(join(tmpdir(), 'onboard-docsonly-'));
    try {
      writeFileSync(join(repo, 'README.md'), '# docs only\n');
      writeFileSync(join(repo, 'NOTES.md'), 'nothing to parse here\n');

      const result = await analyze({
        repoRootAbs: repo,
        grammarsDir: GRAMMARS_DIR,
        engineVersion: '0.0.0-substance',
      });

      expect(result.stats.symbolCount).toBe(0);
      expect(result.stats.filesScanned).toBeGreaterThan(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('a repository of syntactically broken source still analyses', async () => {
    // tree-sitter is error-tolerant: broken source returns `ok` with
    // `hasSyntaxError`, not a thrown parse. The refusal keys on THROWN
    // failures only, so a repository full of syntax errors must survive it —
    // otherwise the guard would reject the repositories most in need of an
    // onboarding map.
    const repo = mkdtempSync(join(tmpdir(), 'onboard-broken-'));
    try {
      writeFileSync(join(repo, 'a.ts'), 'export function ( { { unclosed\n');
      writeFileSync(join(repo, 'b.ts'), 'const = = = ;;;\n');

      const result = await analyze({
        repoRootAbs: repo,
        grammarsDir: GRAMMARS_DIR,
        engineVersion: '0.0.0-substance',
      });

      expect(result.stats.filesParsed).toBeGreaterThan(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
