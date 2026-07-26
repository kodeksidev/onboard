import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { DependencyGraph } from './DependencyGraph';
import { useGraphStore } from '@/state/graphStore';
import { buildLargeSyntheticResult } from './graph-lazy-fixtures';

const SAMPLE = AnalysisEnvelope.parse(rawSampleAnalysis).result;

afterEach(() => {
  useGraphStore.setState({ selectedPath: null, focusedPath: null, focusToken: 0, searchFocusToken: 0 });
});

function getCanvasRegion(): HTMLElement {
  return screen.getByRole('application', { name: /dependency graph canvas/i });
}

describe('DependencyGraph', () => {
  test('renders the accessible canvas region, toolbar, and screen-reader table for the same data', async () => {
    render(<DependencyGraph result={SAMPLE} />);

    expect(getCanvasRegion()).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /search the dependency graph/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('row')).toHaveLength(SAMPLE.files.length + 1);
  });

  test('ArrowDown focuses the highest-importance file and announces it via aria-live', async () => {
    const user = userEvent.setup();
    render(<DependencyGraph result={SAMPLE} />);

    await user.click(getCanvasRegion());
    await user.keyboard('{ArrowDown}');

    await waitFor(() => {
      expect(useGraphStore.getState().focusedPath).toBe('src/config/env.ts'); // importanceRank 1
    });
    expect(screen.getByText(/src\/config\/env\.ts, rank 1 of 24/)).toBeInTheDocument();
  });

  test('] steps from the focused file to its first (sorted) dependency', async () => {
    const user = userEvent.setup();
    render(<DependencyGraph result={SAMPLE} />);
    useGraphStore.getState().focusPath('src/index.ts'); // depends on config/env.ts and server.ts

    await user.click(getCanvasRegion());
    await user.keyboard(']');

    await waitFor(() => {
      expect(useGraphStore.getState().focusedPath).toBe('src/config/env.ts');
    });
  });

  test('Enter opens the focused file', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    render(<DependencyGraph result={SAMPLE} onOpenFile={onOpenFile} />);

    await user.click(getCanvasRegion());
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(onOpenFile).toHaveBeenCalledWith('src/config/env.ts');
  });

  test('/ moves focus into the search input', async () => {
    const user = userEvent.setup();
    render(<DependencyGraph result={SAMPLE} />);

    await user.click(getCanvasRegion());
    await user.keyboard('/');

    await waitFor(() => {
      expect(screen.getByRole('searchbox', { name: /search the dependency graph/i })).toHaveFocus();
    });
  });

  test('Escape clears the current selection', async () => {
    const user = userEvent.setup();
    render(<DependencyGraph result={SAMPLE} />);
    useGraphStore.getState().selectPath('src/config/env.ts');

    await user.click(getCanvasRegion());
    await user.keyboard('{Escape}');

    expect(useGraphStore.getState().selectedPath).toBeNull();
  });

  /**
   * Section 9 Phase 8 follow-up: the node SET keyboard nav traverses is now
   * dynamic (`keyboard-nav.ts`'s reducer, unaffected — it's pure over the
   * FULL `AnalysisResult`, never over whatever happens to be materialized
   * into Cytoscape). This exceeds `GRAPH_AUTO_COLLAPSE_THRESHOLD`, so its
   * highest-importance file lives inside a lazily-collapsed directory and
   * is never added to the Cytoscape core at all — proving focus/announce
   * still works correctly even when the focused node doesn't exist there.
   */
  test('keyboard navigation still reaches a file that lazy materialization never added to the Cytoscape core', async () => {
    const user = userEvent.setup();
    const large = buildLargeSyntheticResult(30, 21); // 630 files, well past the 600 auto-collapse threshold
    render(<DependencyGraph result={large} />);

    await user.click(getCanvasRegion());
    await user.keyboard('{ArrowDown}');

    await waitFor(() => {
      expect(useGraphStore.getState().focusedPath).toBe('src/mod0/index.ts'); // importanceRank 1, hidden by auto-collapse
    });
    expect(screen.getByText(/src\/mod0\/index\.ts, rank 1 of 630/)).toBeInTheDocument();
  });
});
