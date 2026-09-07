/**
 * @onboard/engine — manifest detection and dependency extraction (Section 7.1's
 * `ManifestInfo`/`DependencyInfo`).
 *
 * v1 extracts real dependency lists only for the ecosystems it supports
 * (npm via `package.json`, pypi via `requirements.txt`/`pyproject.toml`);
 * `go.mod`/`Cargo.toml`/`pom.xml`/`composer.json` are still detected and
 * reported (a repo can be honestly described even when its language isn't
 * parsed — A2), but their dependency lists are out of scope, matching
 * Section 3 non-goal 1.
 *
 * Reads the repo root AND every known workspace package directory
 * (`workspacePackages`, declared or inferred — docs/DECISIONS.md,
 * "detectManifests reads root-relative paths only") — mirroring
 * `entry-points.ts`'s existing `detectEntryPoints`, which already looped
 * over workspace dirs before this module did. A sibling-packages repo with
 * no root manifest (CacttusEdu: `backend/`, `dashboard/`,
 * `cacttus-edu-front/`) previously reported zero manifests and zero
 * dependencies even though three real `package.json` files existed one
 * level down.
 */
import { z } from 'zod';
import { DependencyInfo, ManifestInfo } from '@onboard/contract';
import { inferDependencyRole } from './dependency-roles';
import { posixJoin } from '../util/posix-path';
import { parseManifest, type UnparseableSink } from '../util/json';

export type ManifestInfoValue = z.infer<typeof ManifestInfo>;
export type DependencyInfoValue = z.infer<typeof DependencyInfo>;

export interface ManifestWorkspaceRef {
  readonly dirPath: string;
}

export interface ManifestDetectionInput {
  readonly existingPaths: ReadonlySet<string>;
  readonly readFile: (repoRelPath: string) => string | null;
  /** Every known workspace package (declared or inferred) — manifests are read from each, plus the repo root. Defaults to root-only when omitted, matching this module's original behavior. */
  readonly workspacePackages?: readonly ManifestWorkspaceRef[];
  /** Notified with the path of any manifest that did not parse (see `util/json.ts`). */
  readonly onUnparseable?: UnparseableSink;
}

export interface ManifestDetectionResult {
  readonly manifests: readonly ManifestInfoValue[];
  readonly dependencies: readonly DependencyInfoValue[];
}

function detectPackageManager(existingPaths: ReadonlySet<string>, packageJson: Record<string, unknown>): string | null {
  if (existingPaths.has('bun.lockb')) return 'bun';
  if (existingPaths.has('pnpm-lock.yaml')) return 'pnpm';
  if (existingPaths.has('yarn.lock')) return 'yarn';
  if (existingPaths.has('package-lock.json')) return 'npm';
  const field = packageJson.packageManager;
  return typeof field === 'string' ? (field.split('@')[0] ?? null) : null;
}

function npmDependenciesFromSection(section: unknown, scope: DependencyInfoValue['scope']): DependencyInfoValue[] {
  if (section === null || typeof section !== 'object') {
    return [];
  }
  return Object.entries(section as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, versionSpec]) => ({
      name,
      versionSpec,
      ecosystem: 'npm' as const,
      scope,
      inferredRole: inferDependencyRole(name),
      importedByCount: 0,
    }));
}

function detectPackageJson(dirPath: string, input: ManifestDetectionInput): { manifest: ManifestInfoValue; deps: DependencyInfoValue[] } | null {
  const path = posixJoin(dirPath, 'package.json');
  const content = input.readFile(path);
  if (content === null) {
    return null;
  }
  // A manifest that does not parse is NOT an empty manifest. Reporting it as
  // one is what made a malformed package.json read as a project with no
  // dependencies.
  const parsed = parseManifest(content, path, input.onUnparseable);
  if (parsed === null) {
    return null;
  }
  const manifest: ManifestInfoValue = {
    path,
    kind: 'package.json',
    projectName: typeof parsed.name === 'string' ? parsed.name : null,
    version: typeof parsed.version === 'string' ? parsed.version : null,
    packageManager: detectPackageManager(input.existingPaths, parsed),
  };
  const deps = [
    ...npmDependenciesFromSection(parsed.dependencies, 'runtime'),
    ...npmDependenciesFromSection(parsed.devDependencies, 'dev'),
    ...npmDependenciesFromSection(parsed.peerDependencies, 'peer'),
    ...npmDependenciesFromSection(parsed.optionalDependencies, 'optional'),
  ];
  return { manifest, deps };
}

