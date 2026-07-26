/**
 * @onboard/engine — stack detection: `repo.detectedType`, `repo.sourceRoots`,
 * and `stack.languages` (Section 7.1). Manifests/dependencies come from
 * `manifests.ts`; this module only adds the language histogram and the
 * higher-level "what kind of project is this" classification, both derived
 * by reading manifests directly, never guessed from file extensions alone
 * (Section 9's "Stack detection by reading manifests directly").
 */
import { z } from 'zod';
import { LanguageStat } from '@onboard/contract';
import { roundFixed } from '../util/round';
import { byteCompare } from '../util/sort';
import type { DependencyInfoValue, ManifestInfoValue } from './manifests';

export type LanguageStatValue = z.infer<typeof LanguageStat>;

const SHARE_PERCENT_PRECISION = 1;
const PERCENT_MULTIPLIER = 100;

export interface StackFileInput {
  readonly language: string;
  readonly lineCount: number;
}

export interface DetectedTypeInput {
  readonly manifests: readonly ManifestInfoValue[];
  readonly dependencies: readonly DependencyInfoValue[];
  readonly workspacePackageCount: number;
}

function hasDependency(dependencies: readonly DependencyInfoValue[], name: string): boolean {
  return dependencies.some((d) => d.name === name);
}

function hasManifestKind(manifests: readonly ManifestInfoValue[], kind: ManifestInfoValue['kind']): boolean {
  return manifests.some((m) => m.kind === kind);
}

function detectJsProjectType(dependencies: readonly DependencyInfoValue[]): string {
  if (hasDependency(dependencies, 'next')) {
    return 'Next.js application';
  }
  if (hasDependency(dependencies, 'react') || hasDependency(dependencies, 'react-dom')) {
    return 'React application';
  }
  if (hasDependency(dependencies, 'vue')) {
    return 'Vue application';
  }
  return 'Node.js service';
}

function detectPythonProjectType(dependencies: readonly DependencyInfoValue[]): string {
  if (['flask', 'django', 'fastapi'].some((name) => hasDependency(dependencies, name))) {
    return 'Python web application';
  }
  return 'Python package';
}

/** `repo.detectedType` (Section 7.1's examples: "Node.js service", "React application", ...). */
export function detectRepoType(input: DetectedTypeInput): string {
  if (input.workspacePackageCount > 1) {
    return `Monorepo (${String(input.workspacePackageCount)} workspaces)`;
  }
  if (hasManifestKind(input.manifests, 'package.json')) {
    return detectJsProjectType(input.dependencies);
  }
  const isPythonProject = ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'].some((kind) =>
    hasManifestKind(input.manifests, kind as ManifestInfoValue['kind']),
  );
  if (isPythonProject) {
    return detectPythonProjectType(input.dependencies);
  }
  return 'Unknown project type';
}

/** `repo.sourceRoots`: workspace package directories, or the whole repo when there are none. */
export function detectSourceRoots(workspacePackageDirPaths: readonly string[]): readonly string[] {
  return workspacePackageDirPaths.length > 0 ? [...workspacePackageDirPaths].sort(byteCompare) : [''];
}

/** `stack.languages`: one entry per `Language`, share of total file count. */
export function computeLanguageStats(files: readonly StackFileInput[]): readonly LanguageStatValue[] {
  const totalFiles = files.length;
  const counts = new Map<string, { fileCount: number; lineCount: number }>();
  files.forEach((f) => {
    const existing = counts.get(f.language) ?? { fileCount: 0, lineCount: 0 };
    counts.set(f.language, { fileCount: existing.fileCount + 1, lineCount: existing.lineCount + f.lineCount });
  });
  const languages = [...counts.keys()].sort(byteCompare);
  return languages.map((language) => {
    const stat = counts.get(language)!;
    const sharePercent = totalFiles === 0 ? 0 : roundFixed((stat.fileCount / totalFiles) * PERCENT_MULTIPLIER, SHARE_PERCENT_PRECISION);
    return { language: language as LanguageStatValue['language'], fileCount: stat.fileCount, lineCount: stat.lineCount, sharePercent };
  });
}
