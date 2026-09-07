import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AnalysisEnvelope, type AnalysisResult } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { GraphListFallback } from './GraphListFallback';
import { SLOW_MOUNT_TIMEOUT_MS } from '@/test/timeouts';

const SAMPLE = AnalysisEnvelope.parse(rawSampleAnalysis).result;

/**
 * Real-world regression for the sr-only table width blowout (docs/DECISIONS.md):
 * a hub file's "Depended on by" list has no natural bound, and this component's
 * one uncapped, unwrapped table cell is exactly what forced the whole
 * `<table>`'s auto-layout width past its intended 1px on a real 500-file repo.
 * Reuses SAMPLE's existing files as synthetic dependents of `env.ts` so the
 * fixture stays schema-valid without hand-rolling a full AnalysisResult.
 */
function withManyDependents(hubPath: string): AnalysisResult {
  const extraEdges = SAMPLE.files
    .filter((file) => file.path !== hubPath)
    .map((file) => ({
      fromPath: file.path,
      toPath: hubPath,
      specifier: './hub',
      line: 1,
      kind: 'static' as const,
      isTypeOnly: false,
    }));
  return { ...SAMPLE, edges: [...SAMPLE.edges, ...extraEdges] };
}

/**
 * Real-world regression for the sr-only table HEIGHT blowout
 * (docs/DECISIONS.md): 500 rows measured 12,142px tall against an 800px
 * viewport, independent of the width fix above — `table-fixed` and the
 * dependency-list cap bound width, neither bounds row count. Generates
 * `count` synthetic files from one real fixture file's shape, each with a
 * distinct, REVERSED importance rank (higher index = better rank = more
 * important) so a correct "most important" cap keeps the LAST-generated
 * files, not an arbitrary prefix — a naive `.slice(0, N)` on unsorted input
 * would keep the wrong ones and this test would still pass by accident if
 * the component didn't actually sort.
 */
function withManyFiles(count: number): AnalysisResult {
  const template = SAMPLE.files[0]!;
  const files = Array.from({ length: count }, (_unused, index) => ({
    ...template,
    path: `synthetic/file${String(index)}.ts`,
    importanceRank: count - index, // file0 has the WORST rank; last file has rank 1 (best).
  }));
  return { ...SAMPLE, files };
}

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

  test('forces table-layout: fixed so real (uncappable) long paths cannot re-inflate the table', () => {
    // The cap above bounds list-column CONTENT; this bounds the <table>'s
    // own rendered box regardless of content — real repo paths (see
    // docs/DECISIONS.md) are long enough that the cap alone still measured
    // ~9,900px wide. `table-layout: auto` (the default) sizes columns from
    // content even under `sr-only`'s `width: 1px`; `fixed` does not.
    render(<GraphListFallback result={SAMPLE} onOpenFile={vi.fn()} />);
    expect(screen.getByRole('table')).toHaveClass('table-fixed');
  });

  test("caps a hub file's dependent list instead of rendering it unbounded", () => {
    const hubPath = 'src/config/env.ts';
    render(<GraphListFallback result={withManyDependents(hubPath)} onOpenFile={vi.fn()} />);
    const hubRow = screen.getByRole('rowheader', { name: hubPath }).closest('tr')!;
    const dependedOnByCell = within(hubRow).getAllByRole('cell')[4]!;
    // 23 other fixture files all depend on the hub — far past the cap.
    expect(dependedOnByCell.textContent).toMatch(/\(\+\d+ more\)$/);
    expect(dependedOnByCell.textContent!.split(', ')).toHaveLength(8);
    expect(dependedOnByCell.textContent!.length).toBeLessThan(500);
  });

  test('caps row count, keeps the most important files, and states how many were omitted', () => {
    const TOTAL_FILES = 356;
    render(<GraphListFallback result={withManyFiles(TOTAL_FILES)} onOpenFile={vi.fn()} />);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(101); // 100 capped rows + header row, not 357.

    // Rank 1 (best) is `synthetic/file355.ts` (index count-1); rank 100 is `synthetic/file256.ts`.
    expect(screen.getByRole('rowheader', { name: 'synthetic/file355.ts' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'synthetic/file256.ts' })).toBeInTheDocument();
    // Rank 101 (first omitted) must NOT be rendered — proves the cap keeps the
    // most important files by rank, not an arbitrary array prefix.
    expect(screen.queryByRole('rowheader', { name: 'synthetic/file255.ts' })).not.toBeInTheDocument();

    expect(screen.getByText(/the 100 most important of 356 files.*256 more not shown.*Where is X\?/)).toBeInTheDocument();
  });
});
