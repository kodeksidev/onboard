/**
 * `apps/desktop/bench/fixtures/generate-synthetic-repo.ts` (Section 9 Phase
 * 11, Section 11's 10,000-file row: "synthetic repo, seed 0xONBOARD").
 *
 * Deterministic: the same `(fileCount, seed)` pair always emits byte-identical
 * files in byte-identical paths, so a bench run today and one next week are
 * measuring the same input. Every file is a small, syntactically valid
 * TypeScript module (target ~120 lines each, matching the 1,000-file row's
 * "~120k LOC" figure) that imports 1-3 earlier-numbered files by relative
 * path, so the engine's resolver and grapher have real edges to walk rather
 * than 10,000 disconnected leaves.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Section 11: "synthetic repo, seed 0xONBOARD". `O`/`N`/`B`/`D` aren't valid
 * hex digits, so `"0xONBOARD"` can't be a numeric literal — it names the
 * seed as a string instead, hashed here (FNV-1a, 32-bit) into the numeric
 * seed `createRng` actually needs. Deterministic either way: the same
 * string always hashes to the same number.
 */
export const SYNTHETIC_REPO_SEED_LABEL = '0xONBOARD';

function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export const SYNTHETIC_REPO_SEED = fnv1a32(SYNTHETIC_REPO_SEED_LABEL);
const FILES_PER_DIRECTORY = 25;
const MAX_IMPORTS_PER_FILE = 3;
const TARGET_LINES_PER_FILE = 120;

/** mulberry32 — tiny, fast, deterministic across platforms (no crypto, no Math.random). */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Always POSIX-style (`src/module-0001`), independent of host OS — this is
 * a logical directory name used to build import specifiers, not a real
 * filesystem path; `path.join` would use `\` on Windows and silently break
 * the specifier math below.
 */
function directoryForIndex(index: number): string {
  const dirIndex = Math.floor(index / FILES_PER_DIRECTORY);
  return `src/module-${String(dirIndex).padStart(4, '0')}`;
}

function fileNameForIndex(index: number): string {
  return `file-${String(index).padStart(5, '0')}.ts`;
}

function relativeImportPath(fromIndex: number, toIndex: number): string {
  const fromDir = directoryForIndex(fromIndex);
  const toDir = directoryForIndex(toIndex);
  const toFile = fileNameForIndex(toIndex).replace(/\.ts$/, '');
  if (fromDir === toDir) {
    return `./${toFile}`;
  }
  return `../${toDir.split('/').slice(1).join('/')}/${toFile}`;
}

/** Picks up to `MAX_IMPORTS_PER_FILE` distinct earlier indices (never a forward/self reference, so the import graph is acyclic and always resolvable). */
function pickImportTargets(index: number, rng: () => number): number[] {
  if (index === 0) {
    return [];
  }
  const importCount = Math.min(index, 1 + Math.floor(rng() * MAX_IMPORTS_PER_FILE));
  const targets = new Set<number>();
  while (targets.size < importCount) {
    targets.add(Math.floor(rng() * index));
  }
  return [...targets].sort((a, b) => a - b);
}

function buildFileContent(index: number, importTargets: readonly number[]): string {
  const importLines = importTargets.map((target, position) => {
    const symbol = `dep${String(position)}`;
    return `import { value as ${symbol} } from '${relativeImportPath(index, target)}';`;
  });
  const bodyLines: string[] = [];
  bodyLines.push(`/** Synthetic module ${String(index)} (generate-synthetic-repo.ts, seed ${String(SYNTHETIC_REPO_SEED)}). */`);
  bodyLines.push(...importLines);
  bodyLines.push('');
  bodyLines.push(`export interface Item${String(index)} {`);
  bodyLines.push('  readonly id: number;');
  bodyLines.push('  readonly label: string;');
  bodyLines.push('}');
  bodyLines.push('');
  const sumTerm = importTargets.length > 0 ? importTargets.map((_t, p) => `dep${String(p)}`).join(' + ') : '0';
  bodyLines.push(`export function computeValue${String(index)}(seed: number): number {`);
  bodyLines.push(`  return seed + ${sumTerm} + ${String(index)};`);
  bodyLines.push('}');
  bodyLines.push('');
  bodyLines.push(`export const value = computeValue${String(index)}(${String(index)});`);
  bodyLines.push('');
  // Pad with deterministic, syntactically inert comment lines so every file
  // approaches TARGET_LINES_PER_FILE regardless of its (small) import count.
  while (bodyLines.length < TARGET_LINES_PER_FILE) {
    bodyLines.push(`// padding line ${String(bodyLines.length)} for module ${String(index)}`);
  }
  return `${bodyLines.join('\n')}\n`;
}

/** `package.json` so the engine's stack-detection step has a real manifest to read. */
function writePackageManifest(outDir: string): void {
  const manifest = {
    name: 'onboard-synthetic-bench-repo',
    version: '0.0.0',
    private: true,
    main: 'src/module-0000/file-00000.ts',
  };
  writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/**
 * Generates `fileCount` files under `outDir`, deterministic for a given
 * `(fileCount, seed)` pair. Returns the absolute paths written, in
 * generation order, so callers (e.g. the incremental-analysis budget's "20
 * changed files") can pick a deterministic subset to touch.
 */
export function generateSyntheticRepo(
  outDir: string,
  fileCount: number,
  seed: number = SYNTHETIC_REPO_SEED,
): readonly string[] {
  const rng = createRng(seed);
  const writtenPaths: string[] = [];
  writePackageManifest(outDir);

  for (let index = 0; index < fileCount; index += 1) {
    const dir = join(outDir, directoryForIndex(index));
    mkdirSync(dir, { recursive: true });
    const importTargets = pickImportTargets(index, rng);
    const content = buildFileContent(index, importTargets);
    const filePath = join(dir, fileNameForIndex(index));
    writeFileSync(filePath, content, 'utf8');
    writtenPaths.push(filePath);
  }
  return writtenPaths;
}
