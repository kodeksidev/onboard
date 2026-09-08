import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type cytoscape from 'cytoscape';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { DependencyGraph } from './DependencyGraph';
import { useGraphStore } from '@/state/graphStore';
import { fileNodeId } from './graph-model';
import { buildLargeSyntheticResult } from './graph-lazy-fixtures';
import { SLOW_MOUNT_TIMEOUT_MS } from '@/test/timeouts';

const SAMPLE = AnalysisEnvelope.parse(rawSampleAnalysis).result;

afterEach(() => {
  useGraphStore.setState({ selectedPath: null, focusedPath: null, focusToken: 0, searchFocusToken: 0 });
});

function getCanvasRegion(): HTMLElement {
  return screen.getByRole('application', { name: /dependency graph canvas/i });
}

describe('DependencyGraph', { timeout: SLOW_MOUNT_TIMEOUT_MS }, () => {
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
   * `keyboard-nav.ts`'s reducer is pure over the FULL `AnalysisResult`, never
   * over whatever happens to be materialized into Cytoscape, so its
   * highest-importance file starts inside a collapsed directory that the
   * entering view has not built.
   */
  test('keyboard navigation reaches a file the entering view had collapsed away', async () => {
    const user = userEvent.setup();
    const large = buildLargeSyntheticResult(30, 21); // 630 files across 61 directories
    render(<DependencyGraph result={large} />);

    await user.click(getCanvasRegion());
    await user.keyboard('{ArrowDown}');

    await waitFor(() => {
      expect(useGraphStore.getState().focusedPath).toBe('src/mod0/index.ts'); // importanceRank 1
    });
    expect(screen.getByText(/src\/mod0\/index\.ts, rank 1 of 630/)).toBeInTheDocument();
  });

  /**
   * Condition 2 of the 2026-09-08 amendment, and the reason `focusPath`
   * exists at all: the keyboard model and the canvas must not diverge. A
   * keyboard move onto a file inside a collapsed directory used to announce
   * that file to screen readers while the canvas showed nothing — criterion
   * 20 satisfied, the experience not. The focused node must now actually be
   * on the canvas: materialized AND not hidden by collapse.
   */
  test('a keyboard move onto a collapsed file reveals it on the canvas, not just in the announcement', async () => {
    const user = userEvent.setup();
    const large = buildLargeSyntheticResult(30, 21);
    let core: cytoscape.Core | null = null;
    render(<DependencyGraph result={large} onCytoscapeReady={(cy) => (core = cy)} />);
    await waitFor(() => {
      expect(core).not.toBeNull();
    });
    const cy = core as unknown as cytoscape.Core;
    // Precondition: the entering view genuinely does not contain this file.
    expect(cy.getElementById(fileNodeId('src/mod0/index.ts')).empty()).toBe(true);

    await user.click(getCanvasRegion());
    await user.keyboard('{ArrowDown}');

    await waitFor(() => {
      const focused = cy.getElementById(fileNodeId('src/mod0/index.ts'));
      expect(focused.empty()).toBe(false);
      expect(focused.hasClass('hidden-by-collapse')).toBe(false);
    });
  });

  /**
   * PROGRESSIVE ESCAPE (2026-09-08). Section 8 specifies Escape as "exit the
   * graph". Before this, Escape ALWAYS cleared and deselected, so with a
   * selection active there was no way to express "exit" — and, more to the
   * point, a mouse user could never reach this handler at all (Cytoscape's
   * canvas consumes the mousedown, so focus stayed on <body>). First Escape
   * clears; second exits.
   */
  test('the first Escape clears the selection rather than exiting', async () => {
    const user = userEvent.setup();
    render(<DependencyGraph result={SAMPLE} />);

    await user.click(getCanvasRegion());
    await user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(useGraphStore.getState().selectedPath).not.toBeNull();
    });

    await user.keyboard('{Escape}');

    expect(useGraphStore.getState().selectedPath).toBeNull();
    // Still inside the graph: exiting is what the SECOND Escape is for.
    expect(getCanvasRegion()).toHaveFocus();
  });

  test('the second Escape leaves the graph, honouring Section 8s contract as the terminal step', async () => {
    const user = userEvent.setup();
    render(<DependencyGraph result={SAMPLE} />);

    await user.click(getCanvasRegion());
    await user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(useGraphStore.getState().selectedPath).not.toBeNull();
    });

    await user.keyboard('{Escape}');
    await user.keyboard('{Escape}');

    expect(getCanvasRegion()).not.toHaveFocus();
  });

  test('the toolbar offers a visible way out of a selection, enabled only when there is one', async () => {
    const user = userEvent.setup();
    render(<DependencyGraph result={SAMPLE} />);
    const clear = screen.getByRole('button', { name: 'Clear selection' });
    expect(clear).toBeDisabled();

    await user.click(getCanvasRegion());
    await user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Clear selection' })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));

    expect(useGraphStore.getState().selectedPath).toBeNull();
  });

  /** "Analysed fine, nothing qualified" — defensive: `E_NO_SUPPORTED_FILES` already gates this above `DependencyGraph` in practice, but the component itself does not assume that invariant. */
  test('explains there is nothing to graph instead of an empty toolbar and canvas', () => {
    render(<DependencyGraph result={{ ...SAMPLE, files: [], edges: [] }} />);

    expect(screen.getByRole('heading', { name: 'Nothing to graph' })).toBeInTheDocument();
    expect(screen.getByText('This repo has no parsed files to show a dependency graph for.')).toBeInTheDocument();
    expect(screen.queryByRole('application', { name: /dependency graph canvas/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  /**
   * Real-world regression (docs/DECISIONS.md, "KI-11 is a scrollbar-
   * reservation feedback loop"): without a clipping boundary between this
   * panel and `AppShell`'s `overflow-auto` <main>, Cytoscape's own resize
   * could make `main` itself oscillate a real scrollbar in and out roughly
   * twice a second on a real repo. This panel never has scrollable content
   * of its own — it is a canvas that fills its box — so it must never be
   * able to affect an ancestor's overflow accounting, regardless of size.
   */
  test('is its own overflow-clipping boundary, so it can never make an ancestor scroll', () => {
    render(<DependencyGraph result={SAMPLE} />);
    expect(screen.getByRole('region', { name: 'Dependency graph' })).toHaveClass('overflow-hidden');
  });

  test('the empty-state variant is also its own clipping boundary', () => {
    render(<DependencyGraph result={{ ...SAMPLE, files: [], edges: [] }} />);
    expect(screen.getByRole('region', { name: 'Dependency graph' })).toHaveClass('overflow-hidden');
  });
});
