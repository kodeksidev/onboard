import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AnalysisEnvelope } from '@onboard/contract';
import type { AnalysisResult } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { OverviewPanel } from './OverviewPanel';

const SAMPLE: AnalysisResult = AnalysisEnvelope.parse(rawSampleAnalysis).result;

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

  /**
   * "Analysed fine, nothing qualified" for every Overview sub-list that maps
   * an array with no empty branch would previously have rendered a heading
   * and blank space, the same trap `ModuleMap` had (Section 9's defect
   * report). Each names the actual rule, not a generic "nothing here".
   */
  describe('empty sub-lists (analysed fine, nothing qualified)', () => {
    const NO_ENTRY_POINTS_RESULT: AnalysisResult = { ...SAMPLE, entryPoints: [] };
    const NO_IMPORTANT_FILES_RESULT: AnalysisResult = { ...SAMPLE, importantFilePaths: [] };
    const NO_STACK_RESULT: AnalysisResult = {
      ...SAMPLE,
      stack: { languages: [], manifests: [], dependencies: [] },
    };
    const NO_RUNTIME_DEPS_RESULT: AnalysisResult = {
      ...SAMPLE,
      stack: { ...SAMPLE.stack, dependencies: SAMPLE.stack.dependencies.filter((d) => d.scope !== 'runtime') },
    };

    test('names the entry-point detection rule when none were found', () => {
      render(<OverviewPanel result={NO_ENTRY_POINTS_RESULT} />);
      const region = within(screen.getByRole('region', { name: 'Entry points' }));
      expect(
        region.getByText(
          "Onboard looks for package.json's main, bin, or scripts.start; a conventional index file; or Python's __main__.py file or module guard. None of those were found in this repo.",
        ),
      ).toBeInTheDocument();
    });

    test('explains why there are no important files to rank', () => {
      render(<OverviewPanel result={NO_IMPORTANT_FILES_RESULT} />);
      const region = within(screen.getByRole('region', { name: 'Most important files' }));
      expect(
        region.getByText('Onboard ranks files by importance once they are parsed. No files in this repo were parsed successfully.'),
      ).toBeInTheDocument();
    });

    test('distinguishes "no languages", "no manifest", and "no runtime deps" as three separate messages', () => {
      render(<OverviewPanel result={NO_STACK_RESULT} />);
      expect(
        screen.getByText('Onboard detects languages from parsed files. No files in this repo were parsed successfully.'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Onboard looks for files such as package.json, pyproject.toml, or requirements.txt. None were found in this repo.'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('The manifest(s) Onboard found in this repo declare no runtime dependencies.'),
      ).toBeInTheDocument();
    });

    test('"no runtime dependencies" is distinct from "no manifest" when a manifest exists but declares none', () => {
      render(<OverviewPanel result={NO_RUNTIME_DEPS_RESULT} />);
      expect(
        screen.getByText('The manifest(s) Onboard found in this repo declare no runtime dependencies.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Onboard looks for files such as package.json, pyproject.toml, or requirements.txt. None were found in this repo.'),
      ).not.toBeInTheDocument();
    });
  });
});
