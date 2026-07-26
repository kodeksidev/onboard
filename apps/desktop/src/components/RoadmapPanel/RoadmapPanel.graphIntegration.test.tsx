import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type cytoscape from 'cytoscape';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { useGraphStore } from '@/state/graphStore';
import { DependencyGraph } from '@/components/DependencyGraph/DependencyGraph';
import { fileNodeId } from '@/components/DependencyGraph/graph-model';
import { RoadmapPanel } from './RoadmapPanel';

const RESULT = AnalysisEnvelope.parse(rawSampleAnalysis).result;
const STEPS = RESULT.roadmap.steps;

// Forces `focusNodeById`'s synchronous `cy.center()` branch instead of the
// animated one, so centering is deterministic and doesn't depend on a real
// requestAnimationFrame loop running under jsdom (Section 9 Phase 8's
// honest-about-jsdom stance: real Cytoscape behavior, just avoiding a
// second, unrelated timing dependency in a test about focus/centering).
function stubReducedMotion(matches: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  stubReducedMotion(true);
});

afterEach(() => {
  useGraphStore.setState({
    selectedPath: null,
    focusedPath: null,
    focusToken: 0,
    searchFocusToken: 0,
    routePaths: [],
  });
});

/**
 * Section 9 Phase 9's gate: "clicking step n focuses and centers that node
 * in the graph (asserted by a test against the Cytoscape [instance])" and
 * "the route overlay renders exactly steps.length - 1 connector segments."
 * Mounts the real `RoadmapPanel` and `DependencyGraph` together (the same
 * `graphStore` seam wires them in the real app, whether or not both are
 * visible in the same tab at once) and asserts against the genuine,
 * headless-fallback Cytoscape core `DependencyGraph` constructs — the same
 * real-library approach Phase 8 used throughout, via `onCytoscapeReady`.
 */
function renderRoadmapAndGraph(): { getCore: () => cytoscape.Core } {
  let core: cytoscape.Core | null = null;
  render(
    <>
      <RoadmapPanel steps={STEPS} />
      <DependencyGraph result={RESULT} onCytoscapeReady={(cy) => (core = cy)} />
    </>,
  );
  return {
    getCore: () => {
      if (core === null) {
        throw new Error('cytoscape core was not ready');
      }
      return core;
    },
  };
}

describe('RoadmapPanel + DependencyGraph integration', () => {
  test('clicking step n centers that node in the real Cytoscape core', async () => {
    const user = userEvent.setup();
    const { getCore } = renderRoadmapAndGraph();
    await waitFor(() => expect(() => getCore()).not.toThrow());
    const cy = getCore();
    const step = STEPS[2]!; // order 3: src/server.ts
    cy.getElementById(fileNodeId(step.path)).position({ x: 900, y: 700 });

    await user.click(screen.getByRole('button', { name: new RegExp(`focus ${step.path.replace(/[.[\]]/g, '\\$&')} in the dependency graph`, 'i') }));

    await waitFor(() => {
      const rendered = cy.getElementById(fileNodeId(step.path)).renderedPosition();
      expect(rendered.x).toBeCloseTo(cy.width() / 2, 0);
      expect(rendered.y).toBeCloseTo(cy.height() / 2, 0);
    });
    expect(useGraphStore.getState().focusedPath).toBe(step.path);
  });

  test('the route overlay renders exactly steps.length - 1 connector segments', async () => {
    const { getCore } = renderRoadmapAndGraph();
    await waitFor(() => expect(() => getCore()).not.toThrow());

    await waitFor(() => {
      expect(getCore().edges('.route-edge').length).toBe(STEPS.length - 1);
    });
  });

  test('cross-tab: focusing a step while the graph is unmounted still centers it once the graph opens', async () => {
    const user = userEvent.setup();
    // The graph tab is "closed": only the roadmap is mounted.
    render(<RoadmapPanel steps={STEPS} />);
    const step = STEPS[5]!; // order 6, the fixture's 3-file-cycle step

    await user.click(
      screen.getByRole('button', {
        name: new RegExp(`focus ${step.path.replace(/[.[\]]/g, '\\$&')} in the dependency graph`, 'i'),
      }),
    );

    expect(useGraphStore.getState().focusedPath).toBe(step.path); // set, but nothing to center yet

    // The user now opens the "Dependency graph" tab.
    let core: cytoscape.Core | null = null;
    render(<DependencyGraph result={RESULT} onCytoscapeReady={(cy) => (core = cy)} />);
    await waitFor(() => expect(core).not.toBeNull());

    await waitFor(() => {
      const rendered = core!.getElementById(fileNodeId(step.path)).renderedPosition();
      expect(rendered.x).toBeCloseTo(core!.width() / 2, 0);
      expect(rendered.y).toBeCloseTo(core!.height() / 2, 0);
    });
  });

  test('closing the roadmap (unmount) clears the route overlay', async () => {
    let core: cytoscape.Core | null = null;
    const { rerender } = render(
      <>
        <RoadmapPanel steps={STEPS} />
        <DependencyGraph result={RESULT} onCytoscapeReady={(cy) => (core = cy)} />
      </>,
    );
    await waitFor(() => expect(core).not.toBeNull());
    await waitFor(() => expect(core!.edges('.route-edge').length).toBe(STEPS.length - 1));

    rerender(<DependencyGraph result={RESULT} onCytoscapeReady={(cy) => (core = cy)} />);

    await waitFor(() => expect(core!.edges('.route-edge').length).toBe(0));
  });
});
