import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { analyze } from '../../src/analyze';

const GRAMMARS_DIR = join(import.meta.dir, '..', '..', 'grammars');

function repoWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'onboard-inferred-workspaces-'));
  for (const [name, content] of Object.entries(files)) {
    const full = join(root, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

async function analyzeRepo(root: string) {
  return analyze({ repoRootAbs: root, grammarsDir: GRAMMARS_DIR, engineVersion: '0.0.0-inferred-workspaces' });
}

/**
 * Option B (docs/DECISIONS.md, "detectManifests reads root-relative paths
 * only"): CacttusEdu's real shape — sibling packages, no root manifest —
 * previously read as "Unknown project type" with zero dependencies and
 * Python scripts picked as entry points. End-to-end proof, through the real
 * `analyze()` entry point (not just `discoverWorkspacePackages` in
 * isolation), that all four affected subsystems now correct themselves:
 * `detectedType`, `sourceRoots`, `entryPoints`, and `stack.dependencies`.
 * Also plants condition 2 (resolution isolation) in the same fixture: an
 * inferred package's cross-sibling import must NOT resolve internally.
 */
describe('analyze — sibling packages with no root manifest (Option B)', () => {
  test('detects the monorepo, finds real per-package entry points and dependencies, and keeps inferred names OUT of resolution', async () => {
    const root = repoWith({
      'backend/package.json': JSON.stringify({ name: 'backend', main: 'src/index.ts', dependencies: { express: '^4.19.2' } }),
      'backend/src/index.ts': "import { d } from 'dashboard';\nexport const started = d;\n",
      'backend/src/db.ts': 'export const connect = (): void => undefined;\n',
      'backend/src/util.ts': 'export const noop = (): void => undefined;\n',
      'dashboard/package.json': JSON.stringify({ name: 'dashboard', main: 'src/main.ts' }),
      'dashboard/src/main.ts': 'export const d = 1;\n',
      'dashboard/src/view.ts': 'export const render = (): void => undefined;\n',
      'dashboard/src/state.ts': 'export const state = {};\n',
      'frontend/package.json': JSON.stringify({ name: 'frontend', main: 'src/app.ts' }),
      'frontend/src/app.ts': 'export const app = {};\n',
      'frontend/src/component.ts': 'export const Component = (): null => null;\n',
      'frontend/src/routes.ts': 'export const routes = [];\n',
    });
    try {
      const result = await analyzeRepo(root);

      // detectedType and sourceRoots: correct themselves via the existing
      // `workspacePackageCount > 1` / `detectSourceRoots` paths.
      expect(result.repo.detectedType).toBe('Monorepo (3 workspaces)');
      expect(result.repo.sourceRoots).toEqual(['backend', 'dashboard', 'frontend']);
      expect(result.repo.workspacePackages).toEqual([
        { name: 'backend', dirPath: 'backend' },
        { name: 'dashboard', dirPath: 'dashboard' },
        { name: 'frontend', dirPath: 'frontend' },
      ]);

      // entryPoints: real per-package #main entries, not a fallback guess.
      const entryPointPaths = result.entryPoints.map((e) => e.path);
      expect(entryPointPaths).toContain('backend/src/index.ts');
      expect(entryPointPaths).toContain('dashboard/src/main.ts');
      expect(entryPointPaths).toContain('frontend/src/app.ts');

      // dependencies: manifests are now read from each package directory, not just root.
      expect(result.stack.dependencies.map((d) => d.name)).toContain('express');
      expect(result.stack.manifests.map((m) => m.path).sort()).toEqual([
        'backend/package.json',
        'dashboard/package.json',
        'frontend/package.json',
      ]);

      // Condition 2: `backend/src/index.ts` imports the bare specifier
      // 'dashboard', matching an INFERRED workspace package's name. It must
      // NOT resolve as an internal edge into dashboard/src/main.ts — that
      // would be a wrong edge silently corrupting the graph, not a missing
      // one. It must surface as an external dependency instead, exactly as
      // it would if 'dashboard' were an unrelated real npm package.
      expect(result.edges.some((e) => e.toPath.startsWith('dashboard/'))).toBe(false);
      expect(result.externalDependencies.some((d) => d.packageName === 'dashboard')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not invent a monorepo from one real package plus one incidental package.json (tools/)', async () => {
    // app/ dominates (20 real files) versus tools/'s single incidental
    // helper — the size-ratio gate (not just the ">= 2 named siblings"
    // count) is what has to reject this, matching
    // `workspaces.test.ts`'s unit-level version of the same shape.
    const appFiles = Object.fromEntries(
      Array.from({ length: 20 }, (_unused, i) => [`app/src/file${String(i)}.ts`, `export const v${String(i)} = ${String(i)};\n`]),
    );
    const root = repoWith({
      'app/package.json': JSON.stringify({ name: 'app' }),
      ...appFiles,
      'tools/package.json': JSON.stringify({ name: 'lint-config' }),
      'tools/format.ts': 'export const format = (): void => undefined;\n',
    });
    try {
      const result = await analyzeRepo(root);

      expect(result.repo.workspacePackages).toEqual([]);
      expect(result.repo.detectedType).not.toBe('Monorepo (2 workspaces)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
