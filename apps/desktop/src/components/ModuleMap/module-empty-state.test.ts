import { describe, expect, test } from 'vitest';
import { AnalysisEnvelope } from '@onboard/contract';
import type { AnalysisResult } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { MODULE_MIN_FILES, findLargestCandidateDirectory } from './module-empty-state';

const FIXTURE_RESULT: AnalysisResult = AnalysisEnvelope.parse(rawSampleAnalysis).result;

function fileStub(path: string, isParsed = true): AnalysisResult['files'][number] {
  const template = FIXTURE_RESULT.files[0]!;
  return { ...template, path, isParsed };
}

/** Reproduces the coordinator's reported defect exactly: a small repo with no sourceRoot subdirectory and 2 parsed files directly in `src/`. */
function smallRepoResult(): AnalysisResult {
  return {
    ...FIXTURE_RESULT,
    repo: { ...FIXTURE_RESULT.repo, sourceRoots: [''] },
    files: [fileStub('src/a.ts'), fileStub('src/b.ts')],
    modules: [],
  };
}

describe('MODULE_MIN_FILES', () => {
  test('matches the engine\'s frozen constant (Section 8.6)', () => {
    expect(MODULE_MIN_FILES).toBe(3);
  });
});

describe('findLargestCandidateDirectory', () => {
  test('reproduces the reported defect: src has 2 parsed files, needs 3', () => {
    const largest = findLargestCandidateDirectory(smallRepoResult());
    expect(largest).toEqual({ dirPath: 'src', fileCount: 2 });
  });

  test('ignores unparsed files when counting', () => {
    const result: AnalysisResult = {
      ...FIXTURE_RESULT,
      repo: { ...FIXTURE_RESULT.repo, sourceRoots: [''] },
      files: [fileStub('src/a.ts'), fileStub('src/b.ts'), fileStub('src/c.ts', false)],
      modules: [],
    };
    expect(findLargestCandidateDirectory(result)).toEqual({ dirPath: 'src', fileCount: 2 });
  });

  test('ignores a directory that is itself a source root (not strictly below one)', () => {
    const result: AnalysisResult = {
      ...FIXTURE_RESULT,
      repo: { ...FIXTURE_RESULT.repo, sourceRoots: ['src'] },
      files: [fileStub('src/a.ts'), fileStub('src/b.ts')],
      modules: [],
    };
    expect(findLargestCandidateDirectory(result)).toBeNull();
  });

  test('ignores directories deeper than depth 2 below a source root', () => {
    const result: AnalysisResult = {
      ...FIXTURE_RESULT,
      repo: { ...FIXTURE_RESULT.repo, sourceRoots: ['src'] },
      files: [fileStub('src/a/b/c/deep1.ts'), fileStub('src/a/b/c/deep2.ts'), fileStub('src/a/b/c/deep3.ts')],
      modules: [],
    };
    expect(findLargestCandidateDirectory(result)).toBeNull();
  });

  test('returns null when there are no parsed files at all', () => {
    const result: AnalysisResult = {
      ...FIXTURE_RESULT,
      repo: { ...FIXTURE_RESULT.repo, sourceRoots: [''] },
      files: [fileStub('src/a.ts', false)],
      modules: [],
    };
    expect(findLargestCandidateDirectory(result)).toBeNull();
  });

  test('picks the directory with the most direct parsed files, alphabetically breaking ties', () => {
    const result: AnalysisResult = {
      ...FIXTURE_RESULT,
      repo: { ...FIXTURE_RESULT.repo, sourceRoots: [''] },
      files: [fileStub('alpha/a.ts'), fileStub('beta/b.ts'), fileStub('beta/c.ts')],
      modules: [],
    };
    expect(findLargestCandidateDirectory(result)).toEqual({ dirPath: 'beta', fileCount: 2 });
  });
});
