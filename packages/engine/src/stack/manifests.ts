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
 */
import { z } from 'zod';
import { DependencyInfo, ManifestInfo } from '@onboard/contract';
import { inferDependencyRole } from './dependency-roles';
import { parseManifest, type UnparseableSink } from '../util/json';

export type ManifestInfoValue = z.infer<typeof ManifestInfo>;
export type DependencyInfoValue = z.infer<typeof DependencyInfo>;

export interface ManifestDetectionInput {
  readonly existingPaths: ReadonlySet<string>;
  readonly readFile: (repoRelPath: string) => string | null;
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

function detectPackageJson(input: ManifestDetectionInput): { manifest: ManifestInfoValue; deps: DependencyInfoValue[] } | null {
  const content = input.readFile('package.json');
  if (content === null) {
    return null;
  }
  // A manifest that does not parse is NOT an empty manifest. Reporting it as
  // one is what made a malformed package.json read as a project with no
  // dependencies.
  const parsed = parseManifest(content, 'package.json', input.onUnparseable);
  if (parsed === null) {
    return null;
  }
  const manifest: ManifestInfoValue = {
    path: 'package.json',
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

function detectRequirementsTxt(input: ManifestDetectionInput): { manifest: ManifestInfoValue; deps: DependencyInfoValue[] } | null {
  const content = input.readFile('requirements.txt');
  if (content === null) {
    return null;
  }
  const deps = content
    .split('\n')
    .map(parseRequirementLine)
    .filter((d): d is DependencyInfoValue => d !== null);
  return {
    manifest: { path: 'requirements.txt', kind: 'requirements.txt', projectName: null, version: null, packageManager: 'pip' },
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

function detectPyprojectToml(input: ManifestDetectionInput): { manifest: ManifestInfoValue; deps: DependencyInfoValue[] } | null {
  const content = input.readFile('pyproject.toml');
  if (content === null) {
    return null;
  }
  const projectName = extractTomlString(content, 'name');
  const version = extractTomlString(content, 'version');
  const packageManager = content.includes('[tool.poetry]') ? 'poetry' : 'pip';
  return {
    manifest: { path: 'pyproject.toml', kind: 'pyproject.toml', projectName, version, packageManager },
    deps: extractPoetryDependencies(content),
  };
}

function detectSimpleManifest(
  input: ManifestDetectionInput,
  path: string,
  kind: ManifestInfoValue['kind'],
  packageManager: string | null,
): ManifestInfoValue | null {
  return input.readFile(path) === null
    ? null
    : { path, kind, projectName: null, version: null, packageManager };
}

function detectGoMod(input: ManifestDetectionInput): ManifestInfoValue | null {
  const content = input.readFile('go.mod');
  if (content === null) {
    return null;
  }
  const match = /^module\s+(\S+)/m.exec(content);
  return { path: 'go.mod', kind: 'go.mod', projectName: match?.[1] ?? null, version: null, packageManager: null };
}

function detectCargoToml(input: ManifestDetectionInput): ManifestInfoValue | null {
  const content = input.readFile('Cargo.toml');
  if (content === null) {
    return null;
  }
  return {
    path: 'Cargo.toml',
    kind: 'Cargo.toml',
    projectName: extractTomlString(content, 'name'),
    version: extractTomlString(content, 'version'),
    packageManager: 'cargo',
  };
}

function detectPomXml(input: ManifestDetectionInput): ManifestInfoValue | null {
  const content = input.readFile('pom.xml');
  if (content === null) {
    return null;
  }
  const match = /<artifactId>([^<]+)<\/artifactId>/.exec(content);
  return { path: 'pom.xml', kind: 'pom.xml', projectName: match?.[1] ?? null, version: null, packageManager: 'maven' };
}

function detectComposerJson(input: ManifestDetectionInput): ManifestInfoValue | null {
  const content = input.readFile('composer.json');
  if (content === null) {
    return null;
  }
  const parsed = parseManifest(content, 'composer.json', input.onUnparseable);
  if (parsed === null) {
    return null;
  }
  return {
    path: 'composer.json',
    kind: 'composer.json',
    projectName: typeof parsed.name === 'string' ? parsed.name : null,
    version: typeof parsed.version === 'string' ? parsed.version : null,
    packageManager: 'composer',
  };
}

/** Detects every supported manifest kind at the repo root and extracts npm/pypi dependencies. */
export function detectManifests(input: ManifestDetectionInput): ManifestDetectionResult {
  const manifests: ManifestInfoValue[] = [];
  const dependencies: DependencyInfoValue[] = [];

  const packageJson = detectPackageJson(input);
  if (packageJson !== null) {
    manifests.push(packageJson.manifest);
    dependencies.push(...packageJson.deps);
  }
  const requirementsTxt = detectRequirementsTxt(input);
  if (requirementsTxt !== null) {
    manifests.push(requirementsTxt.manifest);
    dependencies.push(...requirementsTxt.deps);
  }
  const pyprojectToml = detectPyprojectToml(input);
  if (pyprojectToml !== null) {
    manifests.push(pyprojectToml.manifest);
    dependencies.push(...pyprojectToml.deps);
  }
  const setupPy = detectSimpleManifest(input, 'setup.py', 'setup.py', 'pip');
  if (setupPy !== null) {
    manifests.push(setupPy);
  }
  const pipfile = detectSimpleManifest(input, 'Pipfile', 'Pipfile', 'pip');
  if (pipfile !== null) {
    manifests.push(pipfile);
  }
  [detectGoMod(input), detectCargoToml(input), detectPomXml(input), detectComposerJson(input)].forEach((manifest) => {
    if (manifest !== null) {
      manifests.push(manifest);
    }
  });

  return { manifests, dependencies };
}
