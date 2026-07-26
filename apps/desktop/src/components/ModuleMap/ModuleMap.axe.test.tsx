import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { ModuleMap } from './ModuleMap';

const MODULES = AnalysisEnvelope.parse(rawSampleAnalysis).result.modules;

describe('ModuleMap accessibility', () => {
  test('has zero axe-core violations across all 5 fixture module cards', async () => {
    const { container } = render(<ModuleMap modules={MODULES} />);

    const results = await axe(container);

    expect(results.violations).toEqual([]);
  });
});
