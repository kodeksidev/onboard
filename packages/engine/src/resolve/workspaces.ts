/**
 * @onboard/engine — monorepo workspace package discovery (Section 8.2, JS/TS
 * rule 7; Section 10 "monorepo workspace import"; Section 14 known-hard-part 5).
 *
 * Resolves workspace package NAMES to their in-repo directory from
 * `package.json#workspaces`, `pnpm-workspace.yaml`, or `lerna.json` — never
 * by descending into `node_modules`. Glob expansion runs once, against the
 * walk's already-known directories (never the live filesystem), matching the
 * purity requirement resolution itself must uphold.
 */
import { splitPosixSegments } from '../util/posix-path';

export interface WorkspacePackage {
  readonly name: string;
  readonly dirPath: string; // repo-relative POSIX, '' for the repo root
  /** `exports['.']`/`exports` (string form) -> `module` -> `main`, whichever is found first. */
  readonly entryField: string | null;
}

export interface WorkspaceDiscoveryInput {
  readonly existingPaths: ReadonlySet<string>;
  readonly readFile: (repoRelPath: string) => string | null;
}

function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** `package.json#workspaces`: either a bare array or `{ packages: [...] }`. */
function globsFromPackageJson(content: string | null): readonly string[] {
  if (content === null) {
    return [];
  }
  const parsed = parseJsonSafely(content);
  if (parsed === null || typeof parsed !== 'object') {
    return [];
  }
  const workspaces = (parsed as { workspaces?: unknown }).workspaces;
  if (Array.isArray(workspaces)) {
    return stringArray(workspaces);
  }
  if (workspaces !== null && typeof workspaces === 'object') {
    return stringArray((workspaces as { packages?: unknown }).packages);
  }
  return [];
}

/** Minimal `packages:` list reader for `pnpm-workspace.yaml` — not a general YAML parser. */
function globsFromPnpmWorkspaceYaml(content: string | null): readonly string[] {
  if (content === null) {
    return [];
  }
  const lines = content.split('\n');
  const globs: string[] = [];
  let inPackagesList = false;
  for (const line of lines) {
    if (/^packages\s*:/.test(line.trim())) {
      inPackagesList = true;
      continue;
    }
    if (inPackagesList) {
      const match = /^\s*-\s*['"]?([^'"#]+)['"]?\s*$/.exec(line);
      if (match?.[1] !== undefined) {
        globs.push(match[1].trim());
        continue;
      }
      if (line.trim().length > 0 && !line.startsWith(' ')) {
        inPackagesList = false;
      }
    }
  }
  return globs;
}

function globsFromLernaJson(content: string | null): readonly string[] {
  if (content === null) {
    return [];
  }
  const parsed = parseJsonSafely(content);
  if (parsed === null || typeof parsed !== 'object') {
    return [];
  }
  return stringArray((parsed as { packages?: unknown }).packages);
}

function collectWorkspaceGlobs(input: WorkspaceDiscoveryInput): readonly string[] {
  return [
    ...globsFromPackageJson(input.readFile('package.json')),
    ...globsFromPnpmWorkspaceYaml(input.readFile('pnpm-workspace.yaml')),
    ...globsFromLernaJson(input.readFile('lerna.json')),
  ];
}

/** Every unique ancestor directory (repo-relative POSIX, `''` = root) implied by the file set. */
function collectDirectories(existingPaths: ReadonlySet<string>): ReadonlySet<string> {
  const directories = new Set<string>(['']);
  for (const path of existingPaths) {
    const segments = splitPosixSegments(path);
    let prefix = '';
    for (let i = 0; i < segments.length - 1; i += 1) {
      prefix = prefix === '' ? segments[i]! : `${prefix}/${segments[i]!}`;
      directories.add(prefix);
    }
  }
  return directories;
}

/** A workspace glob supports a single trailing `*` segment (the common case) or `**`. */
function globToPattern(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withGlobs = escaped.replace(/\*\*|\*/g, (m) => (m === String.raw`**` ? ".*" : "[^/]+"));
  return new RegExp(`^${withGlobs}$`);
}

function directoriesMatchingGlobs(globs: readonly string[], directories: ReadonlySet<string>): ReadonlySet<string> {
  const matched = new Set<string>();
  for (const glob of globs) {
    const pattern = globToPattern(glob);
    for (const dir of directories) {
      if (pattern.test(dir)) {
        matched.add(dir);
      }
    }
  }
  return matched;
}

function packageJsonPath(dirPath: string): string {
  return dirPath === '' ? 'package.json' : `${dirPath}/package.json`;
}

/** `exports['.']`/`exports` (string form) -> `module` -> `main` (Section 8.2 rule 7). */
function extractEntryField(parsed: Record<string, unknown>): string | null {
  const exportsField = parsed.exports;
  if (typeof exportsField === 'string') {
    return exportsField;
  }
  if (exportsField !== null && typeof exportsField === 'object') {
    const dot = (exportsField as Record<string, unknown>)['.'];
    if (typeof dot === 'string') {
      return dot;
    }
  }
  if (typeof parsed.module === 'string') {
    return parsed.module;
  }
  return typeof parsed.main === 'string' ? parsed.main : null;
}

/** Discovers every in-repo workspace package, sorted by directory path. */
export function discoverWorkspacePackages(input: WorkspaceDiscoveryInput): readonly WorkspacePackage[] {
  const globs = collectWorkspaceGlobs(input);
  if (globs.length === 0) {
    return [];
  }
  const directories = collectDirectories(input.existingPaths);
  const matchedDirs = [...directoriesMatchingGlobs(globs, directories)].sort(byteCompare);

  const packages: WorkspacePackage[] = [];
  for (const dirPath of matchedDirs) {
    const manifestPath = packageJsonPath(dirPath);
    if (!input.existingPaths.has(manifestPath)) {
      continue;
    }
    const content = input.readFile(manifestPath);
    const parsed = content === null ? null : parseJsonSafely(content);
    if (parsed === null || typeof parsed !== 'object') {
      continue;
    }
    const record = parsed as Record<string, unknown>;
    const name = record.name;
    if (typeof name === 'string' && name.length > 0) {
      packages.push({ name, dirPath, entryField: extractEntryField(record) });
    }
  }
  return packages;
}
