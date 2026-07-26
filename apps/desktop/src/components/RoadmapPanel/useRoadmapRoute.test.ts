import { afterEach, describe, expect, test } from 'vitest';
import { renderHook } from '@testing-library/react';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { useGraphStore } from '@/state/graphStore';
import { buildRoutePairs, useRoadmapRoute } from './useRoadmapRoute';

const STEPS = AnalysisEnvelope.parse(rawSampleAnalysis).result.roadmap.steps;

afterEach(() => {
  useGraphStore.setState({ routePaths: [] });
});

describe('buildRoutePairs', () => {
  test('produces exactly steps.length - 1 pairs', () => {
    expect(buildRoutePairs(STEPS)).toHaveLength(STEPS.length - 1);
  });

  test('each pair connects consecutive steps in reading order, by their representative path', () => {
    const pairs = buildRoutePairs(STEPS);
    expect(pairs[0]).toEqual({ from: 'src/index.ts', to: 'worker/main.py' }); // steps 1 -> 2
    expect(pairs[pairs.length - 1]).toEqual({
      from: 'src/utils/format.ts', // step 12
      to: 'src/legacy/old-mailer.ts', // step 13
    });
  });

  test('a single step produces zero pairs', () => {
    expect(buildRoutePairs([STEPS[0]!])).toEqual([]);
  });

  test('zero steps produces zero pairs', () => {
    expect(buildRoutePairs([])).toEqual([]);
  });
});

describe('useRoadmapRoute', () => {
  test('publishes the full ordered path list to graphStore.routePaths on mount', () => {
    renderHook(() => useRoadmapRoute(STEPS));
    expect(useGraphStore.getState().routePaths).toEqual(STEPS.map((step) => step.path));
  });

  test('clears routePaths on unmount so a closed roadmap does not leave a stale overlay', () => {
    const { unmount } = renderHook(() => useRoadmapRoute(STEPS));
    expect(useGraphStore.getState().routePaths.length).toBeGreaterThan(0);

    unmount();

    expect(useGraphStore.getState().routePaths).toEqual([]);
  });
});
