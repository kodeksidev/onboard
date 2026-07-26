/**
 * Stages the engine sidecar and its WASM grammars into the Tauri shell.
 *
 * This script exists because the artifacts cross an ownership boundary
 * (Section 2): `packages/engine` produces them, `apps/desktop/src-tauri`
 * consumes them, and neither agent may write into the other's directory.
 *
 * The staged files are deliberately NOT committed. Each compiled sidecar is
 * 60-100 MB (four target triples is ~320 MB), and Phase 14's release workflow
 * builds them in CI. Committing them would bloat every clone forever to save
 * one command locally. `.gitignore` therefore excludes the contents of
 * `binaries/` and `resources/grammars/` while keeping the directories
 * themselves, because `tauri-build`'s externalBin resolution requires them to
 * exist.
 *
 * Run: `bun run stage:sidecar`  (after `bun run --cwd packages/engine build:sidecar`)
 */
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..');
const ENGINE_DIST = join(REPO_ROOT, 'packages', 'engine', 'dist');
const ENGINE_GRAMMARS = join(REPO_ROOT, 'packages', 'engine', 'grammars');
const SHELL_BINARIES = join(REPO_ROOT, 'apps', 'desktop', 'src-tauri', 'binaries');
const SHELL_GRAMMARS = join(REPO_ROOT, 'apps', 'desktop', 'src-tauri', 'resources', 'grammars');

/** Tauri requires the exact `-<target-triple>` suffix on each sidecar. */
const SIDECAR_PREFIX = 'onboard-engine-';

interface StageResult {
  readonly copied: number;
  readonly totalBytes: number;
}

function stageDirectory(from: string, to: string, filter: (name: string) => boolean): StageResult {
  if (!existsSync(from)) {
    throw new Error(
      `stage:sidecar: source directory does not exist: ${from}\n` +
        'Run `bun run --cwd "packages/engine" build:sidecar` first.',
    );
  }
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter(filter).sort();
  let totalBytes = 0;
  for (const name of names) {
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    totalBytes += statSync(source).size;
    console.log(`  staged ${name} (${(statSync(source).size / 1024 / 1024).toFixed(1)} MB)`);
  }
  return { copied: names.length, totalBytes };
}

console.log('Staging engine sidecar binaries -> src-tauri/binaries/');
const binaries = stageDirectory(ENGINE_DIST, SHELL_BINARIES, (name) =>
  name.startsWith(SIDECAR_PREFIX),
);

console.log('Staging WASM grammars -> src-tauri/resources/grammars/');
const grammars = stageDirectory(ENGINE_GRAMMARS, SHELL_GRAMMARS, (name) => name.endsWith('.wasm'));

if (binaries.copied === 0) {
  console.error('stage:sidecar FAILED: no sidecar binaries found. Did build:sidecar run?');
  process.exit(1);
}
if (grammars.copied === 0) {
  console.error('stage:sidecar FAILED: no .wasm grammars found in packages/engine/grammars.');
  process.exit(1);
}

const totalMb = (binaries.totalBytes + grammars.totalBytes) / 1024 / 1024;
console.log(
  `stage:sidecar OK — ${binaries.copied} sidecar binar${binaries.copied === 1 ? 'y' : 'ies'} ` +
    `and ${grammars.copied} grammars (${totalMb.toFixed(1)} MB total, intentionally untracked).`,
);
