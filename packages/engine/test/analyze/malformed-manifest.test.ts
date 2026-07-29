import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../../src/analyze';

const GRAMMARS_DIR = join(import.meta.dir, '..', '..', 'grammars');

function repoWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'onboard-manifest-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content);
  }
  return root;
}

async function analyzeRepo(root: string) {
  return analyze({ repoRootAbs: root, grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-manifest' });
}

/**
 * KI-6. Three modules each defined an identical `parseJsonSafely` returning
 * `null` on failure, and two then wrote `?? {}` — so a malformed `package.json`
 * produced a manifest reported as present and valid with ZERO dependencies.
 * Onboard told the user their project had no external dependencies, silently.
 *
 * This is the third instance of one mechanism: INV-3 dropped a refusal, KI-1
 * collapsed an integer overflow, this collapses a parse failure. Each time the
 * output is well formed and reads as success.
 *
 * `resolve/tsconfig-paths.ts` already reported its own version of this failure
 * as `TSCONFIG_UNREADABLE`. These tests hold the other three to that standard.
 */
describe('a manifest that does not parse is reported, not treated as empty', () => {
  test('a malformed package.json produces a diagnostic naming it', async () => {
    const root = repoWith({
      'package.json': '{ "name": "broken", "dependencies": { oops }',
      'index.ts': 'export const x = 1;\n',
    });
    try {
      const result = await analyzeRepo(root);

      const diagnostic = result.diagnostics.find((d) => d.code === 'MANIFEST_UNREADABLE');
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.path).toBe('package.json');
      expect(diagnostic?.severity).toBe('warning');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the diagnostic says what the user lost, not just that something failed', async () => {
    const root = repoWith({
      'package.json': 'not json at all',
      'index.ts': 'export const x = 1;\n',
    });
    try {
      const result = await analyzeRepo(root);

      const message =
        result.diagnostics.find((d) => d.code === 'MANIFEST_UNREADABLE')?.message ?? '';
      expect(message).toContain('dependencies');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the same manifest read by three modules is reported ONCE', async () => {
    // `package.json` is parsed by manifests, workspaces and entry-points.
    // Three copies of one warning would be worse than none.
    const root = repoWith({ 'package.json': '{ broken', 'index.ts': 'export const x = 1;\n' });
    try {
      const result = await analyzeRepo(root);

      const forPackageJson = result.diagnostics.filter(
        (d) => d.code === 'MANIFEST_UNREADABLE' && d.path === 'package.json',
      );
      expect(forPackageJson).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a VALID but empty manifest produces no diagnostic', async () => {
    // The distinction the fix exists for. `{}` parsed and was empty; that is
    // not a failure, and reporting it would make the warning meaningless.
    const root = repoWith({ 'package.json': '{}', 'index.ts': 'export const x = 1;\n' });
    try {
      const result = await analyzeRepo(root);

      expect(result.diagnostics.filter((d) => d.code === 'MANIFEST_UNREADABLE')).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a broken manifest no longer masquerades as a valid one', async () => {
    // Before the fix this emitted a `package.json` manifest entry with
    // projectName null and zero dependencies — indistinguishable from a real
    // project that declares none.
    const root = repoWith({
      'package.json': '{ "name": "broken"',
      'index.ts': 'export const x = 1;\n',
    });
    try {
      const result = await analyzeRepo(root);

      expect(result.stack.manifests.find((m) => m.path === 'package.json')).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a well-formed manifest still yields its dependencies', async () => {
    // Non-vacuity: the fix must refuse malformed manifests, not all manifests.
    const root = repoWith({
      'package.json': '{ "name": "fine", "dependencies": { "zod": "^4.0.0" } }',
      'index.ts': 'export const x = 1;\n',
    });
    try {
      const result = await analyzeRepo(root);

      expect(result.stack.manifests.find((m) => m.path === 'package.json')).toBeDefined();
      expect(result.stack.dependencies.map((d) => d.name)).toContain('zod');
      expect(result.diagnostics.filter((d) => d.code === 'MANIFEST_UNREADABLE')).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
