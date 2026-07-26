/**
 * @onboard/engine — entry-point detection (Section 7.1's `EntryPoint`).
 *
 * The spec names the evidence strings this must produce
 * (`package.json#main`, `package.json#scripts.start`, `package.json#bin.cli`,
 * `convention:src/index.ts`, `python:__main__.py`, `python:module-guard`) but
 * does not fully specify detection order beyond that; this module applies
 * them in the priority order below (most explicit evidence first) and logs
 * the choice in docs/DECISIONS.md.
 */
import { z } from 'zod';
import { EntryPoint } from '@onboard/contract';
import { byteCompare } from '../util/sort';

export type EntryPointValue = z.infer<typeof EntryPoint>;

export interface EntryPointWorkspaceRef {
  readonly dirPath: string;
}

export interface EntryPointDetectionInput {
  readonly existingPaths: ReadonlySet<string>;
  readonly readFile: (repoRelPath: string) => string | null;
  readonly workspacePackages: readonly EntryPointWorkspaceRef[];
}

interface Candidate {
  readonly path: string;
  readonly evidence: string;
  readonly kind: EntryPointValue['kind'];
  readonly priority: number;
}

const CONVENTION_FILES = ['src/index.ts', 'src/index.js', 'index.ts', 'index.js'];
const JS_TS_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function parseJsonSafely(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function resolveExisting(base: string, existingPaths: ReadonlySet<string>): string | null {
  for (let i = 0; i < JS_TS_EXTENSIONS.length; i += 1) {
    const candidate = `${base}${JS_TS_EXTENSIONS[i]!}`;
    if (existingPaths.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function joinDir(dirPath: string, relative: string): string {
  const cleaned = relative.startsWith('./') ? relative.slice(2) : relative;
  return dirPath === '' ? cleaned : `${dirPath}/${cleaned}`;
}

function mainCandidates(dirPath: string, parsed: Record<string, unknown>, existingPaths: ReadonlySet<string>): Candidate[] {
  if (typeof parsed.main !== 'string') {
    return [];
  }
  const resolved = resolveExisting(joinDir(dirPath, parsed.main), existingPaths);
  return resolved === null ? [] : [{ path: resolved, evidence: 'package.json#main', kind: 'main', priority: 0 }];
}

function binCandidates(dirPath: string, parsed: Record<string, unknown>, existingPaths: ReadonlySet<string>): Candidate[] {
  const bin = parsed.bin;
  if (typeof bin === 'string') {
    const resolved = resolveExisting(joinDir(dirPath, bin), existingPaths);
    return resolved === null ? [] : [{ path: resolved, evidence: 'package.json#bin', kind: 'bin', priority: 1 }];
  }
  if (bin === null || typeof bin !== 'object') {
    return [];
  }
  return Object.entries(bin as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, relPath]) => ({ name, resolved: resolveExisting(joinDir(dirPath, relPath), existingPaths) }))
    .filter((entry): entry is { name: string; resolved: string } => entry.resolved !== null)
    .map(({ name, resolved }) => ({ path: resolved, evidence: `package.json#bin.${name}`, kind: 'bin' as const, priority: 1 }));
}

function startScriptCandidate(dirPath: string, parsed: Record<string, unknown>, existingPaths: ReadonlySet<string>): Candidate[] {
  const scripts = parsed.scripts;
  if (scripts === null || typeof scripts !== 'object') {
    return [];
  }
  const start = (scripts as Record<string, unknown>).start;
  if (typeof start !== 'string') {
    return [];
  }
  const tokenMatch = /([./\w-]+\.[cm]?[tj]sx?)\b/.exec(start);
  if (tokenMatch?.[1] === undefined) {
    return [];
  }
  const resolved = resolveExisting(joinDir(dirPath, tokenMatch[1]), existingPaths);
  return resolved === null ? [] : [{ path: resolved, evidence: 'package.json#scripts.start', kind: 'script', priority: 4 }];
}

function packageJsonCandidates(dirPath: string, input: EntryPointDetectionInput): Candidate[] {
  const path = dirPath === '' ? 'package.json' : `${dirPath}/package.json`;
  const content = input.readFile(path);
  if (content === null) {
    return [];
  }
  const parsed = parseJsonSafely(content) ?? {};
  return [
    ...mainCandidates(dirPath, parsed, input.existingPaths),
    ...binCandidates(dirPath, parsed, input.existingPaths),
    ...startScriptCandidate(dirPath, parsed, input.existingPaths),
  ];
}

function conventionCandidates(dirPath: string, existingPaths: ReadonlySet<string>): Candidate[] {
  for (let i = 0; i < CONVENTION_FILES.length; i += 1) {
    const candidatePath = joinDir(dirPath, CONVENTION_FILES[i]!);
    if (existingPaths.has(candidatePath)) {
      return [{ path: candidatePath, evidence: `convention:${CONVENTION_FILES[i]!}`, kind: 'convention', priority: 3 }];
    }
  }
  return [];
}

function pythonMainCandidates(existingPaths: ReadonlySet<string>): Candidate[] {
  return [...existingPaths]
    .filter((path) => path === '__main__.py' || path.endsWith('/__main__.py'))
    .sort(byteCompare)
    .map((path) => ({ path, evidence: 'python:__main__.py', kind: 'main' as const, priority: 2 }));
}

function pythonModuleGuardCandidates(input: EntryPointDetectionInput): Candidate[] {
  const guardPattern = /if\s+__name__\s*==\s*['"]__main__['"]\s*:/;
  return [...input.existingPaths]
    .filter((path) => path.endsWith('.py') && !path.endsWith('/__main__.py') && path !== '__main__.py')
    .filter((path) => guardPattern.test(input.readFile(path) ?? ''))
    .sort(byteCompare)
    .map((path) => ({ path, evidence: 'python:module-guard', kind: 'script' as const, priority: 5 }));
}

function byPriorityThenPath(a: Candidate, b: Candidate): number {
  return a.priority !== b.priority ? a.priority - b.priority : byteCompare(a.path, b.path);
}

/** Detects entry points across the repo root and every workspace package. */
export function detectEntryPoints(input: EntryPointDetectionInput): readonly EntryPointValue[] {
  const dirs = [''].concat(input.workspacePackages.map((p) => p.dirPath));
  const candidates: Candidate[] = [];
  dirs.forEach((dir) => {
    candidates.push(...packageJsonCandidates(dir, input));
    candidates.push(...conventionCandidates(dir, input.existingPaths));
  });
  candidates.push(...pythonMainCandidates(input.existingPaths));
  candidates.push(...pythonModuleGuardCandidates(input));

  const seen = new Set<string>();
  const deduped = candidates.filter((c) => {
    if (seen.has(c.path)) {
      return false;
    }
    seen.add(c.path);
    return true;
  });
  const ranked = [...deduped].sort(byPriorityThenPath);
  return ranked.map((c, index) => ({ path: c.path, rank: index + 1, evidence: c.evidence, kind: c.kind }));
}
