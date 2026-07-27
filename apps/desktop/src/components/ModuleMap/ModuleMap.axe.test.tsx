import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AnalysisEnvelope } from '@onboard/contract';
import type { AnalysisResult } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { ModuleMap } from './ModuleMap';

const RESULT: AnalysisResult = AnalysisEnvelope.parse(rawSampleAnalysis).result;

describe('ModuleMap accessibility', () => {
  test('has zero axe-core violations across all 5 fixture module cards', async () => {
    const { container } = render(<ModuleMap result={RESULT} />);

    const results = await axe(container);

    expect(results.violations).toEqual([]);
  });

  test('has zero axe-core violations in the empty ("no modules qualified") state', async () => {
    const smallRepo: AnalysisResult = {
      ...RESULT,
      repo: { ...RESULT.repo, sourceRoots: [''] },
      files: [{ ...RESULT.files[0]!, path: 'src/a.ts' }, { ...RESULT.files[0]!, path: 'src/b.ts' }],
      modules: [],
    };
    const { container } = render(<ModuleMap result={smallRepo} />);

    const results = await axe(container);

    expect(results.violations).toEqual([]);
  });
});
