import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import { waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AnalysisEnvelope } from '@onboard/contract';
import type { AnalysisResult } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { FileViewer } from './FileViewer';

const REPO_ID = '9f3c1a7b2e5d4086';
const RESULT: AnalysisResult = AnalysisEnvelope.parse(rawSampleAnalysis).result;
const AUTH_SERVICE_PATH = 'src/services/auth.service.ts';

/** Section 9 Phase 10's quality gate: axe-clean, matching Phase 8/9's precedent. */
describe('FileViewer accessibility', () => {
  test('has zero axe-core violations with a file loaded', async () => {
    const { container } = render(<FileViewer repoId={REPO_ID} result={RESULT} path={AUTH_SERVICE_PATH} />);

    await waitFor(() => {
      expect(container.querySelector('.cm-editor')).not.toBeNull();
    });

    const results = await axe(container);

    expect(results.violations).toEqual([]);
  });

  test('has zero axe-core violations in the empty ("no file open") state', async () => {
    const { container } = render(<FileViewer repoId={REPO_ID} result={RESULT} path={null} />);

    const results = await axe(container);

    expect(results.violations).toEqual([]);
  });
});
