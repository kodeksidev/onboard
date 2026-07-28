import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { GraphListFallback } from './GraphListFallback';
import { SLOW_MOUNT_TIMEOUT_MS } from '@/test/timeouts';

const SAMPLE = AnalysisEnvelope.parse(rawSampleAnalysis).result;

describe('GraphListFallback', { timeout: SLOW_MOUNT_TIMEOUT_MS }, () => {
  test('renders one row per file with classification, module, and rank', () => {
    render(<GraphListFallback result={SAMPLE} onOpenFile={vi.fn()} />);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(SAMPLE.files.length + 1); // + header row

    const envRow = screen.getByRole('rowheader', { name: 'src/config/env.ts' }).closest('tr')!;
    expect(within(envRow).getByText('config')).toBeInTheDocument();
  });

  test('lists dependents and dependencies by path', () => {
    render(<GraphListFallback result={SAMPLE} onOpenFile={vi.fn()} />);
    const indexRow = screen.getByRole('rowheader', { name: 'src/index.ts' }).closest('tr')!;
    expect(within(indexRow).getByText(/src\/config\/env\.ts/)).toBeInTheDocument();
  });

  test('clicking Open on a row calls onOpenFile with that path', async () => {
    const onOpenFile = vi.fn();
    render(<GraphListFallback result={SAMPLE} onOpenFile={onOpenFile} />);
    screen.getByRole('button', { name: 'Open src/config/env.ts' }).click();
    expect(onOpenFile).toHaveBeenCalledWith('src/config/env.ts');
  });

  test('is visually hidden (sr-only) rather than rendered as a visible duplicate of the canvas', () => {
    render(<GraphListFallback result={SAMPLE} onOpenFile={vi.fn()} />);
    expect(screen.getByRole('table')).toHaveClass('sr-only');
  });
});
