import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalysisEnvelope } from '@onboard/contract';
import type { AnalysisResult } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { ModuleMap } from './ModuleMap';

const RESULT: AnalysisResult = AnalysisEnvelope.parse(rawSampleAnalysis).result;
const MODULES = RESULT.modules;

function fileStub(path: string, isParsed = true): AnalysisResult['files'][number] {
  return { ...RESULT.files[0]!, path, isParsed };
}

describe('ModuleMap', () => {
  test('renders all 5 fixture module cards', () => {
    render(<ModuleMap result={RESULT} />);
    expect(screen.getAllByRole('article')).toHaveLength(5);
    for (const module of MODULES) {
      expect(screen.getByRole('heading', { name: module.name })).toBeInTheDocument();
    }
  });

  test('clicking a key file jump link calls onOpenFile with that path', () => {
    const onOpenFile = vi.fn();
    render(<ModuleMap result={RESULT} onOpenFile={onOpenFile} />);

    const firstKeyFile = MODULES[0]!.keyFilePaths[0]!;
    screen.getByRole('button', { name: firstKeyFile }).click();

    expect(onOpenFile).toHaveBeenCalledWith(firstKeyFile);
  });

  /** The reported defect: analysis succeeded, but a small repo has nothing that qualifies as a module. */
  test('names the actual rule and the actual largest directory when nothing qualifies', () => {
    const smallRepo: AnalysisResult = {
      ...RESULT,
      repo: { ...RESULT.repo, sourceRoots: [''] },
      files: [fileStub('src/a.ts'), fileStub('src/b.ts')],
      modules: [],
    };
    render(<ModuleMap result={smallRepo} />);

    expect(screen.getByRole('heading', { name: 'No modules found' })).toBeInTheDocument();
    expect(
      screen.getByText("Modules are directories with at least 3 analysed files. This repo's largest is src with 2."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  test('names the rule without a specific directory when nothing has any analysed files', () => {
    const emptyRepo: AnalysisResult = {
      ...RESULT,
      repo: { ...RESULT.repo, sourceRoots: [''] },
      files: [fileStub('src/a.ts', false)],
      modules: [],
    };
    render(<ModuleMap result={emptyRepo} />);

    expect(screen.getByRole('heading', { name: 'No modules found' })).toBeInTheDocument();
    expect(
      screen.getByText('Modules are directories with at least 3 analysed files. No directory in this repo has any analysed files yet.'),
    ).toBeInTheDocument();
  });
});
