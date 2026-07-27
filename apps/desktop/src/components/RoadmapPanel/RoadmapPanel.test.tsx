import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { useGraphStore } from '@/state/graphStore';
import { RoadmapPanel } from './RoadmapPanel';

const RESULT = AnalysisEnvelope.parse(rawSampleAnalysis).result;

afterEach(() => {
  useGraphStore.setState({
    selectedPath: null,
    focusedPath: null,
    focusToken: 0,
    searchFocusToken: 0,
    routePaths: [],
  });
});

describe('RoadmapPanel', () => {
  test('renders all 13 fixture steps as a numbered list, in order', () => {
    render(<RoadmapPanel steps={RESULT.roadmap.steps} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(13);
    expect(items[0]).toHaveTextContent('src/index.ts');
    expect(items[12]).toHaveTextContent('src/legacy/old-mailer.ts');
  });

  test('publishes the route into graphStore for the graph overlay to read', () => {
    render(<RoadmapPanel steps={RESULT.roadmap.steps} />);
    expect(useGraphStore.getState().routePaths).toEqual(RESULT.roadmap.steps.map((step) => step.path));
  });

  test('clicking a step focuses it via graphStore.focusPath', async () => {
    const user = userEvent.setup();
    render(<RoadmapPanel steps={RESULT.roadmap.steps} />);

    await user.click(
      screen.getByRole('button', { name: /focus src\/services\/auth\.service\.ts in the dependency graph/i }),
    );

    expect(useGraphStore.getState().focusedPath).toBe('src/services/auth.service.ts');
  });

  test('the focused step is the only one marked aria-current', async () => {
    const user = userEvent.setup();
    render(<RoadmapPanel steps={RESULT.roadmap.steps} />);

    await user.click(screen.getByRole('button', { name: /focus src\/index\.ts in the dependency graph/i }));

    const current = screen.getAllByRole('listitem').filter((item) => item.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('src/index.ts');
  });

  test('clicking "Open file" calls onOpenFile without changing graph focus', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    render(<RoadmapPanel steps={RESULT.roadmap.steps} onOpenFile={onOpenFile} />);

    await user.click(screen.getByRole('button', { name: 'Open file: src/index.ts' }));

    expect(onOpenFile).toHaveBeenCalledWith('src/index.ts');
    expect(useGraphStore.getState().focusedPath).toBeNull();
  });

  /** "Analysed fine, nothing qualified" — matches Section 9's ModuleMap defect report, audited across every list-rendering tab. */
  test('names why there is no roadmap when nothing was parsed, instead of a blank list', () => {
    render(<RoadmapPanel steps={[]} />);

    expect(screen.getByRole('heading', { name: 'No roadmap yet' })).toBeInTheDocument();
    expect(
      screen.getByText('Onboard builds a reading order from parsed files. No files in this repo were parsed successfully.'),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