function parseRequirementLine(line: string): DependencyInfoValue | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('-')) {
    return null;
  }
  const match = /^([A-Za-z0-9._-]+)\s*(.*)$/.exec(trimmed);
  if (match?.[1] === undefined) {
    return null;
  }
  const name = match[1];
  return {
    name,
    versionSpec: match[2] ?? '',
    ecosystem: 'pypi',
    scope: 'runtime',
    inferredRole: inferDependencyRole(name.toLowerCase()),
    importedByCount: 0,
  };
}

function detectRequirementsTxt(dirPath: string, input: ManifestDetectionInput): { manifest: ManifestInfoValue; deps: DependencyInfoValue[] } | null {
  const path = posixJoin(dirPath, 'requirements.txt');
  const content = input.readFile(path);
  if (content === null) {
    return null;
  }
  const deps = content
    .split('\n')
    .map(parseRequirementLine)
    .filter((d): d is DependencyInfoValue => d !== null);
  return {
    manifest: { path, kind: 'requirements.txt', projectName: null, version: null, packageManager: 'pip' },
    deps,
  };
}

function extractTomlString(content: string, key: string): string | null {
  const match = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm').exec(content);
  return match?.[1] ?? null;
}

function extractPoetryDependencies(content: string): DependencyInfoValue[] {
  const sectionMatch = /\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(content);
  if (sectionMatch?.[1] === undefined) {
    return [];
  }
  const lines = sectionMatch[1].split('\n');
  const deps: DependencyInfoValue[] = [];
  lines.forEach((line) => {
    const match = /^([A-Za-z0-9._-]+)\s*=\s*"?([^"\n]*)"?/.exec(line.trim());
    if (match?.[1] === undefined || match[1].toLowerCase() === 'python') {
      return;
    }
    deps.push({
      name: match[1],
      versionSpec: match[2] ?? '',
      ecosystem: 'pypi',
      scope: 'runtime',
      inferredRole: inferDependencyRole(match[1].toLowerCase()),
      importedByCount: 0,
    });
  });
  return deps;
}

function detectPyprojectToml(dirPath: string, input: ManifestDetectionInput): { manifest: ManifestInfoValue; deps: DependencyInfoValue[] } | null {
  const path = posixJoin(dirPath, 'pyproject.toml');
  const content = input.readFile(path);
  if (content === null) {
    return null;
  }
  const projectName = extractTomlString(content, 'name');
  const version = extractTomlString(content, 'version');
  const packageManager = content.includes('[tool.poetry]') ? 'poetry' : 'pip';
  return {
    manifest: { path, kind: 'pyproject.toml', projectName, version, packageManager },
    deps: extractPoetryDependencies(content),
  };
}

function detectSimpleManifest(
  dirPath: string,
  input: ManifestDetectionInput,
  relativePath: string,
  kind: ManifestInfoValue['kind'],
  packageManager: string | null,
): ManifestInfoValue | null {
  const path = posixJoin(dirPath, relativePath);
  return input.readFile(path) === null ? null : { path, kind, projectName: null, version: null, packageManager };
}

function detectGoMod(dirPath: string, input: ManifestDetectionInput): ManifestInfoValue | null {
  const path = posixJoin(dirPath, 'go.mod');
  const content = input.readFile(path);
  if (content === null) {
    return null;
  }
  const match = /^module\s+(\S+)/m.exec(content);
  return { path, kind: 'go.mod', projectName: match?.[1] ?? null, version: null, packageManager: null };
}

function detectCargoToml(dirPath: string, input: ManifestDetectionInput): ManifestInfoValue | null {
  const path = posixJoin(dirPath, 'Cargo.toml');
  const content = input.readFile(path);
  if (content === null) {
    return null;
  }
  return {
    path,
    kind: 'Cargo.toml',
    projectName: extractTomlString(content, 'name'),
    version: extractTomlString(content, 'version'),
    packageManager: 'cargo',
  };
}

