import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalysisEnvelope } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { ModuleCardView } from './ModuleCardView';

const MODULES = AnalysisEnvelope.parse(rawSampleAnalysis).result.modules;
const NAMES_BY_ID = new Map(MODULES.map((module) => [module.id, module.name]));

function moduleById(id: string) {
  const module = MODULES.find((candidate) => candidate.id === id);
  if (module === undefined) {
    throw new Error(`fixture has no module ${id}`);
  }
  return module;
}

describe('ModuleCardView', () => {
  test('renders name, dirPath, purpose, and file count', () => {
    render(<ModuleCardView module={moduleById('src-services')} moduleNamesById={NAMES_BY_ID} />);
    expect(screen.getByRole('heading', { name: 'services' })).toBeInTheDocument();
    expect(screen.getByText('src/services')).toBeInTheDocument();
    expect(screen.getByText('Business logic and orchestration between models and controllers.')).toBeInTheDocument();
    expect(screen.getByText('4 files')).toBeInTheDocument();
  });

  test('renders every keyFilePath as a working jump link', async () => {
    const onOpenFile = vi.fn();
    render(<ModuleCardView module={moduleById('src-services')} moduleNamesById={NAMES_BY_ID} onOpenFile={onOpenFile} />);

    const keyFiles = moduleById('src-services').keyFilePaths;
    expect(keyFiles.length).toBeGreaterThan(0);
    for (const path of keyFiles) {
      screen.getByRole('button', { name: path }).click();
      expect(onOpenFile).toHaveBeenCalledWith(path);
    }
    expect(onOpenFile).toHaveBeenCalledTimes(keyFiles.length);
  });

  test('resolves dependsOnModuleIds/dependedOnByModuleIds to human-readable module names', () => {
    render(<ModuleCardView module={moduleById('src-controllers')} moduleNamesById={NAMES_BY_ID} />);
    // src-controllers depends on src-services and src-utils, and is depended on by src-routes
    expect(screen.getByText('services')).toBeInTheDocument();
    expect(screen.getByText('utils')).toBeInTheDocument();
    expect(screen.getByText('routes')).toBeInTheDocument();
  });

  test('a module with no dependents renders "none" rather than an empty section', () => {
    render(<ModuleCardView module={moduleById('src-routes')} moduleNamesById={NAMES_BY_ID} />);
    expect(screen.getByText('none')).toBeInTheDocument();
  });
});
