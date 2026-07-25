import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { OverviewPanel } from './OverviewPanel';

const SAMPLE = AnalysisEnvelope.parse(rawSampleAnalysis).result;

describe('OverviewPanel', () => {
  test('renders the repo identity and detected type from the fixture', () => {
    render(<OverviewPanel result={SAMPLE} />);
    expect(screen.getByRole('heading', { name: 'acme-billing-api' })).toBeInTheDocument();
    expect(
      screen.getByText('Node.js service with React admin and Python worker'),
    ).toBeInTheDocument();
  });

  test('renders stats from AnalysisResult.stats', () => {
    render(<OverviewPanel result={SAMPLE} />);
    expect(screen.getByText('Files scanned').nextSibling).toHaveTextContent('24');
    expect(screen.getByText('Cycles').nextSibling).toHaveTextContent('1');
  });

  test('renders every entry point path from the fixture inside the Entry points region', () => {
    render(<OverviewPanel result={SAMPLE} />);
    const region = within(screen.getByRole('region', { name: 'Entry points' }));
    for (const entryPoint of SAMPLE.entryPoints) {
      expect(region.getByText(entryPoint.path)).toBeInTheDocument();
    }
  });

  test('renders the top important files list inside the Most important files region', () => {
    render(<OverviewPanel result={SAMPLE} />);
    const region = within(screen.getByRole('region', { name: 'Most important files' }));
    expect(region.getByText('src/config/env.ts')).toBeInTheDocument();
  });

  test('clicking a file path calls onOpenFile with its path', () => {
    const opened: string[] = [];
    render(<OverviewPanel result={SAMPLE} onOpenFile={(path) => opened.push(path)} />);
    const region = within(screen.getByRole('region', { name: 'Most important files' }));
    region.getByText('src/config/env.ts').click();
    expect(opened).toContain('src/config/env.ts');
  });

  test('lists the deliberately skipped minified file under "Skipped files"', () => {
    render(<OverviewPanel result={SAMPLE} />);
    const disclosure = screen.getByText('Skipped files').closest('details');
    expect(disclosure).not.toBeNull();
    expect(screen.getByText(/web\/src\/vendor\.min\.js/)).toBeInTheDocument();
  });
});
