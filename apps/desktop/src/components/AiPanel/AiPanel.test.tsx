import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalysisEnvelope } from '@onboard/contract';
import type { AnalysisResult } from '@onboard/contract';
import rawSampleAnalysis from '@onboard/contract/fixtures/sample-analysis.json';
import { AiPanel } from './AiPanel';
import { ipc } from '@/ipc/ipc';
import { DEFAULT_SETTINGS } from '@/ipc/settings-schema';
import { useAiStore } from '@/state/aiStore';
import { useSettingsStore } from '@/state/settingsStore';

const RESULT: AnalysisResult = AnalysisEnvelope.parse(rawSampleAnalysis).result;

/**
 * AI is enabled the way a user enables it — through `update_settings` and
 * `store_ai_key` on the same mock IPC the app uses (`VITE_IPC=mock`), then
 * `loadSettings` — rather than by forcing store state. That keeps this test
 * honest about the gate actually being the settings the backend reports.
 */
async function enableAi(): Promise<void> {
  await ipc.storeAiKey({ provider: 'anthropic', apiKey: 'sk-test-key' });
  await ipc.updateSettings({ ai: { ...DEFAULT_SETTINGS.ai, isEnabled: true, hasStoredKey: true } });
  await useSettingsStore.getState().loadSettings();
}

beforeEach(() => {
  useAiStore.getState().reset();
});

afterEach(async () => {
  await ipc.updateSettings({ ai: DEFAULT_SETTINGS.ai });
  await ipc.clearAiKey({ provider: 'anthropic' });
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, isLoaded: false, isSettingsOpen: false });
  useAiStore.getState().reset();
});

describe('AiPanel with AI off (A5 — the default)', () => {
  test('offers no AI action, explains why, and makes zero ai_* calls', async () => {
    const summarySpy = vi.spyOn(ipc, 'aiProjectSummary');
    const askSpy = vi.spyOn(ipc, 'aiAsk');
    const explainSpy = vi.spyOn(ipc, 'aiExplainModule');

    render(<AiPanel result={RESULT} onOpenFile={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'AI is off' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Summarise this project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask' })).not.toBeInTheDocument();
    expect(summarySpy).not.toHaveBeenCalled();
    expect(askSpy).not.toHaveBeenCalled();
    expect(explainSpy).not.toHaveBeenCalled();
  });

  test('its one control opens Settings — the thing that actually fixes the state', async () => {
    const user = userEvent.setup();
    render(<AiPanel result={RESULT} onOpenFile={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
  });

  test('a credentialed provider with no key is a different state, named separately', () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        ai: { ...DEFAULT_SETTINGS.ai, isEnabled: true, hasStoredKey: false },
      },
    });

    render(<AiPanel result={RESULT} onOpenFile={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'No key stored for anthropic' })).toBeInTheDocument();
  });
});

describe('AiPanel with AI enabled', () => {
  test('the project summary renders the answer and the real payload counts', async () => {
    const user = userEvent.setup();
    await enableAi();
    render(<AiPanel result={RESULT} onOpenFile={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Summarise this project' }));

    expect(await screen.findByRole('heading', { name: 'What this project is' })).toBeInTheDocument();
    expect(screen.getByText(/3 files/)).toHaveTextContent('6144 bytes');
  });

  test('clicking a citation opens that exact path at that exact line', async () => {
    const onOpenFile = vi.fn();
    const user = userEvent.setup();
    await enableAi();
    render(<AiPanel result={RESULT} onOpenFile={onOpenFile} />);

    await user.click(screen.getByRole('button', { name: 'Summarise this project' }));
    const citation = await screen.findByRole('button', {
      name: `Open ${RESULT.importantFilePaths[0]}, line 1`,
    });
    await user.click(citation);

    expect(onOpenFile).toHaveBeenCalledWith(RESULT.importantFilePaths[0], 1);
  });

  test('explaining a module sends the selected moduleId, not a guessed one', async () => {
    const user = userEvent.setup();
    const explainSpy = vi.spyOn(ipc, 'aiExplainModule');
    await enableAi();
    render(<AiPanel result={RESULT} onOpenFile={vi.fn()} />);

    const secondModule = RESULT.modules[1];
    await user.selectOptions(screen.getByLabelText('Module'), secondModule!.id);
    await user.click(screen.getByRole('button', { name: 'Explain this module' }));

    await waitFor(() => {
      expect(explainSpy).toHaveBeenCalledWith({ repoId: RESULT.repo.id, moduleId: secondModule!.id });
    });
    expect(await screen.findByRole('heading', { name: secondModule!.name })).toBeInTheDocument();
  });

  test('asking a question sends the trimmed question and shows the answer', async () => {
    const user = userEvent.setup();
    const askSpy = vi.spyOn(ipc, 'aiAsk');
    await enableAi();
    render(<AiPanel result={RESULT} onOpenFile={vi.fn()} />);

    await user.type(screen.getByLabelText('Question'), '  where is auth handled?  ');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => {
      expect(askSpy).toHaveBeenCalledWith({
        repoId: RESULT.repo.id,
        question: 'where is auth handled?',
      });
    });
    expect(await screen.findByText('where is auth handled?')).toBeInTheDocument();
  });

  test('a repo with no modules gets an explanation, not a button with nothing to explain', async () => {
    await enableAi();
    render(<AiPanel result={{ ...RESULT, modules: [] }} onOpenFile={vi.fn()} />);

    expect(
      screen.getByText(
        'There are no modules to explain — the module map found no directory with enough analysed files.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Explain this module' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Module')).not.toBeInTheDocument();
  });

  test('the Ask button cannot be pressed with an empty question — no control that does nothing', async () => {
    await enableAi();
    render(<AiPanel result={RESULT} onOpenFile={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
  });
});
