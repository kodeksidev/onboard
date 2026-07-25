import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalysisProgress } from './AnalysisProgress';

describe('AnalysisProgress', () => {
  test('renders a phase label and progress value derived from processed/total', () => {
    render(<AnalysisProgress progress={{ phase: 'parse', processed: 6, total: 24, currentPath: null }} />);
    expect(screen.getByText('Parsing symbols')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '25');
  });

  test('renders a sensible default before the first progress event arrives', () => {
    render(<AnalysisProgress progress={null} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
  });

  test('never exceeds 100 percent', () => {
    render(<AnalysisProgress progress={{ phase: 'persist', processed: 999, total: 24, currentPath: null }} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '100');
  });
});
