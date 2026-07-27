import { afterEach, describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { DependencyGraph } from './DependencyGraph';
import { useGraphStore } from '@/state/graphStore';
import { SLOW_MOUNT_TIMEOUT_MS } from '@/test/timeouts';

const SAMPLE = AnalysisEnvelope.parse(rawSampleAnalysis).result;

afterEach(() => {
  useGraphStore.setState({ selectedPath: null, focusedPath: null, focusToken: 0, searchFocusToken: 0 });
});

/**
 * Section 9 Phase 8's gate: "an axe-core test on the graph panel reports
 * zero violations." Runs against the real rendered DOM (toolbar, the
 * keyboard-operable canvas region, the aria-live announcer, and the
 * screen-reader table) — jsdom's missing canvas support has no bearing on
 * this check, since axe inspects the accessibility tree, not pixels.
 */
describe('DependencyGraph accessibility', { timeout: SLOW_MOUNT_TIMEOUT_MS }, () => {
  test('has zero axe-core violations', async () => {
    const { container } = render(<DependencyGraph result={SAMPLE} />);

    const results = await axe(container);

    expect(results.violations).toEqual([]);
  });
});
