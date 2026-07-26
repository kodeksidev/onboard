import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { ModuleMap } from './ModuleMap';

const MODULES = AnalysisEnvelope.parse(rawSampleAnalysis).result.modules;

describe('ModuleMap', () => {
  test('renders all 5 fixture module cards', () => {
    render(<ModuleMap modules={MODULES} />);
    expect(screen.getAllByRole('article')).toHaveLength(5);
    for (const module of MODULES) {
      expect(screen.getByRole('heading', { name: module.name })).toBeInTheDocument();
    }
  });

  test('clicking a key file jump link calls onOpenFile with that path', () => {
    const onOpenFile = vi.fn();
    render(<ModuleMap modules={MODULES} onOpenFile={onOpenFile} />);

    const firstKeyFile = MODULES[0]!.keyFilePaths[0]!;
    screen.getByRole('button', { name: firstKeyFile }).click();

    expect(onOpenFile).toHaveBeenCalledWith(firstKeyFile);
  });
});
