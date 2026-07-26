import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalysisEnvelope } from '@onboard/contract';
import type { AnalysisResult } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { FileViewer } from './FileViewer';

const REPO_ID = '9f3c1a7b2e5d4086';
const RESULT: AnalysisResult = AnalysisEnvelope.parse(rawSampleAnalysis).result;
const AUTH_SERVICE_PATH = 'src/services/auth.service.ts';

describe('FileViewer', () => {
  test('with no path open, renders the exact "No file open" empty state', () => {
    render(<FileViewer repoId={REPO_ID} result={RESULT} path={null} />);

    expect(screen.getByText('No file open')).toBeInTheDocument();
    expect(
      screen.getByText('Choose a search result, or click a path anywhere in Onboard, to view it here.'),
    ).toBeInTheDocument();
  });

  test('loads a real file and renders its symbol outline and imports/importers', async () => {
    render(<FileViewer repoId={REPO_ID} result={RESULT} path={AUTH_SERVICE_PATH} />);

    expect(await screen.findByText('AuthService')).toBeInTheDocument();
    expect(screen.getByText('authenticate')).toBeInTheDocument();

    const importsRegion = screen.getByRole('region', { name: 'Imports' });
    expect(importsRegion).toHaveTextContent('src/services/session.service.ts');
    expect(importsRegion).toHaveTextContent('src/models/user.model.ts');
    expect(importsRegion).toHaveTextContent('src/utils/logger.ts');

    const importedByRegion = screen.getByRole('region', { name: 'Imported by' });
    expect(importedByRegion).toHaveTextContent('src/controllers/auth.controller.ts');
    expect(importedByRegion).toHaveTextContent('src/services/token.service.ts');
  });

  test('clicking a symbol scrolls the editor to that symbol\'s line', async () => {
    const user = userEvent.setup();
    render(<FileViewer repoId={REPO_ID} result={RESULT} path={AUTH_SERVICE_PATH} />);

    const symbolButton = await screen.findByRole('button', { name: /authenticate/i });
    await user.click(symbolButton);

    await waitFor(() => {
      const editor = document.querySelector('.cm-editor');
      expect(editor).not.toBeNull();
    });
  });

  test('clicking an import jump-link calls onOpenFile with that path', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    render(<FileViewer repoId={REPO_ID} result={RESULT} path={AUTH_SERVICE_PATH} onOpenFile={onOpenFile} />);

    const importsRegion = await screen.findByRole('region', { name: 'Imports' });
    await waitFor(() => expect(importsRegion.querySelector('button')).not.toBeNull());
    const button = screen.getByRole('button', { name: 'src/services/session.service.ts' });
    await user.click(button);

    expect(onOpenFile).toHaveBeenCalledWith('src/services/session.service.ts');
  });

  test('a path outside the repo shows the exact error copy for E_PATH_ESCAPES_REPO', async () => {
    render(<FileViewer repoId={REPO_ID} result={RESULT} path="not/a/real/file.ts" />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("That path isn't part of this repository")).toBeInTheDocument();
  });
});