function detectPomXml(dirPath: string, input: ManifestDetectionInput): ManifestInfoValue | null {
  const path = posixJoin(dirPath, 'pom.xml');
  const content = input.readFile(path);
  if (content === null) {
    return null;
  }
  const match = /<artifactId>([^<]+)<\/artifactId>/.exec(content);
  return { path, kind: 'pom.xml', projectName: match?.[1] ?? null, version: null, packageManager: 'maven' };
}

function detectComposerJson(dirPath: string, input: ManifestDetectionInput): ManifestInfoValue | null {
  const path = posixJoin(dirPath, 'composer.json');
  const content = input.readFile(path);
  if (content === null) {
    return null;
  }
  const parsed = parseManifest(content, path, input.onUnparseable);
  if (parsed === null) {
    return null;
  }
  return {
    path,
    kind: 'composer.json',
    projectName: typeof parsed.name === 'string' ? parsed.name : null,
    version: typeof parsed.version === 'string' ? parsed.version : null,
    packageManager: 'composer',
  };
}

/** Detects every supported manifest kind in one directory (`''` = repo root). */
function detectManifestsInDir(dirPath: string, input: ManifestDetectionInput): ManifestDetectionResult {
  const manifests: ManifestInfoValue[] = [];
  const dependencies: DependencyInfoValue[] = [];

  const packageJson = detectPackageJson(dirPath, input);
  if (packageJson !== null) {
    manifests.push(packageJson.manifest);
    dependencies.push(...packageJson.deps);
  }
  const requirementsTxt = detectRequirementsTxt(dirPath, input);
  if (requirementsTxt !== null) {
    manifests.push(requirementsTxt.manifest);
    dependencies.push(...requirementsTxt.deps);
  }
  const pyprojectToml = detectPyprojectToml(dirPath, input);
  if (pyprojectToml !== null) {
    manifests.push(pyprojectToml.manifest);
    dependencies.push(...pyprojectToml.deps);
  }
  const setupPy = detectSimpleManifest(dirPath, input, 'setup.py', 'setup.py', 'pip');
  if (setupPy !== null) {
    manifests.push(setupPy);
  }
  const pipfile = detectSimpleManifest(dirPath, input, 'Pipfile', 'Pipfile', 'pip');
  if (pipfile !== null) {
    manifests.push(pipfile);
  }
  [detectGoMod(dirPath, input), detectCargoToml(dirPath, input), detectPomXml(dirPath, input), detectComposerJson(dirPath, input)].forEach(
    (manifest) => {
      if (manifest !== null) {
        manifests.push(manifest);
      }
    },
  );

  return { manifests, dependencies };
}

/**
 * Two sibling packages can each declare the same dependency (e.g. both
 * `dashboard` and `frontend` depend on `@radix-ui/react-dialog`) — reading
 * manifests from every workspace directory means that is now possible where
 * it structurally could not be before. `DependencyInfoValue` has no field
 * for "which package(s) declared this" or "these specs disagree," so
 * showing two entries for one logical dependency isn't a richer answer, it
 * is an unlabeled duplicate. Keeps the FIRST occurrence by
 * `(ecosystem, name, scope)` — `dirs` below is already root-then-path-
 * ascending, so "first" means the root manifest if it declares this
 * dependency, else the alphabetically-first workspace package that does.
 * A conflicting versionSpec from a later package is silently dropped, not
 * merged or flagged — recorded here rather than invisibly: if that turns
 * out to matter, the honest fix is a schema change (this dependency's
 * specs disagree), not a heuristic for which one "wins."
 */
function dedupeDependencies(dependencies: readonly DependencyInfoValue[]): readonly DependencyInfoValue[] {
  const seen = new Set<string>();
  return dependencies.filter((dep) => {
    const key = `${dep.ecosystem}:${dep.name}:${dep.scope}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** Detects every supported manifest kind at the repo root and in every known workspace package, and extracts npm/pypi dependencies. */
export function detectManifests(input: ManifestDetectionInput): ManifestDetectionResult {
  const dirs = [''].concat((input.workspacePackages ?? []).map((p) => p.dirPath));
  const manifests: ManifestInfoValue[] = [];
  const dependencies: DependencyInfoValue[] = [];
  dirs.forEach((dirPath) => {
    const result = detectManifestsInDir(dirPath, input);
    manifests.push(...result.manifests);
    dependencies.push(...result.dependencies);
  });
  return { manifests, dependencies: dedupeDependencies(dependencies) };
}
