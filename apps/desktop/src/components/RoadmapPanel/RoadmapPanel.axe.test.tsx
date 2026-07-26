import { afterEach, describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { useGraphStore } from '@/state/graphStore';
import { RoadmapPanel } from './RoadmapPanel';

const STEPS = AnalysisEnvelope.parse(rawSampleAnalysis).result.roadmap.steps;

afterEach(() => {
  useGraphStore.setState({ routePaths: [] });
});

/** Criterion 20 names the roadmap panel explicitly alongside the graph. */
describe('RoadmapPanel accessibility', () => {
  test('has zero axe-core violations across all 13 fixture steps (all 5 sections)', async () => {
    const { container } = render(<RoadmapPanel steps={STEPS} />);

    const results = await axe(container);

    expect(results.violations).toEqual([]);
  });
});
