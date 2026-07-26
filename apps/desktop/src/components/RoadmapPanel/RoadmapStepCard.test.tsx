import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { RoadmapStepCard } from './RoadmapStepCard';

const STEPS = AnalysisEnvelope.parse(rawSampleAnalysis).result.roadmap.steps;

function stepByOrder(order: number) {
  const step = STEPS.find((candidate) => candidate.order === order);
  if (step === undefined) {
    throw new Error(`fixture has no roadmap step with order ${order}`);
  }
  return step;
}

describe('RoadmapStepCard', () => {
  test('renders the order, path, and why text', () => {
    render(<RoadmapStepCard step={stepByOrder(1)} isFocused={false} onFocus={vi.fn()} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('src/index.ts')).toBeInTheDocument();
    expect(screen.getByText('Entry point (package.json#main). Start reading here.')).toBeInTheDocument();
  });

  test('clicking the step focuses it in the graph', async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    render(<RoadmapStepCard step={stepByOrder(3)} isFocused={false} onFocus={onFocus} />);

    await user.click(screen.getByRole('button', { name: /focus src\/server\.ts in the dependency graph/i }));

    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  test('marks the currently focused step with aria-current', () => {
    render(<RoadmapStepCard step={stepByOrder(3)} isFocused onFocus={vi.fn()} />);
    expect(screen.getByRole('listitem')).toHaveAttribute('aria-current', 'step');
  });

  test('an "Open file" action calls onOpenFile with the step path', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    render(<RoadmapStepCard step={stepByOrder(1)} isFocused={false} onFocus={vi.fn()} onOpenFile={onOpenFile} />);

    await user.click(screen.getByRole('button', { name: 'Open file: src/index.ts' }));

    expect(onOpenFile).toHaveBeenCalledWith('src/index.ts');
  });

  test.each([
    [1, 'entry', 'Entry point'],
    [6, 'core', 'Core'],
    [7, 'supporting', 'Supporting'],
    [11, 'leaf-utility', 'Leaf utility'],
    [13, 'unreached', 'Unreached'],
  ])('step %i (section %s) renders the distinguishing badge "%s"', (order, _section, label) => {
    render(<RoadmapStepCard step={stepByOrder(order)} isFocused={false} onFocus={vi.fn()} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  test('the fixture\'s 3-file-cycle step (order 6) renders both companion paths', () => {
    const step = stepByOrder(6);
    expect(step.companionPaths).toEqual(['src/services/session.service.ts', 'src/services/token.service.ts']);

    render(<RoadmapStepCard step={step} isFocused={false} onFocus={vi.fn()} />);

    const companionsRegion = screen.getByRole('region', { name: 'Part of this step:' });
    expect(within(companionsRegion).getByText('src/services/session.service.ts')).toBeInTheDocument();
    expect(within(companionsRegion).getByText('src/services/token.service.ts')).toBeInTheDocument();
  });

  test('a step with no companions renders no companions region', () => {
    render(<RoadmapStepCard step={stepByOrder(1)} isFocused={false} onFocus={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Part of this step:' })).not.toBeInTheDocument();
  });

  test('renders dependsOnPaths and the dependedOnByCount', () => {
    const step = stepByOrder(1); // dependsOnPaths: [env.ts, server.ts], dependedOnByCount: 0
    render(<RoadmapStepCard step={step} isFocused={false} onFocus={vi.fn()} />);
    expect(screen.getByText('src/config/env.ts')).toBeInTheDocument();
    expect(screen.getByText('src/server.ts')).toBeInTheDocument();
    expect(screen.getByText('Imported by 0 files')).toBeInTheDocument();
  });
});
